"use client";

import * as React from "react";
import Link from "next/link";
import { AlarmClock, ChevronRight, HardHat, Inbox, MapPin, MessageSquareReply, Mic, PartyPopper, Plus, PoundSterling, ReceiptText, Reply, SendHorizontal } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { followUpDue, invoiceBalance, isActiveJob, isInvoiceOutstanding, isInvoiceOverdue, jobFinance, needsReply, todaysPriorities, type PriorityItem } from "@/lib/derive";
import { cn, gbp, timeAgo, formatDateInline, firstName } from "@/lib/utils";
import { Card, EmptyState, PageHeader, ProgressBar, SectionHeader } from "@/components/common/bits";
import { EnquiryStatusBadge, JobStatusBadge, SourceIcon } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";
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

export default function OverviewPage() {
  const { data, can, user } = useStore();
  const ui = useUI();
  const finance = can("finance.read");
  const [reports, setReports] = React.useState<Reports | null>(null);
  const priorities = todaysPriorities(data, { includeFinance: finance });
  const newEnquiries = data.enquiries.filter((e) => e.status === "new");
  const followUps = data.enquiries.filter((e) => !needsReply(e) && followUpDue(e));
  const activeJobs = data.jobs.filter(isActiveJob);
  const outstanding = data.invoices.filter(isInvoiceOutstanding);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const name = /^(owner|office|site team)$/i.test(user.name) ? "" : `, ${firstName(user.name)}`;

  React.useEffect(() => {
    void api<Reports>("/api/reports").then((r) => r.status === 200 && setReports(r.body));
  }, [data.generatedAt]);

  return (
    <>
      <PageHeader
        title={`${greetingNow()}${name}`}
        subtitle={`${today}. Here's what needs you today.`}
        actions={
          <div className="hidden gap-2 lg:flex">
            {can("enquiries.write") ? (
              <Button variant="secondary" onClick={() => ui.openForm({ form: "enquiry" })}>
                <Plus /> Log enquiry
              </Button>
            ) : null}
            {can("jobs.write") ? (
              <Button onClick={() => ui.openForm({ form: "job" })}>
                <Plus /> New job
              </Button>
            ) : null}
          </div>
        }
      />

      <AskBobPanel />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          <section>
            <SectionHeader title="Today's priorities" />
            <Priorities items={priorities} />
          </section>

          <section>
            <SectionHeader title="New enquiries" href="/enquiries?filter=new" />
            {newEnquiries.length ? (
              <Card className="p-1.5">
                {newEnquiries.slice(0, 5).map((e) => (
                  <button key={e.id} onClick={() => ui.openEnquiry(e.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04]">
                    <SourceIcon source={e.source} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-medium">{e.customerName}</div>
                      <div className="truncate text-[12.5px] text-muted-foreground">
                        {e.title} · {e.location} · {timeAgo(e.receivedAt)}
                      </div>
                    </div>
                    <EnquiryStatusBadge status={e.status} />
                  </button>
                ))}
              </Card>
            ) : (
              <EmptyState icon={Inbox} title="No new enquiries" body="New emails, form submissions and logged calls show up here." />
            )}
          </section>

          <section>
            <SectionHeader title="Active jobs" href="/jobs" />
            {activeJobs.length ? (
              <div className="space-y-3">
                {activeJobs.slice(0, 4).map((j) => {
                  const f = jobFinance(j, data.payments);
                  return (
                    <button key={j.id} onClick={() => ui.openJob(j.id)} className="card-surface flex w-full items-center gap-4 rounded-2xl p-3 text-left transition hover:bg-white/[0.05]">
                      <JobTile kind={j.kind} className="size-[64px]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[16px] font-semibold">{j.title}</div>
                            <div className="flex items-center gap-1 truncate text-[13.5px] text-muted-foreground">
                              <MapPin className="size-3.5 text-copper-400" />
                              {j.location} · {j.customerName}
                            </div>
                          </div>
                          <JobStatusBadge status={j.status} />
                        </div>
                        {finance ? (
                          <>
                            <div className="tabular mt-1.5 text-[13.5px] text-foreground/90">
                              {gbp(j.quotedValue)} <span className="px-1 text-subtle">|</span>
                              {f.totalPaid > 0 ? `${gbp(f.totalPaid)} paid (${f.paidPercent}%)` : f.depositOutstanding ? `Deposit due ${gbp(f.depositOutstanding)}` : "Nothing paid yet"}
                            </div>
                            {f.totalPaid > 0 ? <ProgressBar value={f.paidPercent} className="mt-2" /> : null}
                          </>
                        ) : j.nextAction ? (
                          <div className="mt-1.5 truncate text-[13.5px] text-foreground/85">Next: {j.nextAction}</div>
                        ) : null}
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

          <section>
            <SectionHeader title="Follow-ups due" href="/enquiries?filter=followup" />
            <Card className="p-1.5">
              {followUps.length ? (
                followUps.map((e) => (
                  <button key={e.id} onClick={() => ui.openEnquiry(e.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04]">
                    <MessageSquareReply className="size-4 text-copper-300" />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{e.customerName} — {e.title}</span>
                    <span className="text-[12.5px] text-muted-foreground">{e.followUpDate ? formatDateInline(e.followUpDate) : ""}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-3 text-[14px] text-muted-foreground">No follow-ups due.</p>
              )}
            </Card>
          </section>

          {finance ? (
            <section>
              <SectionHeader title="Outstanding invoices" href="/invoices" />
              <Card className="p-1.5">
                {outstanding.length ? (
                  outstanding.map((i) => (
                    <Link key={i.id} href={`/invoices?open=${i.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04]">
                      <ReceiptText className="size-4 text-copper-300" />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{data.customers.find((c) => c.id === i.customerId)?.name}</span>
                      <span className="text-right">
                        <span className="tabular block text-[14px] font-semibold">{gbp(invoiceBalance(i))}</span>
                        <span className={cn("block text-[12px]", isInvoiceOverdue(i) ? "text-red-300" : "text-muted-foreground")}>
                          {isInvoiceOverdue(i) ? "Overdue" : i.dueDate ? `Due ${formatDateInline(i.dueDate)}` : "Sent"}
                        </span>
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="px-3 py-3 text-[14px] text-muted-foreground">Nothing outstanding on record.</p>
                )}
              </Card>
            </section>
          ) : null}

          {can("activity.read") ? (
            <section>
              <SectionHeader title="Recent activity" href="/activity" />
              <Card className="divide-y divide-white/[0.05]">
                {data.activity.slice(0, 6).map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-copper-500" />
                    <div className="min-w-0">
                      <p className="text-[13.5px] leading-snug">{a.summary}</p>
                      <p className="mt-0.5 text-[12px] text-subtle">
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

/** Prominent Ask Bob panel — types straight into the shared conversation. */
function AskBobPanel() {
  const ui = useUI();
  const { send } = useBob();
  const [text, setText] = React.useState("");
  const go = (t: string) => {
    void send(t, "text");
    ui.setAssistantOpen(true);
  };
  return (
    <div className="card-copper relative overflow-hidden rounded-3xl p-4 sm:p-5">
      <div className="flex items-center gap-4">
        <div className="hidden shrink-0 sm:block">
          <Orb state="idle" size={84} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold">Ask Bob</div>
          <p className="text-[13.5px] text-muted-foreground">Talk or type — he&apos;ll look it up, or prepare it for your OK.</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) go(text);
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Who's not paid me?"
              aria-label="Ask Bob"
              className="h-11 min-w-0 flex-1 rounded-full bg-black/30 px-4 text-[15px] outline-none ring-1 ring-white/12 placeholder:text-subtle focus:ring-2 focus:ring-copper-500/70"
            />
            <Button type="submit" size="icon" aria-label="Send to Bob" className="size-11 rounded-full">
              <SendHorizontal />
            </Button>
            <Button type="button" variant="secondary" size="icon" aria-label="Talk to Bob" className="size-11 rounded-full" onClick={() => ui.setAssistantOpen(true)}>
              <Mic />
            </Button>
          </form>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {["What needs sorting today?", "How many enquiries in the last month?", "Who haven't I replied to?"].map((s) => (
              <button key={s} onClick={() => go(s)} className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[12.5px] text-foreground/85 ring-1 ring-white/10 hover:ring-copper-500/40">
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
      <span className="text-[13.5px] text-muted-foreground">{label}</span>
      <span className={cn("tabular text-[14px] font-semibold", tone === "warn" && "text-amber-200", tone === "good" && "text-emerald-300")}>{value}</span>
    </div>
  );
  return (
    <section>
      <SectionHeader title="Business at a glance" />
      <Card className="p-4">
        <div className="text-[12px] font-semibold uppercase tracking-wider text-copper-300">Enquiries · {r.enquiries.period}</div>
        <Row label="Received" value={String(r.enquiries.total)} />
        <div className="flex flex-wrap gap-1.5 pb-1">
          {r.enquiries.bySource.map((s) => (
            <span key={s.label} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[12px] text-muted-foreground ring-1 ring-white/10">
              {s.label} {s.count}
            </span>
          ))}
        </div>
        <Row label="Still need action" value={String(r.enquiries.needsAction)} tone={r.enquiries.needsAction ? "warn" : "good"} />
        <Row label="Won" value={String(r.enquiries.won)} tone="good" />
        <div className="my-3 border-t border-white/[0.06]" />
        <div className="text-[12px] font-semibold uppercase tracking-wider text-copper-300">Jobs</div>
        <Row label={`Won (${r.jobs.wonPeriod.replace(/ \(.*\)/, "")})`} value={`${r.jobs.won}${r.jobs.wonValue !== null ? ` · ${gbp(r.jobs.wonValue)}` : ""}`} />
        <Row label="Starting next week" value={String(r.jobs.bookedNextWeek.length)} />
        {r.quotes ? (
          <>
            <div className="my-3 border-t border-white/[0.06]" />
            <div className="text-[12px] font-semibold uppercase tracking-wider text-copper-300">Quotes · {r.quotes.period.replace(/ \(.*\)/, "")}</div>
            <Row label="Sent" value={`${r.quotes.sentCount} · ${gbp(r.quotes.sentValue)}`} />
            <Row label="Need chasing" value={String(r.quotes.needFollowUp.length)} tone={r.quotes.needFollowUp.length ? "warn" : "good"} />
          </>
        ) : null}
        {r.money ? (
          <>
            <div className="my-3 border-t border-white/[0.06]" />
            <div className="text-[12px] font-semibold uppercase tracking-wider text-copper-300">Money owed</div>
            <Row label="Unpaid invoices" value={gbp(r.money.invoicedTotal)} />
            <Row label="Overdue" value={`${gbp(r.money.overdueTotal)}${r.money.overdueCount ? ` (${r.money.overdueCount})` : ""}`} tone={r.money.overdueTotal ? "warn" : "good"} />
            <Row label="Deposits awaited" value={gbp(r.money.depositsTotal)} />
            <p className="mt-1 text-[11.5px] text-subtle">
              From {r.money.source}
              {r.money.lastUpdated ? ` · last updated ${timeAgo(r.money.lastUpdated)}` : ""}.
            </p>
          </>
        ) : null}
        <p className="mt-2 text-[11.5px] leading-snug text-subtle">{r.enquiries.coverage}</p>
      </Card>
    </section>
  );
}

function Priorities({ items }: { items: PriorityItem[] }) {
  const ui = useUI();
  if (!items.length) return <EmptyState icon={PartyPopper} title="You're all caught up" body="Nothing needs attention right now." />;
  return (
    <Card className="divide-y divide-white/[0.05]">
      {items.slice(0, 7).map((p) => {
        const Icon = p.kind === "reply" ? Reply : p.kind === "followup" || p.kind === "quote" ? MessageSquareReply : p.kind === "deposit" || p.kind === "invoice" ? PoundSterling : AlarmClock;
        const inner = (
          <>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-copper-500/12 text-copper-300 ring-1 ring-copper-500/25">
              <Icon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">{p.title}</div>
              <div className="truncate text-[13px] text-muted-foreground">{p.detail}</div>
            </div>
            <ChevronRight className="size-4 text-subtle" />
          </>
        );
        const cls = "flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.03]";
        if (p.kind === "invoice")
          return (
            <Link key={p.id} href={`/invoices?open=${p.invoiceId}`} className={cls}>
              {inner}
            </Link>
          );
        if (p.kind === "task")
          return (
            <Link key={p.id} href="/tasks" className={cls}>
              {inner}
            </Link>
          );
        return (
          <button
            key={p.id}
            className={cls}
            onClick={() => {
              if (p.kind === "reply" || p.kind === "followup") ui.openEnquiry(p.enquiryId);
              else if (p.kind === "quote" && p.enquiryId) ui.openEnquiry(p.enquiryId);
              else if (p.kind === "deposit") ui.openJob(p.jobId);
            }}
          >
            {inner}
          </button>
        );
      })}
    </Card>
  );
}
