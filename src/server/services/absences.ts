import "server-only";
/**
 * Holidays, leave and availability for Team people.
 *
 *  - Employees (with a login) request full or half days; owners/admins
 *    approve or decline. Owners/admins can also record leave directly.
 *  - Policy (Settings → Team & holidays, default on): a main user may record
 *    their own leave as approved.
 *  - Subcontractors record "Unavailable" dates; those take effect straight away
 *    (it's their availability, not a request).
 *  - Reasons are private: only the requester and owners/admins see them.
 *  - Dates are plain YYYY-MM-DD keys compared as strings: no time zone ever
 *    touches them, so a holiday can't slip a day around the clock change.
 */
import { z } from "zod";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { formatDayShort, rangeKeys } from "@/lib/dates";
import { uid } from "@/lib/utils";
import { scoped, tx } from "@/server/db";
import { fail, ok, type Ctx, type Result } from "@/server/context";
import { audit } from "./records";
import { myPerson } from "./team";

const now = () => new Date().toISOString();
const dateKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Choose a date");

const input = z
  .object({
    personId: z.string().min(3).max(80).optional(),
    kind: z.enum(["holiday", "unavailable", "sick", "other"]).default("holiday"),
    startDate: dateKey,
    endDate: dateKey.optional().or(z.literal("")).transform((v) => v || undefined),
    part: z.enum(["am", "pm", "full"]).optional().transform((v) => (v === "full" ? undefined : v)),
    reason: z.string().trim().max(300).optional().or(z.literal("")).transform((v) => v || undefined),
  })
  .transform((v) => ({ ...v, endDate: v.endDate ?? v.startDate }))
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "The last day can't be before the first" })
  .refine((v) => !v.part || v.endDate === v.startDate, { path: ["part"], message: "A half day is a single date" })
  .refine((v) => rangeKeys(v.startDate, v.endDate).length <= 366, { path: ["endDate"], message: "Keep it to a year or less" });

export const isManager = (ctx: Ctx) => can(ctx.role, "team.manage");
const selfApprove = (ctx: Ctx) => ctx.org.leavePolicy?.managersSelfApprove ?? true;

export const ABSENCE_LABEL: Record<Absence["kind"], string> = { holiday: "Holiday", unavailable: "Unavailable", sick: "Sick", other: "Away" };

/** What this person may see. Managers: everything. Site team: approved/pending dates, no reasons. */
export function listAbsences(ctx: Ctx): Absence[] {
  const rows = scoped(ctx).list<Absence>("absences", { order: "start_date" });
  if (isManager(ctx)) return rows;
  if (!can(ctx.role, "schedule.read")) return [];
  const me = myPerson(ctx);
  return rows.filter((a) => a.status === "approved" || a.status === "pending").map((a) => (a.personId === me?.id ? a : { ...a, reason: undefined }));
}

/** A worker's own leave (My work). */
export function myAbsences(ctx: Ctx): Absence[] {
  const me = myPerson(ctx);
  if (!me) return [];
  return scoped(ctx).list<Absence>("absences", { where: "person_id = ? AND status != 'cancelled'", params: [me.id], order: "start_date" });
}

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}

const describe = (a: Pick<Absence, "startDate" | "endDate" | "part">) =>
  `${formatDayShort(a.startDate)}${a.endDate !== a.startDate ? `–${formatDayShort(a.endDate)}` : ""}${a.part ? ` (${a.part === "am" ? "morning" : "afternoon"})` : ""}`;

/** Does an absence overlap a booking? Half days only clash with the matching part of the day. */
export function absenceOverlapsBooking(a: Pick<Absence, "startDate" | "endDate" | "part">, b: Pick<Booking, "date" | "endDate" | "startTime" | "endTime">): boolean {
  const bEnd = b.endDate ?? b.date;
  if (bEnd < a.startDate || a.endDate < b.date) return false;
  if (!a.part || !b.startTime || !b.endTime) return true;
  return a.part === "am" ? b.startTime < "13:00" : b.endTime > "12:00";
}

export interface AffectedBooking {
  bookingId: string;
  jobId: string;
  jobTitle: string;
  date: string;
}

export function bookingsAffectedBy(ctx: Ctx, a: Pick<Absence, "personId" | "startDate" | "endDate" | "part">): AffectedBooking[] {
  const jobs = new Map(scoped(ctx).list<Job>("jobs").map((j) => [j.id, j]));
  return scoped(ctx)
    .list<Booking>("bookings", { where: "date <= ? AND COALESCE(end_date, date) >= ?", params: [a.endDate, a.startDate] })
    .filter((b) => b.personIds.includes(a.personId) && absenceOverlapsBooking(a, b))
    .map((b) => ({ bookingId: b.id, jobId: b.jobId, jobTitle: jobs.get(b.jobId)?.title ?? "a job", date: b.date }));
}

/** Approved absences that a draft booking would clash with (used by saveBooking). */
export function absenceClashes(ctx: Ctx, draft: Pick<Booking, "date" | "endDate" | "startTime" | "endTime" | "personIds">): { personId: string; absence: Absence }[] {
  if (!draft.personIds.length) return [];
  const out: { personId: string; absence: Absence }[] = [];
  const rows = scoped(ctx).list<Absence>("absences", { where: "status = 'approved' AND start_date <= ? AND end_date >= ?", params: [draft.endDate ?? draft.date, draft.date] });
  for (const a of rows) if (draft.personIds.includes(a.personId) && absenceOverlapsBooking(a, draft)) out.push({ personId: a.personId, absence: a });
  return out;
}

