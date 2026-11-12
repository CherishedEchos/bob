"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, Bell, Mic, MoreHorizontal, Pencil, PlusCircle, SendHorizontal, Square, Volume2, VolumeX, X } from "lucide-react";
import { useBob } from "@/lib/bob/provider";
import type { BobMessage, Chip } from "@/lib/bob/types";
import { useSpeechRecognition, stopSpeaking } from "@/lib/voice/use-speech";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { tasksDue, todaysPriorities } from "@/lib/derive";
import { cn, firstName } from "@/lib/utils";
import { PriorityCard } from "@/components/common/priority-card";
import { BobWordmark, OrgLogo } from "@/components/brand/logo";
import { Orb, OrbAvatar, type OrbState } from "./orb";
import { ActionCard, AssistantCard } from "./assistant-cards";

function greetingNow() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function AssistantView({ variant = "page", onClose }: { variant?: "page" | "panel"; onClose?: () => void }) {
  const { messages, thinking, ready, send, decide, newConversation, readAloud, setReadAloud } = useBob();
  const { data, org, user, can } = useStore();
  const ui = useUI();
  const router = useRouter();
  const [draft, setDraft] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [home, setHome] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const speech = useSpeechRecognition((text) => {
    setHome(false);
    void send(text, "voice");
  });
  const inConversation = !home && messages.length > 0;
  const orbState: OrbState = speech.listening ? "listening" : thinking ? "thinking" : "idle";
  const dueCount = tasksDue(data.tasks).length;
  const priorities = React.useMemo(() => todaysPriorities(data, { includeFinance: can("finance.read") }), [data, can]);
  const name = /^(owner|office|site team)$/i.test(user.name) ? "" : `, ${firstName(user.name)}`;

  // A request sent from anywhere (Today, Enquiries, a priority action) opens the conversation.
  React.useEffect(() => {
    if (thinking) setHome(false);
  }, [thinking]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && inConversation) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, thinking, speech.interim, inConversation]);

  const toggleMic = () => {
    if (speech.listening) speech.stop();
    else {
      stopSpeaking();
      speech.start();
    }
  };

  const ask = (text: string, via: "voice" | "text" = "text") => {
    setHome(false);
    void send(text, via);
  };

  const runChip = (chip: Chip) => {
    if (chip.kind === "send") {
      if (/\s$/.test(chip.text)) {
        setDraft(chip.text);
        inputRef.current?.focus();
      } else ask(chip.text);
    } else if (chip.kind === "link") {
      router.push(chip.href);
      onClose?.();
    } else if (chip.record === "job") ui.openJob(chip.id);
    else if (chip.record === "enquiry") ui.openEnquiry(chip.id);
    else if (chip.record === "customer") ui.openCustomer(chip.id);
    else {
      router.push(`/invoices?open=${chip.id}`);
      onClose?.();
    }
  };

  const submitText = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || thinking) return;
    ask(draft, "text");
    setDraft("");
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;

  const suggestions = [
    "What needs sorting today?",
    "How many enquiries have I had in the last month?",
    "Remind me to call Dave tomorrow",
    ...(can("finance.read") ? ["Who's not paid me?"] : []),
    ...(can("jobs.write") ? ["Add a new kitchen job for Sarah in Crawley for £12,000"] : []),
    ...(can("invoices.draft") ? ["Invoice Sophie £7,500 for the Copthorne job"] : []),
  ];

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", variant === "page" && "bg-app")}>
      {/* ------------------------------ Header ------------------------------ */}
      <header className="relative z-10 flex h-[68px] shrink-0 items-center justify-between gap-2 px-4 pt-[env(safe-area-inset-top)] lg:px-6">
        {inConversation ? (
          <button onClick={() => setHome(true)} className="flex items-center gap-2.5 rounded-full pr-2 text-left hover:bg-surface-2" aria-label="Back to Bob home">
            <BobWordmark org={variant === "page" ? org : undefined} />
          </button>
        ) : (
          <BobWordmark org={variant === "page" ? org : undefined} />
        )}
        <div className="relative flex items-center gap-1">
          {variant === "page" ? (
            <Link
              href="/tasks"
              aria-label={`Tasks${dueCount ? `, ${dueCount} due` : ""}`}
              className="relative grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-surface-3 lg:hidden"
            >
              <Bell className="size-6" />
              {dueCount ? <span className="absolute right-2.5 top-2.5 size-2.5 rounded-full bg-copper-500 ring-2 ring-background" /> : null}
            </Link>
          ) : null}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Bob options"
            aria-expanded={menuOpen}
            className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-surface-3"
          >
            <MoreHorizontal className="size-6" />
          </button>
          {variant === "panel" ? (
            <button onClick={onClose} aria-label="Close Bob" className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-surface-3">
              <X className="size-6" />
            </button>
          ) : (
            <span className="lg:hidden">
              <OrgLogo org={org} size={34} />
            </span>
          )}
          {menuOpen ? (
            <div className="absolute right-0 top-12 z-20 w-72 rounded-2xl bg-card p-1.5 shadow-2xl ring-1 ring-line">
              <MenuItem
                onClick={() => {
                  setReadAloud(!readAloud);
                  if (readAloud) stopSpeaking();
                  setMenuOpen(false);
                }}
              >
                {readAloud ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                {readAloud ? "Stop reading replies aloud" : "Read replies aloud"}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  speech.cancel();
                  stopSpeaking();
                  void newConversation();
                  setHome(true);
                  setMenuOpen(false);
                }}
              >
                <PlusCircle className="size-4" /> New conversation
              </MenuItem>
              <div className="px-3 pb-1.5 pt-2 text-[12.5px] leading-snug text-subtle">
                Engine: {data.mode.aiEngine === "claude" ? "Claude (live AI)" : "Bob rules engine (demo — no AI key configured)"}.
                Voice: {speech.supported ? "your browser's speech recognition" : "not available in this browser"}.
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {/* ------------------------------ Body ------------------------------ */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!inConversation ? (
          <div className="mx-auto max-w-xl px-4 pb-8">
            {/* Voice + text input sit right at the top, inside Bob's charcoal panel. */}
            <div className="theme-dark rounded-3xl bg-ink-850 px-4 pb-4 pt-3 shadow-lg">
              <div className="flex flex-col items-center">
                <button
                  onClick={toggleMic}
                  disabled={!speech.supported}
                  aria-label={speech.listening ? "Stop listening" : "Tap to talk to Bob"}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-300 disabled:cursor-default"
                >
                  <Orb state={orbState} size={variant === "panel" ? 120 : 140} />
                </button>
                <VoiceStatus listening={speech.listening} starting={speech.starting} thinking={thinking} interim={speech.interim} idleTitle="Hey, how can I help?" idleSub={`${greetingNow()}${name}`} />
              </div>
              <Composer
                dark
                inputRef={inputRef}
                draft={draft}
                setDraft={setDraft}
                onSubmit={submitText}
                thinking={thinking}
                listening={speech.listening}
                supported={speech.supported}
                onMic={toggleMic}
              />
              <SpeechHelp error={speech.error} supported={speech.supported} onClear={speech.clearError} dark />
            </div>

            {messages.length > 0 ? (
              <button onClick={() => setHome(false)} className="mt-3 h-11 w-full rounded-2xl text-[15px] font-medium text-accent-fg hover:bg-surface-3">
                Continue our conversation
              </button>
            ) : null}

            {priorities.length ? (
              <section className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[14px] font-semibold uppercase tracking-wider text-subtle">Sort these first</h2>
                  <button onClick={() => ask("What needs sorting today?")} className="h-10 px-1 text-[15px] font-medium text-accent-fg">
                    Ask Bob
                  </button>
                </div>
                <div className="space-y-2.5">
                  {priorities.slice(0, 3).map((p) => (
                    <PriorityCard key={p.key} item={p} onAskBob={ask} onNavigate={onClose} />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mt-6">
              <h2 className="mb-2 text-[14px] font-semibold uppercase tracking-wider text-subtle">Try saying</h2>
              <div className="flex flex-wrap gap-2">
                {suggestions.slice(0, variant === "panel" ? 4 : 5).map((x) => (
                  <button
                    key={x}
                    onClick={() => ask(x)}
                    className="min-h-11 rounded-full bg-card px-4 py-2 text-left text-[15px] text-foreground ring-1 ring-line-strong transition hover:ring-copper-500/60"
                  >
                    “{x}”
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 px-4 pb-6 pt-2 lg:px-6" aria-live="polite">
            {!ready ? <p className="text-center text-[14px] text-subtle">Loading conversation…</p> : null}
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                showChips={m.id === lastAssistantId && !thinking}
                canEdit={m.id === lastUserId && !thinking}
                onEdit={() => {
                  setDraft(m.text);
                  setTimeout(() => inputRef.current?.focus(), 30);
                }}
                onChip={runChip}
                onDecide={(d, edits) => (m.action ? decide(m.action.id, d, edits) : Promise.resolve(null))}
                onNavigate={onClose}
              />
            ))}
            {speech.listening ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-ink-800 px-4 py-3 text-[16px] text-white/85">
                  <span className="mr-2 inline-block size-2.5 animate-pulse rounded-full bg-red-500 align-middle" />
                  {speech.interim || "Listening…"}
                </div>
              </div>
            ) : null}
            {thinking ? (
              <div className="flex items-center gap-3" role="status">
                <OrbAvatar />
                <div className="flex items-center gap-2 rounded-3xl bg-card px-4 py-3 text-[15px] text-muted-foreground ring-1 ring-line">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-2 animate-pulse rounded-full bg-copper-500" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                  Bob is working on it…
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ------------------------------ Composer (in conversation) ------------------------------ */}
      {inConversation ? (
        <div className="shrink-0 border-t border-line bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 lg:px-6">
          <div className="mx-auto max-w-2xl">
            {speech.listening || speech.starting || thinking ? (
              <div role="status" className={cn("mb-2 flex items-center justify-center gap-2 rounded-full py-2 text-[15px] font-medium", speech.listening ? "bg-red-500/10 text-danger-fg" : "bg-copper-500/10 text-accent-fg")}>
                <span className={cn("size-2.5 rounded-full", speech.listening ? "animate-pulse bg-red-500" : "animate-pulse bg-copper-500")} />
                {speech.listening ? "Listening — tap the mic again to stop" : speech.starting ? "Starting the microphone…" : "Bob is working on it…"}
              </div>
            ) : null}
            <SpeechHelp error={speech.error} supported={speech.supported} onClear={speech.clearError} />
            <Composer
              inputRef={inputRef}
              draft={draft}
              setDraft={setDraft}
              onSubmit={submitText}
              thinking={thinking}
              listening={speech.listening}
              supported={speech.supported}
              onMic={toggleMic}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VoiceStatus({ listening, starting, thinking, interim, idleTitle, idleSub }: { listening: boolean; starting: boolean; thinking: boolean; interim: string; idleTitle: string; idleSub: string }) {
  return (
    <div className="min-h-[76px] px-2 pb-3 text-center" aria-live="polite">
      {starting ? (
        <>
          <p className="text-[22px] font-semibold tracking-tight">Starting the microphone…</p>
          <p className="mt-1 text-[16px] text-white/70">Allow microphone access if your phone asks.</p>
        </>
      ) : listening ? (
        <>
          <p className="flex items-center justify-center gap-2 text-[22px] font-semibold tracking-tight">
            <span className="size-3 animate-pulse rounded-full bg-red-500" /> Listening…
          </p>
          <p className="mt-1 text-[17px] text-white/85">{interim || "Go ahead — tap the orb or mic to stop."}</p>
        </>
      ) : thinking ? (
        <>
          <p className="text-[22px] font-semibold tracking-tight">Working on it…</p>
          <p className="mt-1 text-[16px] text-white/70">Checking your records</p>
        </>
      ) : (
        <>
          <p className="text-[16px] text-white/70">{idleSub}</p>
          <h1 className="mt-0.5 text-[25px] font-semibold tracking-tight">{idleTitle}</h1>
        </>
      )}
    </div>
  );
}

function Composer({
  dark,
  inputRef,
  draft,
  setDraft,
  onSubmit,
  thinking,
  listening,
  supported,
  onMic,
}: {
  dark?: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  thinking: boolean;
  listening: boolean;
  supported: boolean;
  onMic: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <textarea
        ref={inputRef}
        value={draft}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={listening ? "Listening…" : "Type to Bob, or tap the mic"}
        aria-label="Message Bob"
        maxLength={2000}
        className={cn(
          "max-h-32 min-h-[52px] min-w-0 flex-1 resize-none rounded-3xl px-5 py-3.5 text-[17px] leading-6 outline-none focus:ring-2 focus:ring-copper-500/80",
          dark ? "bg-white/10 text-white ring-1 ring-white/15 placeholder:text-white/50" : "bg-card text-foreground ring-1 ring-line-strong placeholder:text-subtle",
        )}
      />
      {draft.trim() ? (
        <button
          type="submit"
          disabled={thinking}
          aria-label="Send"
          className="grid size-[52px] shrink-0 place-items-center rounded-full bg-primary text-white shadow-[0_4px_14px_-4px_rgb(226_112_31/0.7)] transition disabled:opacity-40"
        >
          <SendHorizontal className="size-6" />
        </button>
      ) : (
        <MicButton listening={listening} disabled={!supported} onClick={onMic} />
      )}
    </form>
  );
}

function SpeechHelp({ error, supported, onClear, dark }: { error: string | null; supported: boolean; onClear: () => void; dark?: boolean }) {
  if (error)
    return (
      <div role="alert" className={cn("mt-3 flex items-start gap-2 rounded-2xl px-4 py-3 text-[15px] ring-1", dark ? "bg-amber-400/15 text-amber-100 ring-amber-300/30" : "bg-amber-400/15 text-warn-fg ring-amber-500/30")}>
        <span className="flex-1">{error} Typing still works.</span>
        <button onClick={onClear} aria-label="Dismiss" className="grid size-8 place-items-center">
          <X className="size-4" />
        </button>
      </div>
    );
  if (!supported)
    return <p className={cn("mt-2 text-center text-[14px]", dark ? "text-white/60" : "text-subtle")}>Voice isn&apos;t available in this browser — typing works the same.</p>;
  return null;
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] hover:bg-surface-3" onClick={onClick}>
      {children}
    </button>
  );
}

function MicButton({ listening, onClick, disabled }: { listening: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={listening ? "Stop listening" : "Talk to Bob"}
      aria-pressed={listening}
      className="group relative grid size-[52px] shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-300 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
    >
      {listening ? <span className="absolute inset-0 animate-ping-slow rounded-full bg-copper-500/40" /> : null}
      <span
        className="absolute inset-0 rounded-full transition group-active:scale-95"
        style={{
          background: "radial-gradient(circle at 50% 35%, #f0873d, #b9521a 75%)",
          boxShadow: "0 0 0 1.5px rgb(255 190 140 / 0.6) inset, 0 0 22px rgb(236 122 46 / 0.6)",
        }}
      />
      {listening ? <Square className="relative size-5 fill-white text-white" /> : <Mic className="relative size-7 text-white" strokeWidth={1.9} />}
    </button>
  );
}

function MessageRow({
  message,
  showChips,
  canEdit,
  onEdit,
  onChip,
  onDecide,
  onNavigate,
}: {
  message: BobMessage;
  showChips: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onChip: (c: Chip) => void;
  onDecide: (d: "approve" | "cancel" | "undo", edits?: Record<string, string>) => Promise<unknown>;
  onNavigate?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex animate-fade-up flex-col items-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-ink-800 px-4 py-3 text-white">
          {message.via === "voice" ? (
            <div className="mb-1.5 flex items-center gap-1.5 text-[13px] text-copper-300">
              <AudioLines className="size-3.5" /> You said
            </div>
          ) : null}
          <p className="whitespace-pre-wrap text-[17px] leading-relaxed">{message.via === "voice" ? `“${message.text}”` : message.text}</p>
        </div>
        {canEdit ? (
          <button onClick={onEdit} className="mt-1 flex items-center gap-1 px-2 text-[13px] text-subtle hover:text-foreground">
            <Pencil className="size-3" /> {message.via === "voice" ? "Not what you said? Edit" : "Edit"}
          </button>
        ) : null}
      </div>
    );
  }
  const hasBubble = !!message.text || !!message.cards?.length;
  return (
    <div className="flex animate-fade-up items-start gap-3">
      <OrbAvatar className="mt-0.5" />
      <div className="min-w-0 max-w-[88%] flex-1">
        {hasBubble ? (
          <div className="inline-block max-w-full rounded-3xl rounded-tl-lg bg-card px-4 py-3 shadow-sm ring-1 ring-line">
            {message.text ? <p className="whitespace-pre-wrap text-[17px] leading-relaxed">{message.text}</p> : null}
            {message.cards?.map((c, i) => <AssistantCard key={i} card={c} onNavigate={onNavigate} />)}
          </div>
        ) : null}
        {message.action ? <ActionCard action={message.action} onDecide={onDecide} onNavigate={onNavigate} /> : null}
        {showChips && message.chips?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {message.chips.map((c, i) => (
              <button
                key={i}
                onClick={() => onChip(c)}
                className="rounded-full bg-surface-2 px-3.5 py-2 text-[14.5px] text-accent-fg ring-1 ring-copper-500/40 transition hover:bg-copper-500/12"
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
