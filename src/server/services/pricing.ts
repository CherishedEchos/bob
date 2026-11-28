import "server-only";
/**
 * Jobs to price — the notes Luke gets down before driving away from a site
 * visit. A pricing record IS the enquiry (same customer, same files, same
 * quote), so nobody types the address twice and no second customer appears:
 *
 *   enquiry ──"Add to jobs to price"──▶ To visit ──▶ To price ──▶ Quote sent ──"Accepted"──▶ job
 *
 * Stages map onto the existing enquiry workflow:
 *   To visit = site_visit · To price = quote_required · Quote sent = quoted
 * "Quote sent" only happens when a quote is actually sent (or the user records
 * that they sent it elsewhere) — never by preparing a draft.
 *
 * Private by default: measurements, notes, photos and videos stay with the
 * office (enquiries are never visible to subcontractors), and when the job is
 * created the files come across marked office-only. The rough estimate never
 * leaves the pricing record.
 */
import { z } from "zod";
import type { Enquiry, Job, Measurement, Quote } from "@/lib/types";
import { uid } from "@/lib/utils";
import { scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { addJobNote, audit, convertToJob, createEnquiry, createQuote, ensureCustomerForEnquiry, getCustomer, getEnquiry, listQuotes, setQuoteStatus, updateCustomer } from "./records";

export type PricingStage = "to_visit" | "to_price" | "quote_sent";
export const PRICING_STAGE_LABEL: Record<PricingStage, string> = { to_visit: "To visit", to_price: "To price", quote_sent: "Quote sent" };

const now = () => new Date().toISOString();
const STAGE_STATUS: Record<Exclude<PricingStage, "quote_sent">, Enquiry["status"]> = { to_visit: "site_visit", to_price: "quote_required" };

/** Where a pricing record is. A sent quote (not declined) means "Quote sent". */
export function pricingStage(e: Pick<Enquiry, "id" | "status">, quotes: Pick<Quote, "enquiryId" | "status">[]): PricingStage {
  if (e.status === "quoted" || quotes.some((q) => q.enquiryId === e.id && (q.status === "sent" || q.status === "accepted"))) return "quote_sent";
  if (e.status === "quote_required") return "to_price";
  return "to_visit";
}

/** On the Jobs to price list: added to it (or already in a pricing stage), and not yet won or lost. */
export const onPricingList = (e: Pick<Enquiry, "status" | "pricingAt" | "jobId">) =>
  !e.jobId && e.status !== "won" && e.status !== "lost" && (!!e.pricingAt || ["site_visit", "quote_required", "quoted"].includes(e.status));

/** From an enquiry: "Add to jobs to price". Safe to tap twice. */
export function addToPricing(ctx: Ctx, enquiryId: string): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const e = getEnquiry(ctx, enquiryId);
  if (!e) return fail("not_found", "Enquiry not found");
  if (e.status === "won" || e.jobId) return fail("conflict", "This enquiry is already a job.");
  if (e.pricingAt) return ok(e);
  const status = ["site_visit", "quote_required", "quoted"].includes(e.status) ? e.status : "site_visit";
  const u = tx(() => {
    const row = scoped(ctx).update<Enquiry>("enquiries", e.id, { pricingAt: now(), status, siteAddress: e.siteAddress ?? (e.location || undefined) })!;
    audit(ctx, "pricing.added", `${e.customerName}'s ${e.title.toLowerCase()} added to Jobs to price`, "enquiry", e.id);
    return row;
  });
  return ok(u);
}

const directSchema = z.object({
  customerId: z.string().max(80).optional(),
  customerName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(160).optional(),
  title: z.string().trim().min(2, "Give it a short name, e.g. Alcove units").max(120),
  siteAddress: z.string().trim().max(240).optional(),
  how: z.enum(["phone", "referral", "site", "other"]).default("phone"),
  note: z.string().trim().max(4000).optional(),
});

