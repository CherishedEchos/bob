import "server-only";
/**
 * What's billable on a job, and saving invoice DRAFTS from a conversation.
 * Shared by Bob's rules engine and the Claude tools, so both give the same
 * figures. All money comes from the job, its approved variations, invoices
 * and payments; nothing is estimated.
 *
 *  - Remaining to invoice: the contract value (price + approved variations)
 *    less everything already invoiced (sent or paid) and payments taken
 *    without an invoice (e.g. a deposit paid by bank transfer).
 *  - Unpaid on invoices: what's still owed on invoices already sent. That's
 *    different from the remaining contract value and is never re-billed.
 *  - Drafts: one open draft per job. Asking again for the same amount returns
 *    the same draft (no duplicates on a double submit or a retry); a
 *    different amount asks whether to update the existing draft.
 */
import type { Invoice, Job, Payment, Variation } from "@/lib/types";
import { invoiceBalance, round2 } from "@/lib/derive";
import { addDaysKey, gbp, todayKey } from "@/lib/utils";
import { scoped } from "@/server/db";
import { fail, ok, type Ctx, type Result } from "@/server/context";
import { can } from "@/lib/auth/permissions";
import { getCustomer, getJob, listCustomers, listJobs } from "./records";
import { createInvoiceDraft, updateInvoiceDraft } from "./finance";
import { mentionScore, mentionedTown, soundKey } from "@/server/bob/resolve";
import { workKeywords } from "@/server/bob/nlu";

export type BillingBasis = "final_balance" | "deposit" | "amount";

export interface BillingInvoice {
  id: string;
  ref: string;
  status: Invoice["status"];
  description: string;
  total: number;
  paid: number;
  balance: number;
  isDeposit: boolean;
  dueDate?: string;
  overdue: boolean;
}

export interface JobBilling {
  job: { id: string; title: string; site: string; town: string; status: Job["status"] };
  customer: { id: string; name: string; hasEmail: boolean };
  price: number;
  approvedVariations: { description: string; amount: number; amountsAre: Variation["amountsAre"] }[];
  contractValue: number;
  depositRequired: number;
  depositPaid: number;
  depositInvoiced: boolean;
  paymentsTotal: number;
  paymentsWithoutInvoice: number;
  invoices: BillingInvoice[];
  drafts: BillingInvoice[];
  invoicedTotal: number;
  unpaidOnInvoices: number;
  remainingToInvoice: number;
  leftToPay: number;
  /** Everything has been invoiced already (there's a sent/paid invoice and nothing left). */
  fullyInvoiced: boolean;
  vat: { registered: boolean | null; rate: number | null; termsDays: number | null };
  options: { basis: BillingBasis; amount: number; label: string }[];
}

const isDepositInvoice = (i: Invoice) => i.lines.some((l) => /\bdeposit\b/i.test(l.description));

const asBillingInvoice = (i: Invoice): BillingInvoice => ({
  id: i.id,
  ref: i.number ?? i.draftRef,
  status: i.status,
  description: i.lines[0]?.description ?? "",
  total: i.total,
  paid: i.amountPaid,
  balance: invoiceBalance(i),
  isDeposit: isDepositInvoice(i),
  dueDate: i.dueDate,
  overdue: i.status === "sent" && invoiceBalance(i) > 0 && !!i.dueDate && i.dueDate < todayKey(),
});

