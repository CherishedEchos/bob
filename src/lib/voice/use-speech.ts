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
import { setRecording, speakReply, stopSpeaking } from "./speech-output";

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

export type VoicePhase = "idle" | "starting" | "listening" | "stopping";

export interface VoiceHandlers {
  /** The browser ended recording after a pause: send what was heard. */
  onAutoSend(text: string): void;
  /** The user tapped Stop: everything heard goes into the editable input. */
  onManualStop(text: string): void;
}

/**
 * One recording session at a time. Every callback checks its session id and a
 * "finished" flag, so late results from an old session can never clear a
 * draft or trigger a second send.
 */
export function useSpeechRecognition(handlers: VoiceHandlers) {
  const [supported, setSupported] = React.useState(false);
  const [phase, setPhase] = React.useState<VoicePhase>("idle");
  const [interim, setInterim] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const recRef = React.useRef<RecognitionLike | null>(null);
  const session = React.useRef(0);
  const done = React.useRef(true);
  const manual = React.useRef(false);
  const finalText = React.useRef("");
  const interimText = React.useRef("");
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;
  const phaseRef = React.useRef(phase);
  phaseRef.current = phase;

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  React.useEffect(() => {
    setSupported(!!getCtor());
    return () => {
      clearTimers();
      done.current = true;
      recRef.current?.abort();
      setRecording(false);
    };
  }, []);

  /** End the session exactly once and hand over the transcript. */
  const finish = React.useCallback((id: number) => {
    if (id !== session.current || done.current) return;
    done.current = true;
    clearTimers();
    const text = `${finalText.current} ${interimText.current}`.replace(/\s+/g, " ").trim();
    setPhase("idle");
    setInterim("");
    if (manual.current) handlersRef.current.onManualStop(text);
    else if (text) handlersRef.current.onAutoSend(text);
    setRecording(false);
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Voice isn't supported in this browser. Try Chrome, Edge or Safari — or type instead.");
      return;
    }
    clearTimers();
    done.current = true;
    recRef.current?.abort();
    const id = ++session.current;
    done.current = false;
    manual.current = false;
    finalText.current = "";
    interimText.current = "";
    setInterim("");
    setError(null);
    setRecording(true);

    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = false; // the browser ends the session after a pause → auto-send
    rec.maxAlternatives = 1;
    const live = () => id === session.current && !done.current;

    rec.onstart = () => {
      if (!live()) return;
      clearTimers();
      setPhase((p) => (p === "stopping" ? p : "listening"));
    };
    rec.onresult = (e) => {
      if (!live()) return;
      let fin = "";
      let tmp = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript;
        else tmp += r[0].transcript;
      }
      finalText.current = fin.trim() ? fin : finalText.current;
      interimText.current = tmp;
      setInterim(`${finalText.current} ${tmp}`.replace(/\s+/g, " ").trim());
    };
    rec.onerror = (e) => {
      if (!live()) return;
      if (e.error !== "aborted" && !(e.error === "no-speech" && manual.current)) setError(ERROR_TEXT[e.error] ?? "Voice stopped unexpectedly. Try again or type instead.");
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        manual.current = true; // nothing to send
        finalText.current = "";
        interimText.current = "";
      }
    };
    rec.onend = () => finish(id);
    recRef.current = rec;
    setPhase("starting");
    // Some browsers accept start() but never begin listening or report an error.
    timers.current.push(
      setTimeout(() => {
        if (!live() || phaseRef.current !== "starting") return;
        manual.current = true;
        rec.abort();
        setError("The microphone didn't start. Check this site is allowed to use the microphone, or type instead.");
        finish(id);
      }, 4000),
    );
    try {
      rec.start();
    } catch {
      manual.current = true;
      setError("Couldn't start the microphone. Try again.");
      finish(id);
    }
  }, [finish]);

  /** Manual Stop: cancel auto-send, collect the final results, fill the input. */
  const stop = React.useCallback(() => {
    const id = session.current;
    if (done.current) return; // already finished (e.g. auto-send has started)
    manual.current = true;
    setPhase("stopping");
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    // If the browser never reports the end, finish with what we have.
    timers.current.push(
      setTimeout(() => {
        if (id !== session.current || done.current) return;
        recRef.current?.abort();
        finish(id);
      }, 1500),
    );
  }, [finish]);

  /** Throw the recording away: nothing is sent or put in the input. */
  const cancel = React.useCallback(() => {
    clearTimers();
    done.current = true;
    recRef.current?.abort();
    setPhase("idle");
    setInterim("");
    setRecording(false);
  }, []);

  return {
    supported,
    phase,
    listening: phase === "listening",
    starting: phase === "starting",
    stopping: phase === "stopping",
    interim,
    error,
    clearError: () => setError(null),
    start,
    stop,
    cancel,
  };
}

/** Read text aloud (one at a time, UK voice preferred). */
export function speak(text: string, id = `say_${Date.now()}`) {
  speakReply(id, text);
}

export { stopSpeaking };
