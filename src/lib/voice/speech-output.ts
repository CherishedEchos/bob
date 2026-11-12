"use client";

/**
 * Bob's spoken replies (browser speechSynthesis).
 *
 * - One reply plays at a time; starting another stops the first.
 * - While the microphone is recording, replies are held and played once
 *   recording ends; starting a recording stops any playback.
 * - Prefers a UK English voice, otherwise the device default.
 * - iOS Safari only allows speech after a user gesture. `prime()` is called
 *   from taps (Tap to talk, Send) so a later automatic reply can play; if the
 *   browser still blocks it, `blocked` is set and the reply stays on screen
 *   with its Read aloud button.
 */
import * as React from "react";
import type { BobMessage } from "@/lib/bob/types";

interface State {
  speakingId: string | null;
  blocked: boolean;
}

let state: State = { speakingId: null, blocked: false };
const listeners = new Set<() => void>();
let recording = false;
let pending: { id: string; text: string } | null = null;
let primed = false;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  return voices.find((v) => norm(v.lang) === "en-gb" && v.localService) ?? voices.find((v) => norm(v.lang) === "en-gb") ?? undefined;
}

/** Call from a tap so later automatic speech is allowed (iOS Safari). */
export function prime() {
  if (!speechOutputSupported() || primed) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
    primed = true;
  } catch {
    /* ignore */
  }
}

function play(id: string, text: string) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-GB";
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.rate = 1.02;
  u.onstart = () => set({ speakingId: id, blocked: false });
  u.onend = () => {
    if (state.speakingId === id) set({ speakingId: null });
  };
  u.onerror = (e) => {
    const err = (e as SpeechSynthesisErrorEvent).error;
    set({ speakingId: state.speakingId === id ? null : state.speakingId, blocked: err === "not-allowed" ? true : state.blocked });
  };
  set({ speakingId: id });
  // Safari can drop an utterance queued in the same tick as cancel().
  setTimeout(() => synth.speak(u), 60);
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
  if (speechOutputSupported()) window.speechSynthesis.cancel();
  if (state.speakingId) set({ speakingId: null });
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