export const absenceWhen = describe;

/**
 * Request or record leave/unavailability.
 * Managers can record for anyone (approved straight away). Everyone else can
 * only add their own: employees' holiday is a request; "Unavailable" dates
 * (subcontractors) are recorded as they are.
 */
export function addAbsence(ctx: Ctx, raw: unknown): Result<Absence & { affected: AffectedBooking[] }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return fail("invalid", "Check the dates.", fieldErrors(parsed.error.issues));
  const v = parsed.data;
  const db = scoped(ctx);
  const me = myPerson(ctx);
  const manager = isManager(ctx);
  const personId = manager ? (v.personId ?? me?.id) : me?.id;
  if (!manager && v.personId && v.personId !== me?.id) return fail("forbidden", "You can only add your own leave.");
  if (!personId) return fail("invalid", manager ? "Choose who it's for." : "Your login isn't linked to a Team record yet. Ask the office to link it.", { personId: "Choose a person" });
  const person = db.get<Person>("people", personId);
  if (!person || person.archivedAt) return fail("not_found", "Person not found", { personId: "Choose a person" });
  if (!manager && !can(ctx.role, "mywork.read")) return fail("forbidden", "Your account can't add leave.");
  // Only managers record sickness or "other"; crews choose holiday or unavailable.
  const kind = manager ? v.kind : person.kind === "subcontractor" ? "unavailable" : v.kind === "unavailable" ? "unavailable" : "holiday";
  const own = personId === me?.id;
  const status: Absence["status"] = manager ? (own && !selfApprove(ctx) ? "pending" : "approved") : kind === "unavailable" ? "approved" : "pending";
  const a: Absence = {
    id: uid("abs"),
    personId,
    kind,
    startDate: v.startDate,
    endDate: v.endDate,
    part: v.part,
    status,
    reason: v.reason,
    requestedBy: ctx.userName,
    requestedByUserId: ctx.userId,
    decidedBy: status === "approved" ? ctx.userName : undefined,
    decidedAt: status === "approved" ? now() : undefined,
    createdAt: now(),
    updatedAt: now(),
  };
  tx(() => {
    db.insert("absences", a);
    const what = status === "pending" ? `${ABSENCE_LABEL[kind]} requested` : manager && !own ? `${ABSENCE_LABEL[kind]} recorded` : `${ABSENCE_LABEL[kind]} added`;
    audit(ctx, status === "pending" ? "leave.requested" : "leave.recorded", `${what} for ${person.name}: ${describe(a)}`, "person", personId);
  });
  return ok({ ...a, affected: status === "approved" ? bookingsAffectedBy(ctx, a) : [] });
}

export function decideAbsence(ctx: Ctx, id: string, decision: unknown): Result<Absence & { affected: AffectedBooking[] }> {
  if (!isManager(ctx)) return fail("forbidden", "Only an owner or admin can approve leave.");
  if (decision !== "approve" && decision !== "decline") return fail("invalid", "Approve or decline.");
  const db = scoped(ctx);
  const a = db.get<Absence>("absences", id);
  if (!a) return fail("not_found", "Leave request not found");
  if (a.status !== "pending") return fail("conflict", `That request is already ${a.status}.`);
  const me = myPerson(ctx);
  if (a.personId === me?.id && !selfApprove(ctx)) return fail("forbidden", "Your own leave needs approving by the other main user (Settings → Team & holidays).");
  const person = db.get<Person>("people", a.personId);
  const status = decision === "approve" ? "approved" : "declined";
  const out = tx(() => {
    const u = db.update<Absence>("absences", id, { status, decidedBy: ctx.userName, decidedAt: now(), updatedAt: now() })!;
    audit(ctx, `leave.${status}`, `${ABSENCE_LABEL[a.kind]} ${status} for ${person?.name ?? "someone"}: ${describe(a)}`, "person", a.personId);
    return u;
  });
  return ok({ ...out, affected: status === "approved" ? bookingsAffectedBy(ctx, out) : [] });
}

/** Cancel leave: the person themselves (their own) or a manager. The diary updates straight away. */
export function cancelAbsence(ctx: Ctx, id: string): Result<Absence> {
  const db = scoped(ctx);
  const a = db.get<Absence>("absences", id);
  const me = myPerson(ctx);
  if (!a || (!isManager(ctx) && a.personId !== me?.id)) return fail("not_found", "Leave not found");
  if (a.status === "cancelled" || a.status === "declined") return fail("conflict", `That leave is already ${a.status}.`);
  const person = db.get<Person>("people", a.personId);
  const out = tx(() => {
    const u = db.update<Absence>("absences", id, { status: "cancelled", updatedAt: now() })!;
    audit(ctx, "leave.cancelled", `${ABSENCE_LABEL[a.kind]} cancelled for ${person?.name ?? "someone"}: ${describe(a)}`, "person", a.personId);
    return u;
  });
  return ok(out);
}
