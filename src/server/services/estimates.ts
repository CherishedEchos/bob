import "server-only";
/**
 * Rough estimates (pilot feature, off unless switched on for a workspace) and
 * the workspace price list they use.
 *
 *  - Saved on the pricing record; never shown to subcontractors (enquiries
 *    aren't) and never copied onto the job.
 *  - The arithmetic is deterministic (src/lib/estimate.ts). No AI is involved
 *    in the figures, so no AI usage is recorded here.
 *  - Turning one into a quote makes a DRAFT quote. Sending it is a separate,
 *    deliberate step (and only when every line is priced).
 */
import { z } from "zod";
import type { Enquiry, OrgConfig, Quote, RateCard, RoughEstimate } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { estimateTotals, savedEstimate } from "@/lib/estimate";
import { gbp, uid } from "@/lib/utils";
import { getDb, scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { audit, getEnquiry } from "./records";
import { preparePricingQuote } from "./pricing";

const now = () => new Date().toISOString();
const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) => {
  const fe: Record<string, string> = {};
  for (const i of issues) fe[i.path.map(String).join(".")] ??= i.message;
  return fe;
};

export const estimatesEnabled = (org: OrgConfig) => !!org.features?.roughEstimates;

const lineSchema = z.object({
  id: z.string().max(80).optional(),
  label: z.string().trim().min(1, "Name the line").max(120),
  qty: z.coerce.number().min(0, "Quantity can't be negative").max(100000),
  unit: z.string().trim().max(20).default("each"),
  // null first: a cleared price must stay "no price", never become £0.
  rate: z.union([z.null(), z.coerce.number().min(0).max(1_000_000)]),
  source: z.enum(["rate_card", "entered", "allowance", "missing"]),
  rateItemId: z.string().max(80).optional(),
  note: z.string().trim().max(300).optional(),
});
const estimateSchema = z.object({
  description: z.string().trim().max(2000).default(""),
  lines: z.array(lineSchema).max(60),
  rangePercent: z.union([z.null(), z.coerce.number().min(0).max(50)]).optional(),
  questions: z.array(z.string().trim().max(200)).max(20).optional(),
  inputs: z.record(z.string().max(40), z.union([z.number().min(0).max(1_000_000), z.string().max(80)])).optional(),
});

/** Save (replace) the rough estimate on a pricing record. A rate typed by hand is marked "entered"; a cleared rate is "missing". */
export function saveEstimate(ctx: Ctx, enquiryId: string, raw: unknown): Result<Enquiry> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  if (!estimatesEnabled(ctx.org)) return fail("forbidden", "Rough estimates aren't switched on for this business.");
  const e = getEnquiry(ctx, enquiryId);
  if (!e) return fail("not_found", "Pricing record not found");
  const p = estimateSchema.safeParse(raw);
  if (!p.success) return fail("invalid", "Check the estimate.", fieldErrors(p.error.issues));
  const est: RoughEstimate = {
    kind: "fitted_furniture",
    description: p.data.description,
    lines: p.data.lines.map((l) => ({
      ...l,
      id: l.id ?? uid("est"),
      source: l.rate === null ? "missing" : l.source === "missing" ? "entered" : l.source,
    })),
    rangePercent: p.data.rangePercent ?? null,
    questions: p.data.questions,
    inputs: p.data.inputs,
    quoteId: savedEstimate(e)?.quoteId,
    updatedAt: now(),
    updatedBy: ctx.userName,
  };
  const t = estimateTotals(est, ctx.org.finance);
  const u = tx(() => {
    const row = scoped(ctx).update<Enquiry>("enquiries", e.id, { estimate: est })!;
    audit(ctx, "estimate.saved", `Rough estimate saved for ${e.customerName}'s ${e.title.toLowerCase()}: ${gbp(t.gross)}${t.missing.length ? ` (${t.missing.length} line${t.missing.length === 1 ? "" : "s"} without a price)` : ""}`, "enquiry", e.id);
    return row;
  });
  return ok(u);
}

