/**
 * Pure, deterministic business logic shared by the server (reports, Bob tools)
 * and the dashboard. No storage, no React, no AI.
 */
import type {
  Enquiry, EnquirySource, EnquiryStatus, Expense, ExpenseCategory, Invoice, Job, JobStatus, Payment, PaymentMethod,
  PaymentType, Priority, Quote, Snapshot, Task,
} from "@/lib/types";
import { daysFromToday, hoursSince, todayKey } from "@/lib/utils";

/* ----------------------------- Labels ----------------------------- */

export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New",
  awaiting_reply: "Awaiting reply",
  replied: "Replied",
  quote_required: "Quote required",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};
export const ENQUIRY_STATUSES = Object.keys(ENQUIRY_STATUS_LABEL) as EnquiryStatus[];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  quoted: "Quoted",
  awaiting_deposit: "Awaiting deposit",
  scheduled: "Booked in",
  in_progress: "In progress",
  snagging: "Snagging",
  completed: "Completed",
  lost: "Lost",
};
export const JOB_STATUSES = Object.keys(JOB_STATUS_LABEL) as JobStatus[];

export const SOURCE_LABEL: Record<EnquirySource, string> = {
  email: "Email",
  website: "Website",
  instagram: "Instagram",
  phone: "Phone",
  manual: "Added manually",
};
export const ENQUIRY_SOURCES = Object.keys(SOURCE_LABEL) as EnquirySource[];

export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

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

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  materials: "Materials",
  labour: "Labour",
  plant_hire: "Plant hire",
  subcontractor: "Subcontractor",
  waste: "Skips & waste",
  other: "Other",
};

export const QUOTE_STATUS_LABEL: Record<Quote["status"], string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
};

/* ----------------------------- Enquiries ----------------------------- */

export function needsReply(e: Enquiry): boolean {
  return e.status === "new" || e.status === "awaiting_reply";
}

export const isOpenEnquiry = (e: Enquiry) => e.status !== "won" && e.status !== "lost";

export function followUpDue(e: Enquiry): boolean {
  return !!e.followUpDate && daysFromToday(e.followUpDate) <= 0 && isOpenEnquiry(e);
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function sortEnquiries(list: Enquiry[]): Enquiry[] {
  return [...list].sort((a, b) => {
    const ra = needsReply(a) ? 0 : followUpDue(a) ? 1 : isOpenEnquiry(a) ? 2 : 3;
    const rb = needsReply(b) ? 0 : followUpDue(b) ? 1 : isOpenEnquiry(b) ? 2 : 3;
    if (ra !== rb) return ra - rb;
    if (ra < 2 && PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority])
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
  });
}

/* ----------------------------- Quotes ----------------------------- */

/** Sent quotes with no answer whose follow-up date has arrived (or 7+ days with none set). */
export function quoteNeedsFollowUp(q: Quote): boolean {
  if (q.status !== "sent") return false;
  if (q.followUpDate) return daysFromToday(q.followUpDate) <= 0;
  return !!q.sentAt && hoursSince(q.sentAt) >= 7 * 24;
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
  expenses: number;
  invoiced: number;
}