/** A phone call or referral straight into Jobs to price (an enquiry underneath, so it flows the same way). */
export function createPricing(ctx: Ctx, raw: unknown): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const p = directSchema.safeParse(raw);
  if (!p.success) {
    const fe: Record<string, string> = {};
    for (const i of p.error.issues) fe[String(i.path[0])] ??= i.message;
    return fail("invalid", "Check the details.", fe);
  }
  const v = p.data;
  const customer = v.customerId ? getCustomer(ctx, v.customerId) : undefined;
  if (v.customerId && !customer) return fail("not_found", "Customer not found");
  const customerName = customer?.name ?? v.customerName ?? "";
  if (customerName.trim().length < 2) return fail("invalid", "Who's it for?", { customerName: "Enter the customer's name" });
  // The town for lists: the part of the address before the postcode, else the customer's town.
  const parts = (v.siteAddress ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const town = (parts.length > 1 ? parts.filter((x) => !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(x)).at(-1) : parts[0]) ?? customer?.town ?? "Not set";
  const how = { phone: "Phone call", referral: "Referral", site: "Seen on site", other: "Other" }[v.how];
  const r = createEnquiry(
    ctx,
    {
      customerName,
      customerId: customer?.id,
      phone: v.phone || customer?.phone || undefined,
      email: v.email || customer?.email || undefined,
      source: v.how === "phone" ? "phone" : "manual",
      title: v.title,
      description: v.note ?? "",
      location: town.length >= 2 ? town : "Not set",
      priority: "medium",
    },
    { pricingAt: now(), status: "site_visit", siteAddress: v.siteAddress || customer?.address || undefined },
  );
  if (!r.ok) {
    // No contact details: the same message the enquiry form uses, on the phone field.
    if (r.code === "invalid" && !v.phone && !v.email && !customer) return fail("invalid", "Add a phone number or email (or pick an existing customer).", { phone: "Add a way to contact them" });
    return r;
  }
  audit(ctx, "pricing.added", `${how}: ${customerName} — ${v.title} added to Jobs to price`, "enquiry", r.value.id);
  return ok(r.value);
}

const measurementSchema = z.object({ id: z.string().max(80).optional(), label: z.string().trim().min(1, "What's measured?").max(80), value: z.string().trim().min(1, "Enter the measurement").max(80) });
const patchSchema = z.object({
  stage: z.enum(["to_visit", "to_price"]).optional(),
  title: z.string().trim().min(2).max(120).optional(),
  siteAddress: z.string().trim().max(240).optional(),
  measurements: z.array(measurementSchema).max(60).optional(),
});

/** Save part of a pricing record (each field saves on its own, so leaving halfway loses nothing). */
export function updatePricing(ctx: Ctx, id: string, raw: unknown): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Pricing record not found");
  if (e.jobId) return fail("conflict", "This has already become a job.");
  const p = patchSchema.safeParse(raw);
  if (!p.success) {
    const fe: Record<string, string> = {};
    for (const i of p.error.issues) fe[i.path.join(".")] ??= i.message;
    return fail("invalid", "Check the details.", fe);
  }
  const v = p.data;
  const patch: Partial<Enquiry> = { pricingAt: e.pricingAt ?? now() };
  if (v.title) patch.title = v.title;
  if (v.siteAddress !== undefined) patch.siteAddress = v.siteAddress || (null as unknown as undefined);
  if (v.measurements) patch.measurements = v.measurements.map((m): Measurement => ({ id: m.id ?? uid("mea"), label: m.label, value: m.value }));
  if (v.stage) {
    if (pricingStage(e, listQuotes(ctx)) === "quote_sent") return fail("conflict", "A quote has been sent. Record the customer's answer instead.");
    patch.status = STAGE_STATUS[v.stage];
  }
  const u = tx(() => {
    const row = scoped(ctx).update<Enquiry>("enquiries", id, patch)!;
    const what = [v.stage && `moved to ${PRICING_STAGE_LABEL[v.stage]}`, v.measurements && "measurements saved", v.siteAddress !== undefined && "site address saved", v.title && "renamed"].filter(Boolean).join(", ");
    audit(ctx, "pricing.updated", `${e.customerName}'s ${e.title.toLowerCase()}: ${what || "updated"}`, "enquiry", id);
    return row;
  });
  return ok(u);
}

/**
 * The customer said yes: turn the pricing record into ONE live job. Carries the
 * customer, site address, measurements and site-visit notes (as private job
 * notes) and the photos/videos (office-only). The rough estimate stays on the
 * pricing record. Retrying returns the same job.
 */
