import "server-only";
/**
 * Deterministic reporting. These functions query the organisation's records
 * and return numbers + the exact period used. Bob explains the results — he
 * never calculates business figures himself.
 */
import type { EnquirySource, Invoice } from "@/lib/types";
import {
  SOURCE_LABEL, followUpDue, invoiceBalance, isActiveJob, isInvoiceOutstanding, isInvoiceOverdue, jobFinance,
  jobsAwaitingDeposit, needsReply, quoteNeedsFollowUp, tasksDue, todaysPriorities,
} from "@/lib/derive";
import { toDateKey, todayKey } from "@/lib/utils";
import { scoped } from "@/server/db";
import { can } from "@/lib/auth/permissions";
import type { Ctx } from "@/server/context";
import { listCustomers, listEnquiries, listJobs, listQuotes, listTasks } from "./records";
import { listInvoices, listPayments } from "./finance";
import { listConnections } from "@/server/integrations/registry";

/* --------------------------------- Periods --------------------------------- */

export type PeriodSpec =
  | { kind: "last_days"; days: number }
  | { kind: "today" }
  | { kind: "this_week" }
  | { kind: "next_week" }
  | { kind: "last_week" }
  | { kind: "this_month" }
  | { kind: "last_month" }
  | { kind: "this_year" }
  | { kind: "all_time" };

export interface Period {
  /** Inclusive start (ISO, local midnight). */
  from: string;
  /** Exclusive end (ISO). */
  to: string;
  fromKey: string;
  toKeyInclusive: string;
  label: string;
  spec: PeriodSpec;
}

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function resolvePeriod(spec: PeriodSpec, nowDate = new Date()): Period {
  const today = startOfDay(nowDate);
  const tomorrow = addDays(today, 1);
  const mondayOffset = (today.getDay() + 6) % 7;
  const thisMonday = addDays(today, -mondayOffset);
  let from: Date;
  let to: Date;
  let label: string;
  switch (spec.kind) {
    case "today":
      [from, to, label] = [today, tomorrow, "today"];
      break;
    case "last_days":
      from = addDays(today, -(spec.days - 1));
      to = tomorrow;
      label = `the last ${spec.days} days (${fmt(from)} – ${fmt(today)})`;
      break;
    case "this_week":
      [from, to] = [thisMonday, addDays(thisMonday, 7)];
      label = `this week (${fmt(from)} – ${fmt(addDays(to, -1))})`;
      break;
    case "next_week":
      [from, to] = [addDays(thisMonday, 7), addDays(thisMonday, 14)];
      label = `next week (${fmt(from)} – ${fmt(addDays(to, -1))})`;
      break;
    case "last_week":
      [from, to] = [addDays(thisMonday, -7), thisMonday];
      label = `last week (${fmt(from)} – ${fmt(addDays(to, -1))})`;
      break;
    case "this_month":
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to = tomorrow;
      label = `this month so far (${fmt(from)} – ${fmt(today)})`;
      break;
    case "last_month":
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 1);
      label = `last month (${from.toLocaleDateString("en-GB", { month: "long" })})`;
      break;
    case "this_year":
      from = new Date(today.getFullYear(), 0, 1);
      to = tomorrow;
      label = `this year so far (since ${fmt(from)})`;
      break;
    case "all_time":
      from = new Date(2000, 0, 1);
      to = addDays(tomorrow, 3650);
      label = "all time";
      break;
  }
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    fromKey: toDateKey(from),
    toKeyInclusive: toDateKey(addDays(to, -1)),
    label,
    spec,
  };
}

/* ------------------------------- Coverage note ------------------------------- */

/**
 * Explain which channels the numbers cover. Bob must say when a total only
 * includes enquiries that were recorded manually.
 */
export function enquiryCoverage(ctx: Ctx): { connected: string[]; note: string } {
  const connections = listConnections(ctx);
  const emailLive = connections.find((c) => c.kind === "email" && (c.status === "connected" || c.status === "demo"));
  const connected = emailLive ? [emailLive.provider === "demo_inbox" ? "demo inbox" : emailLive.provider] : [];
  const gaps: string[] = [];
  if (!emailLive) gaps.push("email");
  gaps.push("Instagram");
  const note = `These figures only include enquiries recorded in Bob. ${
    emailLive ? `Email comes in from your ${connected[0]}; ` : ""
  }Your website form feeds Bob directly; ${listJoin(gaps)} ${gaps.length === 1 ? "isn't" : "aren't"} connected yet, so those only count if they were added to Bob.`;
  return { connected, note };
}

