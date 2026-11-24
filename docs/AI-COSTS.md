# Ask Bob: Claude API cost

## What drove the cost in the pilot's first test

The pilot's first test sent 183,821 input tokens and got 4,856 output tokens back, costing $0.83. That is exactly the main model's price with no caching ($4/M input, $20/M output).

Profiling the request bodies Bob sends for the same questions (8 questions, 17 model calls) showed where the input came from.

| Part of each request | Size | Share of input |
|---|---|---|
| Tool definitions (64 tools, permission-filtered) | ~8,650 tokens | ~79% |
| System prompt (instructions, calendar, VAT rules) | ~1,820 tokens | ~16% |
| Conversation and tool results | 20–1,000 tokens | ~5% |

About 10,500 tokens of instructions and tool definitions never change during a conversation. They were sent, uncached and at full price, on every model call: twice per question, three times when Bob had to look something up first.

Output tokens were already small (about 290 per call), and conversation history wasn't a factor at this length.

## What changed

1. **Prompt caching.** The tools and the stable part of the system prompt are cached with an explicit breakpoint. Automatic caching covers the growing conversation within a turn.
   - Per-turn details (spoken or typed, the job or customer in focus) moved into a small block after the breakpoint, so they no longer break the cache.
   - Cached input costs a tenth of normal input.
2. **History window.** History slides in steps of 8 messages (keeping 12–20) instead of one message every turn. The start of a long conversation stays identical, so it stays cached.
3. **Fewer round trips.** `get_job_profile` accepts a description ("Patels kitchen"), so "what's outstanding on X" takes one lookup instead of a search followed by a profile.
4. **Smaller tool results.** The cap dropped from 20,000 to 12,000 characters.
5. **Optional model routing** (`BOB_CLAUDE_ROUTING=auto`).
   - Simple questions go to the cheaper model; anything that changes data, invoices, multi-part requests and long messages stay on the main model.
   - Once a conversation needs the main model it stays there, because each model keeps its own cache.
   - It's **off by default** (see below).
6. **Usage tracking.** Every model call is recorded per workspace: Ask Bob, handover drafting, rewrites and connection tests. Each record has its four token meters, cost, duration and success.
7. **Spending limits.** Each workspace can have a monthly limit and a warning threshold.
   - Over the limit, Ask Bob answers with its built-in assistant and says so.
   - Handover drafting uses the job-details template instead.
8. **Cresaro admin area** (`/cresaro`, for `BOB_PLATFORM_ADMINS` only). It shows spend, cache hit rate, call time, daily spend, and breakdowns by feature, model and person, with per-workspace limits and the connection test. Model and cost details no longer appear in a customer's Settings.
9. **Bug fixed along the way:** handover AI drafting forced a `tool_choice` that current models reject. It had been silently falling back to the template every time. It now asks for the tool explicitly.

## Before and after (estimate)

Run with `BOB_BENCH=sim npx vitest run tests/benchmark`. This replays the same questions with the same tool calls through a fake model, captures every request Bob would send, and applies the API's caching rules. Tokens are estimated at 3.78 characters per token, calibrated on the pilot's measured figure. The "before" estimate reproduces the pilot: 186K tokens and $0.84, against 183.8K and $0.83 measured.

| | Model calls | Input tokens | of which read from cache | Cost (main model) |
|---|---|---|---|---|
| Before | 17 | 186,440 | 0% | $0.84 |
| After | 16 | 175,536 | 92% | $0.20 |

The result is **about 77% lower cost** for the same answers from the same model. Input *volume* barely changes; what changes is that 92% of it is billed at the cache-read rate.

- If everything ran on the cheaper model, the same session would cost about $0.10.
- Response times weren't measured here, because no live key is available in this environment. Caching normally shortens time to first token on a cached prefix of this size.
- To measure on the real API (about $0.30–$1):

  ```
  BOB_BENCH=live ANTHROPIC_API_KEY=... npx vitest run tests/benchmark
  ```

  This prints the API's own usage meters, cost and answer times with caching off and on. Add `BOB_BENCH_ROUTING=1` to include routing.
- The cache lasts 5 minutes. Someone who asks Bob a question every 20 minutes pays a cache write each time, which is still cheaper than no cache (1.25× once instead of 1× on every call). `BOB_CLAUDE_CACHE_TTL=1h` suits that pattern better.

## Model choice

Keep the main model as the default. Ask Bob decides which records to change, chains several actions together and has to avoid inventing figures, and the larger model is measurably more reliable at that. Caching already brings it to roughly what the cheaper model would cost uncached.

Routing is built and tested. Before switching it on, run the live benchmark with `BOB_BENCH_ROUTING=1` and check the answers to the read-only questions side by side.
