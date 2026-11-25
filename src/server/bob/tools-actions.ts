import "server-only";
/**
 * Ask Bob's write actions across the workspace. Every tool:
 *  - validates its input (zod) and resolves names to records server-side;
 *  - prepares a short preview (before → after) that the user approves or
 *    edits — nothing changes until then (except task completion, which has Undo);
 *  - executes through the existing service functions, so permissions,
 *    validation, workspace scoping and the activity log are the app's own;
 *  - returns a short confirmation and a link to the record.
 * No tool accepts SQL or raw table writes.
 */
import { z } from "zod";
import type { ActionLine, ActionNotice } from "@/lib/bob/types";
import { can } from "@/lib/auth/permissions";
import { addDays, formatDayShort, formatTimeRange, rangeKeys } from "@/lib/dates";
import { JOB_STATUS_LABEL } from "@/lib/derive";
import { dateKey, jobStatusSchema, money } from "@/lib/validation";
import type { Absence, Booking, Customer, Job, Person, Task } from "@/lib/types";
import { formatDateInline, gbp, todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";
import { usersInOrg } from "@/server/auth/session";
import * as R from "@/server/services/records";
import * as Team from "@/server/services/team";
import * as Abs from "@/server/services/absences";
import { saveVariation, deleteVariation } from "@/server/services/variations";
import { createUpdate, deleteUpdate } from "@/server/services/updates";
import { listMerchants } from "@/server/services/merchants";
import * as Rep from "@/server/services/handover-reports";
import * as FU from "@/server/services/followups";
import type { ActionTool, PrepareResult } from "./tools";

const id = z.string().min(1).max(80);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const ready = <P>(v: { payload: P; title: string; lines: ActionLine[]; notices?: ActionNotice[]; approveLabel: string; category?: "internal" | "external" }): PrepareResult<P> => ({ ok: true, value: { notices: [], ...v } });
const clarify = (message: string) => ({ ok: false as const, code: "clarify" as const, message });
const blocked = (message: string) => ({ ok: false as const, code: "blocked" as const, message });
const notFound = (what: string) => ({ ok: false as const, code: "not_found" as const, message: `I couldn't find that ${what}.` });
const arrow = (from: string | undefined, to: string) => `${from ? `${from} → ` : ""}${to}`;
const jobLabel = (j: Job) => `${j.customerName} — ${j.title}`;
const days = (from: string, to?: string) => (to && to !== from ? `${formatDayShort(from)} – ${formatDayShort(to)}` : formatDayShort(from));

/* ------------------------------ Name resolution ------------------------------ */

/** Names (or ids) → team members. Ambiguous or unknown names come back as a short question. */
function resolvePeople(ctx: Ctx, refs: string[]): { ok: true; people: Person[] } | { ok: false; message: string } {
  const team = Team.listPeople(ctx).filter((p) => !p.archivedAt);
  const out: Person[] = [];
  for (const raw of refs) {
    const ref = raw.trim().toLowerCase();
    const byId = team.find((p) => p.id === raw);
    if (byId) {
      out.push(byId);
      continue;
    }
    const exact = team.filter((p) => p.name.toLowerCase() === ref);
    const first = team.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === ref);
    const part = team.filter((p) => p.name.toLowerCase().includes(ref));
    const hits = exact.length ? exact : first.length ? first : part;
    if (hits.length === 1) out.push(hits[0]);
    else if (hits.length > 1) return { ok: false, message: `There's more than one ${raw} — ${hits.map((p) => p.name).join(" or ")}?` };
    else return { ok: false, message: `I can't find ${raw} in the team. Who do you mean?` };
  }
  return { ok: true, people: [...new Map(out.map((p) => [p.id, p])).values()] };
}

/** A person or a login user (e.g. Ryan) for task assignment. */
function resolveAssignee(ctx: Ctx, ref: string): { ok: true; personId?: string; userId?: string; name: string } | { ok: false; message: string } {
  const q = ref.trim().toLowerCase();
  if (["me", "myself"].includes(q)) return { ok: true, userId: ctx.userId, name: ctx.userName };
  const users = usersInOrg(ctx.orgId).filter((u) => u.name.toLowerCase() === q || u.name.toLowerCase().split(/\s+/)[0] === q);
  const people = Team.listPeople(ctx).filter((p) => !p.archivedAt && (p.name.toLowerCase() === q || p.name.toLowerCase().split(/\s+/)[0] === q || p.id === ref));
  if (users.length === 1 && (!people.length || people[0].userId === users[0].id)) return { ok: true, userId: users[0].id, personId: people[0]?.id, name: users[0].name };
  if (people.length === 1 && !users.length) return { ok: true, personId: people[0].id, userId: people[0].userId, name: people[0].name };
  const all = [...users.map((u) => u.name), ...people.filter((p) => !users.some((u) => u.id === p.userId)).map((p) => p.name)];
  if (all.length > 1) return { ok: false, message: `There's more than one ${ref} — ${all.join(" or ")}?` };
  return { ok: false, message: `I can't find ${ref} in the team. Who do you mean?` };
}

function clashNotices(ctx: Ctx, draft: Pick<Booking, "date" | "endDate" | "startTime" | "endTime" | "personIds"> & { id?: string }): ActionNotice[] {
  // findClashes covers both other bookings and approved leave/unavailability.
  return Team.findClashes(ctx, draft).map((c) => ({
    tone: "warning" as const,
    text: c.kind === "absence" ? `${c.personName} is off ${c.when}.` : `Clash: ${c.personName} is already on ${c.jobTitle} ${c.when}. Approving books them on both.`,
  }));
}

/* --------------------------------- Customers --------------------------------- */

const customerFields = { name: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().max(200).optional(), phone: z.string().trim().min(5).max(30).optional(), address: z.string().trim().min(3).max(240).optional(), town: z.string().trim().min(2).max(80).optional() };

const createCustomer: ActionTool<{ name: string; email?: string; phone?: string; address?: string; town?: string }> = {
  kind: "action",
  name: "create_customer",
  description: "Add a new customer record. Check with search_customers first that they don't already exist.",
  category: "internal",
  permission: "customers.write",
  confirmation: "always",
  editable: ["name", "email", "phone", "address", "town"],
  schema: z.object({ ...customerFields, name: z.string().trim().min(2).max(120) }),
  prepare(ctx, a) {
    const same = R.listCustomers(ctx).find((c) => c.name.toLowerCase() === a.name.toLowerCase());
    const lines: ActionLine[] = [{ label: "Name", value: a.name, emphasis: true }];
    if (a.email) lines.push({ label: "Email", value: a.email });
    if (a.phone) lines.push({ label: "Phone", value: a.phone });
    if (a.address || a.town) lines.push({ label: "Address", value: [a.address, a.town].filter(Boolean).join(", ") });
    return ready({ payload: a, title: "Add customer", lines, notices: same ? [{ tone: "warning", text: `There's already a customer called ${same.name}${same.town ? ` in ${same.town}` : ""}.` }] : [], approveLabel: "Add customer" });
  },
  execute(ctx, a) {
    const r = R.createCustomer(ctx, a);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: `Added ${r.value.name}.`, undo: undefined, links: [{ label: "Open customer", kind: "customer", id: r.value.id }] };
  },
};

const updateCustomer: ActionTool<{ customerId: string; name?: string; email?: string; phone?: string; address?: string; town?: string }, { customerId: string; patch: Partial<Customer>; previous: Partial<Customer> }> = {
  kind: "action",
  name: "update_customer",
  description: "Correct or change a customer's name, email address, phone number, address or town. Find the customerId with search_customers (or the customer_id on a job).",
  category: "internal",
  permission: "customers.write",
  confirmation: "always",
  editable: ["name", "email", "phone", "address", "town"],
  schema: z.object({ customerId: id, ...customerFields }),
  prepare(ctx, a) {
    const c = R.getCustomer(ctx, a.customerId);
    if (!c) return notFound("customer");
    const patch: Partial<Customer> = {};
    const previous: Partial<Customer> = {};
    const lines: ActionLine[] = [];
    for (const [k, label] of [["name", "Name"], ["email", "Email"], ["phone", "Phone"], ["address", "Address"], ["town", "Town"]] as const) {
      const v = a[k];
      if (v === undefined || v === (c[k] ?? "")) continue;
      patch[k] = v;
      previous[k] = c[k] ?? "";
      lines.push({ label, value: arrow(c[k] || "not set", v), emphasis: true });
    }
    if (!lines.length) return clarify(`${c.name}'s details already match that. What would you like to change?`);
    lines.unshift({ label: "Customer", value: c.name });
    return ready({ payload: { customerId: c.id, patch, previous }, title: "Update customer", lines, approveLabel: "Save changes" });
  },
  execute(ctx, a) {
    const r = R.updateCustomer(ctx, a.customerId, a.patch);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: `${r.value.name}'s details are updated.`, undo: a, links: [{ label: "Open customer", kind: "customer", id: a.customerId }] };
  },
  undo(ctx, u) {
    const { customerId, previous } = u as { customerId: string; previous: Partial<Customer> };
    const r = R.updateCustomer(ctx, customerId, previous);
    return r.ok ? { ok: true, message: "Change undone." } : { ok: false, error: r.error };
  },
};