function listJoin(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ------------------------------- Enquiries ------------------------------- */

export interface EnquiryStats {
  period: Period;
  total: number;
  bySource: { source: EnquirySource; label: string; count: number }[];
  byStatus: Record<string, number>;
  needsAction: number;
  won: number;
  lost: number;
  coverage: string;
}

export function enquiryStats(ctx: Ctx, spec: PeriodSpec): EnquiryStats {
  const period = resolvePeriod(spec);
  const db = scoped(ctx);
  const where = "received_at >= ? AND received_at < ?";
  const params = [period.from, period.to];
  const bySourceRows = db.aggregate<{ source: EnquirySource; n: number }>("enquiries", "source, COUNT(*) AS n", { where, params, group: "source" });
  const byStatusRows = db.aggregate<{ status: string; n: number }>("enquiries", "status, COUNT(*) AS n", { where, params, group: "status" });
  const inPeriod = db.list<import("@/lib/types").Enquiry>("enquiries", { where, params });
  const total = bySourceRows.reduce((s, r) => s + Number(r.n), 0);
  const byStatus = Object.fromEntries(byStatusRows.map((r) => [r.status, Number(r.n)]));
  return {
    period,
    total,
    bySource: bySourceRows
      .map((r) => ({ source: r.source, label: SOURCE_LABEL[r.source] ?? r.source, count: Number(r.n) }))
      .sort((a, b) => b.count - a.count),
    byStatus,
    needsAction: inPeriod.filter((e) => needsReply(e) || followUpDue(e)).length,
    won: byStatus.won ?? 0,
    lost: byStatus.lost ?? 0,
    coverage: enquiryCoverage(ctx).note,
  };
}

/* --------------------------------- Quotes --------------------------------- */

export interface QuoteStats {
  period: Period;
  sentCount: number;
  sentValue: number;
  accepted: number;
  acceptedValue: number;
  declined: number;
  awaiting: number;
  needFollowUp: { id: string; customerName: string; description: string; amount: number; sentAt?: string; enquiryId?: string }[];
}

export function quoteStats(ctx: Ctx, spec: PeriodSpec): QuoteStats {
  const period = resolvePeriod(spec);
  const db = scoped(ctx);
  const sent = db.aggregate<{ n: number; v: number | null }>("quotes", "COUNT(*) AS n, SUM(amount) AS v", {
    where: "sent_at >= ? AND sent_at < ?",
    params: [period.from, period.to],
  })[0];
  const accepted = db.aggregate<{ n: number; v: number | null }>("quotes", "COUNT(*) AS n, SUM(amount) AS v", {
    where: "status = 'accepted' AND sent_at >= ? AND sent_at < ?",
    params: [period.from, period.to],
  })[0];
  const declined = db.aggregate<{ n: number }>("quotes", "COUNT(*) AS n", {
    where: "status = 'declined' AND sent_at >= ? AND sent_at < ?",
    params: [period.from, period.to],
  })[0];
  const quotes = listQuotes(ctx);
  const names = new Map(listCustomers(ctx).map((c) => [c.id, c.name]));
  return {
    period,
    sentCount: Number(sent.n),
    sentValue: Number(sent.v ?? 0),
    accepted: Number(accepted.n),
    acceptedValue: Number(accepted.v ?? 0),
    declined: Number(declined.n),
    awaiting: quotes.filter((q) => q.status === "sent").length,
    needFollowUp: quotes.filter(quoteNeedsFollowUp).map((q) => ({
      id: q.id,
      customerName: names.get(q.customerId) ?? "Unknown",
      description: q.description,
      amount: q.amount,
      sentAt: q.sentAt,
      enquiryId: q.enquiryId,
    })),
  };
}

/* ---------------------------------- Jobs ---------------------------------- */

export interface JobStats {
  period: Period;
  won: number;
  wonValue: number;
  active: number;
  booked: { id: string; customerName: string; title: string; location: string; startDate: string }[];
}

/** Jobs won (enquiries/quotes converted) in a period, plus jobs starting in it. */
export function jobStats(ctx: Ctx, spec: PeriodSpec): JobStats {
  const period = resolvePeriod(spec);
  const jobs = listJobs(ctx);
  const won = jobs.filter((j) => j.status !== "lost" && j.createdAt >= period.from && j.createdAt < period.to);
  const booked = jobs
    .filter((j) => j.startDate && j.startDate >= period.fromKey && j.startDate <= period.toKeyInclusive && j.status !== "lost")
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!))
    .map((j) => ({ id: j.id, customerName: j.customerName, title: j.title, location: j.location, startDate: j.startDate! }));
  return {
    period,
    won: won.length,
    wonValue: won.reduce((s, j) => s + j.quotedValue, 0),
    active: jobs.filter(isActiveJob).length,
    booked,
  };
}

/* ---------------------------------- Money ---------------------------------- */

export interface MoneyOwed {
  source: string;
  lastUpdated: string | null;
  invoicesOutstanding: { id: string; ref: string; customerName: string; balance: number; dueDate?: string; overdue: boolean }[];
  invoicedTotal: number;
  overdueTotal: number;
  overdueCount: number;
  depositsAwaited: { jobId: string; customerName: string; amount: number; dueDate?: string; overdue: boolean }[];
  depositsTotal: number;
  /** Agreed work not yet invoiced or paid, on active jobs (for context, not "owed"). */
  uninvoicedOnActiveJobs: number;
  draftsCount: number;
}

