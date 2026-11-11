/**
 * POST /api/assistant — server entry point for the future AI engine.
 *
 * Not active in the demo (the deterministic engine runs in the browser over
 * fictional data). The shape is in place so the real implementation only has
 * to fill in the marked section:
 *   1. authenticate (Supabase session) → 401
 *   2. authorise by role → 403
 *   3. validate input with zod → 400
 *   4. call the model with tools that RETURN PROPOSALS ONLY
 *   5. write an audit log entry for the request
 * Model API keys live in server-side env vars only — never NEXT_PUBLIC_*.
 */
import { NextResponse } from "next/server";
import { assistantRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.ASSISTANT_ENGINE !== "llm") {
    return NextResponse.json(
      { error: "not_configured", message: "The AI engine isn't enabled yet. The demo assistant runs locally." },
      { status: 501 },
    );
  }

  // 1–2. TODO: const user = await requireUser(); if (!can(user.role, "...")) return 403
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = assistantRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }

  // 4–5. TODO: model call with tool definitions mirroring ProposedAction.
  return NextResponse.json({ error: "not_implemented" }, { status: 501 });
}
