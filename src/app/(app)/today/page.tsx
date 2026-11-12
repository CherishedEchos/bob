"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, HardHat, MapPin, Mic, PartyPopper, Plus, SendHorizontal, Square } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { useSpeechRecognition, stopSpeaking } from "@/lib/voice/use-speech";
import { isActiveJob, jobFinance, todaysPriorities } from "@/lib/derive";
import { cn, gbp, timeAgo, firstName } from "@/lib/utils";
import { Card, EmptyState, ProgressBar, SectionHeader } from "@/components/common/bits";
import { JobStatusBadge } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";
import { PriorityRow } from "@/components/common/priority-card";
import { Button } from "@/components/ui/button";
import { Orb } from "@/components/assistant/orb";

interface Reports {
  enquiries: { total: number; period: string; bySource: { label: string; count: number }[]; needsAction: number; won: number; coverage: string };
  jobs: { won: number; wonValue: number | null; wonPeriod: string; active: number; bookedNextWeek: { id: string }[]; nextWeekLabel: string };
  quotes: { sentCount: number; sentValue: number; accepted: number; period: string; needFollowUp: unknown[] } | null;
  money: { invoicedTotal: number; overdueTotal: number; overdueCount: number; depositsTotal: number; source: string; lastUpdated: string | null } | null;
}

function greetingNow() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const SHOW = 6;