/* ----------------------------------- Diary ----------------------------------- */

interface BookingArgs { jobId: string; date: string; endDate?: string; startTime?: string; endTime?: string; people?: string[]; notes?: string }

const createBooking: ActionTool<BookingArgs, BookingArgs & { personIds: string[]; allDay: boolean }> = {
  kind: "action",
  name: "create_booking",
  description: "Book work in the diary for a job: date (and end date for several days), optional start/end times (omit for all day) and the people (names). Clashes with other bookings or leave are shown before approval.",
  category: "internal",
  permission: "schedule.manage",
  confirmation: "always",
  editable: ["date", "endDate", "startTime", "endTime"],
  schema: z.object({ jobId: id, date: dateKey, endDate: dateKey.optional(), startTime: time.optional(), endTime: time.optional(), people: z.array(z.string().min(1).max(80)).max(12).optional(), notes: z.string().trim().max(500).optional() }),
  prepare(ctx, a) {
    const j = R.getJob(ctx, a.jobId);
    if (!j) return notFound("job");
    if (a.endDate && a.endDate < a.date) return clarify("The end date is before the start — which days do you mean?");
    if ((a.startTime && !a.endTime) || (!a.startTime && a.endTime)) return clarify("What time does it start and finish? (Or say all day.)");
    if (a.startTime && a.endTime && a.endTime <= a.startTime) return clarify("The finish time is before the start — what times do you mean?");
    const ppl = resolvePeople(ctx, a.people ?? []);
    if (!ppl.ok) return clarify(ppl.message);
    const personIds = ppl.people.map((p) => p.id);
    const draft = { date: a.date, endDate: a.endDate, startTime: a.startTime, endTime: a.endTime, personIds };
    const same = Team.listBookings(ctx).find((b) => b.jobId === j.id && b.date === a.date && (b.endDate ?? b.date) === (a.endDate ?? a.date) && (b.startTime ?? "") === (a.startTime ?? "") && b.personIds.slice().sort().join() === personIds.slice().sort().join());
    if (same) return blocked(`That's already in the diary — ${j.title} ${days(a.date, a.endDate)}.`);
    return ready({
      payload: { ...a, personIds, allDay: !a.startTime },
      title: "Book work",
      lines: [
        { label: "Job", value: jobLabel(j), emphasis: true },
        { label: "When", value: `${days(a.date, a.endDate)}, ${formatTimeRange(a.startTime, a.endTime)}`, emphasis: true },
        { label: "Who", value: ppl.people.length ? ppl.people.map((p) => p.name).join(", ") : "Nobody yet" },
      ],
      notices: clashNotices(ctx, draft),
      approveLabel: "Book it",
    });
  },
  execute(ctx, a) {
    const r = Team.saveBooking(ctx, { jobId: a.jobId, date: a.date, endDate: a.endDate ?? "", allDay: a.allDay, startTime: a.startTime ?? "", endTime: a.endTime ?? "", personIds: a.personIds, notes: a.notes ?? "", confirmOverlap: true });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: `Booked ${days(a.date, a.endDate)}.`, undo: { bookingId: r.value.id }, links: [{ label: "Open diary", kind: "page", id: `/week?w=${a.date}` }, { label: "Open job", kind: "job", id: a.jobId }] };
  },
  undo(ctx, u) {
    const r = Team.deleteBooking(ctx, (u as { bookingId: string }).bookingId);
    return r.ok ? { ok: true, message: "Booking removed." } : { ok: false, error: r.error };
  },
};

interface BookingEdit { bookingId: string; date?: string; endDate?: string; startTime?: string; endTime?: string; allDay?: boolean; people?: string[]; addPeople?: string[]; removePeople?: string[]; jobId?: string }

const updateBooking: ActionTool<BookingEdit, { next: Booking; previous: Booking }> = {
  kind: "action",
  name: "update_booking",
  description: "Reschedule a booking (new date/end date), change its times or make it all day, move it to another job, or change who's on it: people replaces the crew, addPeople/removePeople adjust it. Find bookingId with get_schedule.",
  category: "internal",
  permission: "schedule.manage",
  confirmation: "always",
  editable: ["date", "endDate", "startTime", "endTime"],
  schema: z.object({ bookingId: id, date: dateKey.optional(), endDate: dateKey.optional(), startTime: time.optional(), endTime: time.optional(), allDay: z.boolean().optional(), jobId: id.optional(), people: z.array(z.string().max(80)).max(12).optional(), addPeople: z.array(z.string().max(80)).max(12).optional(), removePeople: z.array(z.string().max(80)).max(12).optional() }),
  prepare(ctx, a) {
    const b = Team.listBookings(ctx).find((x) => x.id === a.bookingId);
    if (!b) return notFound("booking");
    const job = R.getJob(ctx, a.jobId ?? b.jobId);
    if (!job) return notFound("job");
    let personIds = [...b.personIds];
    if (a.people) {
      const r = resolvePeople(ctx, a.people);
      if (!r.ok) return clarify(r.message);
      personIds = r.people.map((p) => p.id);
    }
    if (a.addPeople?.length) {
      const r = resolvePeople(ctx, a.addPeople);
      if (!r.ok) return clarify(r.message);
      personIds = [...new Set([...personIds, ...r.people.map((p) => p.id)])];
    }
    if (a.removePeople?.length) {
      const r = resolvePeople(ctx, a.removePeople);
      if (!r.ok) return clarify(r.message);
      personIds = personIds.filter((pid) => !r.people.some((p) => p.id === pid));
    }
    // Moving the start keeps the same length unless a new end date is given.
    const len = rangeKeys(b.date, b.endDate ?? b.date).length - 1;
    const date = a.date ?? b.date;
    const endDate = a.endDate ?? (a.date && len > 0 ? addDays(date, len) : a.date ? undefined : b.endDate);
    const allDay = a.allDay ?? (a.startTime ? false : !b.startTime);
    const next: Booking = { ...b, jobId: job.id, date, endDate: endDate && endDate !== date ? endDate : undefined, startTime: allDay ? undefined : a.startTime ?? b.startTime, endTime: allDay ? undefined : a.endTime ?? b.endTime, personIds };
    if (next.endDate && next.endDate < next.date) return clarify("The end date would be before the start — which days do you mean?");
    if (!allDay && (!next.startTime || !next.endTime)) return clarify("What time does it start and finish?");
    if (next.startTime && next.endTime && next.endTime <= next.startTime) return clarify("The finish time is before the start — what times do you mean?");
    const names = new Map(Team.listPeople(ctx).map((p) => [p.id, p.name]));
    const crew = (ids: string[]) => (ids.length ? ids.map((i) => names.get(i) ?? "someone").join(", ") : "nobody");
    const lines: ActionLine[] = [{ label: "Job", value: jobLabel(job) }];
    if (next.date !== b.date || next.endDate !== b.endDate) lines.push({ label: "Days", value: arrow(days(b.date, b.endDate), days(next.date, next.endDate)), emphasis: true });
    if (next.startTime !== b.startTime || next.endTime !== b.endTime) lines.push({ label: "Time", value: arrow(formatTimeRange(b.startTime, b.endTime), formatTimeRange(next.startTime, next.endTime)), emphasis: true });
    if (personIds.join() !== b.personIds.join()) lines.push({ label: "Who", value: arrow(crew(b.personIds), crew(personIds)), emphasis: true });
    if (job.id !== b.jobId) lines.push({ label: "Moved from", value: R.getJob(ctx, b.jobId)?.title ?? "another job" });
    if (lines.length === 1) return clarify("That booking already looks like that. What would you like to change?");
    return ready({ payload: { next, previous: b }, title: "Move booking", lines, notices: clashNotices(ctx, { ...next, id: b.id }), approveLabel: "Save changes" });
  },
  execute() {
    return { ok: false, error: "not set" };
  },
};
// Undo for booking edits restores the previous version.
updateBooking.execute = (ctx, p) => {
  const { next, previous } = p;
  const r = Team.saveBooking(ctx, { id: next.id, jobId: next.jobId, date: next.date, endDate: next.endDate ?? "", allDay: !next.startTime, startTime: next.startTime ?? "", endTime: next.endTime ?? "", personIds: next.personIds, notes: next.notes ?? "", confirmOverlap: true });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: "Booking updated.", undo: { previous }, links: [{ label: "Open diary", kind: "page", id: `/week?w=${next.date}` }, { label: "Open job", kind: "job", id: next.jobId }] };
};
updateBooking.undo = (ctx, u) => {
  const b = (u as { previous: Booking }).previous;
  const r = Team.saveBooking(ctx, { id: b.id, jobId: b.jobId, date: b.date, endDate: b.endDate ?? "", allDay: !b.startTime, startTime: b.startTime ?? "", endTime: b.endTime ?? "", personIds: b.personIds, notes: b.notes ?? "", confirmOverlap: true });
  return r.ok ? { ok: true, message: "Booking put back." } : { ok: false, error: r.error };
};

