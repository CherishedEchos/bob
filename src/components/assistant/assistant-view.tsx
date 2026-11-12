"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, CalendarDays, ChevronLeft, FileText, Keyboard, Loader2, MessageCircle, Mic, MoreHorizontal, Pencil, Phone, PlusCircle, SendHorizontal, Square, Volume2, VolumeX, X } from "lucide-react";
import { flushSync } from "react-dom";
import { useBob } from "@/lib/bob/provider";
import type { BobMessage, Chip } from "@/lib/bob/types";
import { stopSpeaking } from "@/lib/voice/speech-output";
import { useVoiceComposer, type ComposerPhase } from "@/lib/voice/use-voice-composer";
import { ComposerStatus, ReadAloudButton, SpeakRepliesToggle, useTtsStatus } from "./voice-bits";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { todaysPriorities } from "@/lib/derive";
import { cn, firstName } from "@/lib/utils";
import { PriorityCard } from "@/components/common/priority-card";
import { BobLogo, BobWordmark, OrgLogo } from "@/components/brand/logo";
import { Orb, OrbAvatar, type OrbState } from "./orb";
import { ActionCard, AssistantCard } from "./assistant-cards";

function greetingNow() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function AssistantView({ variant = "page", onClose }: { variant?: "page" | "panel"; onClose?: () => void }) {
  const { messages, thinking, ready, decide, newConversation, speakReplies, setSpeakReplies } = useBob();
  const { data, org, user, can } = useStore();
  const ui = useUI();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);
  // Opened as a panel (e.g. after asking from Today), show the conversation straight away.
  const [home, setHome] = React.useState(variant !== "panel");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const c = useVoiceComposer({ inputRef });
  const tts = useTtsStatus();
  const { speech, draft, setDraft, phase } = c;
  const inConversation = !home && messages.length > 0;
  const orbState: OrbState = speech.listening ? "listening" : thinking || phase === "sending" ? "thinking" : "idle";
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

  const toggleMic = c.toggleMic;

  const ask = (text: string) => {
    setHome(false);
    c.ask(text);
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
    setHome(false);
    c.submit();
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;

  const shortcuts: Shortcut[] = [
    { label: "What needs my attention today?", icon: MessageCircle, run: () => ask("What needs my attention today?") },
    ...(can("jobs.write") ? [{ label: "Add a new job", icon: CalendarDays, run: () => ui.openForm({ form: "job" }) }] : []),
    ...(can("payments.record") ? [{ label: "Record a payment", icon: FileText, run: () => ui.openForm({ form: "payment" }) }] : []),
    { label: "Follow up on enquiries", icon: Phone, run: () => ask("Follow up on enquiries") },
  ];

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
      {variant === "page" ? (
        <header className="relative z-10 grid h-16 shrink-0 grid-cols-[92px_minmax(0,1fr)_92px] items-center px-2 pt-[env(safe-area-inset-top)] lg:px-6">
          <Link href="/today" aria-label="Back to Today" className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-surface-3">
            <ChevronLeft className="size-7" strokeWidth={1.8} />
          </Link>
          <WorkspaceLockup org={org} />
          <div className="relative flex items-center justify-end gap-0.5">
            <SpeakRepliesToggle withLabel={false} />
            {inConversation ? (
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Bob options"
                aria-expanded={menuOpen}
                className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-surface-3"
              >
                <MoreHorizontal className="size-6" />
              </button>
            ) : null}
            {menuOpen ? (
              <div className="absolute right-0 top-12 z-20 w-72 raised rounded-2xl p-1.5">
                <MenuItem
                  onClick={() => {
                    setHome(true);
                    setMenuOpen(false);
                  }}
                >
                  <AudioLines className="size-4" /> Ask Bob home
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    speech.cancel();
                    c.discard();
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
                  Voice input: {speech.supported ? "your browser's speech recognition" : "not available in this browser"}.
                  <br />
                  Spoken replies: {tts?.configured ? `ElevenLabs (voice …${tts.voiceId?.slice(-4)})` : "this device's voice (ElevenLabs not set up)"}.
                </div>
              </div>
            ) : null}
          </div>
        </header>
      ) : (
      <header className="relative z-10 flex h-[68px] shrink-0 items-center justify-between gap-2 px-4 pt-[env(safe-area-inset-top)] lg:px-6">
        {inConversation ? (
          <button onClick={() => setHome(true)} className="flex items-center gap-2.5 rounded-full pr-2 text-left hover:bg-surface-2" aria-label="Back to Bob home">
            <BobWordmark />
          </button>
        ) : (
          <BobWordmark />
        )}
        <div className="relative flex items-center gap-1">
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
            <div className="absolute right-0 top-12 z-20 w-72 raised rounded-2xl p-1.5">
              <MenuItem
                onClick={() => {
                  setSpeakReplies(!speakReplies);
                  setMenuOpen(false);
                }}
              >
                {speakReplies ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                <span className="flex-1">Speak replies to voice requests</span>
                <span className={cn("rounded-md px-1.5 text-[12px] font-semibold", speakReplies ? "bg-copper-500/15 text-accent-fg" : "bg-surface-3 text-subtle")}>{speakReplies ? "On" : "Off"}</span>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  speech.cancel();
                  c.discard();
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
      )}

      {variant === "page" && !inConversation ? (
        <AskBobHome
          composer={c}
          inputRef={inputRef}
          orbState={orbState}
          thinking={thinking}
          shortcuts={shortcuts}
          hasConversation={messages.length > 0}
          onContinue={() => setHome(false)}
          onSubmit={submitText}
        />
      ) : (
      <>
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
                <VoiceStatus phase={phase} thinking={thinking} interim={speech.interim} idleTitle="Hey, how can I help?" idleSub={`${greetingNow()}${name}`} />
              </div>
              <Composer
                dark
                inputRef={inputRef}
                draft={draft}
                setDraft={setDraft}
                onSubmit={submitText}
                thinking={thinking}
                phase={phase}
                fromVoice={c.fromVoice}
                onDiscard={c.discard}
                supported={speech.supported}
                onMic={toggleMic}
              />
              <ComposerStatus dark phase={phase === "listening" || phase === "starting" ? "idle" : phase} interim="" error={speech.error} notice={c.notice} supported={speech.supported} />
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
            {messages.map((m, i) => (
              <MessageRow
                key={m.id}
                message={m}
                request={m.role === "assistant" ? [...messages.slice(0, i)].reverse().find((x) => x.role === "user")?.text : undefined}
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
            {speech.listening || phase === "stopping" ? (
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
            {phase !== "idle" || thinking ? (
              <div role="status" className={cn("mb-2 flex items-center justify-center gap-2 rounded-full px-3 py-2 text-center text-[15px] font-medium", speech.listening ? "bg-red-500/10 text-danger-fg" : "bg-copper-500/10 text-accent-fg")}>
                <span className={cn("size-2.5 shrink-0 rounded-full", speech.listening ? "animate-pulse bg-red-500" : "animate-pulse bg-copper-500")} />
                {phase === "listening"
                  ? "Listening — pause to send, or tap Stop to check it first"
                  : phase === "starting"
                    ? "Starting the microphone…"
                    : phase === "stopping"
                      ? "Getting the last of what you said…"
                      : phase === "sending"
                        ? "Sending to Bob…"
                        : "Bob is working on it…"}
              </div>
            ) : null}
            {phase === "idle" ? <ComposerStatus phase="idle" interim="" error={speech.error} notice={c.notice} supported={speech.supported} /> : null}
            <div className="mt-2">
              <Composer
                inputRef={inputRef}
                draft={draft}
                setDraft={setDraft}
                onSubmit={submitText}
                thinking={thinking}
                phase={phase}
                fromVoice={c.fromVoice}
                onDiscard={c.discard}
                supported={speech.supported}
                onMic={toggleMic}
              />
            </div>
          </div>
        </div>
      ) : null}
      </>
      )}
    </div>
  );
}

/* ------------------------------ Ask Bob home (page) ------------------------------ */

type Shortcut = { label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; run: () => void };

/** The workspace's own logo and name, "with bob." — works for any trades business. */
function WorkspaceLockup({ org }: { org: { name: string; shortName: string; logoUrl?: string; dataMode?: string } }) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-2.5">
      <OrgLogo org={org} size={40} />
      <div className="min-w-0 leading-none">
        <div className="truncate text-[17px] font-bold uppercase tracking-[0.04em]">{org.shortName}</div>
        <div className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground">
          with <BobLogo height={10} title="Bob" className="translate-y-[1px]" />
          {org.dataMode === "sample" ? (
            <span title="Demo mode — sample data, nothing is sent to real customers" className="ml-1 rounded bg-sky-400/12 px-1 py-[1px] text-[10.5px] font-semibold uppercase tracking-wide text-info-fg">
              Demo
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Orb size that keeps the orb, shortcuts and mic on one iPhone screen. */
function useOrbSize() {
  const [size, setSize] = React.useState(190);
  React.useEffect(() => {
    const calc = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      setSize(Math.round(Math.max(128, Math.min(224, h - 494))));
    };
    calc();
    window.addEventListener("resize", calc);
    window.visualViewport?.addEventListener("resize", calc);
    return () => {
      window.removeEventListener("resize", calc);
      window.visualViewport?.removeEventListener("resize", calc);
    };
  }, []);
  return size;
}

function AskBobHome({
  composer: c,
  inputRef,
  orbState,
  thinking,
  shortcuts,
  hasConversation,
  onContinue,
  onSubmit,
}: {
  composer: ReturnType<typeof useVoiceComposer>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  orbState: OrbState;
  thinking: boolean;
  shortcuts: Shortcut[];
  hasConversation: boolean;
  onContinue: () => void;
  onSubmit: (e?: React.FormEvent) => void;
}) {
  const { speech, phase } = c;
  const orbSize = useOrbSize();
  const [typing, setTyping] = React.useState(false);
  const recording = phase === "listening" || phase === "starting";
  const busy = phase === "stopping" || phase === "sending";
  const showComposer = typing || !!c.draft.trim();

  const openKeyboard = () => {
    // Render the input and focus it inside the same tap, or iOS won't raise the keyboard.
    flushSync(() => setTyping(true));
    inputRef.current?.focus();
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-4 pb-3 pt-1">
          <button
            type="button"
            onClick={c.toggleMic}
            disabled={!speech.supported || busy}
            aria-label={recording ? "Stop listening" : "Tap the orb to talk to Bob"}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-300 disabled:cursor-default"
          >
            <Orb tone="soft" state={orbState} size={orbSize} />
          </button>
          <div className="mt-2 min-h-[40px] w-full px-2 text-center" aria-live="polite">
            {phase === "listening" ? (
              <>
                <p className="flex items-center justify-center gap-2 text-[22px] font-semibold tracking-tight">
                  <span className="size-2.5 animate-pulse rounded-full bg-red-500" /> Listening…
                </p>
                <p className="mt-1 text-[16px] leading-snug text-white/85">{speech.interim ? `“${speech.interim}”` : "Pause when you're done and I'll send it — or tap Stop to check it first."}</p>
              </>
            ) : phase === "starting" ? (
              <p className="text-[22px] font-semibold tracking-tight">Starting the microphone…</p>
            ) : phase === "stopping" ? (
              <p className="text-[20px] font-semibold tracking-tight">Getting the last of what you said…</p>
            ) : phase === "sending" || thinking ? (
              <p className="text-[22px] font-semibold tracking-tight">Sending to Bob…</p>
            ) : (
              <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-[#FAF9F6] min-[400px]:text-[30px]">Hey, how can I help?</h1>
            )}
          </div>

          <ul className="mt-3 w-full space-y-2">
            {shortcuts.map((s) => (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={s.run}
                  disabled={busy || recording}
                  className="flex h-11 w-full items-center gap-4 rounded-xl bg-card px-4 text-left text-[16px] text-[#FAF9F6] shadow-[inset_0_1px_0_rgb(255_240_225/0.04)] ring-1 ring-line-strong transition hover:bg-raised active:scale-[0.99] active:bg-raised-hover disabled:opacity-40"
                >
                  <s.icon className="size-[22px] shrink-0 text-white/85" strokeWidth={1.6} />
                  <span className="truncate">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {hasConversation ? (
            <button onClick={onContinue} className="mt-2 h-10 text-[14.5px] font-medium text-accent-fg">
              Continue our conversation
            </button>
          ) : null}
        </div>
      </div>

      {/* Bottom controls: above Safari's toolbar and the keyboard (the shell follows the visible viewport). */}
      <div className="shrink-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto max-w-md">
          {showComposer ? (
            <>
              <ComposerStatus phase={recording ? "idle" : phase} interim="" error={speech.error} notice={c.notice} supported={speech.supported} />
              <div className="mt-2 flex items-end gap-2">
                {!c.draft.trim() && !recording ? (
                  <button
                    type="button"
                    onClick={() => setTyping(false)}
                    aria-label="Close keyboard"
                    className="grid size-[52px] shrink-0 place-items-center rounded-full text-white/80 ring-1 ring-white/15"
                  >
                    <X className="size-5" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  <Composer
                    inputRef={inputRef}
                    draft={c.draft}
                    setDraft={c.setDraft}
                    onSubmit={onSubmit}
                    thinking={thinking}
                    phase={phase}
                    fromVoice={c.fromVoice}
                    onDiscard={() => {
                      c.discard();
                      setTyping(false);
                    }}
                    supported={speech.supported}
                    onMic={c.toggleMic}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              {speech.error || c.notice ? <ComposerStatus phase="idle" interim="" error={speech.error} notice={c.notice} supported={speech.supported} /> : null}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center">
                <button
                  type="button"
                  onClick={openKeyboard}
                  disabled={busy}
                  aria-label="Type instead"
                  className="ml-2 grid size-12 place-items-center justify-self-start rounded-full text-white/85 hover:bg-surface-3 disabled:opacity-40"
                >
                  <Keyboard className="size-7" strokeWidth={1.6} />
                </button>
                <div className="flex flex-col items-center">
                  <BigMic phase={phase} disabled={!speech.supported || busy} onClick={c.toggleMic} />
                  <span className={cn("mt-1.5 text-[15px] font-medium", recording ? "text-red-200" : "text-accent-fg")}>
                    {phase === "listening" ? "Tap to stop" : phase === "starting" ? "Starting…" : phase === "stopping" ? "Finishing…" : phase === "sending" ? "Sending to Bob…" : "Tap to talk"}
                  </span>
                </div>
                <span />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** The big amber mic (Ask Bob home). */
function BigMic({ phase, disabled, onClick }: { phase: ComposerPhase; disabled?: boolean; onClick: () => void }) {
  const recording = phase === "listening" || phase === "starting";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={recording ? "Stop listening" : "Tap to talk"}
      aria-pressed={recording}
      className="relative grid size-[76px] place-items-center rounded-full transition active:scale-95 disabled:opacity-50"
      style={{
        background: "radial-gradient(circle at 50% 40%, #2a170b, #120a05 72%)",
        boxShadow: recording
          ? "0 0 0 3px rgb(255 120 90 / 0.95), 0 0 26px rgb(255 90 60 / 0.6)"
          : "0 0 0 3px rgb(255 150 70 / 0.95), 0 0 22px rgb(255 130 40 / 0.65), 0 0 50px rgb(236 122 46 / 0.25)",
      }}
    >
      {phase === "listening" ? <span className="absolute inset-0 animate-ping-slow rounded-full ring-2 ring-red-400/60" /> : null}
      {phase === "sending" || phase === "stopping" ? (
        <Loader2 className="size-7 animate-spin text-white" />
      ) : recording ? (
        <Square className="size-6 fill-white text-white" />
      ) : (
        <Mic className="size-9 text-white" strokeWidth={1.8} />
      )}
    </button>
  );
}

function VoiceStatus({ phase, thinking, interim, idleTitle, idleSub }: { phase: ComposerPhase; thinking: boolean; interim: string; idleTitle: string; idleSub: string }) {
  return (
    <div className="min-h-[76px] px-2 pb-3 text-center" aria-live="polite">
      {phase === "starting" ? (
        <>
          <p className="text-[22px] font-semibold tracking-tight">Starting the microphone…</p>
          <p className="mt-1 text-[16px] text-white/70">Allow microphone access if your phone asks.</p>
        </>
      ) : phase === "listening" ? (
        <>
          <p className="flex items-center justify-center gap-2 text-[22px] font-semibold tracking-tight">
            <span className="size-3 animate-pulse rounded-full bg-red-500" /> Listening…
          </p>
          <p className="mt-1 text-[17px] text-white/85">{interim ? `“${interim}”` : "Pause when you're done and I'll send it — or tap Stop to check it first."}</p>
        </>
      ) : phase === "stopping" ? (
        <p className="text-[20px] font-semibold tracking-tight">Getting the last of what you said…</p>
      ) : phase === "sending" || thinking ? (
        <>
          <p className="text-[22px] font-semibold tracking-tight">{phase === "sending" ? "Sending to Bob…" : "Working on it…"}</p>
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
  phase,
  fromVoice,
  onDiscard,
  supported,
  onMic,
}: {
  dark?: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  thinking: boolean;
  phase: ComposerPhase;
  fromVoice: boolean;
  onDiscard: () => void;
  supported: boolean;
  onMic: () => void;
}) {
  const recording = phase === "listening" || phase === "starting";
  const busy = phase === "stopping" || phase === "sending";
  const hasText = !!draft.trim() && !recording;
  return (
    <div>
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={draft}
          rows={fromVoice && hasText ? 3 : 1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          readOnly={busy || recording}
          placeholder={recording ? "Listening…" : "Type to Bob…"}
          aria-label="Message Bob"
          maxLength={2000}
          className={cn(
            "max-h-40 min-h-[52px] min-w-0 flex-1 resize-none rounded-3xl px-5 py-3.5 text-[17px] leading-6 outline-none focus:ring-2 focus:ring-copper-500/80",
            dark ? "bg-white/10 text-white ring-1 ring-white/15 placeholder:text-white/50" : "bg-card text-foreground ring-1 ring-line-strong placeholder:text-subtle",
            busy && "opacity-70",
          )}
        />
        {busy ? (
          <span className="grid size-[52px] shrink-0 place-items-center rounded-full bg-surface-3 text-accent-fg" aria-hidden>
            <Loader2 className="size-6 animate-spin" />
          </span>
        ) : hasText && !fromVoice ? (
          <button
            type="submit"
            disabled={thinking}
            aria-label="Send to Bob"
            className="grid size-[52px] shrink-0 place-items-center rounded-full bg-primary text-white transition disabled:opacity-40"
          >
            <SendHorizontal className="size-6" />
          </button>
        ) : hasText && fromVoice ? null : (
          <MicButton listening={recording} disabled={!supported} onClick={onMic} />
        )}
      </form>
      {hasText && fromVoice && !busy ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className={cn("h-12 rounded-full px-5 text-[15px] font-medium ring-1", dark ? "text-white/80 ring-white/20" : "text-muted-foreground ring-line-strong hover:text-foreground")}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={thinking}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[16px] font-semibold text-white transition disabled:opacity-40"
          >
            <SendHorizontal className="size-5" /> Send to Bob
          </button>
        </div>
      ) : null}
    </div>
  );
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
  request,
  showChips,
  canEdit,
  onEdit,
  onChip,
  onDecide,
  onNavigate,
}: {
  message: BobMessage;
  request?: string;
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
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-ink-700 px-4 py-3 text-white ring-1 ring-line">
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
        {!message.id.startsWith("err_") ? <ReadAloudButton message={message} request={request} /> : null}
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
