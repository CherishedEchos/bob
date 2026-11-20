import "server-only";
/** Job variations (changes to the agreed work and price). Owners/admins; customer-facing amounts only. */
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
});

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
    return fail("invalid", "Check the variation.", fe);
  }
  const v = p.data;
  const db = scoped(ctx);
  const job = db.get<Job>("jobs", v.jobId);
  if (!job) return fail("not_found", "Job not found");
  if (v.invoiceId && db.get<Invoice>("invoices", v.invoiceId)?.jobId !== job.id) return fail("invalid", "That invoice isn't on this job.", { invoiceId: "Choose an invoice for this job" });
  const existing = v.id ? db.get<Variation>("variations", v.id) : undefined;
  if (v.id && !existing) return fail("not_found", "Variation not found");
  const row: Variation = {
    id: existing?.id ?? uid("var"),
    jobId: job.id,
    description: v.description,
    amount: v.amount,
    amountsAre: v.amountsAre,
    status: v.status,
    invoiceId: v.invoiceId,
    approvedAt: v.status === "approved" ? (existing?.approvedAt ?? new Date().toISOString()) : undefined,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    createdBy: existing?.createdBy ?? ctx.userName,
  };
  tx(() => {
    if (existing) db.update<Variation>("variations", row.id, { ...row, invoiceId: row.invoiceId ?? (null as unknown as undefined), approvedAt: row.approvedAt ?? (null as unknown as undefined) });
    else db.insert("variations", row);
    audit(ctx, existing ? "variation.updated" : "variation.added", `Variation ${row.status} on ${job.title}: ${row.description} (${gbp(row.amount)})`, "job", job.id);
  });
  return ok(row);
}

export function deleteVariation(ctx: Ctx, id: string): Result<true> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  const v = scoped(ctx).get<Variation>("variations", id);
  if (!v) return fail("not_found", "Variation not found");
  tx(() => {
    scoped(ctx).remove("variations", id);
    audit(ctx, "variation.removed", `Variation removed: ${v.description}`, "job", v.jobId);
  });
  return ok(true);
}