const cancelBooking: ActionTool<{ bookingId: string }, { booking: Booking }> = {
  kind: "action",
  name: "cancel_booking",
  description: "Remove a booking from the diary (a cancellation — needs approval). Find bookingId with get_schedule.",
  category: "internal",
  permission: "schedule.manage",
  confirmation: "always",
  schema: z.object({ bookingId: id }),
  prepare(ctx, a) {
    const b = Team.listBookings(ctx).find((x) => x.id === a.bookingId);
    if (!b) return notFound("booking");
    const j = R.getJob(ctx, b.jobId);
    const names = new Map(Team.listPeople(ctx).map((p) => [p.id, p.name]));
    return ready({
      payload: { booking: b },
      title: "Cancel booking",
      lines: [
        { label: "Job", value: j ? jobLabel(j) : "Job", emphasis: true },
        { label: "When", value: `${days(b.date, b.endDate)}, ${formatTimeRange(b.startTime, b.endTime)}` },
        { label: "Who", value: b.personIds.map((i) => names.get(i) ?? "someone").join(", ") || "Nobody" },
      ],
      notices: [{ tone: "warning", text: "This takes it out of the diary for everyone booked." }],
      approveLabel: "Cancel booking",
    });
  },
  execute(ctx, { booking }) {
    const r = Team.deleteBooking(ctx, booking.id);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: "Booking cancelled.", undo: { booking }, links: [{ label: "Open diary", kind: "page", id: `/week?w=${booking.date}` }] };
  },
  undo(ctx, u) {
    const b = (u as { booking: Booking }).booking;
    const r = Team.saveBooking(ctx, { jobId: b.jobId, date: b.date, endDate: b.endDate ?? "", allDay: !b.startTime, startTime: b.startTime ?? "", endTime: b.endTime ?? "", personIds: b.personIds, notes: b.notes ?? "", confirmOverlap: true });
    return r.ok ? { ok: true, message: "Booking put back." } : { ok: false, error: r.error };
  },
};

/* ----------------------------- Team and holidays ----------------------------- */

const addPerson: ActionTool<{ name: string; kind: "employee" | "subcontractor"; trade?: string; company?: string; phone?: string; email?: string }> = {
  kind: "action",
  name: "add_person",
  description: "Add an employee or subcontractor to the team (they can be booked straight away; no login is created).",
  category: "internal",
  permission: "team.manage",
  confirmation: "always",
  editable: ["name", "trade", "company", "phone", "email"],
  schema: z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(["employee", "subcontractor"]), trade: z.string().trim().max(80).optional(), company: z.string().trim().max(120).optional(), phone: z.string().trim().max(30).optional(), email: z.string().trim().email().optional() }),
  prepare(ctx, a) {
    const same = Team.listPeople(ctx).find((p) => p.name.toLowerCase() === a.name.toLowerCase() && !p.archivedAt);
    if (same) return blocked(`${same.name} is already in the team.`);
    const lines: ActionLine[] = [{ label: "Name", value: a.name, emphasis: true }, { label: "Type", value: a.kind === "subcontractor" ? "Subcontractor" : "Employee" }];
    if (a.trade) lines.push({ label: "Trade", value: a.trade });
    if (a.company) lines.push({ label: "Company", value: a.company });
    if (a.phone) lines.push({ label: "Phone", value: a.phone });
    return ready({ payload: a, title: "Add to team", lines, approveLabel: "Add person" });
  },
  execute(ctx, a) {
    const r = Team.createPerson(ctx, a);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: `${r.value.name} is in the team.`, undo: { personId: r.value.id }, links: [{ label: "Open team", kind: "page", id: "/team" }] };
  },
  undo(ctx, u) {
    const r = Team.archivePerson(ctx, (u as { personId: string }).personId, true);
    return r.ok ? { ok: true, message: "Removed from the team." } : { ok: false, error: r.error };
  },
};

const ABS_LABEL: Record<Absence["kind"], string> = { holiday: "Holiday", unavailable: "Unavailable", sick: "Sick", other: "Away" };
type AbsArgs = { person: string; startDate: string; endDate?: string; part?: "am" | "pm"; kind?: Absence["kind"] };

function leaveNotices(ctx: Ctx, personId: string, startDate: string, endDate: string, part: "am" | "pm" | undefined, ignoreId?: string): { notices: ActionNotice[]; duplicate?: Absence } {
  const existing = Abs.listAbsences(ctx).filter((x) => x.id !== ignoreId && x.personId === personId && ["approved", "pending"].includes(x.status) && x.startDate <= endDate && x.endDate >= startDate);
  const duplicate = existing.find((x) => x.startDate === startDate && x.endDate === endDate && (x.part ?? "") === (part ?? ""));
  const notices: ActionNotice[] = existing.filter((x) => x !== duplicate).map((x) => ({ tone: "warning", text: `Overlaps leave already in: ${ABS_LABEL[x.kind].toLowerCase()} ${days(x.startDate, x.endDate)}${x.status === "pending" ? " (requested)" : ""}.` }));
  const jobs = new Map(R.listJobs(ctx).map((j) => [j.id, j]));
  void jobs;
  for (const b of Abs.bookingsAffectedBy(ctx, { personId, startDate, endDate, part })) notices.push({ tone: "warning", text: `They're booked on ${b.jobTitle} ${formatDayShort(b.date)} — that booking will need someone else.` });
  return { notices, duplicate };
}

const bookAbsence: ActionTool<AbsArgs, { personId: string; startDate: string; endDate: string; part?: "am" | "pm"; kind: Absence["kind"] }> = {
  kind: "action",
  name: "book_holiday",
  description: "Book holiday or unavailable/sick/away dates for a team member (owners/admins). Shows overlapping leave and bookings it affects before approval.",
  category: "internal",
  permission: "team.manage",
  confirmation: "always",
  editable: ["startDate", "endDate"],
  schema: z.object({ person: z.string().min(1).max(80), startDate: dateKey, endDate: dateKey.optional(), part: z.enum(["am", "pm"]).optional(), kind: z.enum(["holiday", "unavailable", "sick", "other"]).optional() }),
  prepare(ctx, a) {
    const r = resolvePeople(ctx, [a.person]);
    if (!r.ok) return clarify(r.message);
    const p = r.people[0];
    const endDate = a.endDate ?? a.startDate;
    if (endDate < a.startDate) return clarify("The last day is before the first — which dates do you mean?");
    if (a.part && endDate !== a.startDate) return clarify("A half day has to be a single date — which day?");
    const kind = a.kind ?? "holiday";
    const { notices, duplicate } = leaveNotices(ctx, p.id, a.startDate, endDate, a.part);
    if (duplicate) return blocked(`${p.name} already has ${ABS_LABEL[duplicate.kind].toLowerCase()} booked for ${days(duplicate.startDate, duplicate.endDate)}.`);
    return ready({
      payload: { personId: p.id, startDate: a.startDate, endDate, part: a.part, kind },
      title: `Book ${ABS_LABEL[kind].toLowerCase()}`,
      lines: [
        { label: "Who", value: p.name, emphasis: true },
        { label: "Dates", value: `${days(a.startDate, endDate)}${a.part ? ` (${a.part.toUpperCase()} only)` : ""} · ${rangeKeys(a.startDate, endDate).length} day${a.startDate === endDate ? "" : "s"}`, emphasis: true },
        { label: "Type", value: ABS_LABEL[kind] },
      ],
      notices,
      approveLabel: "Book it",
    });
  },
  execute(ctx, a) {
    const r = Abs.addAbsence(ctx, a);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: `${ABS_LABEL[r.value.kind]} booked${r.value.status === "pending" ? " (waiting for approval)" : ""}.`, undo: { absenceId: r.value.id }, links: [{ label: "Open holidays", kind: "page", id: "/team?view=holidays" }] };
  },
  undo(ctx, u) {
    const r = Abs.cancelAbsence(ctx, (u as { absenceId: string }).absenceId);
    return r.ok ? { ok: true, message: "Leave cancelled." } : { ok: false, error: r.error };
  },
};

