/**
 * A job's internal financial position, from Bob's records only. Pure, so the
 * job profile, tests and (later) reports all agree.
 *
 *  - Contract value: agreed price + approved variations.
 *  - Received: payments recorded against the job.
 *  - Outstanding: contract value − received (never negative).
 *  - Costs: recorded job costs by type, plus supplier bills linked to the job.
 *  - Profit and margin: contract value − recorded costs. "Estimated" while the
 *    job is open, "actual" once it's completed. Not shown when no costs are
 *    recorded (a 100% margin would be misleading).
 *
 * Internal only: never used for anything a customer sees.
 */
import type { Bill, Expense, Job, Payment, Variation } from "@/lib/types";
import { round2 } from "@/lib/derive";

export interface JobFinancials {
  price: number;
  approvedVariations: number;
  contractValue: number;
  received: number;
  outstanding: number;
  paidPercent: number;
  costs: { labour: number; materials: number; subcontractors: number; other: number; bills: number; total: number };
  /** Which cost types have nothing recorded (shown so gaps are obvious). */
  missing: ("labour" | "materials" | "subcontractors")[];
  profit: number | null;
  margin: number | null;
  basis: "estimated" | "actual" | "none";
}

export function jobFinancials(job: Pick<Job, "id" | "quotedValue" | "status">, data: { variations: Variation[]; payments: Payment[]; expenses: Expense[]; bills: Bill[] }): JobFinancials {
  const approvedVariations = round2(data.variations.filter((v) => v.jobId === job.id && v.status === "approved").reduce((s, v) => s + v.amount, 0));
  const contractValue = round2(job.quotedValue + approvedVariations);
  const received = round2(data.payments.filter((p) => p.jobId === job.id).reduce((s, p) => s + p.amount, 0));
  const exp = data.expenses.filter((e) => e.jobId === job.id);
  const sum = (f: (e: Expense) => boolean) => round2(exp.filter(f).reduce((s, e) => s + e.amount, 0));
  const labour = sum((e) => e.category === "labour");
  const materials = sum((e) => e.category === "materials");
  const subcontractors = sum((e) => e.category === "subcontractor");
  const other = sum((e) => !["labour", "materials", "subcontractor"].includes(e.category));
  const bills = round2(data.bills.filter((b) => b.jobId === job.id).reduce((s, b) => s + b.amount, 0));
  const total = round2(labour + materials + subcontractors + other + bills);
  const missing = ([["labour", labour], ["materials", materials + bills], ["subcontractors", subcontractors]] as const).filter(([, v]) => v === 0).map(([k]) => k);
  const hasCosts = total > 0;
  const profit = hasCosts ? round2(contractValue - total) : null;
  return {
    price: round2(job.quotedValue),
    approvedVariations,
    contractValue,
    received,
    outstanding: Math.max(0, round2(contractValue - received)),
    paidPercent: contractValue > 0 ? Math.min(100, Math.round((received / contractValue) * 100)) : 0,
    costs: { labour, materials, subcontractors, other, bills, total },
    missing: [...missing],
    profit,
    margin: profit !== null && contractValue > 0 ? Math.round((profit / contractValue) * 1000) / 10 : null,
    basis: !hasCosts ? "none" : job.status === "completed" ? "actual" : "estimated",
  };
}
