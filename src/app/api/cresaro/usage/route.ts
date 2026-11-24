import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/server/http";
import { getDb } from "@/server/db";
import { isPlatformAdmin } from "@/server/auth/platform";
import { spendStatus, usageReport } from "@/server/services/ai-usage";
import { claudeConfigured, claudeHealth, claudeModel } from "@/server/bob/claude";
import type { OrgConfig } from "@/lib/types";

export const runtime = "nodejs";

/** Restricted to Cresaro administrators: a customer never sees model names, token counts or costs. */
const deny = () => NextResponse.json({ error: "Not found" }, { status: 404 });

function orgs() {
  return (getDb().prepare("SELECT id, config FROM orgs").all() as { id: string; config: string }[]).map((r) => ({ id: r.id, org: JSON.parse(r.config) as OrgConfig }));
}

export const GET = authed(async (req, ctx) => {
  if (!isPlatformAdmin(ctx)) return deny();
  const all = orgs();
  const selected = all.find((o) => o.id === req.nextUrl.searchParams.get("org")) ?? all.find((o) => o.id === ctx.orgId) ?? all[0];
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  return {
    workspaces: all.map((o) => ({ id: o.id, name: o.org.name, ...spendStatus({ orgId: o.id, org: o.org }), warnAtPercent: o.org.ai?.warnAtPercent ?? 80 })),
    selected: selected ? { id: selected.id, name: selected.org.name, report: usageReport({ orgId: selected.id, org: selected.org }, days) } : null,
    engine: {
      configured: claudeConfigured(),
      model: claudeModel(),
      routing: process.env.BOB_CLAUDE_ROUTING === "auto" ? { fastModel: process.env.BOB_CLAUDE_FAST_MODEL || "claude-sonnet-5-5" } : null,
      caching: process.env.BOB_CLAUDE_CACHE === "off" ? "off" : process.env.BOB_CLAUDE_CACHE_TTL === "1h" ? "1h" : "5m",
      health: claudeHealth,
    },
  };
});

const limitSchema = z.object({
  orgId: z.string().min(1),
  monthlyLimitUsd: z.number().min(0).max(100000).nullable(),
  warnAtPercent: z.number().int().min(10).max(100).optional(),
});

/** Set a workspace's monthly AI spending limit (null = no limit). */
export const POST = authed(async (req, ctx) => {
  if (!isPlatformAdmin(ctx)) return deny();
  const parsed = limitSchema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid limit" }, { status: 422 });
  const row = getDb().prepare("SELECT config FROM orgs WHERE id = ?").get(parsed.data.orgId) as { config: string } | undefined;
  if (!row) return NextResponse.json({ error: "No such workspace" }, { status: 404 });
  const org = JSON.parse(row.config) as OrgConfig;
  const next: OrgConfig = { ...org, ai: { monthlyLimitUsd: parsed.data.monthlyLimitUsd, warnAtPercent: parsed.data.warnAtPercent ?? org.ai?.warnAtPercent ?? 80 } };
  getDb().prepare("UPDATE orgs SET config = ? WHERE id = ?").run(JSON.stringify(next), parsed.data.orgId);
  return { ok: true, spend: spendStatus({ orgId: parsed.data.orgId, org: next }) };
});