const findLeave = (ctx: Ctx, absenceId: string) => Abs.listAbsences(ctx).find((x) => x.id === absenceId);
const personName = (ctx: Ctx, pid: string) => Team.listPeople(ctx).find((p) => p.id === pid)?.name ?? "Someone";

const amendAbsence: ActionTool<{ absenceId: string; startDate?: string; endDate?: string; part?: "am" | "pm" | "full"; kind?: Absence["kind"] }, { absenceId: string; next: { startDate: string; endDate: string; part?: "am" | "pm"; kind: Absence["kind"] } }> = {
  kind: "action",
  name: "amend_holiday",
  description: "Change the dates (or type) of leave already booked. Find absenceId with list_holidays.",
  category: "internal",
  permission: "team.manage",
  confirmation: "always",
  editable: ["startDate", "endDate"],
  schema: z.object({ absenceId: id, startDate: dateKey.optional(), endDate: dateKey.optional(), part: z.enum(["am", "pm", "full"]).optional(), kind: z.enum(["holiday", "unavailable", "sick", "other"]).optional() }),
  prepare(ctx, a) {
    const x = findLeave(ctx, a.absenceId);
    if (!x || !["approved", "pending"].includes(x.status)) return notFound("leave");
    const next = { startDate: a.startDate ?? x.startDate, endDate: a.endDate ?? (a.startDate && x.endDate < a.startDate ? a.startDate : x.endDate), part: a.part === "full" ? undefined : a.part ?? x.part, kind: a.kind ?? x.kind };
    if (next.endDate < next.startDate) return clarify("The last day would be before the first — which dates do you mean?");
    const { notices, duplicate } = leaveNotices(ctx, x.personId, next.startDate, next.endDate, next.part, x.id);
    if (duplicate) return blocked("Those dates are already booked as separate leave.");
    return ready({
      payload: { absenceId: x.id, next },
      title: "Change leave",
      lines: [
        { label: "Who", value: personName(ctx, x.personId), emphasis: true },
        { label: "Dates", value: arrow(days(x.startDate, x.endDate), days(next.startDate, next.endDate)), emphasis: true },
        ...(next.kind !== x.kind ? [{ label: "Type", value: arrow(ABS_LABEL[x.kind], ABS_LABEL[next.kind]) }] : []),
      ],
      notices,
      approveLabel: "Save changes",
    });
  },
  execute(ctx, a) {
    try {
      const r = Abs.amendAbsence(ctx, a.absenceId, a.next);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, message: "Leave updated.", links: [{ label: "Open holidays", kind: "page", id: "/team?view=holidays" }] };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't change it." };
    }
  },
};

const cancelAbsence: ActionTool<{ absenceId: string }> = {
  kind: "action",
  name: "cancel_holiday",
  description: "Cancel booked or requested leave (needs approval). Find absenceId with list_holidays.",
  category: "internal",
  permission: "team.manage",
  confirmation: "always",
  schema: z.object({ absenceId: id }),
  prepare(ctx, a) {
    const x = findLeave(ctx, a.absenceId);
    if (!x || !["approved", "pending"].includes(x.status)) return notFound("leave");
    return ready({ payload: a, title: "Cancel leave", lines: [{ label: "Who", value: personName(ctx, x.personId), emphasis: true }, { label: "Leave", value: `${ABS_LABEL[x.kind]}, ${days(x.startDate, x.endDate)}` }], approveLabel: "Cancel leave" });
  },
  execute(ctx, a) {
    const r = Abs.cancelAbsence(ctx, a.absenceId);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: "Leave cancelled.", links: [{ label: "Open holidays", kind: "page", id: "/team?view=holidays" }] };
  },
};

const decideAbsence: ActionTool<{ absenceId: string; decision: "approve" | "decline" }> = {
  kind: "action",
  name: "decide_holiday_request",
  description: "Approve or decline a leave request that's waiting. Find absenceId with list_holidays (status 'waiting for approval').",
  category: "internal",
  permission: "team.manage",
  confirmation: "always",
  schema: z.object({ absenceId: id, decision: z.enum(["approve", "decline"]) }),
  prepare(ctx, a) {
    const x = findLeave(ctx, a.absenceId);
    if (!x) return notFound("leave request");
    if (x.status !== "pending") return blocked(`That request has already been ${x.status}.`);
    const { notices } = a.decision === "approve" ? leaveNotices(ctx, x.personId, x.startDate, x.endDate, x.part, x.id) : { notices: [] };
    return ready({ payload: a, title: a.decision === "approve" ? "Approve leave" : "Decline leave", lines: [{ label: "Who", value: personName(ctx, x.personId), emphasis: true }, { label: "Leave", value: `${ABS_LABEL[x.kind]}, ${days(x.startDate, x.endDate)}` }], notices, approveLabel: a.decision === "approve" ? "Approve" : "Decline" });
  },
  execute(ctx, a) {
    const r = Abs.decideAbsence(ctx, a.absenceId, a.decision);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: a.decision === "approve" ? "Leave approved." : "Leave declined.", links: [{ label: "Open holidays", kind: "page", id: "/team?view=holidays" }] };
  },
};

/* ------------------------------------ Jobs ----------------------------------- */

interface JobEdit { jobId: string; title?: string; description?: string; siteAddress?: string; location?: string; what3words?: string; status?: Job["status"]; startDate?: string; nextAction?: string; quotedValue?: number; depositRequired?: number }