export default function TodayPage() {
  const { data, can, user } = useStore();
  const ui = useUI();
  const { send } = useBob();
  const finance = can("finance.read");
  const [reports, setReports] = React.useState<Reports | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  // Grouped: one row per underlying issue (deposit + its reminder = one row).
  const priorities = todaysPriorities(data, { includeFinance: finance });
  const shown = showAll ? priorities : priorities.slice(0, SHOW);
  const activeJobs = data.jobs.filter(isActiveJob);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const name = /^(owner|office|site team)$/i.test(user.name) ? "" : `, ${firstName(user.name)}`;
  const askBob = (t: string, via: "voice" | "text" = "text") => {
    void send(t, via);
    ui.setAssistantOpen(true);
  };

  React.useEffect(() => {
    void api<Reports>("/api/reports").then((r) => r.status === 200 && setReports(r.body));
  }, [data.generatedAt]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 sm:mb-6">
        <div>
          <h1 className="text-[27px] font-bold tracking-tight sm:text-[30px] lg:text-[34px]">
            {greetingNow()}
            {name}
          </h1>
          <p className="mt-1 text-[16px] text-muted-foreground">
            {today}
            <span className="hidden sm:inline">. Here&apos;s what needs you today.</span>
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {can("enquiries.write") ? (
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => ui.openForm({ form: "enquiry" })}>
              <Plus /> Add enquiry
            </Button>
          ) : null}
          {can("jobs.write") ? (
            <Button className="flex-1 sm:flex-none" onClick={() => ui.openForm({ form: "job" })}>
              <Plus /> New job
            </Button>
          ) : null}
        </div>
      </div>

      <AskBobPanel onAsk={askBob} />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          <section aria-labelledby="pri-heading">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="pri-heading" className="text-[20px] font-semibold tracking-tight">
                Today&apos;s priorities
              </h2>
              {priorities.length ? <span className="text-[14.5px] text-muted-foreground">{priorities.length} need you</span> : null}
            </div>
            {priorities.length ? (
              <Card className="divide-y divide-line">
                {shown.map((p) => (
                  <PriorityRow key={p.key} item={p} onAskBob={(t) => askBob(t)} />
                ))}
                {priorities.length > SHOW ? (
                  <button onClick={() => setShowAll((v) => !v)} className="flex h-12 w-full items-center justify-center gap-1.5 text-[15px] font-medium text-accent-fg hover:bg-surface-2">
                    {showAll ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    {showAll ? "Show fewer" : `Show ${priorities.length - SHOW} more`}
                  </button>
                ) : null}
              </Card>
            ) : (
              <EmptyState icon={PartyPopper} title="You're all caught up" body="Nothing needs you right now." />
            )}
          </section>

          <section>
            <SectionHeader title="Active jobs" href="/jobs" />
            {activeJobs.length ? (
              <Card className="divide-y divide-line">
                {activeJobs.slice(0, 4).map((j) => {
                  const f = jobFinance(j, data.payments);
                  return (
                    <button key={j.id} onClick={() => ui.openJob(j.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-surface-2 sm:px-4">
                      <JobTile kind={j.kind} className="size-11 rounded-xl [&_svg]:size-5" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15.5px] font-semibold">
                          {j.title} · {j.customerName}
                        </div>
                        <div className="flex items-center gap-1 truncate text-[14px] text-muted-foreground">
                          <MapPin className="size-3.5 text-accent-icon" /> {j.location}
                          {finance && f.totalPaid > 0 ? ` · ${f.paidPercent}% paid` : ""}
                        </div>
                        {finance && f.totalPaid > 0 ? <ProgressBar value={f.paidPercent} className="mt-1.5" /> : null}
                      </div>
                      <JobStatusBadge status={j.status} />
                    </button>
                  );
                })}
              </Card>
            ) : (
              <EmptyState icon={HardHat} title="No active jobs" body="Use New job, or tell Bob “add a new job for…”." />
            )}
          </section>
        </div>

        <div className="space-y-8">
          {reports ? <ReportingCard reports={reports} /> : <Card className="h-64 animate-pulse" />}
          {can("activity.read") ? (
            <section>
              <SectionHeader title="Recent activity" href="/activity" />
              <Card className="divide-y divide-line">
                {data.activity.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-copper-500" />
                    <div className="min-w-0">
                      <p className="text-[14.5px] leading-snug">{a.summary}</p>
                      <p className="mt-0.5 text-[13px] text-subtle">
                        {a.actor}
                        {a.via === "bob" ? " via Bob" : ""} · {timeAgo(a.at)}
                      </p>
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Full-width Ask Bob panel. Typing and the mic go through the same Bob request. */
function AskBobPanel({ onAsk }: { onAsk: (t: string, via?: "voice" | "text") => void }) {
  const [text, setText] = React.useState("");
  const speech = useSpeechRecognition((t) => onAsk(t, "voice"));
  const toggleMic = () => {
    if (speech.listening) speech.stop();
    else {
      stopSpeaking();
      speech.start();
    }
  };
  const status = speech.starting ? "Starting the microphone…" : speech.listening ? speech.interim || "Listening… tap the mic again to stop" : null;
  return (
    <div className="card-copper rounded-3xl p-4 sm:p-5">
      <div className="flex items-start gap-5">
        <div className="hidden shrink-0 sm:block">
          <Orb state={speech.listening ? "listening" : "idle"} size={88} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold">Ask Bob</div>
          <p className="hidden text-[15px] text-muted-foreground sm:block">Talk or type — he&apos;ll look it up, or prepare it for your OK.</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) onAsk(text);
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={speech.listening ? "Listening…" : "e.g. Who needs a reply?"}
              aria-label="Ask Bob"
              enterKeyHint="send"
              className="h-12 min-w-0 flex-1 rounded-full bg-black/35 px-4 text-[16px] text-foreground outline-none ring-1 ring-line-strong placeholder:text-subtle focus:ring-2 focus:ring-copper-500/80"
            />
            <Button type="submit" size="icon" aria-label="Send to Bob" disabled={!text.trim()} className="rounded-full">
              <SendHorizontal />
            </Button>
            <button
              type="button"
              onClick={toggleMic}
              disabled={!speech.supported}
              aria-label={speech.listening ? "Stop listening" : "Tap to talk"}
              aria-pressed={speech.listening}
              className={cn(
                "relative grid size-12 shrink-0 place-items-center rounded-full ring-1 transition disabled:opacity-40",
                speech.listening ? "bg-red-500/20 text-red-200 ring-red-400/60" : "bg-surface-3 text-foreground ring-line-strong hover:bg-surface-2",
              )}
            >
              {speech.listening ? <span className="absolute inset-0 animate-ping-slow rounded-full bg-red-500/30" /> : null}
              {speech.listening ? <Square className="relative size-4 fill-current" /> : <Mic className="relative size-5" />}
            </button>
          </form>
          {status ? (
            <p role="status" className="mt-2 flex items-center gap-2 text-[15px] text-foreground">
              <span className="size-2 animate-pulse rounded-full bg-red-500" /> {status}
            </p>
          ) : speech.error ? (
            <p role="alert" className="mt-2 text-[14.5px] text-warn-fg">
              {speech.error} Typing still works.
            </p>
          ) : null}
          <div className="scrollbar-none -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            {["What needs sorting today?", "How many enquiries in the last month?", "Who needs a reply?"].map((x) => (
              <button key={x} onClick={() => onAsk(x)} className="min-h-10 shrink-0 whitespace-nowrap rounded-full bg-black/25 px-3.5 text-[14px] text-foreground ring-1 ring-line hover:ring-copper-500/50">
                {x}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportingCard({ reports }: { reports: Reports }) {
  const r = reports;
  const Row = ({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[14.5px] text-muted-foreground">{label}</span>
      <span className={cn("tabular text-[15px] font-semibold", tone === "warn" && "text-warn-fg", tone === "good" && "text-good-fg")}>{value}</span>
    </div>
  );
  return (
    <section>
      <SectionHeader title="Business at a glance" />
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wider text-accent-fg">Enquiries · {r.enquiries.period}</div>
        <Row label="Received" value={String(r.enquiries.total)} />
        <div className="flex flex-wrap gap-1.5 pb-1">
          {r.enquiries.bySource.map((s) => (
            <span key={s.label} className="rounded-full bg-surface-2 px-2 py-0.5 text-[13px] text-muted-foreground ring-1 ring-line">
              {s.label} {s.count}
            </span>
          ))}
        </div>
        <Row label="Still need action" value={String(r.enquiries.needsAction)} tone={r.enquiries.needsAction ? "warn" : "good"} />
        <Row label="Won" value={String(r.enquiries.won)} tone="good" />
        <div className="my-3 border-t border-line" />
        <div className="text-[13px] font-semibold uppercase tracking-wider text-accent-fg">Jobs</div>
        <Row label={`Won (${r.jobs.wonPeriod.replace(/ \(.*\)/, "")})`} value={`${r.jobs.won}${r.jobs.wonValue !== null ? ` · ${gbp(r.jobs.wonValue)}` : ""}`} />
        <Row label="Starting next week" value={String(r.jobs.bookedNextWeek.length)} />
        {r.quotes ? (
          <>
            <div className="my-3 border-t border-line" />
            <div className="text-[13px] font-semibold uppercase tracking-wider text-accent-fg">Quotes · {r.quotes.period.replace(/ \(.*\)/, "")}</div>
            <Row label="Sent" value={`${r.quotes.sentCount} · ${gbp(r.quotes.sentValue)}`} />
            <Row label="Need chasing" value={String(r.quotes.needFollowUp.length)} tone={r.quotes.needFollowUp.length ? "warn" : "good"} />
          </>
        ) : null}
        {r.money ? (
          <>
            <div className="my-3 border-t border-line" />
            <div className="text-[13px] font-semibold uppercase tracking-wider text-accent-fg">Money owed</div>
            <Row label="Unpaid invoices" value={gbp(r.money.invoicedTotal)} />
            <Row label="Overdue" value={`${gbp(r.money.overdueTotal)}${r.money.overdueCount ? ` (${r.money.overdueCount})` : ""}`} tone={r.money.overdueTotal ? "warn" : "good"} />
            <Row label="Deposits awaited" value={gbp(r.money.depositsTotal)} />
            <p className="mt-1 text-[12.5px] text-subtle">
              From {r.money.source}
              {r.money.lastUpdated ? ` · last updated ${timeAgo(r.money.lastUpdated)}` : ""}.
            </p>
          </>
        ) : null}
        <p className="mt-2 text-[12.5px] leading-snug text-subtle">{r.enquiries.coverage}</p>
      </Card>
    </section>
  );
}

