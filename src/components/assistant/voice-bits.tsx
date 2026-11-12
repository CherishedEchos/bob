"use client";

import { Square, Volume2, VolumeX } from "lucide-react";
import { useBob } from "@/lib/bob/provider";
import type { BobMessage } from "@/lib/bob/types";
import type { ComposerNotice, ComposerPhase } from "@/lib/voice/use-voice-composer";
import { prime, speakReply, spokenSummary, stopSpeaking, useSpeechOutput } from "@/lib/voice/speech-output";
import { cn } from "@/lib/utils";

/** One line under the mic button that says exactly what's happening. */
export function ComposerStatus({
  phase,
  interim,
  error,
  notice,
  supported,
  dark,
}: {
  phase: ComposerPhase;
  interim: string;
  error: string | null;
  notice: ComposerNotice;
  supported: boolean;
  dark?: boolean;
}) {
  let body: React.ReactNode = null;
  let tone: "muted" | "live" | "warn" = "muted";
  if (phase === "starting") body = "Allow the microphone if your phone asks.";
  else if (phase === "listening") {
    tone = "live";
    body = interim ? (
      <>
        <span className="opacity-60">Hearing: </span>“{interim}”
      </>
    ) : (
      "Speak now. Pause when you're done and I'll send it — or tap Stop to check it first."
    );
  } else if (phase === "stopping") body = "Getting the last of what you said…";
  else if (phase === "sending") {
    tone = "live";
    body = "Sending to Bob…";
  } else if (error) {
    tone = "warn";
    body = `${error} Typing still works.`;
  } else if (notice) {
    tone = notice.tone === "error" ? "warn" : "muted";
    body = notice.text;
  } else if (!supported) body = "Voice isn't available in this browser. Typing works the same.";
  if (!body) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "mt-2 px-0.5 text-[14px] leading-snug",
        tone === "live" && (dark ? "text-white" : "text-foreground"),
        tone === "muted" && (dark ? "text-white/70" : "text-muted-foreground"),
        tone === "warn" && "text-warn-fg",
      )}
    >
      {body}
    </p>
  );
}

/** "Speak replies to voice requests" — typed requests always stay silent. */
export function SpeakRepliesToggle({ className, withLabel = true }: { className?: string; withLabel?: boolean }) {
  const { speakReplies, setSpeakReplies } = useBob();
  const out = useSpeechOutput();
  if (!out.supported) return null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={speakReplies}
      aria-label="Speak replies to voice requests"
      title="Speak replies to voice requests"
      onClick={() => {
        if (!speakReplies) prime();
        setSpeakReplies(!speakReplies);
      }}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium ring-1 transition",
        speakReplies ? "bg-copper-500/12 text-accent-fg ring-copper-500/40" : "text-muted-foreground ring-line-strong hover:text-foreground",
        className,
      )}
    >
      {speakReplies ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
      {withLabel ? <span>{speakReplies ? "Speak replies: on" : "Speak replies: off"}</span> : null}
    </button>
  );
}

/** Read aloud / Stop speaking for one of Bob's replies. */
export function ReadAloudButton({ message, request }: { message: BobMessage; request?: string }) {
  const out = useSpeechOutput();
  if (!out.supported) return null;
  const speaking = out.speakingId === message.id;
  const text = spokenSummary([message], request);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (speaking) stopSpeaking();
        else {
          prime();
          speakReply(message.id, text);
        }
      }}
      className={cn(
        "mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13.5px] font-medium transition",
        speaking ? "bg-copper-500/12 text-accent-fg" : "text-subtle hover:text-foreground",
      )}
    >
      {speaking ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
      {speaking ? "Stop speaking" : "Read aloud"}
    </button>
  );
}