export function jobBilling(ctx: Ctx, jobId: string): Result<JobBilling> {
  if (!can(ctx.role, "finance.read")) return fail("forbidden", "Your account doesn't have access to prices, invoices or payments.");
  const job = getJob(ctx, jobId);
  if (!job) return fail("not_found", "Job not found");
  const customer = getCustomer(ctx, job.customerId);
  const db = scoped(ctx);
  const variations = db.list<Variation>("variations", { where: "job_id = ? AND status = 'approved'", params: [jobId] });
  const all = db.list<Invoice>("invoices", { where: "job_id = ? AND status != 'void'", params: [jobId], order: "created_at" });
  const payments = db.list<Payment>("payments", { where: "job_id = ?", params: [jobId] });
  const issued = all.filter((i) => i.status === "sent" || i.status === "paid");
  const drafts = all.filter((i) => i.status === "draft");
  const contractValue = round2(job.quotedValue + variations.reduce((s, v) => s + v.amount, 0));
  const invoicedTotal = round2(issued.reduce((s, i) => s + i.total, 0));
  const paymentsTotal = round2(payments.reduce((s, p) => s + p.amount, 0));
  const paymentsWithoutInvoice = round2(payments.filter((p) => !p.invoiceId).reduce((s, p) => s + p.amount, 0));
  const depositPaid = round2(payments.filter((p) => p.type === "deposit").reduce((s, p) => s + p.amount, 0));
  const depositInvoiced = issued.some(isDepositInvoice);
  const remainingToInvoice = Math.max(0, round2(contractValue - invoicedTotal - paymentsWithoutInvoice));
  const unpaidOnInvoices = round2(issued.reduce((s, i) => s + invoiceBalance(i), 0));
  const options: JobBilling["options"] = [];
  if (remainingToInvoice > 0) options.push({ basis: "final_balance", amount: remainingToInvoice, label: `the final balance, ${gbp(remainingToInvoice)}` });
  const depositDue = round2(job.depositRequired - depositPaid);
  if (job.depositRequired > 0 && depositDue > 0 && !depositInvoiced && depositDue <= remainingToInvoice + 0.01) options.push({ basis: "deposit", amount: depositDue, label: `the deposit, ${gbp(depositDue)}` });
  return ok({
    job: { id: job.id, title: job.title, site: job.siteAddress || job.location, town: job.location, status: job.status },
    customer: { id: job.customerId, name: customer?.name ?? job.customerName, hasEmail: !!customer?.email },
    price: job.quotedValue,
    approvedVariations: variations.map((v) => ({ description: v.description, amount: v.amount, amountsAre: v.amountsAre })),
    contractValue,
    depositRequired: job.depositRequired,
    depositPaid,
    depositInvoiced,
    paymentsTotal,
    paymentsWithoutInvoice,
    invoices: issued.map(asBillingInvoice),
    drafts: drafts.map(asBillingInvoice),
    invoicedTotal,
    unpaidOnInvoices,
    remainingToInvoice,
    leftToPay: Math.max(0, round2(contractValue - paymentsTotal)),
    fullyInvoiced: remainingToInvoice <= 0 && issued.length > 0,
    vat: { registered: ctx.org.finance.vatRegistered, rate: ctx.org.finance.vatRate, termsDays: ctx.org.finance.defaultPaymentTermsDays },
    options,
  });
}

/* ------------------------------ Finding the job ------------------------------ */

export interface BillingCandidate {
  jobId: string;
  customerId: string;
  customerName: string;
  title: string;
  site: string;
  town: string;
  status: Job["status"];
  score: number;
  why: string[];
}

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
const STOPWORDS = new Set(["the", "for", "and", "invoice", "bill", "job", "prepare", "draft", "sort", "make", "put", "together", "please", "can", "you", "me", "an", "a", "out", "one", "that", "her", "his", "their", "mrs", "mr", "ms", "miss", "about", "need", "needs", "send", "raise", "final", "balance", "deposit"]);

/**
 * Jobs that fit what was said, using the customer's name (tolerant of
 * spelling/transcription slips), the site address, the town and the type of
 * work together. Best first; closed jobs only if nothing open fits.
 */
export function findBillingCandidates(ctx: Ctx, text: string): BillingCandidate[] {
  return billingLookup(ctx, text).candidates;
}

export interface BillingLookup {
  candidates: BillingCandidate[];
  /** A customer named clearly (full name or surname) — only their jobs are considered. */
  named?: { id: string; name: string }[];
  town?: string;
  /** Only a shared first name was said ("Sophie") and nothing else narrows it: ask which customer. */
  ambiguousCustomers?: { id: string; name: string; town?: string }[];
  /** The named customer has no job in the town that was said: refuse rather than pick another job. */
  townMiss?: { customer: string; town: string; theirJobs: string[] };
}