export function moneyOwed(ctx: Ctx): MoneyOwed {
  const invoices = listInvoices(ctx);
  const payments = listPayments(ctx);
  const jobs = listJobs(ctx);
  const names = new Map(listCustomers(ctx).map((c) => [c.id, c.name]));
  const outstanding = invoices.filter(isInvoiceOutstanding);
  const accounting = listConnections(ctx).find((c) => c.kind === "accounting" && (c.status === "connected" || c.status === "demo"));
  const stamps = [
    ...invoices.map((i) => i.lastSyncedAt ?? i.sentAt ?? i.createdAt),
    ...payments.map((p) => p.recordedAt),
  ].filter(Boolean) as string[];
  const deposits = jobsAwaitingDeposit({ jobs, payments });
  const invoicedByJob = (jobId: string) =>
    invoices.filter((i) => i.jobId === jobId && i.status === "sent").reduce((s, i) => s + invoiceBalance(i), 0);
  return {
    source: accounting
      ? accounting.provider === "demo_accounting"
        ? "demo accounting data (simulated)"
        : `${accounting.provider} (connected)`
      : "Bob's own records — no accounting system is connected",
    lastUpdated: stamps.sort().at(-1) ?? null,
    invoicesOutstanding: outstanding.map((i) => ({
      id: i.id,
      ref: i.number ?? i.draftRef,
      customerName: names.get(i.customerId) ?? "Unknown",
      balance: invoiceBalance(i),
      dueDate: i.dueDate,
      overdue: isInvoiceOverdue(i),
    })),
    invoicedTotal: outstanding.reduce((s, i) => s + invoiceBalance(i), 0),
    overdueTotal: outstanding.filter(isInvoiceOverdue).reduce((s, i) => s + invoiceBalance(i), 0),
    overdueCount: outstanding.filter(isInvoiceOverdue).length,
    depositsAwaited: deposits.map(({ job, finance }) => ({
      jobId: job.id,
      customerName: job.customerName,
      amount: finance.depositOutstanding,
      dueDate: job.depositDueDate,
      overdue: finance.depositOverdue,
    })),
    depositsTotal: deposits.reduce((s, d) => s + d.finance.depositOutstanding, 0),
    uninvoicedOnActiveJobs: jobs
      .filter((j) => isActiveJob(j) && j.status !== "quoted")
      .reduce((s, j) => s + Math.max(0, jobFinance(j, payments).balance - invoicedByJob(j.id)), 0),
    draftsCount: invoices.filter((i) => i.status === "draft").length,
  };
}

export function overdueInvoices(ctx: Ctx): Invoice[] {
  return listInvoices(ctx).filter(isInvoiceOverdue);
}

/* ------------------------------ Today summary ------------------------------ */

export interface TodaySummary {
  date: string;
  priorities: ReturnType<typeof todaysPriorities>;
  newEnquiries: number;
  needReply: number;
  tasksDue: { id: string; title: string; dueDate: string }[];
  onSite: { id: string; customerName: string; title: string; location: string }[];
  startingToday: { id: string; customerName: string; title: string; location: string }[];
  overdueInvoices: number;
  overdueDeposits: number;
  financeVisible: boolean;
}

export function todaySummary(ctx: Ctx): TodaySummary {
  const enquiries = listEnquiries(ctx);
  const jobs = listJobs(ctx);
  const tasks = listTasks(ctx);
  const financeVisible = can(ctx.role, "finance.read");
  const invoices = financeVisible ? listInvoices(ctx) : [];
  const payments = financeVisible ? listPayments(ctx) : [];
  const quotes = listQuotes(ctx);
  const customers = listCustomers(ctx);
  const today = todayKey();
  return {
    date: today,
    priorities: todaysPriorities({ enquiries, jobs, payments, tasks, invoices, quotes, customers }, { includeFinance: financeVisible }),
    newEnquiries: enquiries.filter((e) => e.status === "new").length,
    needReply: enquiries.filter(needsReply).length,
    tasksDue: tasksDue(tasks).map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate })),
    onSite: jobs
      .filter((j) => j.status === "in_progress" || j.status === "snagging")
      .map((j) => ({ id: j.id, customerName: j.customerName, title: j.title, location: j.location })),
    startingToday: jobs
      .filter((j) => j.startDate === today && j.status !== "lost")
      .map((j) => ({ id: j.id, customerName: j.customerName, title: j.title, location: j.location })),
    overdueInvoices: invoices.filter(isInvoiceOverdue).length,
    overdueDeposits: financeVisible ? jobsAwaitingDeposit({ jobs, payments }).filter((d) => d.finance.depositOverdue).length : 0,
    financeVisible,
  };
}
