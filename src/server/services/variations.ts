import "server-only";
/**
 * Extras on a job (stored as "variations": changes to the agreed work and price).
 * Owners/admins only — never visible to subcontractors or the site team.
 *
 *  - proposed: logged, not agreed. Never counted in the agreed total.
 *  - approved / declined: someone in the business RECORDED the customer's answer
 *    (by phone, email, text, in person or in writing). Bob stores who recorded
 *    it, when, how the customer said so and any note. It never claims the
 *    customer approved anything in Bob.
 *  - An approved extra counts exactly once: agreed price + approved extras =
 *    revised agreed total (job financials, billing and the handover report all
 *    use that). Adding or approving an extra never creates an invoice or email.
 */
import { z } from "zod";
import type { Invoice, Job, Variation } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { gbp, uid } from "@/lib/utils";
import { scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { audit } from "./records";

const input = z.object({
  id: z.string().max(80).optional(),
  jobId: z.string().min(3).max(80),
  description: z.string().trim().min(3, "Say what changed").max(200),
  amount: z.coerce.number().positive("Enter the amount").max(1_000_000),
  amountsAre: z.enum(["inclusive", "exclusive", "no_vat"]),
  status: z.enum(["proposed", "approved", "declined"]).default("approved"),
  invoiceId: z.string().max(80).optional().or(z.literal("")).transform((v) => v || undefined),
  note: z.string().trim().max(1000).optional().or(z.literal("")).transform((v) => v || undefined),
  fileId: z.string().max(80).optional().or(z.literal("")).transform((v) => v || undefined),
  approvalVia: z.enum(["phone", "email", "text", "in_person", "written", "other"]).optional(),
  decisionNote: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => v || undefined),
});

export const APPROVAL_VIA_LABEL: Record<NonNullable<Variation["approvalVia"]>, string> = { phone: "by phone", email: "by email", text: "by text", in_person: "in person", written: "in writing", other: "" };

export function listVariations(ctx: Ctx): Variation[] {
  if (!can(ctx.role, "finance.read")) return [];
  return scoped(ctx).list<Variation>("variations", { order: "created_at" });
}

export function saveVariation(ctx: Ctx, raw: unknown): Result<Variation> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  const p = input.safeParse(raw);
  if (!p.success) {
    const fe: Record<string, string> = {};
    for (const i of p.error.issues) fe[String(i.path[0])] ??= i.message;
    return fail("invalid", "Check the extra.", fe);
  }
  const v = p.data;
  const db = scoped(ctx);
  const job = db.get<Job>("jobs", v.jobId);
  if (!job) return fail("not_found", "Job not found");
  if (v.invoiceId && db.get<Invoice>("invoices", v.invoiceId)?.jobId !== job.id) return fail("invalid", "That invoice isn't on this job.", { invoiceId: "Choose an invoice for this job" });
  const existing = v.id ? db.get<Variation>("variations", v.id) : undefined;
  if (v.id && !existing) return fail("not_found", "Extra not found");
  if (v.fileId && db.get<{ jobId?: string }>("job_files", v.fileId)?.jobId !== job.id) return fail("invalid", "That photo isn't on this job.");
  const at = new Date().toISOString();
  // A decision (approved/declined) records who logged it and when; changing the decision re-records it.
  const decided = v.status !== "proposed";
  const sameDecision = existing && existing.status === v.status;
  const row: Variation = {
    id: existing?.id ?? uid("var"),
    jobId: job.id,
    description: v.description,
    amount: v.amount,
    amountsAre: v.amountsAre,
    status: v.status,
    invoiceId: v.invoiceId,
    approvedAt: v.status === "approved" ? (sameDecision ? existing!.approvedAt ?? at : at) : undefined,
    createdAt: existing?.createdAt ?? at,
    createdBy: existing?.createdBy ?? ctx.userName,
    note: v.note,
    fileId: v.fileId,
    decidedBy: decided ? (sameDecision ? existing!.decidedBy ?? ctx.userName : ctx.userName) : undefined,
    decidedAt: decided ? (sameDecision ? existing!.decidedAt ?? at : at) : undefined,
    approvalVia: decided ? v.approvalVia ?? (sameDecision ? existing!.approvalVia : undefined) : undefined,
    decisionNote: decided ? v.decisionNote ?? (sameDecision ? existing!.decisionNote : undefined) : undefined,
  };
  tx(() => {
    const nul = null as unknown as undefined;
    if (existing)
      db.update<Variation>("variations", row.id, {
        ...row,
        invoiceId: row.invoiceId ?? nul, approvedAt: row.approvedAt ?? nul, note: row.note ?? nul, fileId: row.fileId ?? nul,
        decidedBy: row.decidedBy ?? nul, decidedAt: row.decidedAt ?? nul, approvalVia: row.approvalVia ?? nul, decisionNote: row.decisionNote ?? nul,
      });
    else db.insert("variations", row);
    const how = row.approvalVia ? ` ${APPROVAL_VIA_LABEL[row.approvalVia]}`.trimEnd() : "";
    const what = row.status === "proposed" ? "proposed" : `${row.status === "approved" ? "approval" : "decline"} recorded by ${ctx.userName}${how ? ` (customer said so${how})` : ""}`;
    audit(ctx, existing ? "variation.updated" : "variation.added", `Extra on ${job.title}: ${row.description} (${gbp(row.amount)}) — ${what}`, "job", job.id);
  });
  return ok(row);
}

export function deleteVariation(ctx: Ctx, id: string): Result<true> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  const v = scoped(ctx).get<Variation>("variations", id);
  if (!v) return fail("not_found", "Extra not found");
  tx(() => {
    scoped(ctx).remove("variations", id);
    audit(ctx, "variation.removed", `Extra removed: ${v.description}`, "job", v.jobId);
  });
  return ok(true);
}

/** Record the customer's answer on an extra (approved or declined), how it reached you, and a note. */
export function decideVariation(ctx: Ctx, id: string, raw: { status?: unknown; approvalVia?: unknown; decisionNote?: unknown }): Result<Variation> {
  const v = scoped(ctx).get<Variation>("variations", id);
  if (!v) return fail("not_found", "Extra not found");
  if (raw.status !== "approved" && raw.status !== "declined" && raw.status !== "proposed") return fail("invalid", "Choose approved or declined.");
  return saveVariation(ctx, { id: v.id, jobId: v.jobId, description: v.description, amount: v.amount, amountsAre: v.amountsAre, status: raw.status, invoiceId: v.invoiceId, note: v.note, fileId: v.fileId, approvalVia: raw.approvalVia, decisionNote: raw.decisionNote });
}
