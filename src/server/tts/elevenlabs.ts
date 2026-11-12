import "server-only";
import { createHash } from "node:crypto";

/**
 * ElevenLabs text-to-speech for Bob's short spoken replies.
 *
 * Configuration (server-side only — set in Render's Environment tab):
 *   ELEVENLABS_API_KEY   required; never sent to the browser or logged
 *   ELEVENLABS_VOICE_ID  optional; defaults to Bob's current voice below.
 *                        Change it in Render to switch voice (e.g. Cockney).
 *   ELEVENLABS_MODEL_ID  optional; defaults to eleven_flash_v2_5 (fast, cheap)
 */
export const DEFAULT_VOICE_ID = "Hj01EoUVZleioJaYx5b0";
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
export const MAX_TTS_CHARS = 600;

export interface TtsConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export function ttsConfig(env: Record<string, string | undefined> = process.env): TtsConfig | null {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    voiceId: env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID,
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
  };
}

/** Safe to show in the UI: which voice, never the key. */
export function ttsStatus(env: Record<string, string | undefined> = process.env) {
  const c = ttsConfig(env);
  return c ? { configured: true as const, voiceId: c.voiceId, model: c.modelId } : { configured: false as const };
}

export type TtsResult = { ok: true; audio: ArrayBuffer; contentType: string; voiceId: string; cached: boolean } | { ok: false; status: number; error: string };

// Small in-memory cache so replaying the same reply doesn't spend credits again.
const CACHE_MAX = 60;
const cache = new Map<string, { audio: ArrayBuffer; contentType: string }>();

export async function synthesize(text: string, opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}): Promise<TtsResult> {
  const config = ttsConfig(opts.env);
  if (!config) return { ok: false, status: 503, error: "not_configured" };
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, status: 400, error: "No text to speak" };
  if (clean.length > MAX_TTS_CHARS) return { ok: false, status: 413, error: "Text too long to speak" };

  const key = createHash("sha256").update(`${config.voiceId}|${config.modelId}|${clean}`).digest("hex");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return { ok: true, ...hit, voiceId: config.voiceId, cached: true };
  }

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: clean, model_id: config.modelId }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Network/timeout. Deliberately no request details in the log (they include the key header).
    console.warn("[tts] ElevenLabs request failed (network or timeout)");
    return { ok: false, status: 502, error: "voice_unavailable" };
  }
  if (!res.ok) {
    console.warn(`[tts] ElevenLabs returned ${res.status}`);
    return { ok: false, status: res.status === 401 ? 503 : 502, error: res.status === 401 ? "not_configured" : "voice_unavailable" };
  }
  const audio = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "audio/mpeg";
  cache.set(key, { audio, contentType });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return { ok: true, audio, contentType, voiceId: config.voiceId, cached: false };
}
