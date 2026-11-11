"use client";

import Link from "next/link";
import {
  AlarmClock,
  Check,
  CirclePoundSterling,
  HardHat,
  Inbox,
  MailWarning,
  MapPin,
  MessageSquareReply,
  Plus,
  PoundSterling,
  Reply,
  PartyPopper,
} from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { isActiveJob, jobFinance, overviewStats, todaysPriorities, type PriorityItem } from "@/lib/derive";
import { cn, gbp, greeting, timeAgo, formatDateKey } from "@/lib/utils";
import { Card, EmptyState, PageHeader, ProgressBar, SectionHeader } from "@/components/common/bits";
import { JobStatusBadge } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

export default function OverviewPage() {
  const { data } = useStore();
  const ui = useUI();
  const stats = overviewStats(data);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          <>
            <span className="hidden lg:inline">{greeting()} · {today}. </span>Your jobs, enquiries and payments at a glance.
          </>
        }
        actions={
          <div className="hidden gap-2 lg:flex">
            <Button variant="secondary" onClick={() => ui.openForm({ form: "enquiry" })}>
              <Plus /> Log enquiry
            </Button>
            <Button onClick={() => ui.openForm({ form: "job" })}>
              <Plus /> New job
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard href="/enquiries?filter=new" icon={Inbox} value={stats.newEnquiries} label="New enquiries" highlight />
        <StatCard href="/enquiries?filter=needs_reply" icon={MailWarning} value={stats.unanswered} label="Awaiting reply" />
        <StatCard href="/jobs" icon={HardHat} value={stats.activeJobs} label="Active jobs" />
        <StatCard
          href="/payments"
          icon={CirclePoundSterling}
          value={stats.depositsDueCount}
          label="Deposits due"
          sub={stats.depositsDueTotal ? gbp(stats.depositsDueTotal) : undefined}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          <section>
            <SectionHeader title="Today's priorities" />
            <Priorities items={todaysPriorities(data)} />
          </section>
          <section>
            <SectionHeader title="My jobs" href="/jobs" />
            <div className="space-y-3">
              {data.jobs
                .filter(isActiveJob)
                .slice(0, 4)
                .map((j) => {
                  const f = jobFinance(j, data.payments);
                  return (
                    <button
                      key={j.id}
                      onClick={() => ui.openJob(j.id)}
                      className="card-surface flex w-full items-center gap-4 rounded-2xl p-3 text-left transition hover:bg-white/[0.05]"
                    >
                      <JobTile kind={j.kind} className="size-[72px]" />
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
                        <div className="tabular mt-1.5 text-[14px] text-foreground/90">
                          {gbp(j.quotedValue)} <span className="px-1 text-subtle">|</span>
                          {f.totalPaid > 0 ? `${gbp(f.totalPaid)} paid (${f.paidPercent}%)` : f.depositOutstanding ? `Deposit due ${gbp(f.depositOutstanding)}` : "Not paid"}
                        </div>
                        {f.totalPaid > 0 ? <ProgressBar value={f.paidPercent} className="mt-2" /> : null}
                      </div>
                    </button>
                  );
                })}
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section>
            <SectionHeader title="Coming up" href="/reminders" />
            <Card className="p-1.5">
              {data.reminders
                .filter((r) => !r.done)
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                .slice(0, 4)
                .map((r) => (
                  <Link key={r.id} href="/reminders" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04]">
                    <AlarmClock className="size-4 shrink-0 text-copper-400" />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{r.title}</span>
                    <span className={cn("shrink-0 text-[12.5px]", r.dueDate < new Date().toISOString().slice(0, 10) ? "text-red-300" : "text-muted-foreground")}>
                      {formatDateKey(r.dueDate)}
                    </span>
                  </Link>
                ))}
              {!data.reminders.some((r) => !r.done) ? <p className="px-3 py-3 text-[14px] text-muted-foreground">No reminders set.</p> : null}
            </Card>
          </section>
          <section>
            <SectionHeader title="Recent activity" href="/activity" />
            <Card className="p-4">
              <ol className="relative space-y-4 border-l border-white/10 pl-4">
                {data.activity.slice(0, 7).map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-copper-500 ring-4 ring-ink-900" />
                    <p className="text-[14px] leading-snug">{a.summary}</p>
                    <p className="mt-0.5 text-[12px] text-subtle">
                      {a.actor} · {timeAgo(a.at)}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}

function StatCard({
  href,
  icon: Icon,
  value,
  label,
  sub,
  highlight,
}: {
  href: string;
  icon: typeof Inbox;
  value: number;
  label: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group rounded-2xl p-4 transition lg:p-5",
        highlight ? "card-copper hover:brightness-110" : "card-surface hover:bg-white/[0.05]",
      )}
    >
      <Icon className={cn("size-7", highlight ? "text-copper-200" : "text-copper-400")} strokeWidth={1.6} />
      <div className="tabular mt-3 text-[34px] font-bold leading-none tracking-tight">{value}</div>
      <div className="mt-1.5 text-[14px] text-foreground/85">
        {label}
        {sub ? <span className="tabular ml-1 text-muted-foreground">· {sub}</span> : null}
      </div>
    </Link>
  );
}

function Priorities({ items }: { items: PriorityItem[] }) {
  const ui = useUI();
  const { actions } = useStore();
  if (!items.length) {
    return <EmptyState icon={PartyPopper} title="All caught up" body="No replies waiting, no deposits overdue, nothing due today." />;
  }
  return (
    <Card className="divide-y divide-white/[0.06]">
      {items.map((p) => {
        const Icon = p.kind === "reply" ? Reply : p.kind === "followup" ? MessageSquareReply : p.kind === "deposit" ? PoundSterling : AlarmClock;
        return (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3.5">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl ring-1",
                p.urgency < 5 ? "bg-red-500/10 text-red-300 ring-red-500/25" : "bg-copper-500/10 text-copper-300 ring-copper-500/25",
              )}
            >
              <Icon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">{p.title}</div>
              <div className="truncate text-[13px] text-muted-foreground">{p.detail}</div>
            </div>
            {p.kind === "reply" || p.kind === "followup" ? (
              <Button size="sm" variant="secondary" onClick={() => ui.openEnquiry(p.enquiryId)}>
                {p.kind === "reply" ? "Reply" : "Open"}
              </Button>
            ) : p.kind === "deposit" ? (
              <Button size="sm" variant="secondary" onClick={() => ui.openJob(p.jobId)}>
                Open
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const res = actions.toggleReminder(p.reminderId);
                  if (res.ok) toast("Reminder done");
                }}
              >
                <Check /> Done
              </Button>
            )}
          </div>
        );
      })}
    </Card>
  );
}
