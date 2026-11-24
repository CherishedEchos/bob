import { NextResponse } from "next/server";
import { authed } from "@/server/http";
import { isPlatformAdmin } from "@/server/auth/platform";
import { recordUsage } from "@/server/services/ai-usage";
import { anthropicClient, claudeConfigured, claudeHealth, claudeModel, noteClaudeFailure } from "@/server/bob/claude";

export const runtime = "nodejs";

const deny = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** Is Claude answering, or has Bob been falling back to its built-in engine? Cresaro administrators only. */
export const GET = authed(async (_req, ctx) => {
  if (!isPlatformAdmin(ctx)) return deny();
  return NextResponse.json({ configured: claudeConfigured(), model: claudeModel(), health: claudeHealth });
});

/** A tiny live request to the Anthropic API (a few tokens) to prove the key and model work. */
export const POST = authed(async (_req, ctx) => {
  if (!isPlatformAdmin(ctx)) return deny();
  if (!claudeConfigured()) return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY isn't set on the server (or BOB_ENGINE=rules)." });
  const t0 = Date.now();
  try {
    const r = await anthropicClient().beta.messages.create(
      { model: claudeModel(), max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word OK." }] },
      { timeout: 20_000, maxRetries: 0 },
    );
    recordUsage(ctx, { feature: "connection_test", model: r.model, usage: r.usage, ms: Date.now() - t0 });
    const text = r.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    claudeHealth.ok++;
    claudeHealth.lastOkAt = new Date().toISOString();
    claudeHealth.lastModel = r.model;
    return NextResponse.json({ ok: true, model: r.model, reply: text.slice(0, 40), ms: Date.now() - t0 });
  } catch (e) {
    noteClaudeFailure(e);
    return NextResponse.json({ ok: false, error: claudeHealth.lastError, ms: Date.now() - t0 });
  }
});
