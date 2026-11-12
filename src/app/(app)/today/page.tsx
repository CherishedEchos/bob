"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, HardHat, Inbox, MapPin, Mic, PartyPopper, Plus, ReceiptText, SendHorizontal } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { invoiceBalance, isActiveJob, isInvoiceOutstanding, isInvoiceOverdue, jobFinance, needsReply, todaysPriorities } from "@/lib/derive";
import { cn, gbp, timeAgo, formatDateInline, firstName } from "@/lib/utils";
import { Card, EmptyState, ProgressBar, SectionHeader } from "@/components/common/bits";
import { EnquiryStatusBadge, JobStatusBadge, SourceIcon } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";
import { PriorityCard } from "@/components/common/priority-card";
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

export default function TodayPage() {
  const { data, can, user } = useStore();
  const ui = useUI();
  const { send } = useBob();
  const finance = can("finance.read");
  const [reports, setReports] = React.useState<Reports | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const priorities = todaysPriorities(data, { includeFinance: finance });
  const shown = showAll ? priorities : priorities.slice(0, 3);
  const waiting = data.enquiries.filter(needsReply);
  const activeJobs = data.jobs.filter(isActiveJob);
  const outstanding = data.invoices.filter(isInvoiceOutstanding);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const name = /^(owner|office|site team)$/i.test(user.name) ? "" : `, ${firstName(user.name)}`;
  const askBob = (t: string) => {
    void send(t, "text");
    ui.setAssistantOpen(true);
  };

  React.useEffect(() => {
    void api<Reports>("/api/reports").then((r) => r.status === 200 && setReports(r.body));
  }, [data.generatedAt]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[16px] text-muted-foreground">{today}</p>
          <h1 className="text-[30px] font-bold tracking-tight lg:text-[34px]">
            {greetingNow()}
            {name}
          </h1>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {can("enquiries.write") ? (
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => ui.openForm({ form: "enquiry" })}>
              <Plus /> Add enquiry
            </Button>
          ) : null}
          <Button className="flex-1 sm:flex-none" onClick={() => ui.setAssistantOpen(true)}>
            <Mic /> Ask Bob
          </Button>
        </div>
      </div>

      <section aria-labelledby="top-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="top-heading" className="text-[21px] font-semibold tracking-tight">
            {priorities.length ? "Sort these first" : "Today"}
          </h2>
          {priorities.length ? (
            <span className="text-[15px] text-muted-foreground">
              {priorities.length} thing{priorities.length === 1 ? "" : "s"} need you
            </span>
          ) : null}
        </div>
        {priorities.length ? (
          <div className="space-y-3">
            {shown.map((p, i) => (
              <PriorityCard key={p.key} item={p} rank={showAll ? undefined : i + 1} onAskBob={askBob} />
            ))}
            {priorities.length > 3 ? (
              <button onClick={() => setShowAll((v) => !v)} className="flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl text-[16px] font-medium text-accent-fg hover:bg-surface-3">
                {showAll ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
                {showAll ? "Show top 3 only" : `Show ${priorities.length - 3} more`}
              </button>
            ) : null}
          </div>
        ) : (
          <EmptyState icon={PartyPopper} title="You're all caught up" body="Nothing needs you right now. New enquiries and reminders will show here." />
        )}
      </section>

      <AskBobPanel onAsk={askBob} />

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          <section>
            <SectionHeader title={`Waiting for a reply (${waiting.length})`} href="/enquiries" />
            {waiting.length ? (
              <Card className="p-1.5">
                {waiting.slice(0, 5).map((e) => (
                  <button key={e.id} onClick={() => ui.openEnquiry(e.id)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2">
                    <SourceIcon source={e.source} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-medium">{e.customerName}</div>
                      <div className="truncate text-[14px] text-muted-foreground">
                        {e.title} · {e.location} · {timeAgo(e.receivedAt)}
                      </div>
                    </div>
                    <EnquiryStatusBadge status={e.status} />
                  </button>
                ))}
              </Card>
            ) : (
              <EmptyState icon={Inbox} title="Nobody's waiting" body="Every enquiry has had a reply." />
            )}
          </section>

          <section>
            <SectionHeader title="Active jobs" href="/jobs" />
            {activeJobs.length ? (
              <div className="space-y-3">
                {activeJobs.slice(0, 4).map((j) => {
                  const f = jobFinance(j, data.payments);
                  return (
                    <button key={j.id} onClick={() => ui.openJob(j.id)} className="card-surface flex w-full items-center gap-4 rounded-2xl p-3 text-left transition hover:bg-surface-2">
                      <JobTile kind={j.kind} className="size-[60px]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[17px] font-semibold">{j.title}</div>
                            <div className="flex items-center gap-1 truncate text-[14.5px] text-muted-foreground">
                              <MapPin className="size-3.5 text-accent-icon" />
                              {j.location} · {j.customerName}
                            </div>
                          </div>
                          <JobStatusBadge status={j.status} />
                        </div>
                        {finance && f.totalPaid > 0 ? <ProgressBar value={f.paidPercent} className="mt-2" /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={HardHat} title="No active jobs" body="Tell Bob “add a new job for…” or use New job." />
            )}
          </section>
        </div>

        <div className="space-y-8">
          {reports ? <ReportingCard reports={reports} /> : <Card className="h-48 animate-pulse" />}

          {finance ? (
            <section>
              <SectionHeader title="Outstanding invoices" href="/invoices" />
              <Card className="p-1.5">
                {outstanding.length ? (
                  outstanding.map((i) => (
                    <Link key={i.id} href={`/invoices?open=${i.id}`} className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                      <ReceiptText className="size-5 text-accent-icon" />
                      <span className="min-w-0 flex-1 truncate text-[16px]">{data.customers.find((c) => c.id === i.customerId)?.name}</span>
                      <span className="text-right">
                        <span className="tabular block text-[16px] font-semibold">{gbp(invoiceBalance(i))}</span>
                        <span className={cn("block text-[13px]", isInvoiceOverdue(i) ? "text-danger-fg" : "text-muted-foreground")}>
                          {isInvoiceOverdue(i) ? "Overdue" : i.dueDate ? `Due ${formatDateInline(i.dueDate)}` : "Sent"}
                        </span>
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="px-3 py-3 text-[15px] text-muted-foreground">Nothing outstanding on record.</p>
                )}
              </Card>
            </section>
          ) : null}

          {can("activity.read") ? (
            <section>
              <SectionHeader title="Recent activity" href="/activity" />
              <Card className="divide-y divide-line">
                {data.activity.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-copper-500" />
                    <div className="min-w-0">
                      <p className="text-[15px] leading-snug">{a.summary}</p>
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

/** Ask Bob strip — the charcoal panel keeps Bob's orange orb recognisable. */
function AskBobPanel({ onAsk }: { onAsk: (t: string) => void }) {
  const ui = useUI();
  const [text, setText] = React.useState("");
  return (
    <div className="theme-dark mt-8 overflow-hidden rounded-3xl bg-ink-850 p-4 shadow-lg sm:p-5">
      <div className="flex items-center gap-4">
        <button onClick={() => ui.setAssistantOpen(true)} aria-label="Talk to Bob" className="hidden shrink-0 rounded-full sm:block">
          <Orb state="idle" size={84} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold">Ask Bob</div>
          <p className="text-[15px] text-muted-foreground">Talk or type. He looks things up, or prepares them for your OK.</p>
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
              placeholder="e.g. Who needs a reply?"
              aria-label="Ask Bob"
              className="h-12 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-[16px] text-white outline-none ring-1 ring-white/15 placeholder:text-white/50 focus:ring-2 focus:ring-copper-500/80"
            />
            <Button type="submit" size="icon" aria-label="Send to Bob" className="rounded-full">
              <SendHorizontal />
            </Button>
          </form>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {["Who needs a reply?", "What needs sorting today?", "How many enquiries in the last month?"].map((s) => (
              <button key={s} onClick={() => onAsk(s)} className="min-h-10 rounded-full bg-white/[0.07] px-3.5 text-[14px] text-white/90 ring-1 ring-white/12 hover:ring-copper-500/50">
                {s}
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

