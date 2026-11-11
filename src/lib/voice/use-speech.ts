"use client";

/**
 * Browser speech recognition (Web Speech API) + optional read-aloud.
 *
 * - Only starts after an explicit tap; the browser shows its own microphone
 *   permission prompt.
 * - In Chrome/Edge, recognition audio is processed by the browser vendor's
 *   cloud service. Before handling real customer data this should be swapped
 *   for a provider covered by a UK GDPR data processing agreement
 *   (see src/lib/integrations/types.ts → SpeechToTextProvider).
 * - Where the API isn't available (e.g. Firefox), `supported` is false and
 *   the UI falls back to typing. We never pretend to listen.
 */
import * as React from "react";

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser settings, or type instead.",
  "service-not-allowed": "Voice isn't allowed in this browser. You can type instead.",
  "no-speech": "I didn't catch anything. Tap the mic and try again.",
  "audio-capture": "No microphone found. You can type instead.",
  network: "Voice needs an internet connection. You can type instead.",
};

export function useSpeechRecognition(onFinal: (text: string) => void) {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const recRef = React.useRef<RecognitionLike | null>(null);
  const finalRef = React.useRef("");
  const onFinalRef = React.useRef(onFinal);
  onFinalRef.current = onFinal;

  React.useEffect(() => {
    setSupported(!!getCtor());
    return () => recRef.current?.abort();
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Voice isn't supported in this browser. Try Chrome, Edge or Safari — or type instead.");
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    finalRef.current = "";
    setInterim("");
    setError(null);

    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim((finalRef.current + " " + interimText).trim());
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted") setError(ERROR_TEXT[e.error] ?? "Voice stopped unexpectedly. Try again or type instead.");
    };
    rec.onend = () => {
      setListening(false);
      const text = finalRef.current.trim();
      setInterim("");
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setError("Couldn't start the microphone. Try again.");
    }
  }, []);

  const stop = React.useCallback(() => recRef.current?.stop(), []);
  const cancel = React.useCallback(() => {
    finalRef.current = "";
    recRef.current?.abort();
    setListening(false);
    setInterim("");
  }, []);

  return { supported, listening, interim, error, clearError: () => setError(null), start, stop, cancel };
}

/** Read replies aloud using on-device speech synthesis (off by default). */
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-GB";
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === "en-GB");
  if (voice) u.voice = voice;
  u.rate = 1.03;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