const updateJob: ActionTool<JobEdit, { jobId: string; patch: Partial<Job>; status?: Job["status"]; previous: Partial<Job> }> = {
  kind: "action",
  name: "update_job",
  description: "Edit a job: title, description, site address, town, what3words, status, start date, next step, price (quotedValue) or deposit. Money changes need money access.",
  category: "internal",
  permission: "jobs.write",
  confirmation: "always",
  editable: ["title", "siteAddress", "what3words", "nextAction"],
  schema: z.object({ jobId: id, title: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(4000).optional(), siteAddress: z.string().trim().max(240).optional(), location: z.string().trim().min(2).max(120).optional(), what3words: z.string().trim().max(80).optional(), status: jobStatusSchema.optional(), startDate: dateKey.optional(), nextAction: z.string().trim().max(240).optional(), quotedValue: money.optional(), depositRequired: money.optional() }),
  prepare(ctx, a) {
    const j = R.getJob(ctx, a.jobId);
    if (!j) return notFound("job");
    if ((a.quotedValue !== undefined || a.depositRequired !== undefined) && !can(ctx.role, "finance.read")) return blocked("Your account can't change prices.");
    const patch: Partial<Job> = {};
    const previous: Partial<Job> = {};
    const lines: ActionLine[] = [{ label: "Job", value: jobLabel(j) }];
    const fmt: Record<string, (v: unknown) => string> = { quotedValue: (v) => gbp(v as number), depositRequired: (v) => gbp(v as number), startDate: (v) => formatDateInline(v as string), what3words: (v) => `///${String(v).replace(/^\/+/, "")}` };
    const labels: Record<string, string> = { title: "Title", description: "Description", siteAddress: "Site address", location: "Town", what3words: "what3words", startDate: "Start date", nextAction: "Next step", quotedValue: "Price", depositRequired: "Deposit" };
    for (const k of Object.keys(labels) as (keyof JobEdit)[]) {
      const v = a[k];
      if (v === undefined || v === (j as unknown as Record<string, unknown>)[k]) continue;
      (patch as Record<string, unknown>)[k] = v;
      (previous as Record<string, unknown>)[k] = (j as unknown as Record<string, unknown>)[k] ?? "";
      const f = fmt[k] ?? ((x: unknown) => String(x));
      const old = (j as unknown as Record<string, unknown>)[k];
      lines.push({ label: labels[k], value: k === "description" ? String(v).slice(0, 120) : arrow(old !== undefined && old !== "" ? f(old) : "not set", f(v)), emphasis: true });
    }
    if (a.status && a.status !== j.status) {
      lines.push({ label: "Status", value: arrow(JOB_STATUS_LABEL[j.status], JOB_STATUS_LABEL[a.status]), emphasis: true });
      previous.status = j.status;
    }
    if (lines.length === 1) return clarify("Nothing to change there — what would you like updated on the job?");
    const notices: ActionNotice[] = [];
    if (patch.quotedValue !== undefined) notices.push({ tone: "info", text: "This changes the agreed price used for billing. Approved variations stay separate." });
    return ready({ payload: { jobId: j.id, patch, status: a.status !== j.status ? a.status : undefined, previous }, title: "Update job", lines, notices, approveLabel: "Save changes" });
  },
  execute(ctx, a) {
    if (Object.keys(a.patch).length) {
      const r = R.updateJob(ctx, a.jobId, a.patch);
      if (!r.ok) return { ok: false, error: r.error };
    }
    if (a.status) {
      const r = R.setJobStatus(ctx, a.jobId, a.status);
      if (!r.ok) return { ok: false, error: r.error };
    }
    return { ok: true, message: "Job updated.", undo: { jobId: a.jobId, previous: a.previous }, links: [{ label: "Open job", kind: "job", id: a.jobId }] };
  },
  undo(ctx, u) {
    const { jobId, previous } = u as { jobId: string; previous: Partial<Job> };
    const { status, ...rest } = previous;
    if (Object.keys(rest).length) R.updateJob(ctx, jobId, rest);
    if (status) R.setJobStatus(ctx, jobId, status);
    return { ok: true, message: "Change undone." };
  },
};

const recordVariation: ActionTool<{ jobId: string; description: string; amount: number; amountsAre?: "inclusive" | "exclusive" | "no_vat"; approved?: boolean }> = {
  kind: "action",
  name: "record_variation",
  description: "Record a variation (a change to the agreed work and price) on a job. approved true if the customer has agreed it; otherwise it's recorded as proposed. VAT treatment defaults to the company's settings.",
  category: "internal",
  permission: "jobs.write",
  confirmation: "always",
  editable: ["description"],
  schema: z.object({ jobId: id, description: z.string().trim().min(2).max(200), amount: money.refine((n) => n > 0, "Amount must be more than £0"), amountsAre: z.enum(["inclusive", "exclusive", "no_vat"]).optional(), approved: z.boolean().optional() }),
  prepare(ctx, a) {
    const j = R.getJob(ctx, a.jobId);
    if (!j) return notFound("job");
    if (!can(ctx.role, "finance.read")) return blocked("Your account can't change prices.");
    const fin = ctx.org.finance;
    const amountsAre = a.amountsAre ?? (fin.vatRegistered === false ? "no_vat" : fin.pricesAre ?? undefined);
    if (!amountsAre) return clarify("Is that plus VAT, including VAT, or no VAT?");
    const vat = { inclusive: "including VAT", exclusive: "plus VAT", no_vat: "no VAT" }[amountsAre];
    return ready({ payload: { ...a, amountsAre }, title: "Record variation", lines: [{ label: "Job", value: jobLabel(j) }, { label: "Change", value: a.description, emphasis: true }, { label: "Amount", value: `${gbp(a.amount)} ${vat}`, emphasis: true }, { label: "Status", value: a.approved ? "Approved by the customer" : "Proposed (not yet agreed)" }], approveLabel: "Record it" });
  },
  execute(ctx, a) {
    const r = saveVariation(ctx, { jobId: a.jobId, description: a.description, amount: a.amount, amountsAre: a.amountsAre, status: a.approved ? "approved" : "proposed" });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: `Variation recorded${a.approved ? " and approved" : ""}.`, undo: { variationId: r.value.id }, links: [{ label: "Open job", kind: "job", id: a.jobId }] };
  },
  undo(ctx, u) {
    const r = deleteVariation(ctx, (u as { variationId: string }).variationId);
    return r.ok ? { ok: true, message: "Variation removed." } : { ok: false, error: r.error };
  },
};

const addProgressNote: ActionTool<{ jobId: string; note: string; stage?: "before" | "in_progress" | "finished" }> = {
  kind: "action",
  name: "add_progress_note",
  description: "Add a progress update to a job's timeline (what's been done on site). For internal office notes use add_note instead.",
  category: "internal",
  permission: "notes.write",
  confirmation: "always",
  editable: ["note"],
  schema: z.object({ jobId: id, note: z.string().trim().min(2).max(2000), stage: z.enum(["before", "in_progress", "finished"]).optional() }),
  prepare(ctx, a) {
    const j = R.getJob(ctx, a.jobId);
    if (!j) return notFound("job");
    return ready({ payload: a, title: "Add progress update", lines: [{ label: "Job", value: jobLabel(j) }, { label: "Update", value: a.note, emphasis: true }], approveLabel: "Add update" });
  },
  execute(ctx, a, meta) {
    const r = createUpdate(ctx, { jobId: a.jobId, note: a.note, stage: a.stage ?? "in_progress", clientRef: `bob:${meta.actionId}` });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: "Update added to the job.", undo: { updateId: r.value.id }, links: [{ label: "Open job", kind: "job", id: a.jobId }] };
  },
  undo(ctx, u) {
    const r = deleteUpdate(ctx, (u as { updateId: string }).updateId);
    return r.ok ? { ok: true, message: "Update removed." } : { ok: false, error: r.error };
  },
};

/* --------------------------------- Materials --------------------------------- */

const STATUS_WORD = { to_order: "To order", ordered: "Ordered", on_site: "Delivered" } as const;

const updateMaterial: ActionTool<{ materialId: string; quantity?: string; unit?: string; neededBy?: string; merchant?: string; status?: "to_order" | "ordered" | "on_site"; orderRef?: string; expectedDelivery?: string }, { materialId: string; next: Record<string, unknown>; previous: Record<string, unknown> }> = {
  kind: "action",
  name: "update_material",
  description: "Change a material on a job list: quantity/unit, needed-by date, merchant (by name), status (to_order, ordered, on_site), order reference or expected delivery. Find materialId with list_materials.",
  category: "internal",
  permission: "materials.write",
  confirmation: "always",
  editable: ["quantity", "orderRef"],
  schema: z.object({ materialId: id, quantity: z.string().trim().min(1).max(30).optional(), unit: z.string().trim().max(20).optional(), neededBy: dateKey.optional(), merchant: z.string().trim().max(120).optional(), status: z.enum(["to_order", "ordered", "on_site"]).optional(), orderRef: z.string().trim().max(80).optional(), expectedDelivery: dateKey.optional() }),
  prepare(ctx, a) {
    const m = Team.listMaterials(ctx).find((x) => x.id === a.materialId);
    if (!m) return notFound("item");
    const merchants = listMerchants(ctx).filter((x) => !x.archivedAt);
    let merchantId: string | undefined;
    if (a.merchant) {
      const q = a.merchant.toLowerCase();
      const hits = merchants.filter((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase().split(" ")[0]));
      if (hits.length > 1) return clarify(`Which merchant — ${hits.map((x) => x.name).join(" or ")}?`);
      if (!hits.length) return clarify(`I can't find a merchant called ${a.merchant}. Add them in Merchants first, or tell me which one.`);
      merchantId = hits[0].id;
    }
    const j = R.getJob(ctx, m.jobId);
    const next: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    const lines: ActionLine[] = [{ label: "Item", value: `${m.item}${j ? ` · ${j.title}` : ""}` }];
    const set = (k: string, label: string, v: unknown, old: unknown, f: (x: unknown) => string = String) => {
      if (v === undefined || v === old) return;
      next[k] = v;
      previous[k] = old ?? "";
      lines.push({ label, value: arrow(old ? f(old) : "not set", f(v)), emphasis: true });
    };
    set("quantity", "Quantity", a.quantity, m.quantity);
    set("unit", "Unit", a.unit, m.unit);
    set("neededBy", "Needed by", a.neededBy, m.neededBy, (x) => formatDateInline(String(x)));
    set("merchantId", "Merchant", merchantId, m.merchantId, (x) => merchants.find((y) => y.id === x)?.name ?? m.supplier ?? "—");
    set("status", "Status", a.status, m.status, (x) => STATUS_WORD[x as keyof typeof STATUS_WORD]);
    set("orderRef", "Order ref", a.orderRef, m.orderRef);
    set("expectedDelivery", "Delivery", a.expectedDelivery, m.expectedDelivery, (x) => formatDateInline(String(x)));
    if (lines.length === 1) return clarify("That item already looks like that — what would you like to change?");
    return ready({ payload: { materialId: m.id, next, previous: { ...m } }, title: "Update material", lines, approveLabel: "Save changes" });
  },
  execute(ctx, a) {
    const m = Team.listMaterials(ctx).find((x) => x.id === a.materialId);
    if (!m) return { ok: false, error: "That item no longer exists." };
    const r = Team.saveMaterial(ctx, { ...m, ...a.next, id: m.id });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: "Materials list updated.", undo: { previous: a.previous }, links: [{ label: "Open job", kind: "job", id: m.jobId }] };
  },
  undo(ctx, u) {
    const r = Team.saveMaterial(ctx, (u as { previous: Record<string, unknown> }).previous);
    return r.ok ? { ok: true, message: "Change undone." } : { ok: false, error: r.error };
  },
};

