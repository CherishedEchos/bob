import "server-only";
/**
 * More read-only questions Bob answers from the workspace's own records:
 *  - "What jobs still need quoting?"
 *  - "Who is on holiday next week?"
 *  - "Create a handover report for the recently completed extension" — Bob
 *    explains where that's done and opens the right job.
 * Permission-checked like everything else.
 */
import type { Chip } from "@/lib/bob/types";
import { can } from "@/lib/auth/permissions";
import { ABSENCE_LABEL } from "@/lib/leave";
import { addDays, formatDayLong, weekStart } from "@/lib/dates";
import { gbp, todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";
import { listEnquiries, listJobs } from "@/server/services/records";
import { listPeople } from "@/server/services/team";
import { listAbsences } from "@/server/services/absences";
import { listNames, plural } from "./compose";
import { runReadTool } from "./tools";

type Answer = { text: string; chips?: Chip[] };
const poss = (n: string) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);

export const NEEDS_QUOTING = /\b(what|which|any|anything)\b[^?]*\b(need(s|ing)?|still need|waiting (for|on)|to)\b[^?]*\bquot(e|ing|ed)\b|\bjobs? to quote\b|\bstill to quote\b/i;
export const ON_HOLIDAY = /\b(who('?s| is| are)?|anyone|anybody|is anyone)\b[^?]*\b(on holiday|on leave|off|away|annual leave|unavailable)\b/i;
export const HANDOVER_REQUEST = /\b(create|make|do|generate|write|prepare|start|put together|draft)\b[^?]*\bhandover\b/i;

export function needsQuoting(ctx: Ctx): Answer {
  const waiting = listEnquiries(ctx).filter((e) => e.status === "quote_required");
  if (!waiting.length) return { text: "Nothing is waiting for a quote right now.", chips: [{ kind: "link", label: "Open jobs", href: "/jobs?view=to_quote" }] };
  const names = waiting.slice(0, 5).map((e) => `${e.customerName} — ${e.title.toLowerCase()} in ${e.location}`);
  return {
    text: `${plural(waiting.length, "enquiry", "enquiries")} still ${waiting.length === 1 ? "needs" : "need"} a quote: ${names.join("; ")}.${waiting.length > 5 ? ` And ${waiting.length - 5} more.` : ""}`,
    chips: [
      ...waiting.slice(0, 2).map((e) => ({ kind: "open" as const, label: `Open ${e.customerName.split(" ")[0]}'s enquiry`, record: "enquiry" as const, id: e.id })),
      { kind: "link", label: "All to quote", href: "/jobs?view=to_quote" },
    ],
  };
}

function period(lower: string): { from: string; to: string; label: string } {
  const today = todayKey();
  const ws = weekStart(today);
  if (/\bnext week\b/.test(lower)) return { from: addDays(ws, 7), to: addDays(ws, 13), label: "next week" };
  if (/\bthis week\b/.test(lower)) return { from: today, to: addDays(ws, 6), label: "this week" };
  if (/\btomorrow\b/.test(lower)) return { from: addDays(today, 1), to: addDays(today, 1), label: "tomorrow" };
  if (/\btoday\b/.test(lower)) return { from: today, to: today, label: "today" };
  return { from: today, to: addDays(today, 13), label: "in the next two weeks" };
}

export function onHoliday(ctx: Ctx, lower: string): Answer {
  if (!can(ctx.role, "schedule.read")) return { text: "Your account can't see the team's holidays." };
  const { from, to, label } = period(lower);
  const people = new Map(listPeople(ctx).map((p) => [p.id, p.name]));
  const off = listAbsences(ctx)
    .filter((a) => ["approved", "pending"].includes(a.status) && a.startDate <= to && a.endDate >= from && people.has(a.personId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const chips: Chip[] = [{ kind: "link", label: "Open holidays", href: "/team?view=holidays" }];
  if (!off.length) return { text: `Nobody is off ${label}.`, chips };
  const lines = off.map((a) => {
    const range = a.startDate === a.endDate ? formatDayLong(a.startDate) : `${formatDayLong(a.startDate)} to ${formatDayLong(a.endDate)}`;
    return `${people.get(a.personId)} — ${ABSENCE_LABEL[a.kind].toLowerCase()}, ${range}${a.status === "pending" ? " (waiting for approval)" : ""}`;
  });
  return { text: `${label[0].toUpperCase()}${label.slice(1)}: ${lines.join("; ")}.`, chips };
}

/** Handover reports are built on the job (photos chosen, summary checked) — open the right one. */
export function handoverHelp(ctx: Ctx, lower: string): Answer {
  if (ctx.role !== "owner" && ctx.role !== "office") return { text: "Handover reports are prepared by Luke or Ryan." };
  const jobs = listJobs(ctx);
  const done = jobs.filter((j) => j.status === "completed" || j.status === "snagging");
  const words = lower.replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["create", "make", "generate", "write", "prepare", "handover", "report", "recently", "completed", "finished", "the", "for"].includes(w));
  const match = done.filter((j) => words.some((w) => `${j.title} ${j.customerName} ${j.location} ${j.kind}`.toLowerCase().includes(w)));
  const target = match[0] ?? null;
  const how = "Handover reports are built on the job's Handover tab: Bob drafts the summary from the updates and photos, and you choose the photos and check every word before anything is shared.";
  if (target) {
    return {
      text: `${how} Open ${target.customerName}'s ${target.title.toLowerCase()} to start.`,
      chips: [{ kind: "link", label: `Open ${target.title} handover`, href: `/jobs/${target.id}?tab=handover` }],
    };
  }
  const names = done.slice(0, 3);
  return {
    text: words.length
      ? `I can't see a finished job matching that. ${names.length ? `Finished or snagging: ${listNames(names.map((j) => `${j.customerName}'s ${j.title.toLowerCase()}`), 3)}.` : "No jobs are marked finished yet."} ${how}`
      : `${how} ${names.length ? `Which job — ${listNames(names.map((j) => `${j.customerName}'s ${j.title.toLowerCase()}`), 3)}?` : "No jobs are marked finished yet."}`,
    chips: names.map((j) => ({ kind: "link" as const, label: `${j.title} handover`, href: `/jobs/${j.id}?tab=handover` })),
  };
}

/* ---- Fallback answers built on the same workspace tools Claude uses ---- */

export const WHO_IS_AVAILABLE = /\b(who('?s| is| are)?|anyone|anybody)\b[^?]*\b(available|free)\b/i;
export const MERCHANTS_TO_CONTACT = /\b(which|what|who)\b[^?]*\b(merchants?|suppliers?)\b|\bmerchants?\b[^?]*\b(contact|call|ring|order)\b/i;
export const READY_TO_INVOICE = /\bready (to|for) (invoice|invoicing|bill|billing)\b|\b(which|what) jobs? (can|should|do) (i|we) (invoice|bill)\b/i;
export const PRIORITISE = /\bwhat should (\w+) (prioriti[sz]e|focus on|do|be doing|crack on with)\b/i;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
function dayFrom(lower: string): { day: string; label: string } {
  const today = todayKey();
  if (/\btomorrow\b/.test(lower)) return { day: addDays(today, 1), label: "tomorrow" };
  const i = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(lower));
  if (i >= 0) {
    let key = addDays(weekStart(today), i + (/\bnext\b/.test(lower) ? 7 : 0));
    if (key < today) key = addDays(key, 7);
    return { day: key, label: formatDayLong(key) };
  }
  return { day: today, label: "today" };
}

type Avail = { days: { people: { name: string; status: string; type: string; booked_on: string[] }[] }[] };
export function whoIsAvailable(ctx: Ctx, lower: string): Answer {
  if (!can(ctx.role, "schedule.read")) return { text: "Your account can't see the company schedule." };
  const { day, label } = dayFrom(lower);
  const r = runReadTool(ctx, "get_team_availability", { from: day });
  if (!r.ok) return { text: r.error ?? "Couldn't look that up." };
  const people = (r.data as Avail).days[0].people;
  const free = people.filter((p) => p.status === "free");
  const off = people.filter((p) => p.status.startsWith("off") || p.status === "leave requested");
  const booked = people.filter((p) => p.status === "booked");
  const parts = [free.length ? `Free ${label}: ${listNames(free.map((p) => p.name), 6)}.` : `Nobody is completely free ${label}.`];
  if (booked.length) parts.push(`Booked: ${booked.map((p) => `${p.name} (${p.booked_on[0]?.split(" — ")[1] ?? "a job"})`).join(", ")}.`);
  if (off.length) parts.push(`Off: ${off.map((p) => `${p.name}${p.status === "leave requested" ? " (requested)" : ""}`).join(", ")}.`);
  return { text: parts.join(" "), chips: [{ kind: "link", label: "Open diary", href: "/week" }] };
}

type Merch = { merchants: { name: string; phone?: string; items_to_order: { item: string; needed_by?: string }[] }[]; items_with_no_merchant: { item: string }[] };
export function merchantsToContact(ctx: Ctx): Answer {
  const r = runReadTool(ctx, "list_merchants", { only_with_items_to_order: true });
  if (!r.ok) return { text: r.error ?? "Couldn't look that up." };
  const d = r.data as Merch;
  if (!d.merchants.length) return { text: "Nothing is waiting to be ordered from a merchant.", chips: [{ kind: "link", label: "Open materials", href: "/materials" }] };
  const lines = d.merchants.slice(0, 4).map((m) => `${m.name}${m.phone ? ` (${m.phone})` : ""} — ${plural(m.items_to_order.length, "item")}${m.items_to_order[0]?.needed_by ? `, first needed ${formatDayLong(m.items_to_order[0].needed_by)}` : ""}`);
  return {
    text: `${plural(d.merchants.length, "merchant")} to contact: ${lines.join("; ")}.${d.items_with_no_merchant.length ? ` ${plural(d.items_with_no_merchant.length, "item has", "items have")} no merchant yet.` : ""}`,
    chips: [{ kind: "link", label: "Open materials", href: "/materials" }],
  };
}

type Ready = { jobs: { job_id: string; customer: string; title: string; remaining_to_invoice: number; open_draft?: string }[]; error?: string };
export function readyToInvoice(ctx: Ctx): Answer {
  const r = runReadTool(ctx, "list_jobs", { stage: "ready_to_invoice" });
  if (!r.ok) return { text: r.error ?? "Couldn't look that up." };
  const d = r.data as Ready;
  if (d.error) return { text: d.error };
  if (!d.jobs.length) return { text: "No finished jobs have money left to invoice." };
  const lines = d.jobs.map((j) => `${poss(j.customer)} ${j.title.toLowerCase()} — ${gbp(j.remaining_to_invoice)} left to invoice${j.open_draft ? ` (draft ${j.open_draft} already started)` : ""}`);
  return { text: `${plural(d.jobs.length, "job is", "jobs are")} ready to invoice: ${lines.join("; ")}.`, chips: d.jobs.slice(0, 3).map((j) => ({ kind: "send" as const, label: `Invoice ${j.customer.split(" ")[0]}`, text: `Draft the final invoice for ${poss(j.customer)} ${j.title.toLowerCase()}` })) };
}

type Prio = { error?: string; name?: string; tasks: { title: string; overdue: boolean; due_today: boolean }[]; booked_today?: { job: string; time: string }[]; business_priorities?: { title: string; detail: string }[] };
export function personPriorities(ctx: Ctx, name: string): Answer {
  const r = runReadTool(ctx, "get_person_priorities", { name });
  if (!r.ok) return { text: r.error ?? "Couldn't look that up." };
  const d = r.data as Prio;
  if (d.error) return { text: d.error };
  const urgent = d.tasks.filter((t) => t.overdue || t.due_today);
  const parts: string[] = [];
  if (d.booked_today?.length) parts.push(`${d.name} is booked on ${d.booked_today.map((b) => `${b.job} (${b.time})`).join(" and ")} today.`);
  if (urgent.length) parts.push(`Tasks due: ${listNames(urgent.map((t) => t.title), 3)}.`);
  if (d.business_priorities?.length) parts.push(`Top of the office list: ${d.business_priorities.slice(0, 3).map((p) => p.title).join("; ")}.`);
  if (!parts.length) parts.push(`${d.name} has nothing due today.`);
  return { text: parts.join(" ") };
}

export const OUTSTANDING_ON = /\b(what'?s|what is|anything|what have we got) (still )?(outstanding|left|to do|owing|owed) (on|for|with)\b/i;

type Profile = { error?: string; customer: string; title: string; next_step?: string; open_tasks: { title: string; overdue: boolean }[]; materials: { to_order: { item: string }[] }; upcoming_bookings: { date: string; time: string; people: string[] }[]; money?: { left_to_pay: number; remaining_to_invoice: number; unpaid_on_invoices: number } };
/** "What's outstanding on the Patels' kitchen?" — what's left to do and to pay, from the job's records. */
export function jobOutstanding(ctx: Ctx, jobId: string): Answer {
  const r = runReadTool(ctx, "get_job_profile", { job_id: jobId });
  if (!r.ok) return { text: r.error ?? "Couldn't look that up." };
  const p = r.data as Profile;
  if (p.error) return { text: p.error };
  const parts = [`On ${poss(p.customer)} ${p.title.toLowerCase()}:`];
  if (p.next_step) parts.push(`next step is to ${p.next_step.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, "")}.`);
  if (p.open_tasks.length) parts.push(`${plural(p.open_tasks.length, "task")} open${p.open_tasks.some((t) => t.overdue) ? " (some overdue)" : ""}.`);
  if (p.materials.to_order.length) parts.push(`${plural(p.materials.to_order.length, "item")} still to order (${listNames(p.materials.to_order.map((m) => m.item), 2)}).`);
  const next = p.upcoming_bookings[0];
  if (next) parts.push(`Next on site ${formatDayLong(next.date)}, ${next.time}${next.people.length ? ` with ${listNames(next.people, 3)}` : ", nobody assigned yet"}.`);
  if (p.money) parts.push(`Money: ${gbp(p.money.left_to_pay)} left to pay — ${gbp(p.money.unpaid_on_invoices)} on invoices already sent and ${gbp(p.money.remaining_to_invoice)} not yet invoiced.`);
  return { text: parts.join(" "), chips: [{ kind: "open", label: "Open job", record: "job", id: jobId }] };
}
