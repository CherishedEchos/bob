/**
 * Pure, derived business logic. No React, no storage — safe to reuse on the
 * server (API routes, assistant tools) once a real database is connected.
 */
import type {
  AppData,
  Enquiry,
  EnquirySource,
  EnquiryStatus,
  Job,
  JobStatus,
  Payment,
  PaymentMethod,
  PaymentType,
  Priority,
  Reminder,
} from "@/lib/types";
import { daysFromToday, hoursSince, todayKey } from "@/lib/utils";

/* ----------------------------- Labels ----------------------------- */

export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New",
  awaiting_reply: "Awaiting reply",
  replied: "Replied",
  site_visit: "Site visit",
  quoted: "Quoted",
  won: "Won",
  closed: "Closed",
};
export const ENQUIRY_STATUSES = Object.keys(ENQUIRY_STATUS_LABEL) as EnquiryStatus[];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  quoted: "Quoted",
  awaiting_deposit: "Awaiting deposit",
  scheduled: "Scheduled",
  in_progress: "In progress",
  snagging: "Snagging",
  completed: "Completed",
};
export const JOB_STATUSES = Object.keys(JOB_STATUS_LABEL) as JobStatus[];

export const SOURCE_LABEL: Record<EnquirySource, string> = {
  email: "Email",
  instagram: "Instagram",
  phone: "Phone",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  deposit: "Deposit",
  stage: "Stage payment",
  final: "Final payment",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  cheque: "Cheque",
};

/* ----------------------------- Enquiries ----------------------------- */

export function needsReply(e: Enquiry): boolean {
  return e.status === "new" || e.status === "awaiting_reply";
}

export function followUpDue(e: Enquiry): boolean {
  return (
    !!e.followUpDate &&
    daysFromToday(e.followUpDate) <= 0 &&
    e.status !== "won" &&
    e.status !== "closed"
  );
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function sortEnquiries(list: Enquiry[]): Enquiry[] {
  return [...list].sort((a, b) => {
    const ra = needsReply(a) ? 0 : followUpDue(a) ? 1 : 2;
    const rb = needsReply(b) ? 0 : followUpDue(b) ? 1 : 2;
    if (ra !== rb) return ra - rb;
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority])
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
  });
}

/* ----------------------------- Jobs & money ----------------------------- */

export interface JobFinance {
  depositPaid: number;
  totalPaid: number;
  depositOutstanding: number;
  balance: number;
  paidPercent: number;
  depositOverdue: boolean;
  depositDaysUntilDue: number | null;
}