/* ----------------------------------- Tasks ----------------------------------- */

const createTask: ActionTool<{ title: string; dueDate: string; assignee?: string; priority?: "high" | "normal" | "low"; jobId?: string; customerId?: string }, { title: string; dueDate: string; assignedPersonId?: string; assignedUserId?: string; priority?: "high" | "normal" | "low"; relatedType?: "job"; relatedId?: string; customerId?: string; who: string }> = {
  kind: "action",
  name: "create_task",
  description: "Create a task or reminder with a due date, optionally for someone (a team member or Ryan/Luke by name), a priority, and linked to a job or customer.",
  category: "internal",
  permission: "tasks.write",
  confirmation: "always",
  editable: ["title", "dueDate"],
  schema: z.object({ title: z.string().trim().min(2).max(200), dueDate: dateKey, assignee: z.string().max(80).optional(), priority: z.enum(["high", "normal", "low"]).optional(), jobId: id.optional(), customerId: id.optional() }),
  prepare(ctx, a) {
    let who = "You";
    let assignedPersonId: string | undefined;
    let assignedUserId: string | undefined;
    if (a.assignee) {
      const r = resolveAssignee(ctx, a.assignee);
      if (!r.ok) return clarify(r.message);
      who = r.name;
      assignedPersonId = r.personId;
      assignedUserId = r.userId;
    }
    const j = a.jobId ? R.getJob(ctx, a.jobId) : undefined;
    if (a.jobId && !j) return notFound("job");
    const dup = R.listTasks(ctx).find((t) => !t.done && t.title.toLowerCase() === a.title.toLowerCase() && t.dueDate === a.dueDate);
    if (dup) return blocked(`That reminder is already set for ${formatDateInline(a.dueDate)}.`);
    return ready({
      payload: { title: a.title, dueDate: a.dueDate, assignedPersonId, assignedUserId, priority: a.priority, relatedType: j ? "job" : undefined, relatedId: j?.id, customerId: a.customerId ?? j?.customerId, who },
      title: "Add task",
      lines: [
        { label: "Task", value: a.title, emphasis: true },
        { label: "For", value: who },
        { label: "Due", value: formatDateInline(a.dueDate) },
        ...(a.priority && a.priority !== "normal" ? [{ label: "Priority", value: a.priority === "high" ? "High" : "Low" }] : []),
        ...(j ? [{ label: "Job", value: jobLabel(j) }] : []),
      ],
      approveLabel: "Add task",
    });
  },
  execute(ctx, a) {
    const r = R.createTask(ctx, { title: a.title, dueDate: a.dueDate, assignedPersonId: a.assignedPersonId, assignedUserId: a.assignedUserId, priority: a.priority, relatedType: a.relatedType, relatedId: a.relatedId, customerId: a.customerId });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: `Task added for ${a.who === ctx.userName ? "you" : a.who}, due ${formatDateInline(a.dueDate)}.`, undo: { taskId: r.value.id }, links: [{ label: "Open tasks", kind: "page", id: "/tasks" }] };
  },
  undo(ctx, u) {
    const r = R.deleteTask(ctx, (u as { taskId: string }).taskId);
    return r.ok ? { ok: true, message: "Task removed." } : { ok: false, error: r.error };
  },
};

const updateTask: ActionTool<{ taskId: string; title?: string; dueDate?: string; assignee?: string; priority?: "high" | "normal" | "low" }, { taskId: string; patch: Partial<Task>; previous: Partial<Task> }> = {
  kind: "action",
  name: "update_task",
  description: "Change a task: title, due date, who it's for, or priority. Find taskId with list_tasks_detailed.",
  category: "internal",
  permission: "tasks.write",
  confirmation: "always",
  editable: ["title", "dueDate"],
  schema: z.object({ taskId: id, title: z.string().trim().min(2).max(200).optional(), dueDate: dateKey.optional(), assignee: z.string().max(80).optional(), priority: z.enum(["high", "normal", "low"]).optional() }),
  prepare(ctx, a) {
    const t = R.listTasks(ctx).find((x) => x.id === a.taskId);
    if (!t) return notFound("task");
    const patch: Partial<Task> = {};
    const previous: Partial<Task> = { title: t.title, dueDate: t.dueDate, assignedPersonId: t.assignedPersonId, assignedUserId: t.assignedUserId, priority: t.priority };
    const lines: ActionLine[] = [{ label: "Task", value: t.title }];
    if (a.title && a.title !== t.title) { patch.title = a.title; lines.push({ label: "Title", value: arrow(t.title, a.title), emphasis: true }); }
    if (a.dueDate && a.dueDate !== t.dueDate) { patch.dueDate = a.dueDate; lines.push({ label: "Due", value: arrow(formatDateInline(t.dueDate), formatDateInline(a.dueDate)), emphasis: true }); }
    if (a.priority && a.priority !== (t.priority ?? "normal")) { patch.priority = a.priority; lines.push({ label: "Priority", value: arrow(t.priority ?? "normal", a.priority), emphasis: true }); }
    if (a.assignee) {
      const r = resolveAssignee(ctx, a.assignee);
      if (!r.ok) return clarify(r.message);
      patch.assignedPersonId = r.personId;
      patch.assignedUserId = r.userId;
      lines.push({ label: "For", value: r.name, emphasis: true });
    }
    if (lines.length === 1) return clarify("What would you like to change on that task?");
    return ready({ payload: { taskId: t.id, patch, previous }, title: "Change task", lines, approveLabel: "Save changes" });
  },
  execute(ctx, a) {
    const r = R.updateTask(ctx, a.taskId, a.patch);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: "Task updated.", undo: a, links: [{ label: "Open tasks", kind: "page", id: "/tasks" }] };
  },
  undo(ctx, u) {
    const { taskId, previous } = u as { taskId: string; previous: Partial<Task> };
    const r = R.updateTask(ctx, taskId, previous);
    return r.ok ? { ok: true, message: "Change undone." } : { ok: false, error: r.error };
  },
};

