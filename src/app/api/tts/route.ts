import { authed, readJson } from "@/server/http";
import { HttpError } from "@/server/context";
import { synthesize, ttsStatus } from "@/server/tts/elevenlabs";

export const runtime = "nodejs";

// Per-user limit so a stuck client can't burn ElevenLabs credits.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 40;
const hits = new Map<string, number[]>();
function limited(userId: string) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return true;
  recent.push(now);
  hits.set(userId, recent);
  return false;
}

/** Which voice is configured (never the key). */
export const GET = authed(async () => ttsStatus());

/** Speak a short reply with the ElevenLabs voice. 503 = not configured → the app uses the browser voice. */
export const POST = authed(async (req, ctx) => {
  const body = await readJson(req);
  const text = typeof body.text === "string" ? body.text : "";
  if (limited(ctx.userId)) throw new HttpError(429, "Too many spoken replies — try again in a few minutes.");
  const r = await synthesize(text);
  if (!r.ok) return Response.json({ error: r.error, reason: r.reason }, { status: r.status, headers: { "Cache-Control": "no-store" } });
  return new Response(r.audio, {
    headers: {
      "Content-Type": r.contentType,
      "Cache-Control": "private, no-store",
      "X-Bob-Voice": "elevenlabs",
      "X-Bob-Voice-Id": r.voiceId,
    },
  });
});