export function billingLookup(ctx: Ctx, text: string): BillingLookup {
  const jobs = listJobs(ctx).filter((j) => j.status !== "lost");
  const customers = new Map(listCustomers(ctx).map((c) => [c.id, c]));
  const town = mentionedTown(ctx, text, jobs.map((j) => j.location));
  const kws = workKeywords(text);
  const words = tokens(text).filter((w) => !STOPWORDS.has(w));
  // A clearly named customer (surname or full name) narrows everything to them.
  const strongest = Math.max(0, ...[...customers.values()].map((c) => mentionScore(text, c.name)));
  const named = strongest >= 2 ? [...customers.values()].filter((c) => mentionScore(text, c.name) === strongest) : [];
  const namedIds = new Set(named.map((c) => c.id));
  if (named.length && town) {
    const inTown = jobs.filter((j) => namedIds.has(j.customerId) && (j.location.toLowerCase() === town.toLowerCase() || `${j.siteAddress ?? ""}`.toLowerCase().includes(town.toLowerCase())));
    if (!inTown.length) {
      const theirs = jobs.filter((j) => namedIds.has(j.customerId));
      return { candidates: [], named: named.map((c) => ({ id: c.id, name: c.name })), town, townMiss: { customer: named[0].name, town, theirJobs: theirs.map((j) => `${j.title} (${j.location})`) } };
    }
  }
  if (strongest === 1 && !town && !kws.length) {
    const firstOnly = [...customers.values()].filter((c) => mentionScore(text, c.name) === 1);
    const siteWords = words.filter((w) => jobs.some((j) => `${j.siteAddress ?? ""}`.toLowerCase().includes(w)));
    if (firstOnly.length > 1 && !siteWords.length) return { candidates: [], ambiguousCustomers: firstOnly.map((c) => ({ id: c.id, name: c.name, town: c.town })) };
  }
  const out: BillingCandidate[] = [];
  for (const j of jobs) {
    if (namedIds.size && !namedIds.has(j.customerId)) continue;
    const c = customers.get(j.customerId);
    const why: string[] = [];
    let score = 0;
    const name = c ? mentionScore(text, c.name) : 0;
    if (name) {
      score += name * 3;
      why.push(name >= 3 ? "name" : name === 2 ? "surname" : "first name");
    }
    const site = `${j.siteAddress ?? ""} ${c?.address ?? ""}`.toLowerCase();
    const siteHits = words.filter((w) => site.includes(w) && !/^\d+$/.test(w) && (!town || w !== town.toLowerCase()));
    if (siteHits.length) {
      score += 2 + siteHits.length;
      why.push("site address");
    }
    if (town) {
      if (j.location.toLowerCase() === town.toLowerCase() || site.includes(town.toLowerCase())) {
        score += 3;
        why.push("town");
      } else score -= 4;
    }
    if (kws.length) {
      const hay = `${j.title} ${j.kind}`.toLowerCase();
      if (kws.some((k) => hay.includes(k))) {
        score += 3;
        why.push("type of work");
      } else if (kws.some((k) => j.description.toLowerCase().includes(k))) {
        score += 1;
        why.push("description");
      }
    }
    if (score > 0 && why.length) out.push({ jobId: j.id, customerId: j.customerId, customerName: c?.name ?? j.customerName, title: j.title, site: j.siteAddress || j.location, town: j.location, status: j.status, score, why });
  }
  out.sort((a, b) => b.score - a.score || Number(a.status === "completed") - Number(b.status === "completed"));
  const result: BillingLookup = { candidates: [], named: named.map((c) => ({ id: c.id, name: c.name })), town: town ?? undefined };
  if (!out.length) return result;
  // Keep the strongest matches: anything within 2 points of the best.
  const best = out[0].score;
  result.candidates = out.filter((x) => x.score >= best - 2).slice(0, 5);
  return result;
}

/** A soft hint for prompts: did the name match only by sound? */
export const soundsLike = (a: string, b: string) => soundKey(a) === soundKey(b);

/* ------------------------------ Saving the draft ------------------------------ */

export interface DraftInput {
  jobId: string;
  basis: BillingBasis;
  amount?: number;
  amountsAre?: Invoice["amountsAre"];
  vatRate?: number;
  dueDate?: string;
  dueInDays?: number;
  description?: string;
  /** Amend this draft instead of creating one. */
  invoiceId?: string;
}

export type DraftOutcome =
  | { ok: true; invoice: Invoice; outcome: "created" | "updated" | "existing"; notes: string[] }
  | { ok: false; code: "missing"; missing: ("amount" | "vat" | "vat_rate" | "due")[]; message: string }
  | { ok: false; code: "draft_exists"; draft: BillingInvoice; message: string }
  | { ok: false; code: "nothing_left" | "duplicate" | "forbidden" | "not_found" | "invalid"; message: string };

