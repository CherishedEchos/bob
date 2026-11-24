/**
 * Ask Bob cost benchmark: the same business questions before and after the
 * cost work. Skipped in the normal test run.
 *
 *   BOB_BENCH=sim npx vitest run tests/benchmark
 *     Estimate with no API calls. A fake model returns the same tool calls the
 *     real one made in the pilot test; every request body Bob would send is
 *     captured and sized. "Before" = no prompt caching and the old two-step job
 *     lookup; "after" = the current code. Tokens are estimated from request size
 *     at 3.78 characters per token, calibrated against the pilot's measured
 *     183,821 input tokens for these questions.
 *
 *   BOB_BENCH=live ANTHROPIC_API_KEY=... npx vitest run tests/benchmark
 *     Real measurement (costs roughly $0.30–$1). Runs the questions twice on a
 *     fresh demo database — caching off, then on (and with routing if
 *     BOB_BENCH_ROUTING=1) — and prints the API's own usage meters, cost and
 *     wall-clock time per answer.
 */
import { describe, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OWNER } from "../helpers";
import { getDb } from "@/server/db";
import { setClaudeClientForTests } from "@/server/bob/claude";
import { costOf, rateFor } from "@/server/services/ai-usage";
import { addDays, weekStart } from "@/lib/dates";
import { todayKey } from "@/lib/utils";

const QUESTIONS = [
  "Where is everyone working tomorrow?",
  "Give me a quick morning briefing.",
  "What is outstanding on the Patels' kitchen?",
  "What materials still need ordering this week?",
  "Which merchants do I need to contact?",
  "Who is available next Thursday?",
  "Which jobs are ready to invoice?",
  "What should Ryan prioritise today?",
];
const CHARS_PER_TOKEN = 3.78;
const MODEL = "claude-opus-5-5";
const OUTPUT_TOKENS = 4_856; // measured in the pilot; output is unchanged by these optimisations

type Req = { system: unknown; tools: unknown[]; messages: unknown[] };
const tok = (s: string) => Math.round(s.length / CHARS_PER_TOKEN);
const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

