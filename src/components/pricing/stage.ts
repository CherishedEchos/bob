/** Jobs to price stages, shared by the list and detail screens (mirrors src/server/services/pricing.ts). */
import type { Enquiry, Quote } from "@/lib/types";

export type Stage = "to_visit" | "to_price" | "quote_sent";
export const STAGE_LABEL: Record<Stage, string> = { to_visit: "To visit", to_price: "To price", quote_sent: "Quote sent" };
export const STAGE_TONE: Record<Stage, string> = { to_visit: "bg-sky-50 text-sky-800", to_price: "bg-amber-50 text-amber-800", quote_sent: "bg-emerald-50 text-emerald-800" };

export function pricingStageOf(e: Pick<Enquiry, "id" | "status">, quotes: Pick<Quote, "enquiryId" | "status">[]): Stage {
  if (e.status === "quoted" || quotes.some((q) => q.enquiryId === e.id && (q.status === "sent" || q.status === "accepted"))) return "quote_sent";
  if (e.status === "quote_required") return "to_price";
  return "to_visit";
}

export const onPricingStage = (e: Pick<Enquiry, "status" | "pricingAt" | "jobId">) =>
  !e.jobId && e.status !== "won" && e.status !== "lost" && (!!e.pricingAt || ["site_visit", "quote_required", "quoted"].includes(e.status));