export function saveDraftFromConversation(ctx: Ctx, input: DraftInput): DraftOutcome {
  if (!can(ctx.role, "invoices.draft")) return { ok: false, code: "forbidden", message: "Your account can't prepare invoices." };
  const b = jobBilling(ctx, input.jobId);
  if (!b.ok) return { ok: false, code: b.code === "forbidden" ? "forbidden" : "not_found", message: b.error };
  const bill = b.value;
  const job = getJob(ctx, input.jobId)!;

  let amount = input.amount;
  if (input.basis === "final_balance") amount = amount ?? bill.remainingToInvoice;
  if (input.basis === "deposit") amount = amount ?? bill.options.find((o) => o.basis === "deposit")?.amount;
  if (!input.invoiceId && input.basis === "final_balance" && bill.remainingToInvoice <= 0)
    return { ok: false, code: "nothing_left", message: bill.fullyInvoiced ? `Everything on ${job.title} has already been invoiced (${bill.invoices.map((i) => `${i.ref}, ${i.status}, ${gbp(i.total)}`).join("; ")}).` : `There's nothing left to invoice on ${job.title}.` };
  if (input.basis === "deposit" && !amount) return { ok: false, code: "nothing_left", message: bill.depositInvoiced ? "The deposit has already been invoiced." : bill.depositRequired ? "The deposit has already been paid." : "This job has no deposit set." };

  const missing: ("amount" | "vat" | "vat_rate" | "due")[] = [];
  if (!amount || amount <= 0) missing.push("amount");
  const amountsAre = ctx.org.finance.vatRegistered === false ? "no_vat" : input.amountsAre;
  if (!amountsAre) missing.push("vat");
  else if (amountsAre !== "no_vat" && input.vatRate === undefined && ctx.org.finance.vatRate == null) missing.push("vat_rate");
  const dueDate = input.dueDate ?? (input.dueInDays ? addDaysKey(input.dueInDays) : ctx.org.finance.defaultPaymentTermsDays ? addDaysKey(ctx.org.finance.defaultPaymentTermsDays) : undefined);
  if (!dueDate) missing.push("due");
  if (missing.length) return { ok: false, code: "missing", missing, message: `Still need: ${missing.join(", ")}.` };

  const description = input.description?.trim() || `${job.title}, ${job.siteAddress || job.location}${input.basis === "final_balance" ? " — final balance" : input.basis === "deposit" ? " — deposit" : ""}`;
  const draftInput = { customerId: job.customerId, jobId: job.id, description, amount: round2(amount!), amountsAre: amountsAre!, vatRate: input.vatRate, dueDate: dueDate! };
  const notes: string[] = [];
  if (input.basis === "amount" && amount! > bill.remainingToInvoice + 0.01 && !input.invoiceId) notes.push(`That's more than the ${gbp(bill.remainingToInvoice)} left to invoice on this job.`);
  if (bill.unpaidOnInvoices > 0) notes.push(`Separately, ${gbp(bill.unpaidOnInvoices)} is still unpaid on invoices already sent.`);

  if (input.invoiceId) {
    const r = updateInvoiceDraft(ctx, input.invoiceId, draftInput);
    if (!r.ok) return { ok: false, code: r.code === "forbidden" ? "forbidden" : r.code === "not_found" ? "not_found" : "invalid", message: r.error };
    return { ok: true, invoice: r.value, outcome: "updated", notes };
  }
  // One open draft per job: same amount → it's the same request (double tap, retry); different → ask.
  const existing = scoped(ctx).list<Invoice>("invoices", { where: "job_id = ? AND status = 'draft'", params: [job.id], order: "created_at DESC" });
  const target = draftInput.amount;
  const same = existing.find((i) => Math.abs(i.lines[0]?.unitAmount - target) < 0.01 && i.amountsAre === draftInput.amountsAre);
  if (same) return { ok: true, invoice: same, outcome: "existing", notes };
  if (existing.length) {
    const d = asBillingInvoice(existing[0]);
    return { ok: false, code: "draft_exists", draft: d, message: `There's already a draft ${d.ref} for ${gbp(d.total)} on this job.` };
  }
  const r = createInvoiceDraft(ctx, draftInput);
  if (!r.ok) return { ok: false, code: r.code === "conflict" ? "duplicate" : "invalid", message: r.error };
  return { ok: true, invoice: r.value, outcome: "created", notes };
}
