/**
 * Claude API cost controls: prompt caching request shape, the conversation
 * history window, optional model routing, per-workspace usage recording,
 * the monthly spending limit, the Cresaro-only admin check, and the handover
 * drafting request. All with a fake Anthropic client — no network, no spend.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OWNER, N93_OFFICE } from "./helpers";
import { getDb } from "@/server/db";
import { historyWindow, pickTier, setClaudeClientForTests, systemBlocks } from "@/server/bob/claude";
import { costOf, spendStatus, usageReport } from "@/server/services/ai-usage";
import { isPlatformAdmin } from "@/server/auth/platform";
import { draftReport } from "@/server/report-ai";

type Req = {
  model: string;
  system: { type: string; text: string; cache_control?: { type: string; ttl?: string } }[] | string;
  tools: { name: string }[];
  messages: { role: string; content: unknown }[];
  cache_control?: { type: string };
  tool_choice?: { type: string };
  output_config?: { effort?: string };
};

const usage = { input_tokens: 300, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 11_000 };
function fakeClient(script: ((req: Req) => unknown)[], seen: Req[]) {
  let i = 0;
  return () =>
    ({
      beta: {
        messages: {
          create: async (req: Req) => {
            seen.push(JSON.parse(JSON.stringify(req)));
            return { model: req.model, usage, ...(script[Math.min(i++, script.length - 1)](req) as object) };
          },
        },
      },
    }) as never;
}
const toolUse = (name: string, input: unknown) => () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${Math.random()}`, name, input }] });
const say = (text: string) => () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

const ENV = ["ANTHROPIC_API_KEY", "BOB_ENGINE", "BOB_CLAUDE_ROUTING", "BOB_CLAUDE_CACHE", "BOB_CLAUDE_CACHE_TTL", "BOB_PLATFORM_ADMINS"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  freshDb();
  for (const k of ENV) saved[k] = process.env[k];
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.BOB_ENGINE;
  delete process.env.BOB_CLAUDE_ROUTING;
  delete process.env.BOB_CLAUDE_CACHE;
  delete process.env.BOB_CLAUDE_CACHE_TTL;
});
afterEach(() => {
  setClaudeClientForTests(null);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const rows = () => getDb().prepare("SELECT * FROM ai_usage ORDER BY created_at").all() as { feature: string; model: string; input_tokens: number; cache_read_tokens: number; output_tokens: number; cost_usd: number; ok: number; org_id: string }[];

describe("cost per call", () => {
  it("prices each meter at its own rate", () => {
    // The pilot's first test, no caching: 183,821 in + 4,856 out on the main model = $0.83.
    expect(costOf("claude-opus-5-5", { input_tokens: 183_821, output_tokens: 4_856 })).toBeCloseTo(0.8324, 3);
    // Cache reads cost a twentieth of fresh input; 5-minute writes 1.25×, 1-hour writes 2×.
    expect(costOf("claude-opus-5-5", { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(costOf("claude-opus-5-5", { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(5);
    expect(costOf("claude-opus-5-5", { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } })).toBeCloseTo(8);
    expect(costOf("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12);
    // A dated model id resolves to its family's price.
    expect(costOf("claude-sonnet-5-5-20261101", { input_tokens: 1_000_000 })).toBeCloseTo(2);
  });
});

describe("prompt caching", () => {
  it("caches tools + the stable system prompt, keeps per-turn notes after the breakpoint, and caches the conversation tail", async () => {
    const seen: Req[] = [];
    setClaudeClientForTests(fakeClient([say("Morning.")], seen));
    const c = new Chat(ctxFor(N93_OWNER));
    await c.say("hello", "voice");
    await c.say("and again");
    const [a, b] = seen;
    expect(Array.isArray(a.system)).toBe(true);
    const sysA = a.system as Exclude<Req["system"], string>;
    const sysB = b.system as Exclude<Req["system"], string>;
    expect(sysA).toHaveLength(2);
    expect(sysA[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sysA[1].cache_control).toBeUndefined();
    expect(a.cache_control).toEqual({ type: "ephemeral" }); // automatic caching of the growing message tail
    // The cached prefix is byte-identical between a spoken and a typed turn; only the small block differs.
    expect(sysB[0].text).toBe(sysA[0].text);
    expect(JSON.stringify(b.tools)).toBe(JSON.stringify(a.tools));
    expect(sysA[1].text).toMatch(/SPOKEN/);
    expect(sysB[1].text).toMatch(/typed/);
    expect(sysA[0].text).not.toMatch(/SPOKEN|typed;/);
  });

  it("1-hour cache and switching caching off are settings", () => {
    const ctx = ctxFor(N93_OWNER);
    process.env.BOB_CLAUDE_CACHE_TTL = "1h";
    expect(systemBlocks(ctx)[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    process.env.BOB_CLAUDE_CACHE = "off";
    expect(systemBlocks(ctx)[0].cache_control).toBeUndefined();
  });

  it("the conversation memory (focus) sits in the uncached block, so following a job doesn't break the cache", () => {
    const ctx = ctxFor(N93_OWNER);
    const plain = systemBlocks(ctx, {});
    const focused = systemBlocks(ctx, { focusJobId: "n93_job_mackay_kitchen" } as never);
    expect(focused[0].text).toBe(plain[0].text);
  });
});

describe("conversation history", () => {
  it("keeps everything up to 20 messages, then slides in steps of 8 so the start stays cacheable", () => {
    const h = (n: number) => Array.from({ length: n }, (_, i) => i);
    expect(historyWindow(h(20))).toHaveLength(20);
    expect(historyWindow(h(21))[0]).toBe(8);
    expect(historyWindow(h(27))[0]).toBe(8); // same start for several turns
    expect(historyWindow(h(28))[0]).toBe(16);
    for (let n = 21; n < 60; n++) expect(historyWindow(h(n)).length).toBeGreaterThanOrEqual(12);
    for (let n = 21; n < 60; n++) expect(historyWindow(h(n)).length).toBeLessThanOrEqual(20);
  });
});

describe("model routing (off unless BOB_CLAUDE_ROUTING=auto)", () => {
  it("is off by default: everything uses the main model", async () => {
    expect(pickTier("where is everyone tomorrow?", {})).toBe("main");
    const seen: Req[] = [];
    setClaudeClientForTests(fakeClient([say("ok")], seen));
    await new Chat(ctxFor(N93_OWNER)).say("where is everyone tomorrow?");
    expect(seen[0].model).toBe("claude-opus-5-5");
  });

  it("when on: questions go to the fast model; changes, several requests and long messages to the main one, and it sticks", async () => {
    process.env.BOB_CLAUDE_ROUTING = "auto";
    expect(pickTier("Where is everyone working tomorrow?", {})).toBe("fast");
    expect(pickTier("What's outstanding on the Patels' kitchen?", {})).toBe("fast");
    expect(pickTier("Prepare an invoice for Sophie Mackay", {})).toBe("main");
    expect(pickTier("Book Liam's holiday next Friday", {})).toBe("main");
    expect(pickTier("who's off, who's free, and what needs ordering?", {})).toBe("main");
    expect(pickTier("Where is everyone tomorrow?", { aiTier: "main" })).toBe("main");
    const seen: Req[] = [];
    setClaudeClientForTests(fakeClient([say("ok")], seen));
    const c = new Chat(ctxFor(N93_OWNER));
    await c.say("where is everyone tomorrow?");
    await c.say("add a task to ring the plasterer");
    await c.say("who's off this week?");
    expect(seen.map((r) => r.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5-5"]);
  });
});

describe("usage tracking and spending limits", () => {
  it("records every model call against the workspace with tokens, cost and time", async () => {
    const seen: Req[] = [];
    setClaudeClientForTests(fakeClient([toolUse("get_schedule", {}), say("Liam's in Copthorne.")], seen));
    const ctx = ctxFor(N93_OWNER);
    await new Chat(ctx).say("where is everyone today?");
    const r = rows();
    expect(r).toHaveLength(2); // one per model call, not per turn
    expect(r.every((x) => x.feature === "ask_bob" && x.org_id === ctx.orgId && x.ok === 1)).toBe(true);
    expect(r[0].cache_read_tokens).toBe(11_000);
    expect(r[0].cost_usd).toBeCloseTo(costOf("claude-opus-5-5", usage), 6);
    const rep = usageReport(ctx, 7);
    expect(rep.total.n).toBe(2);
    expect(rep.total.cacheHitRate).toBeCloseTo(22_000 / 22_600, 3);
    expect(rep.askBobAnswers).toBe(1);
    expect(rep.byUser[0].key).toMatch(/Luke/);
  });

  it("a failed call is recorded as failed and Bob still answers with the built-in assistant", async () => {
    setClaudeClientForTests(() => ({ beta: { messages: { create: async () => { throw new Error("overloaded"); } } } }) as never);
    const c = new Chat(ctxFor(N93_OWNER));
    await c.say("who's off this week?");
    expect(c.text.length).toBeGreaterThan(0);
    expect(rows().some((x) => x.ok === 0)).toBe(true);
  });

  it("over the monthly limit, Ask Bob uses the built-in assistant and makes no model call", async () => {
    const ctx = ctxFor(N93_OFFICE);
    ctx.org.ai = { monthlyLimitUsd: 1 };
    getDb().prepare("INSERT INTO ai_usage (id, org_id, feature, model, cost_usd, created_at) VALUES ('u1', ?, 'ask_bob', 'claude-opus-5-5', 1.2, ?)").run(ctx.orgId, new Date().toISOString());
    expect(spendStatus(ctx)).toMatchObject({ blocked: true, percent: 120 });
    const seen: Req[] = [];
    setClaudeClientForTests(fakeClient([say("should not be called")], seen));
    const c = new Chat(ctx);
    await c.say("who's off this week?");
    expect(seen).toHaveLength(0);
    expect(c.text).toMatch(/AI allowance has been used/);
  });

  it("warns at the configured percentage and other workspaces are unaffected", () => {
    const ctx = ctxFor(N93_OWNER);
    ctx.org.ai = { monthlyLimitUsd: 10, warnAtPercent: 50 };
    getDb().prepare("INSERT INTO ai_usage (id, org_id, feature, model, cost_usd, created_at) VALUES ('u2', ?, 'ask_bob', 'claude-opus-5-5', 6, ?)").run(ctx.orgId, new Date().toISOString());
    expect(spendStatus(ctx)).toMatchObject({ warning: true, blocked: false, percent: 60 });
    const other = ctxFor("alex@ridgeway.example");
    expect(spendStatus(other).spentUsd).toBe(0);
  });
});

describe("Cresaro administration", () => {
  it("only emails listed in BOB_PLATFORM_ADMINS are platform admins — not a customer's owner", () => {
    const owner = ctxFor(N93_OWNER);
    delete process.env.BOB_PLATFORM_ADMINS;
    expect(isPlatformAdmin(owner)).toBe(false);
    process.env.BOB_PLATFORM_ADMINS = "someone@cresaro.example, OWNER@ninety3.example";
    expect(isPlatformAdmin(owner)).toBe(true);
    expect(isPlatformAdmin(ctxFor(N93_OFFICE))).toBe(false);
  });
});

describe("handover drafting request", () => {
  it("asks for the tool without forcing tool_choice, and meters the call", async () => {
    const seen: Req[] = [];
    setClaudeClientForTests(
      fakeClient([toolUse("write_handover_report", { overview: "The kitchen was fitted.", workCompleted: ["Units fitted"], captions: [], aftercare: [], outstanding: [], questions: [] })], seen),
    );
    const ctx = ctxFor(N93_OWNER);
    const d = await draftReport({ business: "Ninety3", job: { title: "Kitchen", status: "complete" }, customerName: "Sophie Mackay", updates: [], photos: [], documents: [], completedTasks: [] }, ctx);
    expect(d.overview).toBe("The kitchen was fitted.");
    expect(seen[0].tool_choice).toEqual({ type: "auto" });
    expect(String(seen[0].system)).toMatch(/Reply only by calling the write_handover_report tool/);
    expect(rows()[0]).toMatchObject({ feature: "handover_report" });
  });
});
