import "server-only";
import { z } from "zod";
import type { OrgConfig, Enquiry } from "@/lib/types";
import type { Ctx, Result } from "@/server/context";
import { getDb } from "@/server/db";
import { createEnquiry } from "@/server/services/records";
import { detectInjection } from "@/server/integrations/safety";
import { parseWorkTitle } from "@/server/bob/nlu";

/**
 * The public website enquiry form. Anyone can submit it, so:
 *  - nothing is returned about the business beyond its public name and logo,
 *  - a hidden "website" field catches simple bots (honeypot),
 *  - submissions are rate-limited per sender and per business,
 *  - the message is screened for text aimed at an assistant and treated as
 *    plain text (never as instructions to Bob).
 */

export interface PublicFormInfo {
  orgId: string;
  name: string;
  shortName: string;
  logoUrl?: string;
  trade?: string;
  services: string[];
}

/** Find a workspace by its public slug (e.g. "ninety3") or id. */
function loadOrg(key: string): { id: string; org: OrgConfig } | null {
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(key)) return null;
  const rows = getDb().prepare("SELECT id, config FROM orgs").all() as { id: string; config: string }[];
  for (const r of rows) {
    const org = JSON.parse(r.config) as OrgConfig;
    if (r.id === key || org.slug === key) return { id: r.id, org };
  }
  return null;
}

export function publicFormInfo(key: string): PublicFormInfo | null {
  const found = loadOrg(key);
  if (!found) return null;
  const { id: orgId, org } = found;
  return { orgId, name: org.name, shortName: org.shortName, logoUrl: org.logoUrl, trade: org.tradeType, services: org.services ?? [] };
}

const optional = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || undefined);
export const websiteEnquirySchema = z
  .object({
    name: z.string().trim().min(2, "Please tell us your name").max(120),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")).transform((v) => v || undefined),
    phone: optional(30),
    job: optional(80),
    town: z.string().trim().min(2, "Where's the job?").max(80),
    message: z.string().trim().min(10, "Tell us a bit about the job").max(2000),
    website: optional(200), // honeypot — real people never fill this in
  })
  .refine((v) => v.email || v.phone, { message: "Leave an email or phone number so they can get back to you", path: ["email"] });

const WINDOW_MS = 10 * 60 * 1000;
const perSender = new Map<string, number[]>();
const perOrg = new Map<string, number[]>();
function overLimit(map: Map<string, number[]>, key: string, max: number) {
  const now = Date.now();
  const recent = (map.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    map.set(key, recent);
    return true;
  }
  recent.push(now);
  map.set(key, recent);
  return false;
}

export type WebsiteSubmitResult = Result<{ id: string } | { ignored: true }>;

export function submitWebsiteEnquiry(key: string, input: unknown, sender: string): WebsiteSubmitResult {
  const found = loadOrg(key);
  if (!found) return { ok: false, code: "not_found", error: "This form isn't available." };
  const { id: orgId, org } = found;
  const parsed = websiteEnquirySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "_")] ??= i.message;
    return { ok: false, code: "invalid", error: "Please check the form.", fieldErrors };
  }
  const v = parsed.data;
  // Bots fill in every field. Pretend it worked, store nothing.
  if (v.website) return { ok: true, value: { ignored: true } };
  if (overLimit(perSender, `${orgId}|${sender}`, 5) || overLimit(perOrg, orgId, 60))
    return { ok: false, code: "unavailable", error: "Too many messages just now — please try again in a few minutes." };

  const ctx: Ctx = { orgId, userId: "website_form", userName: "Website form", role: "office", org, via: "integration" };
  const injection = detectInjection(`${v.job ?? ""}\n${v.message}`);
  const title = v.job || parseWorkTitle(v.message) || "Website enquiry";
  const extra: Partial<Enquiry> = injection.suspicious
    ? {
        notes: [
          {
            id: `note_${Date.now().toString(36)}`,
            text: `⚠ Bob flagged this message: it contains text aimed at an assistant (${injection.reasons.join("; ")}). It was treated as plain text and ignored.`,
            createdAt: new Date().toISOString(),
            author: "Bob",
          },
        ],
      }
    : {};
  const created = createEnquiry(
    ctx,
    { customerName: v.name, email: v.email, phone: v.phone, source: "website", title: title.slice(0, 80), description: v.message, location: v.town, priority: "medium" },
    extra,
  );
  if (!created.ok) return created;
  return { ok: true, value: { id: created.value.id } };
}
