"use client";

import * as React from "react";
import Link from "next/link";
import { AlarmClock, ArrowUpRight, Check, FileText, ReceiptText, Reply, ChevronRight, FlaskConical, HardHat, Mic, Loader2, PartyPopper, Plus, SendHorizontal, Sparkles } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { useVoiceComposer } from "@/lib/voice/use-voice-composer";
import { ComposerStatus, SpeakRepliesToggle } from "@/components/assistant/voice-bits";
import { JOB_STATUS_LABEL, isActiveJob, isInvoiceOverdue, jobFinance, needsReply, quoteNeedsFollowUp, tasksDue, todaysPriorities, type PriorityItem } from "@/lib/derive";
import type { Job, Snapshot } from "@/lib/types";
import { cn, gbp, timeAgo, formatDateInline } from "@/lib/utils";
import { usePriorityAction } from "@/components/common/priority-card";
import { JobTile } from "@/components/common/job-tile";
import { JobStatusBadge, SourceIcon } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Orb } from "@/components/assistant/orb";

interface Reports {
  enquiries: { total: number; period: string; bySource: { label: string; count: number }[]; needsAction: number; won: number; coverage: string };
  jobs: { won: number; wonValue: number | null; wonPeriod: string; active: number; bookedNextWeek: { id: string }[]; nextWeekLabel: string };
  quotes: { sentCount: number; sentValue: number; accepted: number; period: string; needFollowUp: unknown[] } | null;
  money: { invoicedTotal: number; overdueTotal: number; overdueCount: number; depositsTotal: number; source: string; lastUpdated: string | null } | null;
}

/** Spacing scale: 4 · 8 · 12 · 16 · 24 · 32. Panels pad 16 (phone) / 20 (desktop). */
const ROWS = 4;
const EXAMPLE = "What needs sorting today?";

