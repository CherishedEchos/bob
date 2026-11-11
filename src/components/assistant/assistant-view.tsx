"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AudioLines, Bell, ChevronRight, HardHat, Inbox, Mic, MoreHorizontal, Pencil, PlusCircle, ReceiptText, SendHorizontal,
  Square, Volume2, VolumeX, X,
} from "lucide-react";
import { useBob } from "@/lib/bob/provider";
import type { BobMessage, Chip } from "@/lib/bob/types";
import { useSpeechRecognition, stopSpeaking } from "@/lib/voice/use-speech";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { tasksDue, todaysPriorities } from "@/lib/derive";
import { cn, firstName } from "@/lib/utils";
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
          <button onClick={() => setHome(true)} className="flex items-center gap-2.5 rounded-full pr-2 text-left hover:bg-white/[0.04]" aria-label="Back to Bob home">
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
              className="relative grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06] lg:hidden"
            >
              <Bell className="size-6" />
              {dueCount ? <span className="absolute right-2.5 top-2.5 size-2.5 rounded-full bg-copper-500 ring-2 ring-background" /> : null}
            </Link>
          ) : null}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Bob options"
            aria-expanded={menuOpen}
            className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06]"
          >
            <MoreHorizontal className="size-6" />
          </button>
          {variant === "panel" ? (
            <button onClick={onClose} aria-label="Close Bob" className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06]">
              <X className="size-6" />
            </button>
          ) : (
            <span className="lg:hidden">
              <OrgLogo org={org} size={34} />
            </span>
          )}
          {menuOpen ? (
            <div className="absolute right-0 top-12 z-20 w-64 rounded-2xl bg-ink-750 p-1.5 shadow-2xl ring-1 ring-white/10">
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
              <div className="px-3 pb-1.5 pt-2 text-[11.5px] leading-snug text-subtle">
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
          <div className="mx-auto flex max-w-md flex-col items-center px-5 pb-6">
            <button
              onClick={toggleMic}
              aria-label={speech.listening ? "Stop listening" : "Tap to talk to Bob"}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-300"
            >
              <Orb state={orbState} size={variant === "panel" ? 150 : 190} className="mb-5 mt-2" />
            </button>
            {speech.listening ? (
              <div className="min-h-[76px] text-center" aria-live="polite">
                <p className="text-[22px] font-semibold tracking-tight">Listening…</p>
                <p className="mt-2 text-[16px] text-foreground/85">{speech.interim || "Go ahead — I'm listening."}</p>
              </div>
            ) : (
              <div className="min-h-[76px] text-center">
                <p className="text-[15px] text-muted-foreground">
                  {greetingNow()}
                  {name}
                </p>
                <h1 className="mt-1 text-[27px] font-semibold tracking-tight">Hey, how can I help?</h1>
              </div>
            )}

            {!speech.listening && messages.length > 0 ? (
              <button onClick={() => setHome(false)} className="mt-1 text-[13.5px] text-copper-300 underline-offset-4 hover:underline">
                Continue our conversation
              </button>
            ) : null}

            {!speech.listening ? (
              <>
                {priorities.length ? (
                  <section className="mt-6 w-full">
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-subtle">Today</h2>
                      <button onClick={() => ask("What needs sorting today?")} className="text-[13px] text-copper-300">
                        Ask Bob
                      </button>
                    </div>
                    <div className="space-y-2">
                      {priorities.slice(0, 3).map((p) => (
                        <AssistantCardPriority key={p.id} item={p} onClose={onClose} />
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="mt-6 w-full">
                  <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-subtle">Try saying</h2>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.slice(0, variant === "panel" ? 4 : 5).map((s) => (
                      <button
                        key={s}
                        onClick={() => ask(s)}
                        className="rounded-full bg-white/[0.04] px-3.5 py-2 text-left text-[13.5px] text-foreground/90 ring-1 ring-white/[0.12] transition hover:bg-white/[0.08] hover:ring-copper-500/40"
                      >
                        “{s}”
                      </button>
                    ))}
                  </div>
                </section>

                {variant === "page" ? (
                  <nav className="mt-6 grid w-full grid-cols-3 gap-2 lg:hidden" aria-label="Quick links">
                    {[
                      { href: "/enquiries", label: "Enquiries", icon: Inbox },
                      { href: "/jobs", label: "Jobs", icon: HardHat },
                      ...(can("finance.read") ? [{ href: "/invoices", label: "Money", icon: ReceiptText }] : [{ href: "/tasks", label: "Tasks", icon: Bell }]),
                    ].map((l) => (
                      <Link key={l.href} href={l.href} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/[0.03] py-3 text-[13px] ring-1 ring-white/[0.08] hover:bg-white/[0.06]">
                        <l.icon className="size-5 text-copper-300" />
                        {l.label}
                      </Link>
                    ))}
                  </nav>
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 px-4 pb-6 pt-2 lg:px-6" aria-live="polite">
            {!ready ? <p className="text-center text-[13px] text-subtle">Loading conversation…</p> : null}
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
                <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-ink-750 px-4 py-3 text-[15px] text-foreground/75 ring-1 ring-white/10">
                  <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-red-500 align-middle" />
                  {speech.interim || "Listening…"}
                </div>
              </div>
            ) : null}
            {thinking ? (
              <div className="flex items-center gap-3" role="status">
                <OrbAvatar />
                <div className="flex items-center gap-1.5 rounded-3xl bg-white/[0.05] px-4 py-3.5 ring-1 ring-white/10">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-2 animate-pulse rounded-full bg-copper-300" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                  <span className="sr-only">Bob is working on it</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ------------------------------ Composer ------------------------------ */}
      <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 lg:px-6">
        {speech.error ? (
          <div role="alert" className="mx-auto mb-3 flex max-w-2xl items-start gap-2 rounded-2xl bg-amber-400/10 px-4 py-2.5 text-[13.5px] text-amber-100 ring-1 ring-amber-400/25">
            <span className="flex-1">{speech.error}</span>
            <button onClick={speech.clearError} aria-label="Dismiss" className="text-amber-200/80 hover:text-amber-100">
              <X className="size-4" />
            </button>
          </div>
        ) : null}
        {!inConversation && !speech.listening && speech.supported ? (
          <p className="mb-2 text-center text-[13px] text-copper-300">Tap the orb or the mic to talk — or type below</p>
        ) : null}
        <form onSubmit={submitText} className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitText();
              }
            }}
            placeholder={speech.listening ? "Listening…" : "Ask Bob or tell him something…"}
            aria-label="Message Bob"
            maxLength={2000}
            className="max-h-32 min-h-12 min-w-0 flex-1 resize-none rounded-3xl bg-white/[0.05] px-5 py-3 text-[15px] leading-6 outline-none ring-1 ring-white/12 placeholder:text-subtle focus:ring-2 focus:ring-copper-500/70"
          />
          {draft.trim() ? (
            <button
              type="submit"
              disabled={thinking}
              aria-label="Send"
              className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-copper-400 to-copper-600 text-white shadow-[0_0_20px_rgb(236_122_46/0.45)] transition disabled:opacity-40"
            >
              <SendHorizontal className="size-5" />
            </button>
          ) : (
            <MicButton listening={speech.listening} disabled={!speech.supported} onClick={toggleMic} />
          )}
        </form>
        {!speech.supported ? <p className="mt-2 text-center text-[12px] text-subtle">Voice isn&apos;t available in this browser — typing works the same.</p> : null}
      </div>
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] hover:bg-white/[0.06]" onClick={onClick}>
      {children}
    </button>
  );
}

function AssistantCardPriority({ item, onClose }: { item: ReturnType<typeof todaysPriorities>[number]; onClose?: () => void }) {
  const ui = useUI();
  const router = useRouter();
  const open = () => {
    if (item.kind === "reply" || item.kind === "followup") ui.openEnquiry(item.enquiryId);
    else if (item.kind === "quote") {
      if (item.enquiryId) ui.openEnquiry(item.enquiryId);
    } else if (item.kind === "deposit") ui.openJob(item.jobId);
    else {
      router.push(item.kind === "invoice" ? `/invoices?open=${item.invoiceId}` : "/tasks");
      onClose?.();
    }
  };
  return (
    <button onClick={open} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.035] px-4 py-3 text-left ring-1 ring-white/[0.08] transition hover:bg-white/[0.07]">
      <span className="size-2 shrink-0 rounded-full bg-copper-400 shadow-[0_0_8px_rgb(236_122_46/0.8)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium">{item.title}</span>
        <span className="block truncate text-[12.5px] text-muted-foreground">{item.detail}</span>
      </span>
      <ChevronRight className="size-4 text-subtle" />
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
      className="group relative grid size-12 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-300 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
    >
      {listening ? <span className="absolute inset-0 animate-ping-slow rounded-full bg-copper-500/40" /> : null}
      <span
        className="absolute inset-0 rounded-full transition group-active:scale-95"
        style={{
          background: "radial-gradient(circle at 50% 35%, #f0873d, #b9521a 75%)",
          boxShadow: "0 0 0 1.5px rgb(255 190 140 / 0.6) inset, 0 0 22px rgb(236 122 46 / 0.6)",
        }}
      />
      {listening ? <Square className="relative size-5 fill-white text-white" /> : <Mic className="relative size-6 text-white" strokeWidth={1.9} />}
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
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-ink-700/80 px-4 py-3 ring-1 ring-white/10">
          {message.via === "voice" ? (
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-copper-300">
              <AudioLines className="size-3.5" /> You said
            </div>
          ) : null}
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.via === "voice" ? `“${message.text}”` : message.text}</p>
        </div>
        {canEdit ? (
          <button onClick={onEdit} className="mt-1 flex items-center gap-1 px-2 text-[12px] text-subtle hover:text-foreground">
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
          <div className="inline-block max-w-full rounded-3xl rounded-tl-lg bg-white/[0.05] px-4 py-3 ring-1 ring-white/10">
            {message.text ? <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.text}</p> : null}
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
