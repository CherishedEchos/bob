import "server-only";
/**
 * Read tools that give Ask Bob structured, permission-aware access to the
 * workspace: diary bookings, team assignments, availability and holidays,
 * materials and merchants, job profiles (crew, materials, tasks, updates,
 * variations, costs, invoices, handover reports), quotes, tasks, jobs ready
 * to invoice, a morning briefing and someone's priorities.
 *
 * Each tool fetches only what the question needs (no whole-database dumps),
 * from the same services the app uses, scoped to the signed-in user's
 * workspace and role. Merchant account references, password-manager links
 * and private leave reasons are never returned.
 */
import { z } from "zod";
import type { Card } from "@/lib/bob/types";
import { can } from "@/lib/auth/permissions";
import { addDays, formatTimeRange, rangeKeys, weekStart } from "@/lib/dates";
import { bookingDays, bookingEndDate, bookingsOnDay } from "@/lib/schedule";
import { ENQUIRY_STATUS_LABEL, EXPENSE_CATEGORY_LABEL, JOB_STATUS_LABEL, invoiceBalance, isInvoiceOverdue, needsReply } from "@/lib/derive";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { formatDateInline, gbp, todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";
import { usersInOrg } from "@/server/auth/session";
import * as R from "@/server/services/records";
import * as F from "@/server/services/finance";
import * as Rep from "@/server/services/reports";
import * as Bill from "@/server/services/billing";
import { listBookings, listMaterials, listPeople } from "@/server/services/team";
import { listAbsences } from "@/server/services/absences";
import { listMerchants } from "@/server/services/merchants";
import { listVariations } from "@/server/services/variations";
import { listUpdates } from "@/server/services/updates";
import { listReports, listReportVersions } from "@/server/services/handover-reports";
import { morningBriefing } from "./briefing";
import { findConflicts } from "@/lib/diary";
import { reviewRequestStatus } from "@/server/services/followups";
import { resolveJobs } from "./resolve";
import type { ReadTool } from "./tools";

const id = z.string().min(1).max(80);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const ABSENCE_LABEL: Record<Absence["kind"], string> = { holiday: "holiday", unavailable: "unavailable", sick: "sick", other: "away" };
const isManager = (ctx: Ctx) => ctx.role === "owner" || ctx.role === "office";

function names(ctx: Ctx) {
  const people = listPeople(ctx);
  const byId = new Map(people.map((p) => [p.id, p]));
  const jobs = new Map(R.listJobs(ctx).map((j) => [j.id, j]));
  return { people, byId, jobs };
}

const personOut = (p: Person) => ({ person_id: p.id, name: p.name, type: p.kind, trade: p.trade, company: p.company });

function bookingOut(b: Booking, day: string | undefined, jobs: Map<string, Job>, byId: Map<string, Person>) {
  const j = jobs.get(b.jobId);
  const days = bookingDays(b);
  return {
    booking_id: b.id,
    date: day ?? b.date,
    end_date: bookingEndDate(b) !== b.date ? bookingEndDate(b) : undefined,
    day_of: days.length > 1 && day ? `day ${days.indexOf(day) + 1} of ${days.length}` : undefined,
    time: formatTimeRange(b.startTime, b.endTime),
    job_id: b.jobId,
    job: j ? `${j.customerName} — ${j.title}` : "Unknown job",
    town: j?.location,
    site: j?.siteAddress,
    people: b.personIds.map((pid) => byId.get(pid)?.name ?? "someone"),
    unassigned: !b.personIds.length,
  };
}

/** Find a team member, subcontractor or login user by name (first name is enough when unique). */
function findPeopleByName(ctx: Ctx, name: string) {
  const q = name.trim().toLowerCase();
  const people = listPeople(ctx).filter((p) => !p.archivedAt);
  const users = usersInOrg(ctx.orgId);
  const match = (n: string) => n.toLowerCase() === q || n.toLowerCase().split(/\s+/)[0] === q || n.toLowerCase().includes(q);
  return { people: people.filter((p) => match(p.name)), users: users.filter((u) => match(u.name)) };
}

function absencesIn(ctx: Ctx, from: string, to: string) {
  return listAbsences(ctx).filter((a) => ["approved", "pending"].includes(a.status) && a.startDate <= to && a.endDate >= from);
}

export const workspaceReadTools: ReadTool<unknown>[] = [
  {
    kind: "read",
    name: "list_review_requests",
    description: "Finished handovers and, for each customer, whether the thank-you email was sent, whether a Google review was requested, and the reminder status. Use for 'which customers haven't been asked for a review?'. Bob can't see whether a review was actually left — never say one was.",
    permission: "email.send",
    schema: z.object({}),
    run(ctx) {
      const rows = reviewRequestStatus(ctx);
      return { data: { finished_handovers: rows, not_yet_asked: rows.filter((r) => !r.review_requested).map((r) => r.job), note: "Review requests are recorded when sent; whether a customer actually left a review isn't known to Bob." } };
    },
  },
  {
    kind: "read",
    name: "draft_payment_reminder",
    description: "Prepare a polite payment reminder for an unpaid invoice (shown as a draft to copy, or to send with send_email if email is connected). Uses the invoice's real amount, reference and due date. Nothing is sent.",
    permission: "finance.read",
    schema: z.object({ invoice_id: id }),
    run(ctx, { invoice_id }: { invoice_id: string }) {
      const inv = F.getInvoice(ctx, invoice_id);
      if (!inv || inv.status === "draft" || inv.status === "void") return { data: { error: "That invoice isn't one that's been sent." } };
      const owed = invoiceBalance(inv);
      if (owed <= 0) return { data: { error: "That invoice is already paid." } };
      const c = R.getCustomer(ctx, inv.customerId);
      const ref = inv.number ?? inv.draftRef;
      const first = c?.name.replace(/^the\s+/i, "").split(/\s+/)[0] ?? "there";
      const overdue = isInvoiceOverdue(inv);
      const subject = `Invoice ${ref}${overdue ? " — now overdue" : " — reminder"}`;
      const body = `Hi ${first},\n\nJust a friendly reminder that invoice ${ref} for ${gbp(owed)}${inv.dueDate ? ` ${overdue ? "was due on" : "is due on"} ${formatDateInline(inv.dueDate)}` : ""}${overdue ? " and is now overdue" : ""}. If you've already paid, please ignore this and thank you.\n\n${ctx.org.assistant.signOff}`;
      return { data: { to: c?.email, subject, body, amount_owed: owed, overdue }, cards: [{ type: "draft", to: c?.email ?? c?.phone ?? "", subject, body, note: "Not sent — copy it, or ask me to send it if email is connected." } as Card] };
    },
  } as ReadTool<{ invoice_id: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "get_schedule",
    description:
      "Diary bookings for a day or date range: who is working where, on which job, at what time, and any booking with nobody assigned. Use for 'where is everyone tomorrow', 'what's booked next week', 'where is Liam on Friday', 'who is on the Patels' job'. Dates are YYYY-MM-DD (today's calendar is in the system prompt).",
    permission: "schedule.read",
    schema: z.object({ from: dateKey, to: dateKey.optional(), person: z.string().max(80).optional().describe("A person's name to filter to"), job_id: id.optional() }),
    run(ctx, a: { from: string; to?: string; person?: string; job_id?: string }) {
      const to = a.to && a.to >= a.from ? a.to : a.from;
      const keys = rangeKeys(a.from, to).slice(0, 31);
      const { byId, jobs } = names(ctx);
      const who = a.person ? findPeopleByName(ctx, a.person).people.map((p) => p.id) : undefined;
      if (a.person && !who?.length) return { data: { error: `No one called "${a.person}" in the team.` } };
      const all = listBookings(ctx).filter((b) => (!a.job_id || b.jobId === a.job_id) && (!who || b.personIds.some((pid) => who.includes(pid))));
      const days = keys.map((d) => ({ date: d, bookings: bookingsOnDay(all, d).map((b) => bookingOut(b, d, jobs, byId)) }));
      const off = absencesIn(ctx, a.from, to).map((x) => ({ name: byId.get(x.personId)?.name, kind: ABSENCE_LABEL[x.kind], from: x.startDate, to: x.endDate, part: x.part, pending: x.status === "pending" }));
      return { data: { from: a.from, to, days, people_off: off, total_bookings: days.reduce((s, d) => s + d.bookings.length, 0) } };
    },
  } as ReadTool<{ from: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "find_double_bookings",
    description:
      "Clashes in the diary for a date range: anyone booked on two overlapping jobs, or booked while on approved holiday/unavailable. Use for 'have I double-booked anyone this week?', 'any clashes next week?'. Default range: this week (Monday–Sunday).",
    permission: "schedule.read",
    schema: z.object({ from: dateKey.optional(), to: dateKey.optional() }),
    run(ctx, a: { from?: string; to?: string }) {
      const mon = weekStart(todayKey());
      const from = a.from ?? mon;
      const to = a.to && a.to >= from ? a.to : a.from ? a.from : addDays(mon, 6);
      const { byId, jobs } = names(ctx);
      const bookings = listBookings(ctx);
      const absences = listAbsences(ctx);
      const found = findConflicts(bookings, absences, from, to).map((c) => {
        const bs = c.bookingIds.map((id) => bookings.find((b) => b.id === id)).filter(Boolean) as Booking[];
        const leave = c.absenceId ? absences.find((x) => x.id === c.absenceId) : undefined;
        return {
          person: byId.get(c.personId)?.name ?? "Someone",
          date: c.day,
          kind: c.kind === "double" ? "booked on two jobs at once" : `booked while on ${leave ? ABSENCE_LABEL[leave.kind].toLowerCase() : "leave"}`,
          bookings: bs.map((b) => bookingOut(b, c.day, jobs, byId)),
        };
      });
      return { data: { from, to, clashes: found, count: found.length } };
    },
  } as ReadTool<{ from?: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "get_team_availability",
    description:
      "For each employee and subcontractor on a given day (or range): booked (which job), off (holiday/unavailable, approved or pending) or free. Use for 'who is available next Thursday', 'who's free tomorrow', 'can Ellie do Monday'.",
    permission: "schedule.read",
    schema: z.object({ from: dateKey, to: dateKey.optional(), type: z.enum(["employee", "subcontractor", "all"]).default("all") }),
    run(ctx, a: { from: string; to?: string; type: string }) {
      const to = a.to && a.to >= a.from ? a.to : a.from;
      const keys = rangeKeys(a.from, to).slice(0, 14);
      const { people, byId, jobs } = names(ctx);
      const bookings = listBookings(ctx);
      const off = absencesIn(ctx, a.from, to);
      const team = people.filter((p) => !p.archivedAt && (a.type === "all" || p.kind === a.type));
      const days = keys.map((d) => ({
        date: d,
        people: team.map((p) => {
          const leave = off.find((x) => x.personId === p.id && x.startDate <= d && x.endDate >= d);
          const booked = bookingsOnDay(bookings.filter((b) => b.personIds.includes(p.id)), d);
          return {
            ...personOut(p),
            status: leave && !leave.part ? (leave.status === "pending" ? "leave requested" : "off") : booked.length ? "booked" : leave ? `off ${leave.part}` : "free",
            leave: leave ? { kind: ABSENCE_LABEL[leave.kind], pending: leave.status === "pending", part: leave.part } : undefined,
            booked_on: booked.map((b) => bookingOut(b, d, jobs, byId)).map((x) => `${x.job} (${x.town ?? "?"}, ${x.time})`),
          };
        }),
      }));
      return { data: { from: a.from, to, days } };
    },
  } as ReadTool<{ from: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_team",
    description: "Employees and subcontractors: name, employee or subcontractor, trade, company. Use to resolve a person's name before other tools.",
    permission: "schedule.read",
    schema: z.object({ type: z.enum(["employee", "subcontractor", "all"]).default("all") }),
    run(ctx, a: { type: string }) {
      return { data: listPeople(ctx).filter((p) => !p.archivedAt && (a.type === "all" || p.kind === a.type)).map(personOut) };
    },
  } as ReadTool<{ type: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_holidays",
    description: "Holidays and unavailability (approved, and requests waiting for approval) overlapping a date range. Use for 'who is on holiday next week', 'is anyone off on Friday'.",
    permission: "schedule.read",
    schema: z.object({ from: dateKey, to: dateKey }),
    run(ctx, a: { from: string; to: string }) {
      const { byId } = names(ctx);
      const list = absencesIn(ctx, a.from, a.to >= a.from ? a.to : a.from).map((x) => ({
        absence_id: x.id,
        name: byId.get(x.personId)?.name ?? "someone",
        kind: ABSENCE_LABEL[x.kind],
        from: x.startDate,
        to: x.endDate,
        part_day: x.part,
        status: x.status === "pending" ? "waiting for approval" : "approved",
      }));
      return { data: { from: a.from, to: a.to, absences: list } };
    },
  } as ReadTool<{ from: string; to: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_materials",
    description:
      "Materials on job lists: item, quantity, job, merchant/supplier, needed-by date, status (to order, ordered, on site), order reference and expected delivery. Use for 'what still needs ordering this week' (status to_order, needed_by_on_or_before = Sunday of this week, include_undated true), 'what's arriving', 'materials for the Patels' job'.",
    permission: "records.read",
    schema: z.object({
      status: z.enum(["to_order", "ordered", "on_site", "all"]).default("to_order"),
      job_id: id.optional(),
      needed_by_on_or_before: dateKey.optional(),
      include_undated: z.boolean().default(true).describe("When filtering by date, also include items with no needed-by date"),
    }),
    run(ctx, a: { status: string; job_id?: string; needed_by_on_or_before?: string; include_undated: boolean }) {
      const jobs = new Map(R.listJobs(ctx).map((j) => [j.id, j]));
      const merchants = new Map(listMerchants(ctx).map((m) => [m.id, m]));
      const today = todayKey();
      const list = listMaterials(ctx)
        .filter((m) => (a.status === "all" || m.status === a.status) && (!a.job_id || m.jobId === a.job_id))
        .filter((m) => !a.needed_by_on_or_before || (m.neededBy ? m.neededBy <= a.needed_by_on_or_before : a.include_undated))
        .sort((x, y) => (x.neededBy ?? "9999").localeCompare(y.neededBy ?? "9999"));
      return {
        data: {
          count: list.length,
          items: list.slice(0, 40).map((m) => {
            const j = jobs.get(m.jobId);
            return {
              material_id: m.id,
              item: m.item,
              quantity: `${m.quantity}${m.unit ? ` ${m.unit}` : ""}`,
              job_id: m.jobId,
              job: j ? `${j.customerName} — ${j.title}` : undefined,
              merchant: m.merchantId ? merchants.get(m.merchantId)?.name : m.supplier ?? undefined,
              merchant_id: m.merchantId,
              needed_by: m.neededBy,
              late: m.status === "to_order" && !!m.neededBy && m.neededBy < today,
              status: m.status.replace("_", " "),
              order_ref: m.orderRef,
              expected_delivery: m.expectedDelivery,
            };
          }),
        },
      };
    },
  } as ReadTool<{ status: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_merchants",
    description:
      "Merchants and suppliers with contact details (branch, phone, email, website) and what is waiting to be ordered from each (items, earliest needed-by date). Use for 'which merchants do I need to contact', 'Travis Perkins number'. Account numbers and logins are never included.",
    permission: "records.read",
    schema: z.object({ only_with_items_to_order: z.boolean().default(false), query: z.string().max(80).optional() }),
    run(ctx, a: { only_with_items_to_order: boolean; query?: string }) {
      const jobs = new Map(R.listJobs(ctx).map((j) => [j.id, j]));
      const toOrder = listMaterials(ctx).filter((m) => m.status === "to_order");
      const q = a.query?.trim().toLowerCase();
      const list = listMerchants(ctx)
        .filter((m) => !m.archivedAt && (!q || `${m.name} ${m.branch ?? ""}`.toLowerCase().includes(q)))
        .map((m) => {
          const items = toOrder.filter((x) => x.merchantId === m.id).sort((x, y) => (x.neededBy ?? "9999").localeCompare(y.neededBy ?? "9999"));
          // Contact details only. accountRef, passwordManagerUrl, accessManagedBy and notes are deliberately left out.
          return {
            merchant_id: m.id,
            name: m.name,
            branch: m.branch,
            phone: m.phone,
            email: m.email,
            website: m.website,
            items_to_order: items.map((x) => ({ item: x.item, quantity: `${x.quantity}${x.unit ? ` ${x.unit}` : ""}`, job: jobs.get(x.jobId)?.title, customer: jobs.get(x.jobId)?.customerName, needed_by: x.neededBy })),
            earliest_needed_by: items[0]?.neededBy,
          };
        })
        .filter((m) => !a.only_with_items_to_order || m.items_to_order.length)
        .sort((x, y) => (x.earliest_needed_by ?? "9999").localeCompare(y.earliest_needed_by ?? "9999"));
      const noMerchant = toOrder.filter((x) => !x.merchantId && !x.supplier).map((x) => ({ item: x.item, job: jobs.get(x.jobId)?.title, needed_by: x.neededBy }));
      return { data: { merchants: list, items_with_no_merchant: noMerchant } };
    },
  } as ReadTool<{ only_with_items_to_order: boolean }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "get_job_profile",
    description:
      "Everything about one job: customer and site, status and next step, upcoming bookings and who's assigned, materials (to order / ordered / on site), open tasks, latest site updates, approved variations, money position (contract value, received, outstanding, invoices, recorded costs by type) and handover report status. Use for 'what's outstanding on the Patels' kitchen', 'how's the extension going'. Pass job_id, or query (customer, street, town or type of work) to find and open the job in one step — if several jobs match you get the candidates instead.",
    permission: "records.read",
    schema: z.object({ job_id: id.optional(), query: z.string().min(2).max(200).optional() }),
    run(ctx, a: { job_id?: string; query?: string }) {
      let job_id = a.job_id;
      if (!job_id && a.query) {
        const r = resolveJobs(ctx, a.query, { includeClosed: true });
        if (r.jobs.length !== 1) return { data: r.jobs.length ? { several_match: r.jobs.slice(0, 5).map((x) => ({ job_id: x.id, customer: x.customerName, title: x.title, town: x.location, status: JOB_STATUS_LABEL[x.status] })) } : { error: `No job matches "${a.query}".` } };
        job_id = r.jobs[0].id;
      }
      const j = job_id ? R.getJob(ctx, job_id) : undefined;
      if (!j) return { data: { error: "Job not found" } };
      const today = todayKey();
      const finance = can(ctx.role, "finance.read");
      const schedule = can(ctx.role, "schedule.read");
      const { byId, jobs } = names(ctx);
      const upcoming = schedule ? listBookings(ctx).filter((b) => b.jobId === j.id && bookingEndDate(b) >= today).sort((x, y) => x.date.localeCompare(y.date)) : [];
      const crew = [...new Set(upcoming.flatMap((b) => b.personIds))].map((pid) => byId.get(pid)?.name).filter(Boolean);
      const materials = listMaterials(ctx).filter((m) => m.jobId === j.id);
      const tasks = R.listTasks(ctx).filter((t) => !t.done && t.relatedType === "job" && t.relatedId === j.id);
      const updates = listUpdates(ctx).filter((u) => u.jobId === j.id).slice(0, 3);
      const out: Record<string, unknown> = {
        job_id: j.id,
        title: j.title,
        customer: j.customerName,
        customer_id: j.customerId,
        status: JOB_STATUS_LABEL[j.status],
        site: j.siteAddress || j.location,
        next_step: j.nextAction,
        start_date: j.startDate,
        description: j.description,
        upcoming_bookings: upcoming.slice(0, 6).map((b) => bookingOut(b, undefined, jobs, byId)),
        crew,
        materials: {
          to_order: materials.filter((m) => m.status === "to_order").map((m) => ({ item: m.item, quantity: `${m.quantity}${m.unit ? ` ${m.unit}` : ""}`, needed_by: m.neededBy, late: !!m.neededBy && m.neededBy < today })),
          ordered: materials.filter((m) => m.status === "ordered").map((m) => ({ item: m.item, expected_delivery: m.expectedDelivery })),
          on_site: materials.filter((m) => m.status === "on_site").length,
        },
        open_tasks: tasks.map((t) => ({ title: t.title, due: t.dueDate, overdue: t.dueDate < today })),
        latest_updates: updates.map((u) => ({ at: u.createdAt.slice(0, 10), by: u.authorName, note: u.note, stage: u.stage })),
      };
      if (finance) {
        const b = Bill.jobBilling(ctx, j.id);
        const variations = listVariations(ctx).filter((v) => v.jobId === j.id);
        const exp = R.listExpenses(ctx).filter((e) => e.jobId === j.id);
        const byCat: Record<string, number> = {};
        for (const e of exp) byCat[EXPENSE_CATEGORY_LABEL[e.category]] = (byCat[EXPENSE_CATEGORY_LABEL[e.category]] ?? 0) + e.amount;
        if (b.ok) {
          out.money = {
            price: b.value.price,
            approved_variations: b.value.approvedVariations,
            contract_value: b.value.contractValue,
            received: b.value.paymentsTotal,
            left_to_pay: b.value.leftToPay,
            remaining_to_invoice: b.value.remainingToInvoice,
            unpaid_on_invoices: b.value.unpaidOnInvoices,
            deposit: { required: b.value.depositRequired, paid: b.value.depositPaid },
            invoices: b.value.invoices.map((i) => ({ ref: i.ref, status: i.status, total: i.total, unpaid: i.balance, overdue: i.overdue })),
            drafts: b.value.drafts.map((i) => ({ ref: i.ref, total: i.total })),
          };
        }
        out.variations = variations.map((v) => ({ description: v.description, amount: v.amount, status: v.status }));
        out.recorded_costs = { total: exp.reduce((s, e) => s + e.amount, 0), by_type: byCat, note: exp.length ? undefined : "No costs recorded on this job" };
      }
      if (isManager(ctx)) {
        const reps = listReports(ctx).filter((r) => r.jobId === j.id);
        const versions = listReportVersions(ctx).filter((v) => v.jobId === j.id);
        out.handover_report = reps.length ? { exists: true, last_edited: reps[0].updatedAt.slice(0, 10), pdf_versions: versions.length } : { exists: false };
      }
      return { data: out, cards: [{ type: "job_detail", jobId: j.id } as Card] };
    },
  } as ReadTool<{ job_id: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_jobs",
    description:
      "Jobs by stage: active (not completed or lost), quoted, unscheduled (won, nothing booked), in_progress, completed, or ready_to_invoice (work finished or snagging, or in progress with its booked days all done, and money still left to invoice — uses Bob's billing figures). Use for 'what jobs are on', 'which jobs are ready to invoice'.",
    permission: "records.read",
    schema: z.object({ stage: z.enum(["active", "quoted", "unscheduled", "in_progress", "completed", "ready_to_invoice"]).default("active") }),
    run(ctx, a: { stage: string }) {
      const today = todayKey();
      const bookings = can(ctx.role, "schedule.read") ? listBookings(ctx) : [];
      const all = R.listJobs(ctx);
      const finance = can(ctx.role, "finance.read");
      if (a.stage === "ready_to_invoice" && !finance) return { data: { error: "Your account doesn't include money information." } };
      const booked = (j: Job) => bookings.filter((b) => b.jobId === j.id);
      const pick: Record<string, (j: Job) => boolean> = {
        active: (j) => !["completed", "lost"].includes(j.status),
        quoted: (j) => j.status === "quoted",
        unscheduled: (j) => !["quoted", "completed", "lost", "in_progress", "snagging"].includes(j.status) && !booked(j).some((b) => bookingEndDate(b) >= today),
        in_progress: (j) => ["in_progress", "snagging"].includes(j.status),
        completed: (j) => j.status === "completed",
        ready_to_invoice: (j) => {
          if (["quoted", "lost"].includes(j.status)) return false;
          const finished = ["snagging", "completed"].includes(j.status) || (j.status === "in_progress" && booked(j).length > 0 && !booked(j).some((b) => bookingEndDate(b) >= today));
          return finished;
        },
      };
      let list = all.filter(pick[a.stage]);
      const rows = list.map((j) => {
        const base: Record<string, unknown> = { job_id: j.id, customer: j.customerName, title: j.title, town: j.location, status: JOB_STATUS_LABEL[j.status], next_step: j.nextAction };
        const next = booked(j).filter((b) => bookingEndDate(b) >= today).sort((x, y) => x.date.localeCompare(y.date))[0];
        if (next) base.next_booking = `${next.date} ${formatTimeRange(next.startTime, next.endTime)}`;
        if (finance) {
          const b = Bill.jobBilling(ctx, j.id);
          if (b.ok) Object.assign(base, { contract_value: b.value.contractValue, remaining_to_invoice: b.value.remainingToInvoice, unpaid_on_invoices: b.value.unpaidOnInvoices, open_draft: b.value.drafts[0]?.ref });
        }
        return base;
      });
      const out = a.stage === "ready_to_invoice" ? rows.filter((r) => (r.remaining_to_invoice as number) > 0) : rows;
      list = list.filter((j) => out.some((r) => r.job_id === j.id));
      return { data: { stage: a.stage, count: out.length, jobs: out }, cards: list.length && list.length <= 6 ? [{ type: "jobs", ids: list.map((j) => j.id) } as Card] : [] };
    },
  } as ReadTool<{ stage: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_quotes",
    description: "Quotes with their status (draft, sent, accepted, declined), amount, customer, when sent and follow-up date. Use for 'which quotes are waiting', 'what have I quoted the Fletchers'.",
    permission: "finance.read",
    schema: z.object({ status: z.enum(["draft", "sent", "accepted", "declined", "all"]).default("sent") }),
    run(ctx, a: { status: string }) {
      const customers = new Map(R.listCustomers(ctx).map((c) => [c.id, c.name]));
      const list = R.listQuotes(ctx).filter((q) => a.status === "all" || q.status === a.status);
      return { data: list.slice(0, 30).map((q) => ({ quote_id: q.id, customer: customers.get(q.customerId), description: q.description, amount: q.amount, status: q.status, sent: q.sentAt?.slice(0, 10), follow_up: q.followUpDate, job_id: q.jobId, enquiry_id: q.enquiryId })) };
    },
  } as ReadTool<{ status: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_enquiries_to_quote",
    description: "Enquiries waiting for a quote (status: quote needed), with customer, what they want, town and when received.",
    permission: "records.read",
    schema: z.object({}),
    run(ctx) {
      const list = R.listEnquiries(ctx).filter((e) => e.status === "quote_required");
      return { data: list.map((e) => ({ enquiry_id: e.id, customer: e.customerName, title: e.title, town: e.location, received: e.receivedAt.slice(0, 10), status: ENQUIRY_STATUS_LABEL[e.status] })) };
    },
  },
  {
    kind: "read",
    name: "list_job_updates",
    description: "Recent site updates (notes and photos logged from site), newest first, optionally for one job.",
    permission: "records.read",
    schema: z.object({ job_id: id.optional(), days: z.number().int().min(1).max(90).default(14) }),
    run(ctx, a: { job_id?: string; days: number }) {
      const since = addDays(todayKey(), -a.days);
      const jobs = new Map(R.listJobs(ctx).map((j) => [j.id, j]));
      const list = listUpdates(ctx).filter((u) => (!a.job_id || u.jobId === a.job_id) && u.createdAt.slice(0, 10) >= since);
      return { data: list.slice(0, 20).map((u) => ({ job: jobs.get(u.jobId) ? `${jobs.get(u.jobId)!.customerName} — ${jobs.get(u.jobId)!.title}` : undefined, job_id: u.jobId, at: u.createdAt.slice(0, 10), by: u.authorName, stage: u.stage, note: u.note })) };
    },
  } as ReadTool<{ days: number }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_handover_reports",
    description: "Customer handover reports: which jobs have one, when last edited and how many PDF versions were made. Owners and admins only.",
    permission: "records.read",
    schema: z.object({}),
    run(ctx) {
      if (!isManager(ctx)) return { data: { error: "Handover reports are visible to owners and admins." } };
      const jobs = new Map(R.listJobs(ctx).map((j) => [j.id, j]));
      const versions = listReportVersions(ctx);
      return { data: listReports(ctx).map((r) => ({ job_id: r.jobId, job: jobs.get(r.jobId) ? `${jobs.get(r.jobId)!.customerName} — ${jobs.get(r.jobId)!.title}` : undefined, last_edited: r.updatedAt.slice(0, 10), by: r.updatedBy, pdf_versions: versions.filter((v) => v.jobId === r.jobId).length })) };
    },
  },
  {
    kind: "read",
    name: "get_morning_briefing",
    description: "A short morning briefing built from the records (replies waiting, money due, follow-ups, today's tasks, jobs on site) plus today's diary. Use for 'give me a quick briefing', 'what's my day'.",
    permission: "records.read",
    schema: z.object({}),
    run(ctx) {
      const b = morningBriefing(ctx);
      const today = todayKey();
      const out: Record<string, unknown> = { briefing_text: b.text, suggested_first_step: b.suggestion?.label };
      if (can(ctx.role, "schedule.read")) {
        const { byId, jobs } = names(ctx);
        out.today_diary = bookingsOnDay(listBookings(ctx), today).map((x) => bookingOut(x, today, jobs, byId));
        out.off_today = absencesIn(ctx, today, today).map((a) => `${byId.get(a.personId)?.name} (${ABSENCE_LABEL[a.kind]}${a.status === "pending" ? ", pending" : ""})`);
      }
      out.materials_late_or_due_today = listMaterials(ctx).filter((m) => m.status === "to_order" && m.neededBy && m.neededBy <= today).length;
      return { data: out };
    },
  },
  {
    kind: "read",
    name: "get_person_priorities",
    description:
      "What a particular person should focus on: their open tasks (overdue and due today first), where they're booked today and tomorrow, and — for owners/admins (e.g. Ryan, the office) — the business priorities from Bob's records (replies waiting, chasers, overdue money, unassigned bookings, late materials). Use for 'what should Ryan prioritise today', 'what's on Liam's plate'.",
    permission: "records.read",
    schema: z.object({ name: z.string().min(2).max(80) }),
    run(ctx, a: { name: string }) {
      const today = todayKey();
      const tomorrow = addDays(today, 1);
      const found = findPeopleByName(ctx, a.name);
      if (!found.people.length && !found.users.length) return { data: { error: `No one called "${a.name}" in this workspace.` } };
      const user = found.users[0];
      const person = found.people.find((p) => p.userId === user?.id) ?? found.people[0];
      const tasks = R.listTasks(ctx)
        .filter((t) => !t.done && ((user && t.assignedUserId === user.id) || (person && t.assignedPersonId === person.id)))
        .sort((x, y) => x.dueDate.localeCompare(y.dueDate));
      const out: Record<string, unknown> = {
        name: user?.name ?? person?.name,
        role: user ? user.role : person?.kind,
        tasks: tasks.map((t) => ({ title: t.title, due: t.dueDate, overdue: t.dueDate < today, due_today: t.dueDate === today })),
      };
      if (person && can(ctx.role, "schedule.read")) {
        const { byId, jobs } = names(ctx);
        const mine = listBookings(ctx).filter((b) => b.personIds.includes(person.id));
        out.booked_today = bookingsOnDay(mine, today).map((b) => bookingOut(b, today, jobs, byId));
        out.booked_tomorrow = bookingsOnDay(mine, tomorrow).map((b) => bookingOut(b, tomorrow, jobs, byId));
      }
      const office = user && (user.role === "owner" || user.role === "office");
      if (office) {
        const s = Rep.todaySummary(ctx);
        out.business_priorities = s.priorities.slice(0, 8).map((p) => ({ kind: p.kind, title: p.title, who: p.who, detail: p.detail }));
        out.enquiries_needing_reply = R.listEnquiries(ctx).filter(needsReply).length;
        out.unassigned_bookings_next_7_days = listBookings(ctx).filter((b) => !b.personIds.length && b.date >= today && b.date <= addDays(today, 7)).length;
        out.materials_to_order_late_or_this_week = listMaterials(ctx).filter((m) => m.status === "to_order" && (!m.neededBy || m.neededBy <= addDays(weekStart(today), 6))).length;
        if (can(ctx.role, "finance.read")) {
          const inv = F.listInvoices(ctx);
          out.overdue_invoices = inv.filter(isInvoiceOverdue).map((i) => ({ ref: i.number ?? i.draftRef, unpaid: invoiceBalance(i) }));
          out.draft_invoices_not_sent = inv.filter((i) => i.status === "draft").map((i) => i.draftRef);
        }
      }
      return { data: out };
    },
  } as ReadTool<{ name: string }> as ReadTool<unknown>,
  {
    kind: "read",
    name: "list_tasks_detailed",
    description: "Open tasks and reminders with who they're for, what they're linked to and whether they're overdue. Optionally only one person's (by name) or due by a date.",
    permission: "records.read",
    schema: z.object({ assignee: z.string().max(80).optional(), due_on_or_before: dateKey.optional() }),
    run(ctx, a: { assignee?: string; due_on_or_before?: string }) {
      const today = todayKey();
      const people = new Map(listPeople(ctx).map((p) => [p.id, p.name]));
      const users = new Map(usersInOrg(ctx.orgId).map((u) => [u.id, u.name]));
      const jobs = new Map(R.listJobs(ctx).map((j) => [j.id, j]));
      const found = a.assignee ? findPeopleByName(ctx, a.assignee) : undefined;
      const list = R.listTasks(ctx)
        .filter((t) => !t.done && (!a.due_on_or_before || t.dueDate <= a.due_on_or_before))
        .filter((t) => !found || found.users.some((u) => u.id === t.assignedUserId) || found.people.some((p) => p.id === t.assignedPersonId))
        .sort((x, y) => x.dueDate.localeCompare(y.dueDate));
      return {
        data: list.slice(0, 30).map((t) => ({
          task_id: t.id,
          title: t.title,
          priority: t.priority ?? "normal",
          due: t.dueDate,
          overdue: t.dueDate < today,
          for: (t.assignedPersonId && people.get(t.assignedPersonId)) || (t.assignedUserId && users.get(t.assignedUserId)) || "office",
          job: t.relatedType === "job" && t.relatedId ? jobs.get(t.relatedId)?.title : undefined,
        })),
      };
    },
  } as ReadTool<{ assignee?: string }> as ReadTool<unknown>,
];