const completeTask: ActionTool<{ taskId: string; done?: boolean }> = {
  kind: "action",
  name: "complete_task",
  description: "Mark a task done (or reopen it with done=false). Runs straight away with Undo.",
  category: "internal",
  permission: "tasks.write",
  confirmation: "undoable",
  schema: z.object({ taskId: id, done: z.boolean().optional() }),
  prepare(ctx, a) {
    const t = R.listTasks(ctx).find((x) => x.id === a.taskId);
    if (!t) return notFound("task");
    return ready({ payload: a, title: a.done === false ? "Reopen task" : "Task done", lines: [{ label: "Task", value: t.title, emphasis: true }], approveLabel: "Done" });
  },
  execute(ctx, a) {
    const r = R.setTaskDone(ctx, a.taskId, a.done !== false);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: a.done === false ? "Task reopened." : `Done: ${r.value.title}.`, undo: { taskId: a.taskId, done: a.done !== false }, links: [{ label: "Open tasks", kind: "page", id: "/tasks" }] };
  },
  undo(ctx, u) {
    const { taskId, done } = u as { taskId: string; done: boolean };
    const r = R.setTaskDone(ctx, taskId, !done);
    return r.ok ? { ok: true, message: "Undone." } : { ok: false, error: r.error };
  },
};

/* --------------------------- Enquiries and quotes --------------------------- */

const createEnquiry: ActionTool<{ customerName: string; title: string; description?: string; location: string; source?: "phone" | "email" | "website" | "instagram" | "manual"; phone?: string; email?: string }> = {
  kind: "action",
  name: "create_enquiry",
  description: "Log a new enquiry (e.g. from a phone call): customer name, what they want, town, and phone/email if given.",
  category: "internal",
  permission: "enquiries.write",
  confirmation: "always",
  editable: ["customerName", "title", "location", "phone", "email"],
  schema: z.object({ customerName: z.string().trim().min(2).max(120), title: z.string().trim().min(2).max(120), description: z.string().trim().max(2000).optional(), location: z.string().trim().min(2).max(120), source: z.enum(["phone", "email", "website", "instagram", "manual"]).optional(), phone: z.string().trim().max(30).optional(), email: z.string().trim().email().optional() }),
  prepare(ctx, a) {
    const dup = R.listEnquiries(ctx).find((e) => e.customerName.toLowerCase() === a.customerName.toLowerCase() && e.title.toLowerCase() === a.title.toLowerCase() && !["won", "lost"].includes(e.status));
    if (dup) return blocked(`There's already an open enquiry from ${dup.customerName} for ${dup.title.toLowerCase()}.`);
    return ready({ payload: a, title: "Add enquiry", lines: [{ label: "Customer", value: a.customerName, emphasis: true }, { label: "Wants", value: `${a.title}, ${a.location}`, emphasis: true }, ...(a.phone ? [{ label: "Phone", value: a.phone }] : []), ...(a.email ? [{ label: "Email", value: a.email }] : [])], approveLabel: "Add enquiry" });
  },
  execute(ctx, a) {
    const r = R.createEnquiry(ctx, { customerName: a.customerName, title: a.title, description: a.description ?? a.title, location: a.location, source: a.source ?? "phone", phone: a.phone, email: a.email });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: `Enquiry added for ${a.customerName}.`, links: [{ label: "Open enquiry", kind: "enquiry", id: r.value.id }] };
  },
};

const updateQuote: ActionTool<{ quoteId: string; amount?: number; description?: string; followUpDate?: string }, { quoteId: string; patch: Record<string, unknown> }> = {
  kind: "action",
  name: "update_quote",
  description: "Edit a quote's amount, description or follow-up date (not once accepted or declined). Find quoteId with list_quotes.",
  category: "internal",
  permission: "quotes.write",
  confirmation: "always",
  editable: ["description"],
  schema: z.object({ quoteId: id, amount: money.refine((n) => n > 0, "Amount must be more than £0").optional(), description: z.string().trim().min(2).max(200).optional(), followUpDate: dateKey.optional() }),
  prepare(ctx, a) {
    const q = R.listQuotes(ctx).find((x) => x.id === a.quoteId);
    if (!q) return notFound("quote");
    if (q.status === "accepted" || q.status === "declined") return blocked(`That quote has already been ${q.status}.`);
    const c = R.getCustomer(ctx, q.customerId);
    const patch: Record<string, unknown> = {};
    const lines: ActionLine[] = [{ label: "Quote", value: `${c?.name ?? "Customer"} — ${q.description}` }];
    if (a.amount !== undefined && a.amount !== q.amount) { patch.amount = a.amount; lines.push({ label: "Amount", value: arrow(gbp(q.amount), gbp(a.amount)), emphasis: true }); }
    if (a.description && a.description !== q.description) { patch.description = a.description; lines.push({ label: "Description", value: a.description, emphasis: true }); }
    if (a.followUpDate && a.followUpDate !== q.followUpDate) { patch.followUpDate = a.followUpDate; lines.push({ label: "Follow up", value: arrow(q.followUpDate ? formatDateInline(q.followUpDate) : "not set", formatDateInline(a.followUpDate)), emphasis: true }); }
    if (lines.length === 1) return clarify("What would you like to change on the quote?");
    return ready({ payload: { quoteId: q.id, patch }, title: "Change quote", lines, notices: q.status === "sent" ? [{ tone: "info", text: "This changes Bob's record. If the customer already has the quote, send them the new figure." }] : [], approveLabel: "Save changes" });
  },
  execute(ctx, a) {
    const r = R.updateQuote(ctx, a.quoteId, a.patch);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: "Quote updated.", links: r.value.enquiryId ? [{ label: "Open enquiry", kind: "enquiry", id: r.value.enquiryId }] : undefined };
  },
};

const convertToJob: ActionTool<{ quoteId?: string; enquiryId?: string; siteAddress?: string; startDate?: string }> = {
  kind: "action",
  name: "convert_to_job",
  description: "Turn an accepted quote (or won enquiry) into a job, carrying the customer, site and price across. Safe to repeat — it never makes a second job.",
  category: "internal",
  permission: "jobs.write",
  confirmation: "always",
  schema: z.object({ quoteId: id.optional(), enquiryId: id.optional(), siteAddress: z.string().trim().max(240).optional(), startDate: dateKey.optional() }),
  prepare(ctx, a) {
    if (!a.quoteId && !a.enquiryId) return clarify("Which quote or enquiry should become the job?");
    const q = a.quoteId ? R.listQuotes(ctx).find((x) => x.id === a.quoteId) : undefined;
    if (a.quoteId && !q) return notFound("quote");
    const e = R.getEnquiry(ctx, a.enquiryId ?? q?.enquiryId ?? "");
    if (q?.jobId) return blocked("That quote is already a job.");
    const lines: ActionLine[] = [{ label: "Customer", value: e?.customerName ?? R.getCustomer(ctx, q!.customerId)?.name ?? "Customer", emphasis: true }, { label: "Work", value: q?.description ?? e?.title ?? "" }];
    if (q && can(ctx.role, "finance.read")) lines.push({ label: "Price", value: gbp(q.amount) });
    if (a.startDate) lines.push({ label: "Start", value: formatDateInline(a.startDate) });
    return ready({ payload: a, title: "Create job from quote", lines, notices: q && q.status !== "accepted" ? [{ tone: "info", text: "The quote will be marked as accepted." }] : [], approveLabel: "Create job" });
  },
  execute(ctx, a) {
    const r = R.convertToJob(ctx, a);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: r.value.existed ? "That job already exists — nothing new was made." : `Job created: ${r.value.title}.`, links: [{ label: "Open job", kind: "job", id: r.value.id }] };
  },
};

/* ---------------------------------- Handover --------------------------------- */

