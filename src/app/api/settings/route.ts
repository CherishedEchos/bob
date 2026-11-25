import { NextResponse } from "next/server";
import { followUpSettings, isGoogleReviewUrl } from "@/lib/followups";
import { z } from "zod";
import { authed, readJson } from "@/server/http";
import { HttpError } from "@/server/context";
import { can } from "@/lib/auth/permissions";
import { getDb } from "@/server/db";
import { audit } from "@/server/services/records";
import { buildSnapshot } from "@/server/services/snapshot";
import type { OrgConfig } from "@/lib/types";

export const runtime = "nodejs";

const time = z.string().regex(/^\d{2}:\d{2}$/);
const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  shortName: z.string().trim().min(1).max(40).optional(),
  logoUrl: z.string().trim().max(500).refine((v) => v === "" || v.startsWith("/") || /^https:\/\//.test(v), "Logo must be an https:// link or a /brand/ path").optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Accent must be a colour like #E4752F").optional(),
  timeZone: z.string().max(60).refine((tz) => { try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone").optional(),
  quickbooksUrl: z.string().trim().max(300).refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "Use a full https:// link").optional(),
  tradeType: z.string().trim().min(2).max(80).optional(),
  services: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  serviceArea: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  workingHours: z.object({ days: z.string().max(40), start: time, end: time }).optional(),
  contact: z.object({ phone: z.string().max(40).optional(), email: z.string().email().or(z.literal("")).optional(), website: z.string().max(120).optional(), address: z.string().max(240).optional() }).optional(),
  assistant: z.object({ signOff: z.string().max(200), tone: z.enum(["friendly", "brief"]), readAloudDefault: z.boolean() }).partial().optional(),
  finance: z
    .object({
      vatRegistered: z.boolean().nullable(),
      vatRate: z.number().min(0).max(30).nullable(),
      defaultPaymentTermsDays: z.number().int().min(0).max(120).nullable(),
      pricesAre: z.enum(["exclusive", "inclusive"]).nullable(),
    })
    .partial()
    .optional(),
  leavePolicy: z.object({ managersSelfApprove: z.boolean() }).optional(),
  followUps: z
    .object({
      reviewUrl: z.union([z.literal(""), z.string().trim().max(500).refine(isGoogleReviewUrl, "That doesn't look like a Google review link. It should start https:// and be on g.page or google.com (copy it from your Google Business Profile → Ask for reviews).")]).optional(),
      reviewsEnabled: z.boolean().optional(),
      mode: z.enum(["manual", "auto"]).optional(),
      reminder: z.boolean().optional(),
      template: z.object({ subject: z.string().trim().min(2).max(200), body: z.string().trim().min(10).max(4000) }).optional(),
    })
    .optional(),
  retention: z.object({ closedEnquiryMonths: z.number().int().min(1).max(120), conversationDays: z.number().int().min(1).max(730) }).partial().optional(),
});

/** Organisation configuration (owner only). */
export const POST = authed(async (req, ctx) => {
  if (!can(ctx.role, "settings.manage")) throw new HttpError(403, "Only the owner can change business settings.");
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 422 });
  const p = parsed.data;
  const next: OrgConfig = {
    ...ctx.org,
    ...(p.name ? { name: p.name } : {}),
    ...(p.shortName ? { shortName: p.shortName } : {}),
    ...(p.logoUrl !== undefined ? { logoUrl: p.logoUrl || undefined } : {}),
    ...(p.accent ? { accent: p.accent } : {}),
    ...(p.timeZone ? { timeZone: p.timeZone } : {}),
    ...(p.quickbooksUrl !== undefined ? { quickbooksUrl: p.quickbooksUrl || undefined } : {}),
    ...(p.tradeType ? { tradeType: p.tradeType } : {}),
    ...(p.services ? { services: p.services } : {}),
    ...(p.serviceArea ? { serviceArea: p.serviceArea } : {}),
    ...(p.workingHours ? { workingHours: p.workingHours } : {}),
    contact: { ...ctx.org.contact, ...(p.contact ?? {}) },
    assistant: { ...ctx.org.assistant, ...(p.assistant ?? {}) },
    finance: { ...ctx.org.finance, ...(p.finance ?? {}) },
    retention: { ...ctx.org.retention, ...(p.retention ?? {}) },
    ...(p.leavePolicy ? { leavePolicy: p.leavePolicy } : {}),
    ...(p.followUps ? { followUps: { ...followUpSettings(ctx.org), ...p.followUps, reviewUrl: p.followUps.reviewUrl === "" ? undefined : (p.followUps.reviewUrl ?? ctx.org.followUps?.reviewUrl) } } : {}),
  };
  if (next.finance.vatRegistered === false) next.finance.vatRate = null;
  getDb().prepare("UPDATE orgs SET config = ? WHERE id = ?").run(JSON.stringify(next), ctx.orgId);
  const nctx = { ...ctx, org: next };
  audit(nctx, "settings.updated", "Business settings updated");
  return { ok: true, snapshot: buildSnapshot(nctx) };
});
