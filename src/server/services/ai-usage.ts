import "server-only";
/**
 * Claude API usage and cost per workspace: every model call Bob makes
 * (Ask Bob turns, handover drafting, the connection test) is recorded with
 * its four token meters, cost and duration. Feeds the usage dashboard and the
 * monthly spending limit.
 *
 * Prices in USD per million tokens, from Anthropic's pricing page
 * (platform.claude.com/docs/en/about-claude/pricing, fetched 2026-11-24).
 * Update them here if Anthropic's prices change.
 */
import { getDb } from "@/server/db";
import type { Ctx } from "@/server/context";
import { uid } from "@/lib/utils";

interface Rate { input: number; write5m: number; write1h: number; read: number; output: number }
export const PRICES: Record<string, Rate> = {
  "claude-opus-5-5": { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 },
  "claude-haiku-5-5": { input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5 },
  // Models the server-side refusal fallback can hand a request to.
  "claude-opus-5": { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 },
  "claude-sonnet-5": { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 },
};

/** The four meters from a Messages API `usage` object. */
export interface UsageMeters {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

export function rateFor(model: string): Rate {
  const key = Object.keys(PRICES).find((k) => model === k || model.startsWith(`${k}-`) || model.startsWith(k));
  return PRICES[key ?? "claude-opus-5-5"];
}

export function splitMeters(u: UsageMeters) {
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const writeAll = u.cache_creation_input_tokens ?? 0;
  return { input: u.input_tokens ?? 0, write5m: Math.max(0, writeAll - write1h), write1h, read: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 };
}

/** Cost in USD of one response, each meter at its own rate. */
export function costOf(model: string, u: UsageMeters): number {
  const r = rateFor(model);
  const m = splitMeters(u);
  return (m.input * r.input + m.write5m * r.write5m + m.write1h * r.write1h + m.read * r.read + m.output * r.output) / 1e6;
}

export type AiFeature = "ask_bob" | "handover_report" | "report_rewrite" | "connection_test";

export function recordUsage(ctx: Pick<Ctx, "orgId" | "userId">, e: { feature: AiFeature; model: string; usage?: UsageMeters | null; ms: number; ok?: boolean; conversationId?: string }) {
  const m = splitMeters(e.usage ?? {});
  const cost = e.usage ? costOf(e.model, e.usage) : 0;
  getDb()
    .prepare(
      `INSERT INTO ai_usage (id, org_id, user_id, conversation_id, feature, model, input_tokens, cache_write_tokens, cache_write_1h_tokens, cache_read_tokens, output_tokens, cost_usd, duration_ms, ok, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(uid("aiu"), ctx.orgId, ctx.userId ?? null, e.conversationId ?? null, e.feature, e.model, m.input, m.write5m + m.write1h, m.write1h, m.read, m.output, cost, Math.round(e.ms), e.ok === false ? 0 : 1, new Date().toISOString());
  return cost;
}

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();

export function monthToDateCost(orgId: string): number {
  const row = getDb().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_usage WHERE org_id = ? AND created_at >= ?").get(orgId, monthStart()) as { c: number };
  return row.c;
}

export interface SpendStatus { limitUsd: number | null; spentUsd: number; percent: number | null; blocked: boolean; warning: boolean }

/** Month-to-date spend against the workspace's monthly limit (Settings → AI usage). */
export function spendStatus(ctx: Pick<Ctx, "orgId" | "org">): SpendStatus {
  const limit = ctx.org.ai?.monthlyLimitUsd ?? null;
  const spent = monthToDateCost(ctx.orgId);
  const percent = limit ? Math.round((spent / limit) * 100) : null;
  const warnAt = ctx.org.ai?.warnAtPercent ?? 80;
  return { limitUsd: limit, spentUsd: spent, percent, blocked: limit !== null && spent >= limit, warning: percent !== null && percent >= warnAt };
}

type Row = { day: string; model: string; feature: string; user_id: string | null; n: number; input: number; write: number; read: number; output: number; cost: number; ms: number; fails: number };

/** The dashboard: totals, cache hit rate, by day, model, feature and person. */
export function usageReport(ctx: Pick<Ctx, "orgId" | "org">, days = 30) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, model, feature, user_id, COUNT(*) AS n,
              SUM(input_tokens) AS input, SUM(cache_write_tokens) AS write, SUM(cache_read_tokens) AS read, SUM(output_tokens) AS output,
              SUM(cost_usd) AS cost, SUM(duration_ms) AS ms, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS fails
       FROM ai_usage WHERE org_id = ? AND created_at >= ? GROUP BY day, model, feature, user_id`,
    )
    .all(ctx.orgId, since) as Row[];
  const users = new Map((getDb().prepare("SELECT id, name FROM users").all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  const sum = (list: Row[]) => list.reduce((a, r) => ({ n: a.n + r.n, input: a.input + r.input, write: a.write + r.write, read: a.read + r.read, output: a.output + r.output, cost: a.cost + r.cost, ms: a.ms + r.ms, fails: a.fails + r.fails }), { n: 0, input: 0, write: 0, read: 0, output: 0, cost: 0, ms: 0, fails: 0 });
  const group = (key: (r: Row) => string) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m.entries()].map(([k, list]) => ({ key: k, ...sum(list) })).sort((a, b) => b.cost - a.cost);
  };
  const total = sum(rows);
  const totalInput = total.input + total.write + total.read;
  const turns = (getDb().prepare("SELECT COUNT(DISTINCT conversation_id || substr(created_at, 1, 16)) AS t FROM ai_usage WHERE org_id = ? AND created_at >= ? AND feature = 'ask_bob'").get(ctx.orgId, since) as { t: number }).t;
  const byDay = new Map(group((r) => r.day).map((d) => [d.key, d]));
  return {
    days,
    total: { ...total, cacheHitRate: totalInput ? total.read / totalInput : 0, avgMs: total.n ? Math.round(total.ms / total.n) : 0 },
    askBobAnswers: turns,
    spend: spendStatus(ctx),
    byDay: Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 864e5).toISOString().slice(0, 10);
      return { day: d, cost: byDay.get(d)?.cost ?? 0, n: byDay.get(d)?.n ?? 0 };
    }),
    byModel: group((r) => r.model),
    byFeature: group((r) => r.feature),
    byUser: group((r) => users.get(r.user_id ?? "") ?? "Unknown"),
  };
}
