"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarPlus,
  ChevronLeft,
  Keyboard,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Phone,
  ReceiptText,
  SendHorizontal,
  Square,
  Volume2,
  VolumeX,
  X,
  Trash2,
  AudioLines,
} from "lucide-react";
import { useAssistant } from "@/lib/assistant/provider";
import type { AssistantMessage, Chip } from "@/lib/assistant/types";
import { useSpeechRecognition, stopSpeaking } from "@/lib/voice/use-speech";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { remindersDue } from "@/lib/derive";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { Orb, OrbAvatar, WaveLine, type OrbState } from "./orb";
import { AssistantCard, ConfirmCard } from "./assistant-cards";

const QUICK_ACTIONS = [
  { label: "What needs my attention today?", text: "What needs my attention today?", icon: MessageCircle },
  { label: "Add a new job", text: "Add a new job", icon: CalendarPlus },
  { label: "Record a payment", text: "Record a payment", icon: ReceiptText },
  { label: "Follow up on enquiries", text: "Follow up on enquiries", icon: Phone },
];

export function AssistantView({ variant = "page", onClose }: { variant?: "page" | "panel"; onClose?: () => void }) {
  const { messages, thinking, send, propose, confirm, cancel, reset, readAloud, setReadAloud } = useAssistant();
  const { data } = useStore();
  const ui = useUI();
  const router = useRouter();
  const [mode, setMode] = React.useState<"voice" | "text">("voice");
  const [draft, setDraft] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const speech = useSpeechRecognition((text) => void send(text, "voice"));
  const inConversation = messages.length > 0;
  const orbState: OrbState = speech.listening ? "listening" : thinking ? "thinking" : "idle";
  const dueCount = remindersDue(data.reminders).length;

  // Desktop / panel defaults to typing; phones default to voice when available.
  React.useEffect(() => {
    if (variant === "panel" || window.matchMedia("(min-width: 1024px)").matches) setMode("text");
  }, [variant]);

  React.useEffect(() => {
    if (speech.error) setMode("text");
  }, [speech.error]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, thinking, speech.interim]);

  const toggleMic = () => {
    if (speech.listening) speech.stop();
    else {
      stopSpeaking();
      speech.start();
    }
  };

  const runChip = (chip: Chip) => {
    if (chip.kind === "send") void send(chip.text);
    else if (chip.kind === "link") {
      router.push(chip.href);
      onClose?.();
    } else if (chip.kind === "propose") propose(chip.action, chip.label);
    else ui.openForm(chip.prefill);
  };

  const submitText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || thinking) return;
    void send(draft, "text");
    setDraft("");
  };

  const endConversation = () => {
    speech.cancel();
    stopSpeaking();
    reset();
    setMenuOpen(false);
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", variant === "page" && "bg-app")}>
      {/* ------------------------------ Header ------------------------------ */}
      <header className="relative z-10 flex h-[72px] shrink-0 items-center justify-between px-4 pt-[env(safe-area-inset-top)] lg:px-6">
        <div className="w-11">
          {inConversation ? (
            <button
              onClick={endConversation}
              aria-label="Back to assistant home"
              className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06]"
            >
              <ChevronLeft className="size-6" />
            </button>
          ) : variant === "panel" ? (
            <button
              onClick={onClose}
              aria-label="Close assistant"
              className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06]"
            >
              <X className="size-6" />
            </button>
          ) : null}
        </div>
        <Logo size={variant === "panel" ? 36 : 44} className={cn(variant === "page" && "lg:hidden")} />
        {variant === "page" ? <div className="hidden text-lg font-semibold lg:block">Assistant</div> : null}
        <div className="relative flex w-11 justify-end">
          {inConversation || variant === "panel" ? (
            <>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Assistant options"
                aria-expanded={menuOpen}
                className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06]"
              >
                <MoreHorizontal className="size-6" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-12 z-20 w-60 rounded-2xl bg-ink-750 p-1.5 shadow-2xl ring-1 ring-white/10">
                  <button
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] hover:bg-white/[0.06]"
                    onClick={() => {
                      setReadAloud(!readAloud);
                      if (readAloud) stopSpeaking();
                      setMenuOpen(false);
                    }}
                  >
                    {readAloud ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                    {readAloud ? "Stop reading replies aloud" : "Read replies aloud"}
                  </button>
                  <button
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] hover:bg-white/[0.06] disabled:opacity-40"
                    onClick={endConversation}
                    disabled={!inConversation}
                  >
                    <Trash2 className="size-4" /> Clear conversation
                  </button>
                  {variant === "panel" ? (
                    <button
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] hover:bg-white/[0.06]"
                      onClick={() => {
                        setMenuOpen(false);
                        onClose?.();
                      }}
                    >
                      <X className="size-4" /> Close assistant
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <Link
              href="/reminders"
              aria-label={`Reminders${dueCount ? `, ${dueCount} due` : ""}`}
              className="relative grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06] lg:hidden"
            >
              <Bell className="size-6" />
              {dueCount ? <span className="absolute right-2.5 top-2.5 size-2.5 rounded-full bg-copper-500 ring-2 ring-background" /> : null}
            </Link>
          )}
        </div>
      </header>

      {/* ------------------------------ Body ------------------------------ */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!inConversation ? (
          <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center px-6 pb-6">
            <Orb state={orbState} size={variant === "panel" ? 170 : 220} className="mb-8 mt-4" />
            {speech.listening ? (
              <div className="min-h-[88px] text-center" aria-live="polite">
                <p className="text-[22px] font-semibold tracking-tight">Listening…</p>
                <p className="mt-2 text-[16px] text-foreground/80">{speech.interim || "Go ahead, I'm listening."}</p>
              </div>
            ) : (
              <h1 className="mb-7 text-center text-[28px] font-semibold tracking-tight">Hey, how can I help?</h1>
            )}
            {!speech.listening ? (
              <div className="w-full space-y-3">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q.label}
                    onClick={() => void send(q.text)}
                    className="flex h-[52px] w-full items-center gap-4 rounded-2xl bg-white/[0.04] px-5 text-left text-[15.5px] ring-1 ring-white/[0.12] transition hover:bg-white/[0.08] hover:ring-copper-500/40 active:scale-[0.99]"
                  >
                    <q.icon className="size-5 text-foreground/80" strokeWidth={1.7} />
                    {q.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 px-4 pb-6 pt-2 lg:px-6" aria-live="polite">
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                showChips={m.id === lastAssistantId && !thinking}
                onChip={runChip}
                onConfirm={() => confirm(m.id)}
                onCancel={() => cancel(m.id)}
                onNavigate={onClose}
              />
            ))}
            {speech.listening ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-ink-750 px-4 py-3 text-[15px] text-foreground/70 ring-1 ring-white/10">
                  <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-red-500 align-middle" />
                  {speech.interim || "Listening…"}
                </div>
              </div>
            ) : null}
            {thinking ? (
              <div className="flex items-center gap-3">
                <OrbAvatar />
                <div className="flex gap-1.5 rounded-3xl bg-white/[0.05] px-4 py-3.5 ring-1 ring-white/10">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-2 animate-pulse rounded-full bg-copper-300" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ------------------------------ Controls ------------------------------ */}
      <div className="shrink-0 px-4 pb-4 lg:px-6">
        {speech.error ? (
          <div role="alert" className="mx-auto mb-3 flex max-w-2xl items-start gap-2 rounded-2xl bg-amber-400/10 px-4 py-2.5 text-[13.5px] text-amber-100 ring-1 ring-amber-400/25">
            <span className="flex-1">{speech.error}</span>
            <button onClick={speech.clearError} aria-label="Dismiss" className="text-amber-200/80 hover:text-amber-100">
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        {mode === "voice" ? (
          <div className="mx-auto max-w-md">
            {inConversation ? <WaveLine active={speech.listening || thinking} className="-mb-1" /> : null}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center">
              <button
                onClick={() => {
                  speech.cancel();
                  setMode("text");
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                aria-label="Switch to typing"
                className="grid size-12 place-items-center justify-self-start rounded-full text-foreground/85 hover:bg-white/[0.06]"
              >
                <Keyboard className="size-6" />
              </button>
              <div className="flex flex-col items-center">
                <MicButton listening={speech.listening} onClick={toggleMic} />
                <span className="mt-2 flex h-5 items-center gap-1.5 text-[14px] text-copper-300">
                  {speech.listening ? (
                    <>
                      <span className="size-2 animate-pulse rounded-full bg-red-500" /> Listening — tap to stop
                    </>
                  ) : inConversation ? (
                    "Tap to speak"
                  ) : null}
                </span>
              </div>
              {inConversation ? (
                <button
                  onClick={endConversation}
                  aria-label="End conversation"
                  className="grid size-12 place-items-center justify-self-end rounded-full text-foreground/85 hover:bg-white/[0.06]"
                >
                  <X className="size-6" />
                </button>
              ) : (
                <span />
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={submitText} className="mx-auto flex max-w-2xl items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("voice");
                speech.clearError();
              }}
              aria-label="Switch to voice"
              className="grid size-12 shrink-0 place-items-center rounded-full bg-white/[0.05] text-copper-300 ring-1 ring-white/10 hover:bg-white/[0.09]"
            >
              <AudioLines className="size-5" />
            </button>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask or tell me something…"
              aria-label="Message the assistant"
              maxLength={2000}
              className="h-12 min-w-0 flex-1 rounded-full bg-white/[0.05] px-5 text-[15px] ring-1 ring-white/12 outline-none placeholder:text-subtle focus:ring-2 focus:ring-copper-500/70"
            />
            <button
              type="submit"
              disabled={!draft.trim() || thinking}
              aria-label="Send"
              className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-copper-400 to-copper-600 text-white shadow-[0_0_20px_rgb(236_122_46/0.45)] transition disabled:opacity-40 disabled:shadow-none"
            >
              <SendHorizontal className="size-5" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function MicButton({ listening, onClick }: { listening: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={listening ? "Stop listening" : "Start speaking"}
      aria-pressed={listening}
      className="group relative grid size-[88px] place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-300 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      {listening ? <span className="absolute inset-0 animate-ping-slow rounded-full bg-copper-500/40" /> : null}
      <span
        className="absolute inset-0 rounded-full transition group-active:scale-95"
        style={{
          background: "radial-gradient(circle at 50% 35%, #f0873d, #b9521a 75%)",
          boxShadow:
            "0 0 0 1.5px rgb(255 190 140 / 0.6) inset, 0 0 0 6px rgb(236 122 46 / 0.12), 0 0 34px rgb(236 122 46 / 0.65), 0 0 80px rgb(236 122 46 / 0.3)",
        }}
      />
      {listening ? (
        <Square className="relative size-7 fill-white text-white" />
      ) : (
        <Mic className="relative size-9 text-white" strokeWidth={1.8} />
      )}
    </button>
  );
}

function MessageRow({
  message,
  showChips,
  onChip,
  onConfirm,
  onCancel,
  onNavigate,
}: {
  message: AssistantMessage;
  showChips: boolean;
  onChip: (c: Chip) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onNavigate?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex animate-fade-up justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-ink-700/80 px-4 py-3 ring-1 ring-white/10">
          {message.via === "voice" ? (
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-copper-300">
              <AudioLines className="size-3.5" /> Voice
            </div>
          ) : null}
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
            {message.via === "voice" ? `“${message.text}”` : message.text}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex animate-fade-up items-start gap-3">
      <OrbAvatar className="mt-0.5" />
      <div className="min-w-0 max-w-[88%] flex-1">
        <div className="inline-block max-w-full rounded-3xl rounded-tl-lg bg-white/[0.05] px-4 py-3 ring-1 ring-white/10">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.text}</p>
          {message.cards?.map((c, i) => <AssistantCard key={i} card={c} onNavigate={onNavigate} />)}
          {message.proposal ? <ConfirmCard proposal={message.proposal} onConfirm={onConfirm} onCancel={onCancel} /> : null}
        </div>
        {showChips && message.chips?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {message.chips.map((c, i) => (
              <button
                key={i}
                onClick={() => onChip(c)}
                className="rounded-full bg-white/[0.04] px-3.5 py-2 text-[13.5px] text-copper-200 ring-1 ring-copper-500/40 transition hover:bg-copper-500/12"
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
