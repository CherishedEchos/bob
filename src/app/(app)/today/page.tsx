"use client";

import * as React from "react";
import Link from "next/link";
import { AlarmClock, Camera, Check, ChevronDown, ChevronRight, HardHat, Inbox, PartyPopper, Phone, Plus, PoundSterling, Sparkles } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { isActiveJob, isInvoiceOverdue, jobNextStep, needsReply, needsWrittenReply, quoteNeedsFollowUp, tasksDue, todaysPriorities, type PriorityItem } from "@/lib/derive";
import type { Snapshot } from "@/lib/types";
import { cn, gbp, timeAgo } from "@/lib/utils";
import { usePriorityAction } from "@/components/common/priority-card";
import { SnapPhotoButton } from "@/components/common/photos";
import { JobTile } from "@/components/common/job-tile";
import { JobStatusBadge, SourceIcon } from "@/components/common/status";
import { Disclosure, ListPanel, ListRow, pageSecondaryClass, rowActionClass, textActionClass } from "@/components/common/bits";
import { Menu, type MenuItem } from "@/components/ui/menu";

interface Reports {
  enquiries: { total: number; period: string; bySource: { label: string; count: number }[]; needsAction: number; won: number; coverage: string };
  jobs: { won: number; wonValue: number | null; wonPeriod: string; active: number; bookedNextWeek: { id: string }[]; nextWeekLabel: string };
  quotes: { sentCount: number; sentValue: number; accepted: number; period: string; needFollowUp: unknown[] } | null;
  money: { invoicedTotal: number; overdueTotal: number; overdueCount: number; depositsTotal: number; source: string; lastUpdated: string | null } | null;
}

const FIRST = 3;

