import "server-only";
import type { Invoice, Job, Payment } from "@/lib/types";
import { invoiceDraftSchema, paymentInputSchema, toFieldErrors } from "@/lib/validation";
import { PAYMENT_TYPE_LABEL, computeInvoiceTotals, invoiceBalance, jobFinance } from "@/lib/derive";
import { gbp, uid, todayKey } from "@/lib/utils";
import { scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { audit, getCustomer, getJob } from "./records";

const now = () => new Date().toISOString();


export function listInvoices(ctx: Ctx): Invoice[] {
  return scoped(ctx).list<Invoice>("invoices", { order: "created_at DESC" });
}

export function getInvoice(ctx: Ctx, id: string): Invoice | undefined {
  return scoped(ctx).get<Invoice>("invoices", id);
}

export function listPayments(ctx: Ctx): Payment[] {
  return scoped(ctx).list<Payment>("payments", { order: "received_at DESC" });
}

/** Invoices on the same job for the same total, not void — used to stop duplicates. */
export function findSimilarInvoices(ctx: Ctx, jobId: string | undefined, total: number): Invoice[] {
  if (!jobId) return [];
  return scoped(ctx).list<Invoice>("invoices", {
    where: "job_id = ? AND status != 'void' AND ABS(total - ?) < 0.01",
    params: [jobId, total],
  });
}

/**
 * Resolve the VAT rate for a new invoice. Returns an error rather than
 * guessing when the organisation's VAT status is unknown.
 */
export function resolveVatRate(ctx: Ctx, amountsAre: Invoice["amountsAre"], explicitRate?: number): Result<number> {
  if (amountsAre === "no_vat") return ok(0);
  if (ctx.org.finance.vatRegistered === false)
    return fail("invalid", `${ctx.org.shortName} is set up as not VAT registered, so this invoice can't include VAT.`);
  const rate = explicitRate ?? ctx.org.finance.vatRate;
  if (rate === null || rate === undefined) return fail("invalid", "The VAT rate isn't set up yet. Add it in Settings, or say \"no VAT\".");
  return ok(rate);
}

export function createInvoiceDraft(ctx: Ctx, input: unknown, opts: { allowDuplicate?: boolean } = {}): Result<Invoice> {
  const no = denied(ctx, "invoices.draft");
  if (no) return no;
  const parsed = invoiceDraftSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Some invoice details are missing.", toFieldErrors(parsed.error));
  const v = parsed.data;
  const customer = getCustomer(ctx, v.customerId);
  if (!customer) return fail("not_found", "Customer not found");
  let job: Job | undefined;
  if (v.jobId) {
    job = getJob(ctx, v.jobId);
    if (!job) return fail("not_found", "Job not found");
    if (job.customerId !== customer.id) return fail("invalid", "That job belongs to a different customer.");
  }
  const rate = resolveVatRate(ctx, v.amountsAre, v.vatRate);
  if (!rate.ok) return rate;
  const totals = computeInvoiceTotals(v.amount, v.amountsAre, rate.value);
  if (!opts.allowDuplicate && findSimilarInvoices(ctx, v.jobId, totals.total).length)
    return fail("conflict", `There's already an invoice for ${gbp(totals.total)} on this job.`);

  return tx(() => {
    const n = scoped(ctx).nextCounter("invoice_ref");
    const invoice: Invoice = {
      id: uid("inv"),
      customerId: customer.id,
      jobId: job?.id,
      draftRef: `BOB-${String(n).padStart(4, "0")}`,
      status: "draft",
      lines: [{ description: v.description, quantity: 1, unitAmount: v.amount }],
      amountsAre: v.amountsAre,
      vatRate: totals.vatRate,
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
      dueDate: v.dueDate,
      amountPaid: 0,
      createdAt: now(),
      createdBy: ctx.userName,
    };
    scoped(ctx).insert("invoices", invoice);
    audit(ctx, "invoice.draft_created", `Draft invoice ${invoice.draftRef} for ${customer.name}: ${gbp(invoice.total)} (not sent)`, "invoice", invoice.id);
    return ok(invoice);
  });
}

/** Record that an invoice was sent OUTSIDE Bob (e.g. from the accounting app). */
export function markInvoiceSentManually(ctx: Ctx, id: string): Result<Invoice> {
  const no = denied(ctx, "invoices.send");
  if (no) return no;
  const inv = getInvoice(ctx, id);
  if (!inv) return fail("not_found", "Invoice not found");
  if (inv.status !== "draft") return fail("conflict", "Only drafts can be marked as sent.");
  const customer = getCustomer(ctx, inv.customerId);
  const updated = tx(() => {
    const u = scoped(ctx).update<Invoice>("invoices", id, { status: "sent", issueDate: todayKey(), sentAt: now() })!;
    audit(ctx, "invoice.marked_sent", `${inv.draftRef} for ${customer?.name ?? "customer"} marked as sent outside Bob`, "invoice", id);
    return u;
  });
  return ok(updated);
}

/** Apply a successful send from an accounting provider. Only called with the provider's response. */
export function applyProviderSend(
  ctx: Ctx,
  id: string,
  res: { provider: string; externalId: string; number?: string },
): Result<Invoice> {
  const inv = getInvoice(ctx, id);
  if (!inv) return fail("not_found", "Invoice not found");
  const customer = getCustomer(ctx, inv.customerId);
  const updated = tx(() => {
    const u = scoped(ctx).update<Invoice>("invoices", id, {
      status: "sent",
      issueDate: todayKey(),
      sentAt: now(),
      provider: res.provider,
      externalId: res.externalId,
      number: res.number,
      lastSyncedAt: now(),
    })!;
    audit(
      ctx,
      "invoice.sent",
      `Invoice ${res.number ?? inv.draftRef} sent to ${customer?.name ?? "customer"} via ${res.provider === "demo_accounting" ? "demo accounting (simulated)" : res.provider}`,
      "invoice",
      id,
    );
    return u;
  });
  return ok(updated);
}

export function voidInvoice(ctx: Ctx, id: string): Result<Invoice> {
  const no = denied(ctx, "invoices.send");
  if (no) return no;
  const inv = getInvoice(ctx, id);
  if (!inv) return fail("not_found", "Invoice not found");
  if (inv.amountPaid > 0) return fail("conflict", "This invoice has payments against it, so it can't be voided here.");
  if (inv.status === "void") return ok(inv);
  const updated = tx(() => {
    const u = scoped(ctx).update<Invoice>("invoices", id, { status: "void" })!;
    audit(ctx, "invoice.voided", `${inv.number ?? inv.draftRef} voided`, "invoice", id);
    return u;
  });
  return ok(updated);
}

export function deleteInvoiceDraft(ctx: Ctx, id: string): Result<Invoice> {
  const no = denied(ctx, "invoices.draft");
  if (no) return no;
  const inv = getInvoice(ctx, id);
  if (!inv) return fail("not_found", "Invoice not found");
  if (inv.status !== "draft") return fail("conflict", "Only drafts can be deleted.");
  tx(() => {
    scoped(ctx).remove("invoices", id);
    audit(ctx, "invoice.draft_deleted", `Draft ${inv.draftRef} deleted`, "invoice", id);
  });
  return ok(inv);
}

export function recordPayment(ctx: Ctx, input: unknown): Result<{ payment: Payment; job: Job; statusAdvanced: boolean; invoice?: Invoice }> {
  const no = denied(ctx, "payments.record");
  if (no) return no;
  const parsed = paymentInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the payment details.", toFieldErrors(parsed.error));
  const v = parsed.data;
  const job = getJob(ctx, v.jobId);
  if (!job) return fail("not_found", "Job not found");
  const before = jobFinance(job, listPayments(ctx));
  if (v.amount > before.balance + 0.001)
    return fail("invalid", `That's more than the ${gbp(before.balance)} left to pay on this job.`, {
      amount: `That's more than the ${gbp(before.balance)} left to pay on this job`,
    });
  let invoice: Invoice | undefined;
  if (v.invoiceId) {
    invoice = getInvoice(ctx, v.invoiceId);
    if (!invoice) return fail("not_found", "Invoice not found");
    if (invoice.jobId !== job.id) return fail("invalid", "That invoice is for a different job.");
    if (invoice.status !== "sent") return fail("conflict", "Payments can only be recorded against sent invoices.");
    if (v.amount > invoiceBalance(invoice) + 0.001)
      return fail("invalid", `That's more than the ${gbp(invoiceBalance(invoice))} left on this invoice.`, {
        amount: `That's more than the ${gbp(invoiceBalance(invoice))} left on this invoice`,
      });
  }
  const payment: Payment = { id: uid("pay"), ...v, recordedBy: ctx.userName, recordedAt: now() };
  return tx(() => {
    scoped(ctx).insert("payments", payment);
    if (invoice) {
      const paid = Math.round((invoice.amountPaid + v.amount) * 100) / 100;
      const fully = paid >= invoice.total - 0.001;
      invoice = scoped(ctx).update<Invoice>("invoices", invoice.id, {
        amountPaid: paid,
        status: fully ? "paid" : "sent",
        paidAt: fully ? now() : undefined,
      });
    }
    let statusAdvanced = false;
    const after = jobFinance(job, listPayments(ctx));
    if (job.status === "awaiting_deposit" && after.depositOutstanding === 0) {
      scoped(ctx).update<Job>("jobs", job.id, { status: "scheduled" });
      statusAdvanced = true;
    }
    audit(
      ctx,
      "payment.recorded",
      `${gbp(payment.amount)} ${PAYMENT_TYPE_LABEL[payment.type].toLowerCase()} recorded for ${job.customerName} — ${job.title}`,
      "job",
      job.id,
    );
    return ok({ payment, job: getJob(ctx, job.id)!, statusAdvanced, invoice });
  });
}

export function logPaymentChased(ctx: Ctx, jobId: string): Result<Job> {
  const no = denied(ctx, "payments.record");
  if (no) return no;
  const j = getJob(ctx, jobId);
  if (!j) return fail("not_found", "Job not found");
  tx(() => {
    scoped(ctx).update<Job>("jobs", jobId, { lastChasedAt: now() });
    audit(ctx, "payment.chased", `Payment chased with ${j.customerName} — ${j.title}`, "job", jobId);
  });
  return ok(getJob(ctx, jobId)!);
}