export function paymentsForJob(payments: Payment[], jobId: string): Payment[] {
  return payments.filter((p) => p.jobId === jobId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function jobFinance(job: Job, payments: Payment[], expenses: Expense[] = [], invoices: Invoice[] = []): JobFinance {
  const mine = payments.filter((p) => p.jobId === job.id);
  const depositPaid = mine.filter((p) => p.type === "deposit").reduce((s, p) => s + p.amount, 0);
  const totalPaid = mine.reduce((s, p) => s + p.amount, 0);
  const depositOutstanding = Math.max(0, job.depositRequired - Math.max(depositPaid, totalPaid));
  const balance = Math.max(0, round2(job.quotedValue - totalPaid));
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
    expenses: expenses.filter((e) => e.jobId === job.id).reduce((s, e) => s + e.amount, 0),
    invoiced: invoices
      .filter((i) => i.jobId === job.id && i.status !== "void" && i.status !== "draft")
      .reduce((s, i) => s + i.subtotal, 0),
  };
}

export const isActiveJob = (j: Job) => j.status !== "completed" && j.status !== "lost";

export function jobsAwaitingDeposit(data: Pick<Snapshot, "jobs" | "payments">) {
  return data.jobs
    .filter((j) => isActiveJob(j) && j.status !== "quoted")
    .map((job) => ({ job, finance: jobFinance(job, data.payments) }))
    .filter(({ finance }) => finance.depositOutstanding > 0)
    .sort((a, b) => (a.finance.depositDaysUntilDue ?? 99) - (b.finance.depositDaysUntilDue ?? 99));
}

/* ----------------------------- Invoices ----------------------------- */

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function invoiceBalance(i: Invoice): number {
  return Math.max(0, round2(i.total - i.amountPaid));
}

export function isInvoiceOutstanding(i: Invoice): boolean {
  return i.status === "sent" && invoiceBalance(i) > 0;
}

export function isInvoiceOverdue(i: Invoice): boolean {
  return isInvoiceOutstanding(i) && !!i.dueDate && daysFromToday(i.dueDate) < 0;
}

export function invoiceStatusLabel(i: Invoice): string {
  if (i.status === "draft") return "Draft";
  if (i.status === "void") return "Void";
  if (i.status === "paid" || invoiceBalance(i) === 0) return "Paid";
  if (isInvoiceOverdue(i)) return "Overdue";
  if (i.amountPaid > 0) return "Part paid";
  return "Sent";
}

/** Work out subtotal / VAT / total from what the user said. Never guesses the treatment. */
export function computeInvoiceTotals(amount: number, amountsAre: Invoice["amountsAre"], vatRate: number) {
  if (amountsAre === "no_vat" || vatRate === 0) return { subtotal: round2(amount), vat: 0, total: round2(amount), vatRate: 0 };
  if (amountsAre === "exclusive") {
    const vat = round2((amount * vatRate) / 100);
    return { subtotal: round2(amount), vat, total: round2(amount + vat), vatRate };
  }
  const subtotal = round2(amount / (1 + vatRate / 100));
  return { subtotal, vat: round2(amount - subtotal), total: round2(amount), vatRate };
}

/* ----------------------------- Tasks ----------------------------- */

export function tasksDue(tasks: Task[]): Task[] {
  return tasks.filter((r) => !r.done && daysFromToday(r.dueDate) <= 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/* ----------------------------- Priorities ----------------------------- */

interface PriorityBase {
  id: string;
  title: string;
  detail: string;
  /** Compact form for scanning: the customer or job, and why it needs attention. */
  who: string;
  why: string;
  urgency: number;
  /** The underlying issue (enquiry, job, invoice…). Items with the same key are merged. */
  key: string;
  /** Reminders folded into this item because they're about the same thing. */
  taskIds?: string[];
}

export type PriorityItem =
  | (PriorityBase & { kind: "reply"; enquiryId: string; source: EnquirySource; provider?: string })
  | (PriorityBase & { kind: "followup"; enquiryId: string; source: EnquirySource; provider?: string })
  | (PriorityBase & { kind: "quote"; quoteId: string; enquiryId?: string; customerName: string })
  | (PriorityBase & { kind: "deposit"; jobId: string; customerName: string })
  | (PriorityBase & { kind: "invoice"; invoiceId: string; customerName: string })
  | (PriorityBase & { kind: "task"; taskId: string });

const gbp0 = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

/**
 * "What needs sorting today?" — proactive suggestions computed from records:
 * unanswered enquiries, overdue follow-ups, quotes awaiting responses, tasks
 * due, overdue deposits and invoices (by recorded due dates).
 */
export function todaysPriorities(
  data: Pick<Snapshot, "enquiries" | "jobs" | "payments" | "tasks" | "invoices" | "quotes" | "customers">,
  opts: { includeFinance: boolean } = { includeFinance: true },
): PriorityItem[] {
  const items: PriorityItem[] = [];
  const customerName = (id?: string) => data.customers.find((c) => c.id === id)?.name ?? "a customer";

  for (const e of data.enquiries.filter(needsReply)) {
    const hrs = hoursSince(e.receivedAt);
    const waited = hrs < 24 ? `${Math.max(1, Math.round(hrs))}h` : `${Math.round(hrs / 24)}d`;
    items.push({
      kind: "reply",
      id: `reply_${e.id}`,
      title: `Reply to ${e.customerName}`,
      detail: `${e.title}, ${e.location} · waiting ${waited}`,
      who: e.customerName,
      why: `Awaiting reply · ${waited} · ${e.title}`,
      urgency: (e.priority === "high" ? 0 : 10) + (hrs > 24 ? 0 : 5),
      key: `enquiry:${e.id}`,
      enquiryId: e.id,
      source: e.source,
      provider: e.provider,
    });
  }

  for (const e of data.enquiries.filter((x) => !needsReply(x) && followUpDue(x))) {
    items.push({
      kind: "followup",
      id: `follow_${e.id}`,
      title: `Follow up with ${e.customerName}`,
      detail: `${e.title}, ${e.location}`,
      who: e.customerName,
      why: `Follow-up due · ${e.title}`,
      urgency: 12,
      key: `enquiry:${e.id}`,
      enquiryId: e.id,
      source: e.source,
      provider: e.provider,
    });
  }

  const followEnquiryIds = new Set(items.map((i) => ("enquiryId" in i ? i.enquiryId : "")));
  for (const q of data.quotes.filter(quoteNeedsFollowUp)) {
    if (q.enquiryId && followEnquiryIds.has(q.enquiryId)) continue;
    items.push({
      kind: "quote",
      id: `quote_${q.id}`,
      title: `Chase ${customerName(q.customerId)} about their quote`,
      detail: `${q.description}${opts.includeFinance ? ` · ${gbp0(q.amount)}` : ""} · sent ${Math.round(hoursSince(q.sentAt!) / 24)}d ago`,
      who: customerName(q.customerId),
      why: `Quote${opts.includeFinance ? ` of ${gbp0(q.amount)}` : ""} unanswered · sent ${Math.round(hoursSince(q.sentAt!) / 24)}d ago`,
      urgency: 14,
      key: q.enquiryId ? `enquiry:${q.enquiryId}` : `quote:${q.id}`,
      quoteId: q.id,
      enquiryId: q.enquiryId,
      customerName: customerName(q.customerId),
    });
  }

  if (opts.includeFinance) {
    for (const { job, finance } of jobsAwaitingDeposit(data)) {
      if (finance.depositDaysUntilDue === null || finance.depositDaysUntilDue > 3) continue;
      items.push({
        kind: "deposit",
        id: `dep_${job.id}`,
        title: finance.depositOverdue ? `${job.customerName}'s deposit is overdue` : `${job.customerName}'s deposit is due soon`,
        detail: `${gbp0(finance.depositOutstanding)} · ${job.title}`,
        who: job.customerName,
        why: `${gbp0(finance.depositOutstanding)} deposit ${finance.depositOverdue ? "overdue" : "due soon"} · ${job.title}`,
        urgency: finance.depositOverdue ? 3 : 15,
        key: `job:${job.id}`,
        jobId: job.id,
        customerName: job.customerName,
      });
    }
    for (const inv of data.invoices.filter(isInvoiceOverdue)) {
      items.push({
        kind: "invoice",
        id: `inv_${inv.id}`,
        title: `${customerName(inv.customerId)}'s invoice is overdue`,
        detail: `${gbp0(invoiceBalance(inv))} · due ${Math.abs(daysFromToday(inv.dueDate!))}d ago`,
        who: customerName(inv.customerId),
        why: `Invoice ${gbp0(invoiceBalance(inv))} overdue · ${Math.abs(daysFromToday(inv.dueDate!))}d`,
        urgency: 4,
        key: `invoice:${inv.id}`,
        invoiceId: inv.id,
        customerName: customerName(inv.customerId),
      });
    }
  }

  // Reminders about something already on the list are folded into that item,
  // so an overdue deposit and "chase the deposit" appear once.
  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const r of tasksDue(data.tasks)) {
    const urgency = r.dueDate === todayKey() ? 6 : 2;
    const key = r.relatedType && r.relatedId ? `${r.relatedType}:${r.relatedId}` : `task:${r.id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.taskIds = [...(existing.taskIds ?? []), r.id];
      existing.urgency = Math.min(existing.urgency, urgency);
      if (!existing.detail.includes("reminder")) existing.detail += ` · reminder ${r.dueDate === todayKey() ? "due today" : "overdue"}`;
      if (!existing.why.includes("reminder")) existing.why += " · reminder set";
      continue;
    }
    const item: PriorityItem = {
      kind: "task",
      id: `task_${r.id}`,
      title: r.title,
      detail: r.dueDate === todayKey() ? "Due today" : "Overdue",
      who: r.title,
      why: r.dueDate === todayKey() ? "Reminder due today" : "Reminder overdue",
      urgency,
      key,
      taskId: r.id,
    };
    items.push(item);
    byKey.set(key, item);
  }

  return items.sort((a, b) => a.urgency - b.urgency);
}

/* ----------------------------- Lookups ----------------------------- */

export function normaliseText(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s&]/g, " ").replace(/\s+/g, " ").trim();
}

/** "Sarah" matches "Sarah Mitchell"; "Patel" matches "The Patels"; "Smith" matches "Mark Smith". */
export function nameMatches(customerName: string, query: string): boolean {
  const name = normaliseText(customerName);
  const q = normaliseText(query).replace(/^the /, "");
  if (!q) return false;
  if (name.includes(q)) return true;
  const parts = name.split(" ").map((p) => p.replace(/s$/, ""));
  return q.split(" ").every((w) => parts.includes(w.replace(/s$/, "")));
}

export function inferJobKind(text: string): Job["kind"] {
  const t = text.toLowerCase();
  if (/kitchen/.test(t)) return "kitchen";
  if (/loft|dormer/.test(t)) return "loft";
  if (/wardrobe|alcove|cupboard|storage/.test(t)) return "wardrobes";
  if (/extension|garage/.test(t)) return "extension";
  if (/deck/.test(t)) return "decking";
  if (/stair|banister|balustrade/.test(t)) return "staircase";
  if (/bathroom|shower|en-?suite/.test(t)) return "bathroom";
  return "general";
}
