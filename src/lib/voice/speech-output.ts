"use client";

/**
 * Bob's spoken replies.
 *
 * - Voice: the ElevenLabs voice (via the server's /api/tts — the API key
 *   never reaches the browser). If that isn't configured or fails, the
 *   browser's own voice is used instead. `lastVoice` records which one
 *   actually played, so the UI can show it.
 * - One reply plays at a time; starting another stops the first.
 * - While the microphone is recording, replies are held and played once
 *   recording ends; starting a recording stops any playback.
 * - iOS Safari only allows audio after a user gesture. `prime()` is called
 *   from taps (Tap to talk, Send, Read aloud) and unlocks both the shared
 *   <audio> element and speech synthesis; if playback is still blocked,
 *   `blocked` is set and the reply stays on screen with its Read aloud button.
 */
import * as React from "react";
import type { BobMessage } from "@/lib/bob/types";

export type VoiceEngine = "elevenlabs" | "browser";

interface State {
  speakingId: string | null;
  /** Fetching the ElevenLabs audio for this reply. */
  loadingId: string | null;
  blocked: boolean;
  /** Which voice the most recent reply played with. */
  lastVoice: { id: string; engine: VoiceEngine } | null;
  /** Why ElevenLabs wasn't used last time (shown next to the fallback label). */
  fallbackReason: string | null;
}

let state: State = { speakingId: null, loadingId: null, blocked: false, lastVoice: null, fallbackReason: null };
const listeners = new Set<() => void>();
let recording = false;
let pending: { id: string; text: string } | null = null;
let primed = false;
let audioEl: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let fetchCtl: AbortController | null = null;
let token = 0;
// After "not configured", don't ask the server again for a while.
let elevenOffUntil = 0;

// A tiny silent WAV, used to unlock the shared <audio> element on iOS.
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function synthSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}
function audioSupported(): boolean {
  return typeof window !== "undefined" && typeof Audio !== "undefined" && typeof fetch !== "undefined";
}

export function speechOutputSupported(): boolean {
  return synthSupported() || audioSupported();
}

function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
    audioEl.setAttribute("playsinline", "");
  }
  return audioEl;
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  return voices.find((v) => norm(v.lang) === "en-gb" && v.localService) ?? voices.find((v) => norm(v.lang) === "en-gb") ?? undefined;
}

/** Call from a tap so later automatic playback is allowed (iOS Safari). */
export function prime() {
  if (primed) return;
  primed = true;
  try {
    if (audioSupported()) {
      const a = getAudio();
      a.src = SILENCE;
      void a.play().catch(() => {});
    }
    if (synthSupported()) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* ignore */
  }
}

function playBrowser(id: string, text: string, my: number) {
  if (!synthSupported()) {
    set({ speakingId: null, loadingId: null });
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-GB";
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.rate = 1.02;
  u.onstart = () => {
    if (my === token) set({ speakingId: id, loadingId: null, blocked: false, lastVoice: { id, engine: "browser" } });
  };
  u.onend = () => {
    if (state.speakingId === id) set({ speakingId: null });
  };
  u.onerror = (e) => {
    const err = (e as SpeechSynthesisErrorEvent).error;
    set({ speakingId: state.speakingId === id ? null : state.speakingId, loadingId: null, blocked: err === "not-allowed" ? true : state.blocked });
  };
  set({ speakingId: id, loadingId: null });
  // Safari can drop an utterance queued in the same tick as cancel().
  setTimeout(() => {
    if (my === token) synth.speak(u);
  }, 60);
}

async function playEleven(id: string, text: string, my: number): Promise<boolean> {
  fetchCtl = new AbortController();
  let res: Response;
  try {
    res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      credentials: "same-origin",
      signal: fetchCtl.signal,
    });
  } catch {
    if (my === token) set({ fallbackReason: "Couldn't reach the voice service" });
    return my !== token; // aborted (superseded) counts as handled; otherwise fall back
  }
  if (my !== token) return true;
  if (!res.ok) {
    if (res.status === 503) elevenOffUntil = Date.now() + 5 * 60 * 1000;
    const j = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
    set({ fallbackReason: j?.reason ?? (j?.error === "not_configured" ? "ElevenLabs isn't set up" : `Voice service error ${res.status}`) });
    return false;
  }
  const blob = await res.blob();
  if (my !== token) return true;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(blob);
  const a = getAudio();
  a.onended = () => {
    if (state.speakingId === id) set({ speakingId: null });
  };
  a.onerror = () => {
    // Audio couldn't be decoded/played: say it with the device voice instead.
    if (my === token && state.speakingId === id) playBrowser(id, text, my);
  };
  a.src = audioUrl;
  try {
    await a.play();
  } catch (e) {
    if (my !== token) return true;
    // Autoplay blocked: the reply stays on screen with Read aloud.
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      set({ speakingId: null, loadingId: null, blocked: true });
      return true;
    }
    return false;
  }
  if (my === token) set({ speakingId: id, loadingId: null, blocked: false, lastVoice: { id, engine: "elevenlabs" }, fallbackReason: null });
  return true;
}

