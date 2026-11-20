/**
 * The customer cost summary for a handover report. Pure: the same function
 * feeds the editor ("these figures will appear"), the preview and the PDF, so
 * what Luke approves is exactly what's printed. AI never writes numbers.
 *
 * Meanings:
 *  - Agreed price: the job's price as agreed (the accepted quote).
 *  - Approved variations: changes the customer approved, as entered with their
 *    VAT treatment. A variation that has been billed still counts once in the
 *    agreed total; invoices are a separate measure, so nothing is added twice.
 *  - Invoiced to date: invoices sent (or paid), never drafts or voided ones.
 *  - Payments received: payments recorded against the job.
 *  - Left to pay: the agreed total minus payments received.
 *  - Due on invoices: only amounts actually invoiced and unpaid; "overdue" only
 *    when an invoice's due date has passed. Un-invoiced work is never overdue.
 * Internal costs (expenses, supplier bills, subcontractor rates, margins) are
 * never read here.
 */
import type { CostLine, Invoice, Job, Payment, ReportManualFigure, Variation } from "@/lib/types";
import { invoiceBalance, round2 } from "@/lib/derive";
import { daysFromToday, gbp } from "@/lib/utils";

const VAT_NOTE: Record<Variation["amountsAre"], string> = { inclusive: "including VAT", exclusive: "plus VAT", no_vat: "no VAT" };

export interface CostSummary {
  lines: CostLine[];
  notes: string[];
  /** False when there's no agreed price to build on — offer to omit or enter report figures. */
  reliable: boolean;
}

export function reportCostSummary(job: Pick<Job, "id" | "quotedValue">, data: { variations: Variation[]; invoices: Invoice[]; payments: Payment[] }): CostSummary {
  const variations = data.variations.filter((v) => v.jobId === job.id && v.status === "approved");
  const invoices = data.invoices.filter((i) => i.jobId === job.id && (i.status === "sent" || i.status === "paid"));
  const payments = data.payments.filter((p) => p.jobId === job.id);
  const lines: CostLine[] = [];
  const notes: string[] = [];
  const reliable = job.quotedValue > 0;
  if (!reliable) return { lines, notes: ["There's no agreed price on this job, so Bob can't build a reliable summary. Leave costs out, or enter figures for this report."], reliable };

  lines.push({ key: "agreed", label: "Agreed price", amount: round2(job.quotedValue), note: "as quoted" });
  for (const v of variations) {
    const billed = v.invoiceId ? data.invoices.find((i) => i.id === v.invoiceId) : undefined;
    lines.push({ key: `var_${v.id}`, label: `Approved variation: ${v.description}`, amount: round2(v.amount), note: [VAT_NOTE[v.amountsAre], billed ? `billed on ${billed.number ?? "an invoice"}` : ""].filter(Boolean).join(" · ") });
  }
  if (variations.length) {
    const plusVat = variations.some((v) => v.amountsAre === "exclusive");
    lines.push({ key: "total", label: "Total agreed", amount: round2(job.quotedValue + variations.reduce((s, v) => s + v.amount, 0)), note: plusVat ? "VAT on variations marked plus VAT is added when invoiced" : undefined, strong: true });
  }
  const agreedTotal = lines.find((l) => l.key === "total")?.amount ?? lines[0].amount;

  if (invoices.length) {
    const withVat = invoices.some((i) => i.vat > 0);
    lines.push({ key: "invoiced", label: "Invoiced to date", amount: round2(invoices.reduce((s, i) => s + i.total, 0)), note: `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}${withVat ? ", including VAT" : ""}` });
  }
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  lines.push({ key: "paid", label: "Payments received", amount: paid, note: payments.length ? `${payments.length} payment${payments.length === 1 ? "" : "s"}` : "none yet" });
  lines.push({ key: "balance", label: paid >= agreedTotal ? "Paid in full" : "Left to pay", amount: Math.max(0, round2(agreedTotal - paid)), strong: true, note: "agreed total less payments received" });

  // Payments aren't always allocated to an invoice (e.g. a deposit), so never show more as due than
  // has been invoiced but not yet paid overall.
  const unpaid = invoices.filter((i) => invoiceBalance(i) > 0);
  const invoicedTotal = round2(invoices.reduce((s, i) => s + i.total, 0));
  const due = Math.min(round2(unpaid.reduce((s, i) => s + invoiceBalance(i), 0)), Math.max(0, round2(invoicedTotal - paid)));
  if (unpaid.length && due > 0) {
    const overdue = Math.min(due, round2(unpaid.filter((i) => i.dueDate && daysFromToday(i.dueDate) < 0).reduce((s, i) => s + invoiceBalance(i), 0)));
    lines.push({ key: "due", label: "Due on invoices issued", amount: due, note: overdue > 0 ? `${gbp(overdue)} of this is past its due date` : undefined });
  }
  if (invoices.some((i) => i.vat > 0) && variations.length === 0) notes.push("Invoice amounts include VAT as shown on each invoice.");
  return { lines, notes, reliable };
}

/** Lines for figures typed in for this report only (clearly labelled; bookkeeping untouched). */
export function manualCostLines(figures: ReportManualFigure[]): CostLine[] {
  return figures.filter((f) => f.label.trim() && Number.isFinite(f.amount)).map((f, i) => ({ key: `manual_${i}`, label: f.label.trim(), amount: round2(f.amount) }));
}

export const MANUAL_COST_NOTE = "Figures entered for this report.";