export function acceptPricing(ctx: Ctx, id: string, args: { quoteId?: string; startDate?: string } = {}): Result<Job & { existed: boolean }> {
  const no = denied(ctx, "jobs.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Pricing record not found");
  if (e.jobId) {
    const r = convertToJob(ctx, { enquiryId: e.id });
    return r;
  }
  const quotes = listQuotes(ctx).filter((q) => q.enquiryId === e.id);
  const quote = args.quoteId ? quotes.find((q) => q.id === args.quoteId) : quotes.find((q) => q.status === "sent") ?? quotes.find((q) => q.status !== "declined");
  if (args.quoteId && !quote) return fail("not_found", "Quote not found");
  // All or nothing: any failure part-way rolls the whole acceptance back.
  class Abort extends Error {
    constructor(public result: Result<never>) {
      super("abort");
    }
  }
  try {
    return tx(() => accept());
  } catch (err) {
    if (err instanceof Abort) return err.result;
    throw err;
  }
  function accept(): Result<Job & { existed: boolean }> {
    if (quote && quote.status !== "accepted") {
      const s = setQuoteStatus(ctx, quote.id, "accepted");
      if (!s.ok) throw new Abort(s);
    }
    const r = convertToJob(ctx, { enquiryId: e!.id, quoteId: quote?.id, siteAddress: e!.siteAddress, startDate: args.startDate });
    if (!r.ok) throw new Abort(r);
    if (r.value.existed) return r;
    const job = r.value;
    const en = e!;
    scoped(ctx).update<Enquiry>("enquiries", en.id, { jobId: job.id, status: "won" });
    // The address typed at the visit becomes the customer's address if they didn't have one.
    const c = job.customerId ? getCustomer(ctx, job.customerId) : undefined;
    if (c && !c.address && en.siteAddress) updateCustomer(ctx, c.id, { ...c, address: en.siteAddress });
    if (en.measurements?.length) addJobNote(ctx, job.id, `Measurements from the site visit:\n${en.measurements.map((m) => `• ${m.label}: ${m.value}`).join("\n")}`);
    for (const n of en.notes ?? []) addJobNote(ctx, job.id, `From pricing (${n.author}): ${n.text}`);
    audit(ctx, "pricing.accepted", `${e!.customerName} accepted — ${e!.title} is now a job`, "job", job.id);
    return ok({ ...(scoped(ctx).get<Job>("jobs", job.id) ?? job), existed: false });
  }
}

/**
 * Prepare a quote from a pricing record: a DRAFT only. Nothing goes to the
 * customer and the stage doesn't change. (Makes sure the customer record
 * exists — reusing a match — so the quote and later the job share it.)
 */
export function preparePricingQuote(ctx: Ctx, id: string, raw: { description?: unknown; amount?: unknown }): Result<Quote> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Pricing record not found");
  const c = ensureCustomerForEnquiry(ctx, e.id);
  if (!c.ok) return c;
  return createQuote(ctx, { customerId: c.value.customerId, enquiryId: e.id, description: typeof raw.description === "string" && raw.description.trim() ? raw.description : e.title, amount: raw.amount, status: "draft" });
}

/**
 * "Quote sent" only when it really was: the user confirms they sent it
 * (by email, text, post or by hand). Bob doesn't send it from here.
 */
export function markPricingQuoteSent(ctx: Ctx, id: string, quoteId: string, confirmed: unknown): Result<Quote> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  if (confirmed !== true) return fail("invalid", "Tick to confirm you've sent the quote to the customer.", { confirmed: "Confirm you've sent it" });
  const q = listQuotes(ctx).find((x) => x.id === quoteId && x.enquiryId === id);
  if (!q) return fail("not_found", "Quote not found");
  if (q.status !== "draft") return ok(q);
  const r = setQuoteStatus(ctx, q.id, "sent");
  if (r.ok) audit(ctx, "quote.recorded_sent", `Quote recorded as sent outside Bob (${q.description})`, "quote", q.id);
  return r;
}

/** The customer said no (or went quiet for good): off the list, nothing deleted. */
export function declinePricing(ctx: Ctx, id: string): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Pricing record not found");
  if (e.jobId) return fail("conflict", "This has already become a job.");
  return tx(() => {
    for (const q of listQuotes(ctx).filter((x) => x.enquiryId === e.id && (x.status === "sent" || x.status === "draft"))) setQuoteStatus(ctx, q.id, "declined");
    const row = scoped(ctx).update<Enquiry>("enquiries", e.id, { status: "lost" })!;
    audit(ctx, "pricing.declined", `${e.customerName}'s ${e.title.toLowerCase()} marked as not going ahead`, "enquiry", e.id);
    return ok(row);
  });
}