function halt() {
  token++;
  fetchCtl?.abort();
  fetchCtl = null;
  if (audioEl) {
    audioEl.pause();
    audioEl.onended = null;
  }
  if (synthSupported()) window.speechSynthesis.cancel();
}

function play(id: string, text: string) {
  halt();
  const my = token;
  if (audioSupported() && Date.now() > elevenOffUntil) {
    set({ speakingId: id, loadingId: id });
    void playEleven(id, text, my).then((handled) => {
      if (!handled && my === token) playBrowser(id, text, my);
    });
    return;
  }
  playBrowser(id, text, my);
}

/** Speak a reply now, or as soon as recording ends. */
export function speakReply(id: string, text: string) {
  if (!speechOutputSupported() || !text.trim()) return;
  if (recording) {
    pending = { id, text };
    return;
  }
  play(id, text);
}

export function stopSpeaking() {
  pending = null;
  halt();
  if (state.speakingId || state.loadingId) set({ speakingId: null, loadingId: null });
}

/** Drop a held reply (a newer request has been sent). */
export function clearPendingReply() {
  pending = null;
}

export function setRecording(active: boolean) {
  recording = active;
  if (active) {
    // Playback stops the moment a new recording starts.
    const held = pending;
    stopSpeaking();
    pending = held;
    return;
  }
  if (pending) {
    const p = pending;
    pending = null;
    play(p.id, p.text);
  }
}

export function useSpeechOutput(): State & { supported: boolean } {
  const snap = React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => setSupported(speechOutputSupported()), []);
  return { ...snap, supported };
}

/* ------------------------------ What Bob says ------------------------------ */

const firstName = (s: string) => s.replace(/<.*>/, "").trim().split(/\s+/)[0] ?? "";

function shorten(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > max && out) break;
    out += s;
  }
  return out.trim() || clean.slice(0, max);
}

/**
 * A short spoken version of Bob's reply. For actions, a brief confirmation
 * of what was prepared — the full draft stays on screen to review and edit.
 */
export function spokenSummary(replies: BobMessage[], request?: string): string {
  const assistant = replies.filter((m) => m.role === "assistant");
  const action = assistant.find((m) => m.action)?.action;
  if (action) {
    if (action.status === "pending") {
      if (action.tool === "save_email_draft" || action.tool === "send_email") {
        const to = action.lines.find((l) => l.label === "To")?.value ?? "";
        const asking = request?.match(/\bask(?:ing)?\s+(?:(?:her|him|them)\s+)?for\s+([^.,;!?]+)/i)?.[1]?.trim();
        return `I've drafted a reply${to ? ` to ${firstName(to)}` : ""}${asking ? ` asking for ${asking}` : ""}. It's ready to review.`;
      }
      return `I've prepared the ${action.title.toLowerCase()}. It's ready for you to review.`;
    }
    if (action.status === "executed" && action.resultMessage) return shorten(action.resultMessage);
    if (action.error) return shorten(action.error);
  }
  return shorten(assistant.map((m) => m.text).filter(Boolean).join(" "));
}