export default function TodayPage() {
  const { data, can, org } = useStore();
  const ui = useUI();
  const { send } = useBob();
  const finance = can("finance.read");
  const [reports, setReports] = React.useState<Reports | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const priorities = todaysPriorities(data, { includeFinance: finance });
  const shown = showAll ? priorities : priorities.slice(0, ROWS);
  const activeJobs = data.jobs.filter(isActiveJob);
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const askBob = (t: string, via: "voice" | "text" = "text") => {
    void send(t, via);
    ui.setAssistantOpen(true);
  };

  React.useEffect(() => {
    void api<Reports>("/api/reports").then((r) => r.status === 200 && setReports(r.body));
  }, [data.generatedAt]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
      {/* 1 · Header */}
      <header className="flex items-center justify-between gap-3 lg:col-span-5 lg:row-start-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[24px] font-semibold tracking-tight lg:text-[30px]">Today</h1>
            {org.dataMode === "sample" ? (
              <span
                title={org.isDemo ? "A fictional business. Nothing is sent to real customers." : "Fictional sample data. Nothing is sent to real customers."}
                className="inline-flex h-6 items-center gap-1 rounded-md bg-sky-400/10 px-2 text-[12.5px] font-medium text-info-fg ring-1 ring-sky-300/25"
              >
                <FlaskConical className="size-3" /> Demo mode
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[14.5px] text-muted-foreground lg:text-[15px]">{date}</p>
        </div>
        {can("enquiries.write") ? (
          <Button
            size="sm"
            aria-label="Add enquiry"
            className="h-11 rounded-[10px] bg-surface-2 px-3.5 text-[15px] text-foreground ring-1 ring-line-strong hover:bg-surface-3 lg:h-10 lg:bg-primary lg:px-4 lg:text-white lg:ring-0 lg:hover:bg-copper-600"
            onClick={() => ui.openForm({ form: "enquiry" })}
          >
            <Plus /> <span className="lg:hidden">Add</span>
            <span className="hidden lg:inline">Add enquiry</span>
          </Button>
        ) : null}
      </header>

      {/* 3b · Ask Bob — straight after the header on phones, right column on desktop */}
      <AskBobPanel className="lg:col-span-2 lg:col-start-4 lg:row-start-3 lg:self-start" />

      {/* 3a · Needs attention */}
      <section aria-labelledby="attn" className="panel overflow-hidden lg:col-span-3 lg:col-start-1 lg:row-start-3 lg:self-start">
        <div className="flex items-center justify-between px-4 pb-2 pt-4 lg:px-5">
          <h2 id="attn" className="text-[17px] font-semibold">
            Needs attention
            {priorities.length ? <span className="ml-2 text-[14px] font-normal text-subtle tabular">{priorities.length}</span> : null}
          </h2>
          {priorities.length > ROWS ? (
            <button onClick={() => setShowAll((v) => !v)} className="flex h-9 items-center gap-0.5 rounded-md px-1 text-[14.5px] font-medium text-accent-fg hover:text-copper-200">
              {showAll ? "Show fewer" : "View all"} <ChevronRight className={cn("size-4 transition", showAll && "-rotate-90")} />
            </button>
          ) : null}
        </div>
        {priorities.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {shown.map((p) => (
              <AttentionRow key={p.key} item={p} onAskBob={(t) => askBob(t)} />
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 border-t border-line px-4 py-6 lg:px-5">
            <PartyPopper className="size-5 text-accent-icon" />
            <p className="text-[15px] text-muted-foreground">You&apos;re all caught up — nothing needs you right now.</p>
          </div>
        )}
      </section>

      {/* 2 · Three-number summary — under the priorities on phones, top row on desktop */}
      <Summary data={data} finance={finance} className="lg:col-span-5 lg:row-start-2" />

      {/* 4 · Active jobs with next steps */}
      <section aria-labelledby="jobs" className="panel overflow-hidden lg:col-span-5 lg:row-start-4">
        <PanelHead id="jobs" title="Active jobs" count={activeJobs.length} href="/jobs" />
        {activeJobs.length ? (
          <ul className="grid grid-cols-1 divide-y divide-line border-t border-line lg:grid-cols-2 lg:divide-y-0 lg:[&>li]:border-b lg:[&>li]:border-line lg:[&>li:nth-child(odd)]:border-r">
            {activeJobs.slice(0, 6).map((j) => (
              <li key={j.id}>
                <button onClick={() => ui.openJob(j.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 lg:px-5">
                  <JobTile kind={j.kind} className="size-9 rounded-lg [&_svg]:size-[18px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15.5px] font-medium">
                      {j.title} <span className="text-muted-foreground">· {j.customerName}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-[14px] text-muted-foreground">
                      <span className="text-accent-fg">Next:</span> {nextStep(j, data, finance)}
                    </span>
                  </span>
                  <JobStatusBadge status={j.status} className="hidden shrink-0 sm:inline-flex" />
                  <ChevronRight className="size-4 shrink-0 text-subtle" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 border-t border-line px-4 py-6 lg:px-5">
            <HardHat className="size-5 text-accent-icon" />
            <p className="text-[15px] text-muted-foreground">No active jobs. Tell Bob “add a new job for…”.</p>
          </div>
        )}
      </section>

      {/* 5 · Detail, lower down */}
      <div className="grid grid-cols-1 gap-4 lg:col-span-5 lg:row-start-5 lg:grid-cols-2 lg:gap-6">
        {reports ? <Figures reports={reports} /> : <div className="panel h-64 animate-pulse" />}
        {can("activity.read") ? (
          <section aria-labelledby="act" className="panel self-start overflow-hidden">
            <PanelHead id="act" title="Recent activity" href="/activity" />
            <ul className="divide-y divide-line border-t border-line">
              {data.activity.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3 lg:px-5">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-copper-500" />
                  <span className="min-w-0">
                    <span className="block text-[14.5px] leading-snug">{a.summary}</span>
                    <span className="mt-0.5 block text-[13px] text-subtle">
                      {a.actor}
                      {a.via === "bob" ? " via Bob" : ""} · {timeAgo(a.at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function PanelHead({ id, title, count, href }: { id: string; title: string; count?: number; href?: string }) {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-4 lg:px-5">
      <h2 id={id} className="text-[17px] font-semibold">
        {title}
        {count ? <span className="ml-2 text-[14px] font-normal text-subtle tabular">{count}</span> : null}
      </h2>
      {href ? (
        <Link href={href} className="flex h-9 items-center gap-0.5 rounded-md px-1 text-[14.5px] font-medium text-accent-fg hover:text-copper-200">
          View all <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

/* ------------------------------ Summary ------------------------------ */

type Tone = "amber" | "sky" | "rose" | "violet";
const TONE: Record<Tone, { num: string; icon: string; bar: string; wash: string }> = {
  amber: { num: "text-[#ffb27a]", icon: "bg-copper-500/15 text-[#ffb27a] ring-copper-400/30", bar: "bg-[#f7944f]", wash: "from-copper-500/[0.10]" },
  sky: { num: "text-[#8fc3ff]", icon: "bg-sky-500/15 text-[#8fc3ff] ring-sky-400/30", bar: "bg-[#5aa2ff]", wash: "from-sky-500/[0.09]" },
  rose: { num: "text-[#ff9a9a]", icon: "bg-red-500/15 text-[#ff9a9a] ring-red-400/30", bar: "bg-[#f25f5f]", wash: "from-red-500/[0.09]" },
  violet: { num: "text-[#c4b0ff]", icon: "bg-violet-500/15 text-[#c4b0ff] ring-violet-400/30", bar: "bg-[#9b7bff]", wash: "from-violet-500/[0.09]" },
};

function Summary({ data, finance, className }: { data: Snapshot; finance: boolean; className?: string }) {
  const awaiting = data.enquiries.filter(needsReply).length;
  const quotes = data.quotes.filter(quoteNeedsFollowUp).length;
  const figures: { value: number; label: string; href: string; tone: Tone; Icon: React.ComponentType<{ className?: string }> }[] = [
    { value: awaiting, label: "Awaiting reply", href: "/enquiries?tab=reply", tone: "amber", Icon: Reply },
    { value: quotes, label: "Quotes to chase", href: "/enquiries?tab=follow", tone: "sky", Icon: FileText },
    finance
      ? { value: data.invoices.filter(isInvoiceOverdue).length, label: "Overdue invoices", href: "/invoices?filter=overdue", tone: "rose", Icon: ReceiptText }
      : { value: tasksDue(data.tasks).length, label: "Reminders due", href: "/tasks", tone: "violet", Icon: AlarmClock },
  ];
  return (
    <nav aria-label="Summary" className={cn("panel grid grid-cols-3 divide-x divide-line overflow-hidden", className)}>
      {figures.map((f) => {
        const t = TONE[f.tone];
        const on = f.value > 0;
        return (
          <Link
            key={f.label}
            href={f.href}
            className={cn("group relative flex flex-col gap-1.5 bg-gradient-to-b to-transparent px-3 py-3 transition hover:bg-surface-2 sm:px-5 lg:py-5", on ? t.wash : "from-transparent")}
          >
            <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[2px]", on ? t.bar : "bg-transparent")} />
            <span className="flex items-center justify-between">
              <span className={cn("grid size-7 place-items-center rounded-lg ring-1 lg:size-8", on ? t.icon : "bg-surface-2 text-subtle ring-line")}>
                <f.Icon className="size-3.5 lg:size-4" />
              </span>
              <ArrowUpRight className="hidden size-4 text-subtle transition group-hover:text-accent-fg sm:block" />
            </span>
            <span className={cn("tabular text-[30px] font-semibold leading-none tracking-tight lg:text-[40px]", on ? t.num : "text-subtle")}>{f.value}</span>
            <span className="text-[13px] leading-tight text-muted-foreground sm:text-[14px] lg:text-[15px]">{f.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------ Needs attention ------------------------------ */

const SHORT: Record<PriorityItem["kind"], string> = { reply: "Draft reply", followup: "Follow up", quote: "Chase", deposit: "Chase", invoice: "View", task: "Done" };

function AttentionRow({ item, onAskBob }: { item: PriorityItem; onAskBob: (t: string) => void }) {
  const { open, action, busy, Icon } = usePriorityAction(item, onAskBob);
  const urgent = item.kind === "invoice" || (item.kind === "deposit" && item.title.includes("overdue"));
  return (
    <li className="flex items-center gap-3 px-4 py-3 lg:px-5">
      <button onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {"source" in item ? (
          <SourceIcon source={item.source} provider={item.provider} />
        ) : (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-[10px] ring-1", urgent ? "bg-red-500/10 text-danger-fg ring-red-400/25" : "bg-copper-500/10 text-accent-icon ring-copper-500/25")}>
            <Icon className="size-[17px]" />
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-[15.5px] font-medium">{item.who}</span>
          <span className="mt-0.5 block truncate text-[14px] text-muted-foreground">{item.why}</span>
        </span>
      </button>
      <button
        onClick={() => void action.run()}
        disabled={busy}
        aria-label={`${action.label}: ${item.who}`}
        className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-3 text-[14px] font-medium text-accent-fg ring-1 ring-copper-500/40 transition hover:bg-copper-500/12 disabled:opacity-50"
      >
        {item.kind === "task" ? <Check className="size-4" /> : null}
        {SHORT[item.kind]}
      </button>
    </li>
  );
}

/* ------------------------------ Ask Bob ------------------------------ */

/**
 * Voice and typing share one request flow (useVoiceComposer). Pause after
 * speaking to auto-send; tap Stop to check and edit first. Nothing Bob
 * prepares is carried out without approval.
 */
function AskBobPanel({ className }: { className?: string }) {
  const ui = useUI();
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const c = useVoiceComposer({ inputRef, onSent: () => ui.setAssistantOpen(true) });
  const { speech, phase } = c;
  const busy = phase === "stopping" || phase === "sending";
  const recording = phase === "starting" || phase === "listening";
  const showActions = !!c.draft.trim() && phase === "idle" && c.fromVoice;

  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [c.draft]);

  return (
    <section aria-labelledby="askbob" className={cn("panel relative overflow-hidden p-3 lg:p-5", className)}>
      <div className="flex items-center gap-2.5 lg:flex-col lg:gap-2 lg:pb-1 lg:pt-1 lg:text-center">
        <Orb state={speech.listening ? "listening" : phase === "sending" ? "thinking" : "idle"} size={34} className="shrink-0 lg:hidden" />
        <Orb state={speech.listening ? "listening" : phase === "sending" ? "thinking" : "idle"} size={96} className="hidden lg:block" />
        <div className="min-w-0 flex-1">
          <h2 id="askbob" className="text-[16px] font-semibold lg:text-[17px]">
            Ask Bob
          </h2>
          <p className="hidden text-[14px] leading-snug text-muted-foreground lg:block">Talk or type. Bob looks it up, or prepares it for your OK.</p>
        </div>
        <SpeakRepliesToggle className="lg:mt-1" />
      </div>

      <button
        type="button"
        onClick={c.toggleMic}
        disabled={!speech.supported || busy}
        aria-pressed={recording}
        className={cn(
          "mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] text-[16px] font-semibold transition disabled:cursor-not-allowed lg:mt-4",
          recording ? "bg-red-500/15 text-red-100 ring-1 ring-red-400/50" : busy ? "bg-surface-3 text-foreground ring-1 ring-line-strong" : "bg-primary text-white hover:bg-copper-600 disabled:opacity-45",
        )}
      >
        {phase === "listening" ? (
          <>
            <span className="relative flex size-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-red-400" />
              <span className="relative size-2.5 rounded-full bg-red-500" />
            </span>
            Stop
          </>
        ) : phase === "starting" ? (
          "Starting the mic…"
        ) : phase === "stopping" ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Finishing…
          </>
        ) : phase === "sending" ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Sending to Bob…
          </>
        ) : (
          <>
            <Mic className="size-5" /> Tap to talk
          </>
        )}
      </button>

      <ComposerStatus phase={phase} interim={speech.interim} error={speech.error} notice={c.notice} supported={speech.supported} />

      <form className="mt-2 flex items-end gap-2 lg:mt-3" onSubmit={c.submit}>
        <textarea
          ref={inputRef}
          rows={1}
          value={c.draft}
          onChange={(e) => c.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              c.submit();
            }
          }}
          readOnly={busy || recording}
          placeholder={recording ? "Listening…" : "Or type a question…"}
          aria-label="Type a question for Bob"
          enterKeyHint="send"
          maxLength={2000}
          className={cn(
            "min-h-12 min-w-0 flex-1 resize-none rounded-[10px] bg-black/30 px-3.5 py-3 text-[16px] leading-6 text-foreground outline-none ring-1 ring-line-strong placeholder:text-subtle focus:ring-2 focus:ring-copper-500/80",
            busy && "opacity-70",
          )}
        />
        {showActions ? null : (
          <button
            type="submit"
            aria-label="Send to Bob"
            disabled={!c.draft.trim() || phase !== "idle"}
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-[10px] ring-1 transition disabled:opacity-40",
              c.draft.trim() ? "bg-copper-500/20 text-accent-fg ring-copper-500/50" : "bg-surface-3 text-foreground ring-line-strong",
            )}
          >
            <SendHorizontal className="size-[18px]" />
          </button>
        )}
      </form>

      {showActions ? (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={c.discard} className="h-11 rounded-[10px] px-4 text-[15px] font-medium text-muted-foreground ring-1 ring-line-strong hover:text-foreground">
            Discard
          </button>
          <button type="button" onClick={() => c.submit()} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-copper-600">
            <SendHorizontal className="size-4" /> Send to Bob
          </button>
        </div>
      ) : null}

      <button onClick={() => c.ask(EXAMPLE)} className="mt-3 hidden w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[14px] text-muted-foreground transition hover:text-foreground lg:flex">
        <Sparkles className="size-4 shrink-0 text-accent-icon" />
        <span>
          Try: <span className="text-foreground">“{EXAMPLE}”</span>
        </span>
      </button>
    </section>
  );
}

/* ------------------------------ Jobs & figures ------------------------------ */

/** The job's next step, from its records only. */
function nextStep(job: Job, data: Snapshot, finance: boolean): string {
  const task = data.tasks.filter((t) => !t.done && t.relatedType === "job" && t.relatedId === job.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (task) return `${task.title} · ${formatDateInline(task.dueDate)}`;
  if (job.nextAction) return job.nextAction;
  if (finance) {
    const f = jobFinance(job, data.payments);
    if (f.depositOutstanding > 0 && job.status !== "quoted") return `Collect ${gbp(f.depositOutstanding)} deposit`;
  }
  if (job.startDate && job.status === "scheduled") return `Starts ${formatDateInline(job.startDate)}`;
  return JOB_STATUS_LABEL[job.status];
}

function Figures({ reports: r }: { reports: Reports }) {
  const Row = ({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[14.5px] text-muted-foreground">{label}</span>
      <span className={cn("tabular text-[15px] font-medium", tone === "warn" && "text-warn-fg", tone === "good" && "text-good-fg")}>{value}</span>
    </div>
  );
  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="px-4 py-3 lg:px-5">
      <div className="mb-1 text-[12.5px] font-semibold uppercase tracking-wider text-subtle">{title}</div>
      {children}
    </div>
  );
  return (
    <section aria-labelledby="figs" className="panel overflow-hidden">
      <PanelHead id="figs" title="Business figures" />
      <div className="divide-y divide-line border-t border-line">
        <Group title={`Enquiries · ${r.enquiries.period}`}>
          <Row label="Received" value={String(r.enquiries.total)} />
          <div className="flex flex-wrap gap-1.5 py-1">
            {r.enquiries.bySource.map((s) => (
              <span key={s.label} className="rounded-md bg-surface-2 px-2 py-0.5 text-[13px] text-muted-foreground ring-1 ring-line">
                {s.label} {s.count}
              </span>
            ))}
          </div>
          <Row label="Still need action" value={String(r.enquiries.needsAction)} tone={r.enquiries.needsAction ? "warn" : "good"} />
          <Row label="Won" value={String(r.enquiries.won)} />
        </Group>
        <Group title="Jobs">
          <Row label={`Won (${r.jobs.wonPeriod.replace(/ \(.*\)/, "")})`} value={`${r.jobs.won}${r.jobs.wonValue !== null ? ` · ${gbp(r.jobs.wonValue)}` : ""}`} />
          <Row label="Starting next week" value={String(r.jobs.bookedNextWeek.length)} />
          {r.quotes ? <Row label={`Quotes sent (${r.quotes.period.replace(/ \(.*\)/, "")})`} value={`${r.quotes.sentCount} · ${gbp(r.quotes.sentValue)}`} /> : null}
        </Group>
        {r.money ? (
          <Group title="Money owed">
            <Row label="Unpaid invoices" value={gbp(r.money.invoicedTotal)} />
            <Row label="Overdue" value={`${gbp(r.money.overdueTotal)}${r.money.overdueCount ? ` (${r.money.overdueCount})` : ""}`} tone={r.money.overdueTotal ? "warn" : undefined} />
            <Row label="Deposits awaited" value={gbp(r.money.depositsTotal)} />
            <p className="mt-1 text-[12.5px] text-subtle">
              From {r.money.source}
              {r.money.lastUpdated ? ` · updated ${timeAgo(r.money.lastUpdated)}` : ""}.
            </p>
          </Group>
        ) : null}
      </div>
      <p className="border-t border-line px-4 py-3 text-[12.5px] leading-snug text-subtle lg:px-5">{r.enquiries.coverage}</p>
    </section>
  );
}