async function capture(oldLookup: boolean): Promise<Req[]> {
  freshDb();
  process.env.ANTHROPIC_API_KEY = "sim";
  const seen: Req[] = [];
  const call = (name: string, input: unknown) => () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${seen.length}`, name, input }] });
  const say = (t: string) => () => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });
  const ws = weekStart(todayKey());
  const script: (() => unknown)[] = [
    call("get_schedule", { from: addDays(todayKey(), 1) }), say("Tomorrow Liam and Callum are in Copthorne."),
    call("get_morning_briefing", {}), say("Here's your morning."),
    ...(oldLookup
      ? [call("search_jobs", { query: "Patels kitchen" }), call("get_job_profile", { job_id: "n93_job_kitchen_crawley" })]
      : [call("get_job_profile", { query: "Patels kitchen" })]),
    say("Still to do and to pay on the Patels' kitchen."),
    call("list_materials", { status: "to_order", needed_by_on_or_before: addDays(ws, 6) }), say("4 items to order."),
    call("list_merchants", { only_with_items_to_order: true }), say("3 merchants."),
    call("get_team_availability", { from: addDays(ws, 10) }), say("Everyone's free."),
    call("list_jobs", { stage: "ready_to_invoice" }), say("2 jobs."),
    call("get_person_priorities", { name: "Ryan" }), say("Replies first."),
  ];
  setClaudeClientForTests(() => ({ beta: { messages: { create: async (r: Req) => (seen.push(JSON.parse(JSON.stringify(r))), script.shift()!()) } } }) as never);
  const c = new Chat(ctxFor(N93_OWNER));
  for (const q of QUESTIONS) await c.say(q);
  setClaudeClientForTests(null);
  return seen;
}

/** Input token meters for a sequence of requests under the API's caching rules (prefix match, tools → system → messages). */
function meter(reqs: Req[], cached: boolean) {
  let input = 0, write = 0, read = 0;
  let prev = "";
  for (const r of reqs) {
    const body = JSON.stringify(r.tools) + JSON.stringify(r.system) + JSON.stringify(r.messages);
    if (!cached) {
      input += tok(body);
      continue;
    }
    // Everything up to the last block is cacheable; the part matching the previous request is read, the rest written.
    const hit = commonPrefix(prev, body);
    read += tok(body.slice(0, hit));
    write += tok(body.slice(hit));
    prev = body;
  }
  return { input, write, read, total: input + write + read, requests: reqs.length };
}

describe.skipIf(process.env.BOB_BENCH !== "sim")("Ask Bob cost — estimate", () => {
  it("before vs after", async () => {
    process.env.BOB_CLAUDE_CACHE = "off";
    const before = meter(await capture(true), false);
    delete process.env.BOB_CLAUDE_CACHE;
    const after = meter(await capture(false), true);
    const outShare = OUTPUT_TOKENS / before.requests;
    const cost = (m: ReturnType<typeof meter>) => costOf(MODEL, { input_tokens: m.input, cache_creation_input_tokens: m.write, cache_read_input_tokens: m.read, output_tokens: Math.round(outShare * m.requests) });
    const sonnet = (m: ReturnType<typeof meter>) => costOf("claude-sonnet-5-5", { input_tokens: m.input, cache_creation_input_tokens: m.write, cache_read_input_tokens: m.read, output_tokens: Math.round(outShare * m.requests) });
    const r = rateFor(MODEL);
    const line = (label: string, m: ReturnType<typeof meter>) =>
      `${label.padEnd(8)} requests ${m.requests}  input ${m.input.toLocaleString()}  cache write ${m.write.toLocaleString()}  cache read ${m.read.toLocaleString()}  total input ${m.total.toLocaleString()}  billed-input equivalent ${Math.round(m.input + m.write * (r.write5m / r.input) + m.read * (r.read / r.input)).toLocaleString()}  cost $${cost(m).toFixed(3)} (all on the fast model: $${sonnet(m).toFixed(3)})`;
    console.log(`\n${line("BEFORE", before)}\n${line("AFTER", after)}\nCost reduction ${Math.round((1 - cost(after) / cost(before)) * 100)}%  (cache hit rate after: ${Math.round((after.read / after.total) * 100)}%)\n`);
  });
});

describe.skipIf(process.env.BOB_BENCH !== "live")("Ask Bob cost — live", () => {
  it("caching off vs on (vs routing)", { timeout: 900_000 }, async () => {
    const arms: { name: string; env: Record<string, string | undefined> }[] = [
      { name: "no cache", env: { BOB_CLAUDE_CACHE: "off", BOB_CLAUDE_ROUTING: undefined } },
      { name: "cached", env: { BOB_CLAUDE_CACHE: undefined, BOB_CLAUDE_ROUTING: undefined } },
      ...(process.env.BOB_BENCH_ROUTING ? [{ name: "cached+routing", env: { BOB_CLAUDE_CACHE: undefined, BOB_CLAUDE_ROUTING: "auto" } }] : []),
    ];
    for (const arm of arms) {
      freshDb();
      for (const [k, v] of Object.entries(arm.env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      const c = new Chat(ctxFor(N93_OWNER));
      const times: number[] = [];
      for (const q of QUESTIONS) {
        const t0 = Date.now();
        await c.say(q);
        times.push(Date.now() - t0);
        console.log(`  [${arm.name}] ${q} → ${(Date.now() - t0) / 1000}s: ${c.text.slice(0, 140).replace(/\s+/g, " ")}`);
      }
      const s = getDb().prepare("SELECT COUNT(*) n, SUM(input_tokens) i, SUM(cache_write_tokens) w, SUM(cache_read_tokens) r, SUM(output_tokens) o, SUM(cost_usd) c, SUM(ok = 0) f FROM ai_usage").get() as Record<string, number>;
      const sorted = [...times].sort((a, b) => a - b);
      console.log(`${arm.name.padEnd(15)} calls ${s.n} (failed ${s.f})  input ${s.i}  cache write ${s.w}  cache read ${s.r}  output ${s.o}  cost $${s.c.toFixed(4)}  answer time median ${(sorted[sorted.length >> 1] / 1000).toFixed(1)}s, total ${(times.reduce((a, b) => a + b, 0) / 1000).toFixed(1)}s`);
    }
  });
});