/**
 * Luke chooses to turn a complete estimate into a quote DRAFT (amount as the
 * business prices — before VAT when prices are exclusive). Nothing is sent.
 */
export function estimateToQuote(ctx: Ctx, enquiryId: string): Result<Quote> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  if (!estimatesEnabled(ctx.org)) return fail("forbidden", "Rough estimates aren't switched on for this business.");
  const e = getEnquiry(ctx, enquiryId);
  const est = e ? savedEstimate(e) : undefined;
  if (!e || !est) return fail("not_found", "Save an estimate first.");
  const t = estimateTotals(est, ctx.org.finance);
  if (!t.complete) return fail("invalid", `Price every line first — ${t.missing.length} still ${t.missing.length === 1 ? "has" : "have"} no price.`);
  if (t.pricedSubtotal <= 0) return fail("invalid", "The estimate comes to nothing yet.");
  const q = preparePricingQuote(ctx, e.id, { description: e.title, amount: t.pricedSubtotal });
  if (!q.ok) return q;
  scoped(ctx).update<Enquiry>("enquiries", e.id, { estimate: { ...est, quoteId: q.value.id } });
  audit(ctx, "estimate.to_quote", `Quote draft made from the rough estimate (${gbp(t.pricedSubtotal)}) — not sent`, "quote", q.value.id);
  return ok(q.value);
}

/* ------------------------------ Price list (Settings) ------------------------------ */

const cardSchema = z.object({
  labourDayRate: z.union([z.null(), z.coerce.number().min(0).max(100000)]).optional(),
  items: z
    .array(z.object({ id: z.string().max(80).optional(), name: z.string().trim().min(1, "Name the item").max(80), unit: z.string().trim().min(1).max(20), price: z.coerce.number().min(0).max(1_000_000) }))
    .max(100),
});

function writeConfig(ctx: Ctx, next: OrgConfig) {
  getDb().prepare("UPDATE orgs SET config = ? WHERE id = ?").run(JSON.stringify(next), ctx.orgId);
  ctx.org = next;
}

function currentConfig(ctx: Ctx): OrgConfig {
  return JSON.parse((getDb().prepare("SELECT config FROM orgs WHERE id = ?").get(ctx.orgId) as { config: string }).config) as OrgConfig;
}

/** Owners and admins keep the prices Bob may use. Every figure is theirs; Bob never adds one. */
export function saveRateCard(ctx: Ctx, raw: unknown): Result<RateCard> {
  if (!can(ctx.role, "quotes.write") || !can(ctx.role, "team.manage")) return fail("forbidden", "Only the owner or an admin can change prices.");
  const p = cardSchema.safeParse(raw);
  if (!p.success) return fail("invalid", "Check the prices.", fieldErrors(p.error.issues));
  const card: RateCard = { labourDayRate: p.data.labourDayRate ?? null, items: p.data.items.map((i) => ({ ...i, id: i.id ?? uid("rate") })), updatedAt: now(), updatedBy: ctx.userName };
  return tx(() => {
    writeConfig(ctx, { ...currentConfig(ctx), pricing: card });
    audit(ctx, "settings.prices", `Prices for estimates updated (${card.items.length} item${card.items.length === 1 ? "" : "s"}${card.labourDayRate ? `, labour ${gbp(card.labourDayRate)}/day` : ""})`);
    return ok(card);
  });
}

/** Owner only: switch a pilot feature on or off for this workspace. */
export function setPilotFeature(ctx: Ctx, feature: unknown, on: unknown): Result<OrgConfig["features"]> {
  if (!can(ctx.role, "settings.manage")) return fail("forbidden", "Only the owner can switch pilot features on or off.");
  if (feature !== "roughEstimates" && feature !== "conceptDesigns") return fail("invalid", "Unknown feature");
  const cfg = currentConfig(ctx);
  const features = { ...cfg.features, [feature]: on === true };
  return tx(() => {
    writeConfig(ctx, { ...cfg, features });
    audit(ctx, "settings.pilot_feature", `${feature === "roughEstimates" ? "Rough estimates" : "Concept designs"} switched ${on === true ? "on" : "off"}`);
    return ok(features);
  });
}