export function paymentsForJob(payments: Payment[], jobId: string): Payment[] {
  return payments
    .filter((p) => p.jobId === jobId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function jobFinance(job: Job, payments: Payment[]): JobFinance {
  const mine = payments.filter((p) => p.jobId === job.id);
  const depositPaid = mine.filter((p) => p.type === "deposit").reduce((s, p) => s + p.amount, 0);
  const totalPaid = mine.reduce((s, p) => s + p.amount, 0);
  // Any money received counts towards the deposit (customers don't always label payments).
  const depositOutstanding = Math.max(0, job.depositRequired - Math.max(depositPaid, totalPaid));
  const balance = Math.max(0, job.quotedValue - totalPaid);
  const paidPercent = job.quotedValue > 0 ? Math.min(100, Math.round((totalPaid / job.quotedValue) * 100)) : 0;
  const depositDaysUntilDue = job.depositDueDate ? daysFromToday(job.depositDueDate) : null;
  return {
    depositPaid,
    totalPaid,
    depositOutstanding,
    balance,
    paidPercent,
    depositOverdue: depositOutstanding > 0 && depositDaysUntilDue !== null && depositDaysUntilDue < 0,
    depositDaysUntilDue,
  };
}

export const isActiveJob = (j: Job) => j.status !== "completed";

export function jobsAwaitingDeposit(data: AppData) {
  return data.jobs
    .filter(isActiveJob)
    .map((job) => ({ job, finance: jobFinance(job, data.payments) }))
    .filter(({ finance }) => finance.depositOutstanding > 0)
    .sort((a, b) => (a.finance.depositDaysUntilDue ?? 99) - (b.finance.depositDaysUntilDue ?? 99));
}

/** Jobs with deposit covered but money still owed (stage/final). */
export function jobsWithBalance(data: AppData) {
  return data.jobs
    .map((job) => ({ job, finance: jobFinance(job, data.payments) }))
    .filter(({ finance }) => finance.depositOutstanding === 0 && finance.balance > 0)
    .sort((a, b) => b.finance.balance - a.finance.balance);
}

/* ----------------------------- Reminders ----------------------------- */

export function remindersDue(reminders: Reminder[]): Reminder[] {
  return reminders
    .filter((r) => !r.done && daysFromToday(r.dueDate) <= 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/* ----------------------------- Overview ----------------------------- */

export interface OverviewStats {
  newEnquiries: number;
  unanswered: number;
  activeJobs: number;
  depositsDueCount: number;
  depositsDueTotal: number;
  outstandingTotal: number;
  remindersDue: number;
}

export function overviewStats(data: AppData): OverviewStats {
  const deposits = jobsAwaitingDeposit(data);
  return {
    newEnquiries: data.enquiries.filter((e) => e.status === "new").length,
    unanswered: data.enquiries.filter(needsReply).length,
    activeJobs: data.jobs.filter(isActiveJob).length,
    depositsDueCount: deposits.length,
    depositsDueTotal: deposits.reduce((s, d) => s + d.finance.depositOutstanding, 0),
    outstandingTotal: data.jobs
      .filter((j) => j.status !== "quoted")
      .reduce((s, j) => s + jobFinance(j, data.payments).balance, 0),
    remindersDue: remindersDue(data.reminders).length,
  };
}

export type PriorityItem =
  | { kind: "reply"; id: string; title: string; detail: string; urgency: number; enquiryId: string }
  | { kind: "followup"; id: string; title: string; detail: string; urgency: number; enquiryId: string }
  | { kind: "deposit"; id: string; title: string; detail: string; urgency: number; jobId: string }
  | { kind: "reminder"; id: string; title: string; detail: string; urgency: number; reminderId: string };

/** "What needs my attention today?" — ordered, deduplicated list. */
export function todaysPriorities(data: AppData): PriorityItem[] {
  const items: PriorityItem[] = [];

  for (const e of data.enquiries.filter(needsReply)) {
    const hrs = hoursSince(e.receivedAt);
    const waited = hrs < 24 ? `${Math.max(1, Math.round(hrs))}h` : `${Math.round(hrs / 24)}d`;
    items.push({
      kind: "reply",
      id: `reply_${e.id}`,
      title: `Reply to ${e.customerName}`,
      detail: `${e.title}, ${e.location} · waiting ${waited}`,
      urgency: (e.priority === "high" ? 0 : 10) + (hrs > 24 ? 0 : 5),
      enquiryId: e.id,
    });
  }

  for (const e of data.enquiries.filter((x) => !needsReply(x) && followUpDue(x))) {
    items.push({
      kind: "followup",
      id: `follow_${e.id}`,
      title: `Follow up with ${e.customerName}`,
      detail: `${e.title}, ${e.location}`,
      urgency: 12,
      enquiryId: e.id,
    });
  }

  for (const { job, finance } of jobsAwaitingDeposit(data)) {
    if (finance.depositDaysUntilDue === null || finance.depositDaysUntilDue > 3) continue;
    items.push({
      kind: "deposit",
      id: `dep_${job.id}`,
      title: finance.depositOverdue
        ? `${job.customerName}'s deposit is overdue`
        : `${job.customerName}'s deposit is due soon`,
      detail: `£${finance.depositOutstanding.toLocaleString("en-GB")} · ${job.title}`,
      urgency: finance.depositOverdue ? 3 : 15,
      jobId: job.id,
    });
  }

  for (const r of remindersDue(data.reminders)) {
    items.push({
      kind: "reminder",
      id: `rem_${r.id}`,
      title: r.title,
      detail: r.dueDate === todayKey() ? "Due today" : "Overdue",
      urgency: r.dueDate === todayKey() ? 6 : 2,
      reminderId: r.id,
    });
  }

  return items.sort((a, b) => a.urgency - b.urgency);
}

/* ----------------------------- Lookups ----------------------------- */

function normalise(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s&]/g, " ").replace(/\s+/g, " ").trim();
}

/** Fuzzy-ish customer name match: "Sarah" matches "Sarah Mitchell", "Patel" matches "The Patels". */
export function nameMatches(customerName: string, query: string): boolean {
  const name = normalise(customerName);
  const q = normalise(query).replace(/^the /, "");
  if (!q) return false;
  if (name.includes(q)) return true;
  const qSingular = q.replace(/s$/, "");
  const parts = name.split(" ").map((p) => p.replace(/s$/, ""));
  return q.split(" ").every((w) => parts.includes(w.replace(/s$/, ""))) || parts.includes(qSingular);
}