const createHandover: ActionTool<{ jobId: string; includeCosts?: boolean }> = {
  kind: "action",
  name: "create_handover_report",
  description: "Start the customer handover report for a finished job and have Bob draft the summary from its updates and photos. The user then checks photos and wording on the job's Handover tab before anything is shared. Owners/admins.",
  category: "internal",
  permission: "jobs.write",
  confirmation: "always",
  schema: z.object({ jobId: id, includeCosts: z.boolean().optional() }),
  prepare(ctx, a) {
    if (ctx.role !== "owner" && ctx.role !== "office") return blocked("Handover reports are prepared by owners and admins.");
    const j = R.getJob(ctx, a.jobId);
    if (!j) return notFound("job");
    const existing = Rep.listReports(ctx).find((r) => r.jobId === j.id);
    return ready({ payload: a, title: existing ? "Redraft handover report" : "Create handover report", lines: [{ label: "Job", value: jobLabel(j), emphasis: true }, { label: "Bob will", value: "draft the summary and scope from the job's updates, select its photos, and leave it for you to check" }, { label: "Costs", value: a.includeCosts ? "Agreed figures included (no internal costs or margins)" : "Not included" }], notices: existing ? [{ tone: "warning", text: "There's already a report — this replaces its draft text (your saved PDFs stay)." }] : [], approveLabel: existing ? "Redraft" : "Create report" });
  },
  async execute(ctx, a) {
    let rep = Rep.listReports(ctx).find((r) => r.jobId === a.jobId);
    if (!rep) {
      const c = Rep.createReport(ctx, { jobId: a.jobId });
      if (!c.ok) return { ok: false, error: c.error };
      rep = c.value;
    }
    if (a.includeCosts !== undefined && rep.selection.includeCosts !== a.includeCosts) {
      const s = Rep.saveReport(ctx, { id: rep.id, baseRevision: rep.revision, selection: { ...rep.selection, includeCosts: a.includeCosts } });
      if (s.ok) rep = s.value;
    }
    const g = await Rep.generateReport(ctx, { id: rep.id, baseRevision: rep.revision });
    if (!g.ok) return { ok: false, error: g.error };
    return { ok: true, message: g.value.usedAi ? "Draft ready — check the photos and wording before you share it." : "Report started from the job's details (the AI draft wasn't available) — check and edit it before sharing.", links: [{ label: "Open handover", kind: "page", id: `/jobs/${a.jobId}?tab=handover` }] };
  },
};

const amendHandoverSummary: ActionTool<{ jobId: string; summary: string }> = {
  kind: "action",
  name: "amend_handover_summary",
  description: "Replace the summary paragraph of a job's handover report with new wording the user has given or agreed. Owners/admins.",
  category: "internal",
  permission: "jobs.write",
  confirmation: "always",
  editable: ["summary"],
  schema: z.object({ jobId: id, summary: z.string().trim().min(10).max(3000) }),
  prepare(ctx, a) {
    if (ctx.role !== "owner" && ctx.role !== "office") return blocked("Handover reports are edited by owners and admins.");
    const rep = Rep.listReports(ctx).find((r) => r.jobId === a.jobId);
    if (!rep) return clarify("There's no handover report for that job yet — shall I create one?");
    const sec = rep.content.sections.find((s) => s.kind === "text") ;
    return ready({ payload: a, title: "Change report summary", lines: [{ label: "Section", value: sec?.heading ?? "Summary" }, { label: "New wording", value: a.summary, emphasis: true }], approveLabel: "Save wording" });
  },
  execute(ctx, a) {
    const rep = Rep.listReports(ctx).find((r) => r.jobId === a.jobId);
    if (!rep) return { ok: false, error: "There's no handover report for that job yet." };
    const idx = rep.content.sections.findIndex((s) => s.kind === "text");
    if (idx < 0) return { ok: false, error: "The report has no summary section to change." };
    const sections = rep.content.sections.map((s, i) => (i === idx ? { ...s, body: a.summary } : s));
    const r = Rep.saveReport(ctx, { id: rep.id, baseRevision: rep.revision, content: { ...rep.content, sections } });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, message: "Summary updated.", links: [{ label: "Open handover", kind: "page", id: `/jobs/${a.jobId}?tab=handover` }] };
  },
};


/* ------------------------------ Customer follow-ups ------------------------------ */

const sendHandoverEmail: ActionTool<
  { jobId: string; to?: string; subject?: string; body?: string; includeReview?: boolean; draftOnly?: boolean },
  { jobId: string; to: string; subject: string; body: string; includeReview: boolean; draftOnly: boolean; customer: string }
> = {
  kind: "action",
  name: "send_handover_email",
  description:
    "Email a customer their finished handover report (PDF attached) with a thank-you message from the business's template and, if review requests are switched on, a link to leave an honest Google review. Pass the job_id (find it with search_jobs). includeReview defaults to on when available; Bob only asks once per job. draftOnly saves an editable draft without sending (use for 'draft a thank-you email'). With no email account connected it always saves a draft. Never ask only for positive reviews.",
  category: "external",
  permission: "email.send",
  confirmation: "always",
  editable: ["to", "subject", "body"],
  schema: z.object({ jobId: id, to: z.string().trim().max(200).optional(), subject: z.string().trim().max(200).optional(), body: z.string().trim().max(8000).optional(), includeReview: z.boolean().optional(), draftOnly: z.boolean().optional() }),
  prepare(ctx, a) {
    const c = FU.composeFollowUp(ctx, { jobId: a.jobId, includeReview: a.includeReview });
    if (!c.ok) return blocked(c.error);
    const v = c.value;
    const payload = { jobId: a.jobId, to: a.to || v.to, subject: a.subject || v.subject, body: a.body || v.body, includeReview: a.includeReview === false ? false : v.includeReview, draftOnly: !!a.draftOnly || !v.mailbox.connected, customer: R.getJob(ctx, a.jobId)?.customerName ?? "the customer" };
    // If the customer asked for a review but the body came from elsewhere, make sure the link is actually in it.
    if (payload.includeReview && !/https:\/\//.test(payload.body)) payload.includeReview = false;
    if (!payload.draftOnly) {
      const problem = FU.checkSend(ctx, payload);
      if (problem) return blocked(problem);
    } else if (!payload.to && !a.draftOnly) {
      return clarify(`What's ${payload.customer.split(" ")[0]}'s email address?`);
    }
    const notices: ActionNotice[] = [];
    if (payload.draftOnly && !v.mailbox.connected) notices.push({ tone: "info", text: "No email account is connected, so Bob saves this as a draft — nothing is sent. Copy it into your own email with the PDF attached." });
    if (v.mailbox.simulated && !payload.draftOnly) notices.push({ tone: "demo", text: "Demo workspace — nothing will actually be sent. The send is simulated and recorded." });
    if (v.reviewAlreadyRequested) notices.push({ tone: "info", text: `A review was already requested on ${v.reviewAlreadyRequested.slice(0, 10)}, so this email doesn't ask again.` });
    return {
      ok: true,
      value: {
        payload,
        title: payload.draftOnly ? "Save thank-you email draft" : "Send handover email",
        lines: [
          { label: "To", value: payload.to || "(add their email)", emphasis: true },
          { label: "Attachment", value: v.attachment?.filename ?? "Handover report PDF" },
          { label: "Review request", value: payload.includeReview ? "Yes — Google review link included" : "No" },
          ...(payload.draftOnly ? [] : [{ label: "Via", value: v.mailbox.label ?? "Email" }]),
        ],
        preview: { kind: "email", to: payload.to, subject: payload.subject, body: payload.body },
        notices,
        approveLabel: payload.draftOnly ? "Save draft" : v.mailbox.simulated ? "Send (demo)" : "Send email",
        simulated: v.mailbox.simulated,
      },
    };
  },
  async execute(ctx, a, meta) {
    if (a.draftOnly) {
      const r = FU.saveFollowUpDraft(ctx, a);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, message: `Thank-you email for ${a.customer} saved as a draft — nothing has been sent. Send it from your own email with the PDF attached, then tap “I've sent it myself” on the job.`, links: [{ label: "Open handover", kind: "page", id: `/jobs/${a.jobId}?tab=handover` }] };
    }
    const r = await FU.sendFollowUp(ctx, a, meta.idempotencyKey);
    if (!r.ok) return { ok: false, error: r.error };
    const f = r.value;
    return {
      ok: true,
      message: `${f.sentVia === "demo" ? "Demo: simulated sending" : "Sent"} the handover report to ${a.customer}${f.reviewRequested ? " with a review request" : ""}.${f.reminderStatus === "scheduled" ? ` A reminder is set for ${formatDateInline(f.reminderDueAt!)}.` : ""}`,
      links: [{ label: "Open handover", kind: "page", id: `/jobs/${a.jobId}?tab=handover` }],
    };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const workspaceActionTools: ActionTool<any, any>[] = [
  createCustomer, updateCustomer,
  createBooking, updateBooking, cancelBooking,
  addPerson, bookAbsence, amendAbsence, cancelAbsence, decideAbsence,
  updateJob, recordVariation, addProgressNote,
  updateMaterial,
  createTask, updateTask, completeTask,
  createEnquiry, updateQuote, convertToJob,
  createHandover, amendHandoverSummary,
  sendHandoverEmail,
];

export const _forTests = { resolvePeople, resolveAssignee, todayKey };