export default function TodayPage() {
  const { data, can } = useStore();
  const ui = useUI();
  const { send } = useBob();
  const finance = can("finance.read");
  const [reports, setReports] = React.useState<Reports | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const priorities = todaysPriorities(data, { includeFinance: finance });
  const shown = showAll ? priorities : priorities.slice(0, FIRST);
  // The written-reply queue the batch drafts (callbacks are calls, shown on their own row).
  const toDraft = data.enquiries.filter(needsWrittenReply).length;
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const askBob = (t: string, via: "voice" | "text" = "text") => {
    void send(t, via);
    ui.setAssistantOpen(true);
  };

  React.useEffect(() => {
    void api<Reports>("/api/reports").then((r) => r.status === 200 && setReports(r.body));
  }, [data.generatedAt]);

  const addItems: MenuItem[] = [
    ...(can("enquiries.write") ? [{ label: "Log an enquiry", icon: Inbox, onSelect: () => ui.openForm({ form: "enquiry" }) }] : []),
    ...(can("jobs.write") ? [{ label: "Add a job", icon: HardHat, onSelect: () => ui.openForm({ form: "job" }) }] : []),
    ...(can("notes.write") ? [{ label: "Add a photo", icon: Camera, htmlFor: "today-photo", hint: "Bob suggests the job" }] : []),
    ...(can("payments.record") ? [{ label: "Record a payment", icon: PoundSterling, onSelect: () => ui.openForm({ form: "payment" }) }] : []),
    ...(can("tasks.write") ? [{ label: "Add reminder", icon: AlarmClock, onSelect: () => ui.openForm({ form: "reminder" }) }] : []),
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 lg:gap-5">
      {/* Header: date and Add new… (demo mode shows in the bar above / the phone's top bar) */}
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Today</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">{date}</p>
        </div>
        {addItems.length ? (
          <Menu
            label="Add new…"
            items={addItems}
            triggerClassName={pageSecondaryClass}
            trigger={
              <>
                <Plus className="size-[18px]" aria-hidden /> Add new…
              </>
            }
          />
        ) : null}
        <SnapPhotoButton inputId="today-photo" hideTrigger />
      </header>

      {/* Needs attention: the worklist */}
      <ListPanel
        id="attn"
        title="Needs attention"
        count={priorities.length}
        action={
          toDraft > 0 && can("enquiries.write") ? (
            <Link
              href="/replies"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgb(16_24_40/0.12)] transition hover:bg-copper-600 active:bg-copper-700 sm:w-auto"
            >
              <Sparkles className="size-4" aria-hidden /> Draft {toDraft} {toDraft === 1 ? "reply" : "replies"}
            </Link>
          ) : null
        }
        footer={
          priorities.length > FIRST ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} aria-controls="attn-list" className={textActionClass}>
              {showAll ? "Show fewer" : `Show ${priorities.length - FIRST} more`}
              <ChevronDown className={cn("size-4 transition", showAll && "rotate-180")} aria-hidden />
            </button>
          ) : null
        }
      >
        {priorities.length ? (
          <ul id="attn-list" className="divide-y divide-line">
            {shown.map((p) => (
              <AttentionRow key={p.key} item={p} onAskBob={(t) => askBob(t)} />
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 px-4 py-6 lg:px-5">
            <PartyPopper className="size-5 text-accent-icon" />
            <p className="text-[15px] text-muted-foreground">You&apos;re all caught up — nothing needs you right now.</p>
          </div>
        )}
      </ListPanel>

      {/* Everything else, one tap away */}
      <Disclosure id="glance" title="Business at a glance" summary={<GlanceSummary data={data} finance={finance} />}>
        <Summary data={data} finance={finance} />
        <ActiveJobs data={data} finance={finance} />
        {reports ? <Figures reports={reports} /> : <div className="h-40 animate-pulse border-t border-line" />}
      </Disclosure>
    </div>
  );
}

function GlanceSummary({ data, finance }: { data: Snapshot; finance: boolean }) {
  const jobs = data.jobs.filter(isActiveJob).length;
  const quotes = data.quotes.filter(quoteNeedsFollowUp).length;
  const overdue = data.invoices.filter(isInvoiceOverdue).length;
  return (
    <>
      {jobs} active {jobs === 1 ? "job" : "jobs"} · {quotes} {quotes === 1 ? "quote" : "quotes"} to chase
      {finance ? ` · ${overdue} overdue ${overdue === 1 ? "invoice" : "invoices"}` : ""}
    </>
  );
}

function ActiveJobs({ data, finance }: { data: Snapshot; finance: boolean }) {
  const ui = useUI();
  const jobs = data.jobs.filter(isActiveJob);
  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between px-4 pt-3 lg:px-5">
        <h3 className="t-eyebrow">Active jobs · {jobs.length}</h3>
        <Link href="/jobs" className={textActionClass}>
          View all <ChevronRight className="size-4" />
        </Link>
      </div>
      {jobs.length ? (
        <ul className="divide-y divide-line">
          {jobs.slice(0, 5).map((j) => (
            <ListRow
              key={j.id}
              onOpen={() => ui.openJob(j.id)}
              leading={<JobTile kind={j.kind} className="size-9 rounded-lg [&_svg]:size-[18px]" />}
              title={`${j.title} · ${j.customerName}`}
              meta={
                <>
                  <span className="text-accent-fg">Next:</span> {jobNextStep(j, data, finance)}
                </>
              }
              action={<JobStatusBadge status={j.status} className="hidden sm:inline-flex" />}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-4 text-[15px] text-muted-foreground lg:px-5">No active jobs.</p>
      )}
    </div>
  );
}

/* ------------------------------ Summary ------------------------------ */

type Tone = "amber" | "sky" | "rose" | "violet";
const TONE: Record<Tone, { num: string; bar: string }> = {
  amber: { num: "text-accent-fg", bar: "bg-copper-500" },
  sky: { num: "text-info-fg", bar: "bg-sky-500" },
  rose: { num: "text-danger-fg", bar: "bg-red-500" },
  violet: { num: "text-violet-fg", bar: "bg-violet-500" },
};

function Summary({ data, finance }: { data: Snapshot; finance: boolean }) {
  const { can } = useStore();
  const awaiting = data.enquiries.filter(needsReply).length;
  const toDraft = data.enquiries.filter(needsWrittenReply).length;
  const quotes = data.quotes.filter(quoteNeedsFollowUp).length;
  const figures: { value: number; label: string; href: string; tone: Tone; batch?: boolean }[] = [
    { value: awaiting, label: "Awaiting reply", href: "/enquiries?tab=reply", tone: "amber", batch: toDraft > 0 && can("enquiries.write") },
    { value: quotes, label: "Quotes to chase", href: "/enquiries?tab=follow", tone: "sky" },
    finance
      ? { value: data.invoices.filter(isInvoiceOverdue).length, label: "Overdue invoices", href: "/invoices?filter=overdue", tone: "rose" }
      : { value: tasksDue(data.tasks).length, label: "Reminders due", href: "/tasks", tone: "violet" },
  ];
  return (
    <nav aria-label="Summary" className="grid grid-cols-3 divide-x divide-line">
      {figures.map((f) => {
        const t = TONE[f.tone];
        const on = f.value > 0;
        return (
          <div key={f.label} className="group relative flex flex-col gap-1 px-4 py-3.5 transition hover:bg-surface-2 lg:px-5">
            <Link href={f.href} aria-label={`${f.value} ${f.label}`} className="absolute inset-0 z-0" />
            <span aria-hidden className={cn("absolute left-4 right-4 top-0 h-[2px] rounded-full lg:left-5 lg:right-5", on ? t.bar : "bg-transparent")} />
            <span aria-hidden className={cn("pointer-events-none tabular text-[28px] font-semibold leading-none tracking-tight", on ? t.num : "text-subtle")} data-figure={f.label}>
              {f.value}
            </span>
            <span aria-hidden className="pointer-events-none text-[13.5px] leading-tight text-muted-foreground">{f.label}</span>
            {f.batch ? (
              <Link href="/replies" className="relative z-10 mt-1 inline-flex h-9 w-fit items-center whitespace-nowrap text-[13.5px] font-semibold text-accent-fg hover:text-copper-700">
                Draft replies <ChevronRight className="size-3.5" />
              </Link>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

/* ------------------------------ Needs attention ------------------------------ */

function AttentionRow({ item, onAskBob }: { item: PriorityItem; onAskBob: (t: string) => void }) {
  const { open, action, busy, Icon } = usePriorityAction(item, onAskBob);
  const urgent = item.kind === "invoice" || (item.kind === "deposit" && item.title.includes("overdue"));
  const label = (
    <>
      {item.kind === "task" ? <Check className="size-4" aria-hidden /> : null}
      {action.href ? <Phone className="size-4" aria-hidden /> : null}
      <span className="sm:hidden">{action.short}</span>
      <span className="hidden sm:inline">{action.label}</span>
    </>
  );
  return (
    <ListRow
      onOpen={open}
      openLabel={`Open ${item.who}: ${item.why}`}
      leading={
        "source" in item ? (
          <SourceIcon source={item.source} provider={item.provider} />
        ) : (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-[10px]", urgent ? "bg-red-500/10 text-danger-fg" : "bg-copper-500/10 text-accent-icon")}>
            <Icon className="size-[17px]" />
          </span>
        )
      }
      title={item.who}
      meta={item.why}
      action={
        action.href ? (
          <a href={action.href} aria-label={`${action.label} on ${item.kind === "reply" ? (item.callback?.phone ?? "") : ""}`} className={rowActionClass}>
            {label}
          </a>
        ) : (
          <button type="button" onClick={() => void action.run()} disabled={busy} aria-label={`${action.label}: ${item.who}`} className={rowActionClass}>
            {label}
          </button>
        )
      }
    />
  );
}

/* ------------------------------ Jobs & figures ------------------------------ */

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
    <section aria-label="Business figures" className="border-t border-line">
      <div className="divide-y divide-line">
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
            <Row label="Outstanding invoices" value={gbp(r.money.invoicedTotal)} />
            <Row label="Of which overdue" value={`${gbp(r.money.overdueTotal)}${r.money.overdueCount ? ` (${r.money.overdueCount})` : ""}`} tone={r.money.overdueTotal ? "warn" : undefined} />
            <Row label="Deposits due" value={gbp(r.money.depositsTotal)} />
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
