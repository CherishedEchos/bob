import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE_ID, synthesize, ttsStatus } from "@/server/tts/elevenlabs";

const KEY = "sk_test_secret_key_123";
const audioRes = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });

describe("ElevenLabs text-to-speech", () => {
  it("is off without a key, so the app falls back to the browser voice", async () => {
    expect(ttsStatus({})).toEqual({ configured: false });
    const r = await synthesize("Hello", { env: {} });
    expect(r).toMatchObject({ ok: false, status: 503, error: "not_configured" });
  });

  it("uses the default voice, sends the key only in the xi-api-key header, and never exposes it", async () => {
    const fetchImpl = vi.fn(async () => audioRes());
    const r = await synthesize("5 people are waiting for a reply.", { env: { ELEVENLABS_API_KEY: KEY }, fetchImpl });
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/v1/text-to-speech/${DEFAULT_VOICE_ID}`);
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    expect(String(init.body)).not.toContain(KEY);
    expect(JSON.stringify(ttsStatus({ ELEVENLABS_API_KEY: KEY }))).not.toContain(KEY);
  });

  it("switches voice when ELEVENLABS_VOICE_ID changes", async () => {
    const fetchImpl = vi.fn(async () => audioRes());
    await synthesize("Switch voice test", { env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: "cockneyVoice42" }, fetchImpl });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain("/v1/text-to-speech/cockneyVoice42");
  });

  it("caches a replayed reply instead of paying for it twice", async () => {
    const fetchImpl = vi.fn(async () => audioRes());
    const env = { ELEVENLABS_API_KEY: KEY };
    await synthesize("Cache me please", { env, fetchImpl });
    const second = await synthesize("Cache me please", { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.ok && second.cached).toBe(true);
  });

  it("rejects empty or over-long text and keeps errors free of secrets", async () => {
    const env = { ELEVENLABS_API_KEY: KEY };
    expect(await synthesize("   ", { env })).toMatchObject({ ok: false, status: 400 });
    expect(await synthesize("x".repeat(601), { env })).toMatchObject({ ok: false, status: 413 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = await synthesize("Bad key", { env, fetchImpl: vi.fn(async () => new Response("nope", { status: 401 })) });
    expect(bad).toMatchObject({ ok: false, status: 503, error: "not_configured" });
    const failed = await synthesize("Network down", { env, fetchImpl: vi.fn(async () => { throw new Error(`boom ${KEY}`); }) });
    expect(failed).toMatchObject({ ok: false, status: 502 });
    expect(warn.mock.calls.flat().join(" ")).not.toContain(KEY);
    warn.mockRestore();
  });
});
