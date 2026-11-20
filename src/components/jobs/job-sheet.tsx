"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilesPanel } from "@/components/files/files-panel";
import { HandoverPanel } from "@/components/files/handover-panel";
import { AddUpdateButton, UpdatesTimeline } from "@/components/updates/updates-timeline";
import { ReportTab } from "@/components/reports/report-tab";
import { VariationsPanel } from "@/components/jobs/variations";

import * as React from "react";
import { PackageCheck } from "lucide-react";
import { AlarmClock, CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, Lock, Hammer, Inbox, MapPin, MoreHorizontal, Pencil, Phone, PoundSterling, ReceiptText, Trash2, UserRound } from "lucide-react";
import type { JobTab } from "@/lib/store/ui";
import { formatTimeRange, relativeDayInline } from "@/lib/dates";
import { nextBookingForJob } from "@/lib/schedule";
import { JobCrew, JobMaterials, JobSchedule, JobTasks, SharedInstructions } from "./job-parts";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import {
  EXPENSE_CATEGORY_LABEL, JOB_STATUSES, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, invoiceStatusLabel, jobFinance, jobNextStep, paymentsForJob,
} from "@/lib/derive";
import { addDaysKey, cn, firstName, formatDateKey, gbp, timeAgo, todayKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { JobStatusBadge } from "@/components/common/status";
import { Badge } from "@/components/ui/badge";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { JobTile } from "@/components/common/job-tile";
import { MoneyRow, ProgressBar } from "@/components/common/bits";
import { NotesPanel } from "@/components/common/notes";

/** A folded section inside a record: title + one-line summary, tap to open. */
export function Fold({ title, summary, children, defaultOpen = false, last = false }: { title: string; summary?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; last?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <section className={cn("border-t border-line", last && "pb-8")}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-surface-2 sm:px-6">
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold">{title}</span>
          {summary && !open ? <span className="mt-0.5 block truncate text-[14px] text-muted-foreground">{summary}</span> : null}
        </span>
        <ChevronRight className={cn("size-5 shrink-0 text-subtle transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div id={id} className="px-5 pb-5 sm:px-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-line px-5 py-5 sm:px-6", className)}>
      <h3 className="mb-3 text-[14px] font-semibold uppercase tracking-wider text-subtle">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The job workspace (/jobs/[id]): header with status, customer, site and next
 * booking; the primary action beside it; then Overview, Schedule & team,
 * Tasks, Materials, Files & photos, Handover and Money.
 */
export function JobWorkspace({ id, initialTab }: { id: string; initialTab?: JobTab }) {
  const { data, actions, can, user } = useStore();
  const ui = useUI();
  const j = data.jobs.find((x) => x.id === id)!;
  const fileCount = new Set(data.files.filter((x) => x.jobId === id && !x.deletedAt).map((x) => x.groupId)).size;
  const money = can("finance.read");
  const f = jobFinance(j, data.payments, data.expenses, data.invoices);
  const payments = paymentsForJob(data.payments, j.id);
  const expenses = data.expenses.filter((e) => e.jobId === j.id);
  const invoices = data.invoices.filter((i) => i.jobId === j.id);
  const [nextAction, setNextAction] = React.useState(j.nextAction ?? "");
  const [editingNext, setEditingNext] = React.useState(false);
  const router = useRouter();
  const manager = user.role === "owner" || user.role === "office";
  const allowed = (t?: JobTab): JobTab => (!t || (t === "money" && !money) || ((t === "handover" || t === "report") && !manager) ? "overview" : t);
  const [tab, setTabState] = React.useState<JobTab>(allowed(initialTab));
  React.useEffect(() => setTabState(allowed(initialTab)), [initialTab, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (t: JobTab) => {
    setTabState(t);
    router.replace(`/jobs/${encodeURIComponent(id)}${t === "overview" ? "" : `?tab=${t}`}`, { scroll: false });
  };
  const today = todayKey();
  const nextBooking = nextBookingForJob(data.bookings, j.id, today);
  const tabs: { value: JobTab; label: string; count?: number }[] = [
    { value: "overview", label: "Overview" },
    { value: "schedule", label: "Schedule & team", count: data.bookings.filter((b) => b.jobId === j.id && (b.endDate ?? b.date) >= today).length },
    { value: "tasks", label: "Tasks", count: data.tasks.filter((t) => !t.done && t.relatedType === "job" && t.relatedId === j.id).length },
    { value: "materials", label: "Materials", count: data.materials.filter((m) => m.jobId === j.id && m.status === "to_order").length },
    { value: "files", label: "Files & photos", count: fileCount },
    ...(manager ? [{ value: "report" as const, label: "Handover report", count: data.reportVersions.filter((v) => v.jobId === id).length }] : []),
    ...(manager ? [{ value: "handover" as const, label: "Handover pack", count: data.handovers.filter((h) => h.jobId === id).length }] : []),
    ...(money ? [{ value: "money" as const, label: "Money" }] : []),
  ];
  const activity = jobActivity(data, j.id);

  React.useEffect(() => setNextAction(j.nextAction ?? ""), [j.id, j.nextAction]);
  const saveNext = async () => {
    const res = await actions.updateJob(j.id, { nextAction: nextAction.trim() });
    toast(res.ok ? "Next step updated" : Object.values(res.errors)[0] ?? "Couldn't save", res.ok ? "success" : "error");
    if (res.ok) setEditingNext(false);
  };

  const reminder = () =>
    ui.openForm({ form: "reminder", title: j.nextAction ?? `Check in on ${j.customerName}'s ${j.title.toLowerCase()}`, dueDate: addDaysKey(1), customerId: j.customerId, relatedType: "job", relatedId: j.id });
  const invoice = () => ui.openForm({ form: "invoice", customerId: j.customerId, jobId: j.id });
  const payment = () => ui.openForm({ form: "payment", jobId: j.id });
  // Money actions live with the payment status, not with the job's next step.
  const moneyAction =
    money && can("payments.record") && f.depositOutstanding > 0 && j.status !== "quoted"
      ? { label: "Record deposit", icon: PoundSterling, run: payment }
      : money && can("invoices.draft") && f.balance > 0 && (j.status === "snagging" || j.status === "completed") && !invoices.some((i) => i.status !== "void")
        ? { label: "Create invoice draft", icon: ReceiptText, run: invoice }
        : money && can("payments.record") && f.balance > 0 && j.status !== "quoted"
          ? { label: "Record payment", icon: PoundSterling, run: payment }
          : null;
  const paymentStatus = !money
    ? null
    : j.depositRequired > 0 && f.depositOutstanding > 0 && j.status !== "quoted"
      ? {
          tone: f.depositOverdue ? ("red" as const) : ("amber" as const),
          text: `${gbp(f.depositOutstanding)} deposit ${f.depositOverdue ? "overdue" : f.depositDaysUntilDue !== null ? (f.depositDaysUntilDue === 0 ? "due today" : `due in ${f.depositDaysUntilDue} day${f.depositDaysUntilDue === 1 ? "" : "s"}`) : "not yet paid"}`,
        }
      : f.balance === 0 && j.quotedValue > 0
        ? { tone: "green" as const, text: "Paid in full" }
        : { tone: "neutral" as const, text: j.depositRequired > 0 ? `Deposit paid · ${gbp(f.balance)} left to pay` : `${gbp(f.balance)} left to pay` };
  const more: MenuItem[] = [
    ...(money && can("payments.record") && f.balance > 0 && moneyAction?.run !== payment ? [{ label: "Record payment", icon: PoundSterling, onSelect: payment }] : []),
    ...(money && can("invoices.draft") && moneyAction?.run !== invoice ? [{ label: "Create invoice draft", icon: ReceiptText, onSelect: invoice }] : []),
    ...(can("expenses.write") ? [{ label: "Add a cost", icon: Hammer, onSelect: () => ui.openForm({ form: "expense", jobId: j.id }) }] : []),
    { label: "Customer details", icon: UserRound, onSelect: () => ui.openCustomer(j.customerId) },
    ...(j.enquiryId ? [{ label: "Original enquiry", icon: Inbox, onSelect: () => ui.openEnquiry(j.enquiryId!) }] : []),
  ];

  const crewNames = nextBooking ? nextBooking.personIds.map((pid) => data.people.find((p) => p.id === pid)?.name.split(" ")[0]).filter(Boolean).join(", ") : "";
  // One clear primary action: finished jobs go to handover; otherwise schedule or edit the next booking.
  const primary =
    (j.status === "completed" || j.status === "snagging") && manager ? (
      <Button className="w-full sm:w-auto" onClick={() => setTab("report")}>
        <PackageCheck /> {data.reports.some((r) => r.jobId === j.id) ? "Handover report" : "Create handover report"}
      </Button>
    ) : j.status === "completed" || j.status === "lost" ? null : can("schedule.manage") ? (
      nextBooking ? (
        <Button variant="secondary" className="w-full sm:w-auto" onClick={() => ui.openForm({ form: "booking", bookingId: nextBooking.id })}>
          <CalendarClock /> Edit booking
        </Button>
      ) : (
        <Button className="w-full sm:w-auto" onClick={() => ui.openForm({ form: "booking", jobId: j.id })}>
          <CalendarPlus /> Schedule work
        </Button>
      )
    ) : null;

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <Link href="/jobs" className="mb-3 inline-flex h-10 items-center gap-1.5 rounded-lg pr-2 text-[14.5px] font-semibold text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Jobs
      </Link>
      <header className="panel px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <JobTile kind={j.kind} className="hidden size-14 sm:grid" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-page text-[26px] lg:text-[30px]">{j.title}</h1>
                <JobStatusBadge status={j.status} />
                {paymentStatus && paymentStatus.tone !== "neutral" ? <Badge tone={paymentStatus.tone}>{paymentStatus.text}</Badge> : null}
              </div>
              <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Customer</dt>
                  <UserRound className="size-4 text-subtle" aria-hidden />
                  <dd>
                    <button className="font-medium text-foreground hover:text-accent-fg hover:underline" onClick={() => ui.openCustomer(j.customerId)}>
                      {j.customerName}
                    </button>
                  </dd>
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <dt className="sr-only">Site</dt>
                  <MapPin className="size-4 shrink-0 text-accent-icon" aria-hidden />
                  <dd className="min-w-0 truncate text-foreground/90">{j.siteAddress || j.location}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Next booking</dt>
                  <CalendarClock className="size-4 text-subtle" aria-hidden />
                  <dd className={nextBooking ? "text-foreground/90" : "text-muted-foreground"}>
                    {nextBooking ? (
                      <>
                        <span className="font-semibold text-foreground">{nextBooking.date < today ? "On site today" : `Booked ${relativeDayInline(nextBooking.date, today)}`}</span> · {formatTimeRange(nextBooking.startTime, nextBooking.endTime)}
                        {" · "}
                        {crewNames || <span className="font-semibold text-warn-fg">Unassigned</span>}
                      </>
                    ) : (
                      "Not scheduled yet"
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end [&>*:last-child]:order-first sm:[&>*:last-child]:order-none">
            {j.customerPhone ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`tel:${j.customerPhone.replace(/\s/g, "")}`}>
                  <Phone /> Call {firstName(j.customerName)}
                </a>
              </Button>
            ) : null}
            <Menu
              label="More actions"
              items={[{ label: "Add task", icon: AlarmClock, onSelect: reminder }, ...more]}
              triggerClassName="flex h-11 items-center gap-1.5 rounded-xl px-3.5 text-[15px] font-medium text-foreground ring-1 ring-line-strong transition hover:bg-raised-hover"
              trigger={
                <>
                  <MoreHorizontal className="size-5" aria-hidden /> More
                </>
              }
            />
            {primary}
          </div>
        </div>
      </header>

      {/* Sections: tabs on desktop, a scrollable strip on phones */}
      <div role="tablist" aria-label="Job sections" className="sticky top-0 z-10 -mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-line bg-app/95 px-4 backdrop-blur scrollbar-none lg:mx-0 lg:px-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`tab-${t.value}`}
            aria-selected={tab === t.value}
            aria-controls="job-tabpanel"
            onClick={() => setTab(t.value)}
            className={cn(
              "relative flex h-12 shrink-0 items-center gap-1.5 rounded-t-lg px-3 text-[15px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              tab === t.value ? "text-accent-fg after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-t after:bg-copper-500" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count ? <span className="tabular rounded-md bg-surface-3 px-1.5 text-[12px] text-muted-foreground">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div id="job-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-4">
      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <div className="flex min-w-0 flex-col gap-4">
            <section aria-labelledby={`next-${j.id}`} className="panel px-5 py-4 sm:px-6">
              <h2 id={`next-${j.id}`} className="t-eyebrow text-accent-fg">
                Next step
              </h2>
              {editingNext ? (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void saveNext();
                  }}
                >
                  <Input autoFocus value={nextAction} onChange={(ev) => setNextAction(ev.target.value)} placeholder="What's the next thing to do?" aria-label="Next step" />
                  <Button type="submit" disabled={(j.nextAction ?? "") === nextAction.trim()}>
                    <Check /> Save
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNextAction(j.nextAction ?? "");
                      setEditingNext(false);
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-[17px] font-semibold leading-snug text-heading">{jobNextStep(j, data, money)}</p>
                  {can("jobs.write") ? (
                    <Button size="sm" variant="ghost" className="-mr-2" onClick={() => setEditingNext(true)}>
                      <Pencil /> Update
                    </Button>
                  ) : null}
                </div>
              )}
            </section>

            <section className="panel px-5 py-4 sm:px-6" aria-labelledby={`upd-${j.id}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id={`upd-${j.id}`} className="t-eyebrow">Updates from site</h2>
                <AddUpdateButton job={j} />
              </div>
              <UpdatesTimeline job={j} limit={4} />
            </section>

            <section className="panel px-5 py-4 sm:px-6" aria-labelledby={`desc-${j.id}`}>
              <h2 id={`desc-${j.id}`} className="t-eyebrow">
                About the job
              </h2>
              <p className="reading mt-1.5 whitespace-pre-wrap text-[15.5px] leading-relaxed text-foreground/90">{j.description || "No description yet."}</p>
            </section>

            <div className="panel overflow-hidden [&>section:first-child]:border-t-0">
              <SharedInstructions job={j} />
            </div>

            <section className="panel px-5 py-4 sm:px-6" aria-labelledby={`notes-${j.id}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id={`notes-${j.id}`} className="t-eyebrow">
                  Internal notes
                </h2>
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-[12.5px] font-medium text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden /> Office only — never shown to workers or customers
                </span>
              </div>
              <NotesPanel notes={j.notes} onAdd={(t) => actions.addJobNote(j.id, t)} />
            </section>
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <section className="panel px-5 py-4" aria-labelledby={`dates-${j.id}`}>
              <h2 id={`dates-${j.id}`} className="t-eyebrow">
                Key dates
              </h2>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
                <dt className="text-muted-foreground">Start</dt>
                <dd>{j.startDate ? formatDateKey(j.startDate) : "Not set"}</dd>
                <dt className="text-muted-foreground">Next on site</dt>
                <dd>{nextBooking ? formatDateKey(nextBooking.date) : "Nothing booked"}</dd>
                {money ? (
                  <>
                    <dt className="text-muted-foreground">Deposit due</dt>
                    <dd>{j.depositDueDate ? formatDateKey(j.depositDueDate) : "Not set"}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Added</dt>
                <dd>{formatDateKey(j.createdAt.slice(0, 10))}</dd>
              </dl>
              {can("jobs.write") ? (
                <label className="mt-3 block">
                  <span className="mb-1 block text-[13.5px] font-medium text-muted-foreground">Job status</span>
                  <NativeSelect
                    value={j.status}
                    onChange={async (e) => {
                      const s = e.target.value as (typeof JOB_STATUSES)[number];
                      const res = await actions.setJobStatus(j.id, s);
                      toast(res.ok ? `Moved to ${JOB_STATUS_LABEL[s]}` : Object.values(res.errors)[0] ?? "Couldn't update", res.ok ? "success" : "error");
                    }}
                    className="h-11"
                  >
                    {JOB_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {JOB_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
            </section>
            <div className="panel overflow-hidden [&>section:first-child]:border-t-0">
              <JobCrew job={j} />
            </div>
            <section className="panel px-5 py-4" aria-labelledby={`act-${j.id}`}>
              <h2 id={`act-${j.id}`} className="t-eyebrow">
                Recent activity
              </h2>
              {activity.length ? (
                <ol className="mt-2 space-y-2.5">
                  {activity.slice(0, 8).map((a) => (
                    <li key={a.id} className="text-[14.5px] leading-snug">
                      <span className="text-foreground">{a.summary}</span>
                      <span className="block text-[13px] text-muted-foreground">
                        {a.actor} · {timeAgo(a.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-[14.5px] text-muted-foreground">{can("activity.read") ? "Nothing yet." : "Activity is visible to owners and admins."}</p>
              )}
            </section>
          </aside>
        </div>
      ) : null}

      {tab === "files" ? (
        <div className="panel px-4 py-4 sm:px-6 sm:py-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
            <p className="text-[14.5px] text-muted-foreground">On site? Add photos with a line about what&apos;s been done — they&apos;re kept together as a dated update.</p>
            <AddUpdateButton job={j} />
          </div>
          <FilesPanel jobId={j.id} />
        </div>
      ) : null}
      {tab === "report" ? (
        <div className="panel px-4 py-4 sm:px-6 sm:py-5">
          <ReportTab job={j} />
        </div>
      ) : null}
      {tab === "handover" ? (
        <div className="panel px-4 py-4 sm:px-6 sm:py-5">
          <HandoverPanel job={j} />
        </div>
      ) : null}
      {tab === "schedule" ? <div className="panel overflow-hidden"><JobSchedule job={j} /></div> : null}
      {tab === "tasks" ? <div className="panel overflow-hidden"><JobTasks job={j} /></div> : null}
      {tab === "materials" ? <div className="panel overflow-hidden"><JobMaterials job={j} /></div> : null}

      {tab === "money" && money ? (
        <div className="panel overflow-hidden">
          <VariationsPanel job={j} />
          <div className="px-5 pb-5 sm:px-6">
        {money ? (
          <section aria-labelledby={`pay-${j.id}`} className="mt-3 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-line">
            <div className="flex items-center justify-between gap-3">
              <h3 id={`pay-${j.id}`} className="t-eyebrow">
                Payment
              </h3>
              {paymentStatus ? <Badge tone={paymentStatus.tone}>{paymentStatus.text}</Badge> : null}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              {[
                ["Price", gbp(j.quotedValue), ""],
                ["Paid", gbp(f.totalPaid), "text-good-fg"],
                ["Left to pay", gbp(f.balance), f.balance > 0 ? "text-foreground" : "text-good-fg"],
              ].map(([l, v, cls]) => (
                <div key={l}>
                  <div className={cn("tabular text-[19px] font-semibold", cls)}>{v}</div>
                  <div className="text-[13px] text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <ProgressBar value={f.paidPercent} className="flex-1" />
              <span className="tabular text-[13px] text-muted-foreground">{f.paidPercent}% paid</span>
            </div>
            {moneyAction ? (
              <Button size="sm" className="mt-3" onClick={moneyAction.run}>
                <moneyAction.icon /> {moneyAction.label}
              </Button>
            ) : null}
          </section>
        ) : null}
          </div>
      {money ? (
        <Fold title="Payments" summary={payments.length ? `${payments.length} · ${gbp(f.totalPaid)} received` : "None yet"}>
          <MoneyRow label="Deposit required" value={gbp(j.depositRequired)} />
          <MoneyRow
            label="Deposit received"
            value={gbp(Math.min(f.totalPaid, j.depositRequired))}
            tone={f.depositOutstanding === 0 && j.depositRequired > 0 ? "green" : f.depositOverdue ? "red" : "amber"}
          />
          {payments.length ? (
            <ul className="mt-2 divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium">{PAYMENT_TYPE_LABEL[p.type]}</div>
                    <div className="text-[13.5px] text-muted-foreground">
                      {formatDateKey(p.receivedAt)} · {PAYMENT_METHOD_LABEL[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""} · by {p.recordedBy}
                    </div>
                  </div>
                  <div className="tabular text-[16px] font-semibold text-good-fg">{gbp(p.amount)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[15px] text-muted-foreground">No payments recorded yet.</p>
          )}
        </Fold>
      ) : null}

      {money ? (
        <Fold title="Invoices" summary={invoices.length ? invoices.map((i) => `${i.number ?? i.draftRef} ${invoiceStatusLabel(i).toLowerCase()}`).join(" · ") : "None yet"}>
          {invoices.length ? (
            <ul className="divide-y divide-line">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <div className="text-[15px] font-medium">{i.number ?? i.draftRef}</div>
                    <div className="text-[13.5px] text-muted-foreground">
                      {invoiceStatusLabel(i)}
                      {i.dueDate ? ` · due ${formatDateKey(i.dueDate)}` : ""}
                    </div>
                  </div>
                  <div className="tabular text-[16px] font-semibold">{gbp(i.total)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-muted-foreground">No invoices for this job yet.</p>
          )}
        </Fold>
      ) : null}

      {money ? (
        <Fold title="Costs" summary={expenses.length ? `${expenses.length} · ${gbp(f.expenses)}` : "None recorded"}>
          {expenses.length ? (
            <ul className="divide-y divide-line">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium">{e.description}</div>
                    <div className="text-[13.5px] text-muted-foreground">
                      {EXPENSE_CATEGORY_LABEL[e.category]} · {formatDateKey(e.incurredOn)} · by {e.recordedBy}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="tabular text-[16px] font-semibold">{gbp(e.amount)}</span>
                    {can("expenses.write") ? (
                      <button
                        aria-label={`Remove ${e.description}`}
                        className="grid size-9 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-danger-fg"
                        onClick={async () => {
                          const r = await actions.removeExpense(e.id);
                          toast(r.ok ? "Cost removed" : "Couldn't remove", r.ok ? "success" : "error");
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-muted-foreground">No costs recorded. Tell Bob “add £450 of materials to this job”, or use More → Add a cost.</p>
          )}
        </Fold>
      ) : null}

        </div>
      ) : null}
      </div>
    </div>
  );
}

/** Activity about this job: its own entries plus its tasks', newest first. */
function jobActivity(data: ReturnType<typeof useStore>["data"], jobId: string) {
  const taskIds = new Set(data.tasks.filter((t) => t.relatedType === "job" && t.relatedId === jobId).map((t) => t.id));
  return data.activity.filter((a) => (a.entityType === "job" && a.entityId === jobId) || (a.entityType === "task" && a.entityId && taskIds.has(a.entityId)));
}
