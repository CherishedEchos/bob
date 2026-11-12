"use client";

/**
 * The one input flow behind Today's Ask Bob panel and the Ask Bob page.
 * Spoken and typed input go through the same `send` request.
 *
 *  - Pause after speaking → the browser ends recording → auto-send.
 *    "Sending to Bob…" shows while it's in flight.
 *  - Stop before auto-send → recording ends, final results are collected and
 *    the transcript lands in the editable input. Bob waits for Send to Bob.
 *  - Stop once auto-send has begun → nothing happens (no duplicate send).
 *  - A failed send keeps the text in the input for a retry; it is cleared
 *    only after a successful send or an explicit Discard.
 */
import * as React from "react";
import { useBob, type SendResult } from "@/lib/bob/provider";
import { useSpeechRecognition } from "./use-speech";
import { clearPendingReply, prime, stopSpeaking } from "./speech-output";

export type ComposerPhase = "idle" | "starting" | "listening" | "stopping" | "sending";
export type ComposerNotice = { tone: "hint" | "error"; text: string } | null;

export function useVoiceComposer(opts: { onSent?: (via: "voice" | "text") => void; inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null> } = {}) {
  const { send } = useBob();
  const [draft, setDraftState] = React.useState("");
  const [fromVoice, setFromVoice] = React.useState(false);
  const [notice, setNotice] = React.useState<ComposerNotice>(null);
  const [sending, setSending] = React.useState(false);
  const sendingRef = React.useRef(false);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const submitText = React.useCallback(
    async (text: string, via: "voice" | "text"): Promise<SendResult> => {
      const trimmed = text.trim();
      if (!trimmed) return "failed";
      if (sendingRef.current) return "busy";
      sendingRef.current = true;
      setSending(true);
      setNotice(null);
      clearPendingReply();
      const result = await send(trimmed, via);
      sendingRef.current = false;
      setSending(false);
      if (result === "ok") {
        setDraftState("");
        setFromVoice(false);
        optsRef.current.onSent?.(via);
      } else {
        // Keep exactly what was sent so it can be retried.
        setDraftState(trimmed);
        setFromVoice(via === "voice");
        setNotice(
          result === "busy"
            ? { tone: "hint", text: "Bob is still answering your last message. Send this when he's done." }
            : { tone: "error", text: "Couldn't reach Bob. Your words are still here — tap Send to Bob to try again." },
        );
      }
      return result;
    },
    [send],
  );

  const speech = useSpeechRecognition({
    onAutoSend: (text) => {
      setDraftState(text);
      setFromVoice(true);
      void submitText(text, "voice");
    },
    onManualStop: (text) => {
      if (!text) {
        setNotice({ tone: "hint", text: "I didn't catch anything. Tap to talk and try again, or type instead." });
        return;
      }
      setDraftState(text);
      setFromVoice(true);
      setNotice({ tone: "hint", text: "Check what I heard, edit if you need to, then tap Send to Bob." });
      setTimeout(() => optsRef.current.inputRef?.current?.focus(), 50);
    },
  });

  const setDraft = React.useCallback((v: string) => {
    setDraftState(v);
    if (!v.trim()) setFromVoice(false);
  }, []);

  const submit = React.useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!draft.trim() || sendingRef.current || speech.phase !== "idle") return;
      prime(); // a tap: allows the spoken reply on iOS Safari
      void submitText(draft, fromVoice ? "voice" : "text");
    },
    [draft, fromVoice, speech.phase, submitText],
  );

  /** Send a fixed prompt (example chips, priority actions). */
  const ask = React.useCallback((text: string) => void submitText(text, "text"), [submitText]);

  const discard = React.useCallback(() => {
    setDraftState("");
    setFromVoice(false);
    setNotice(null);
  }, []);

  const toggleMic = React.useCallback(() => {
    if (speech.phase === "listening" || speech.phase === "starting") return speech.stop();
    if (speech.phase === "stopping" || sendingRef.current) return;
    prime();
    stopSpeaking();
    setNotice(null);
    speech.start();
  }, [speech]);

  const phase: ComposerPhase = sending ? "sending" : speech.phase;
  return { draft, setDraft, fromVoice, notice, setNotice, phase, sending, speech, submit, ask, discard, toggleMic };
}
