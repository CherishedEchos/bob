"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilesPanel } from "@/components/files/files-panel";
import { HandoverPanel } from "@/components/files/handover-panel";
import { AddUpdateButton, UpdatesTimeline } from "@/components/updates/updates-timeline";
import { ReportTab } from "@/components/reports/report-tab";
import { Tip } from "@/components/common/tip";
import { VariationsPanel } from "@/components/jobs/variations";

import * as React from "react";
import { PackageCheck } from "lucide-react";
import { AlarmClock, CalendarClock, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, ImagePlus, Lock, Hammer, Inbox, MapPin, MoreHorizontal, Navigation, Package, Pencil, Phone, PoundSterling, ReceiptText, Trash2, UserRound } from "lucide-react";
import type { JobTab } from "@/lib/store/ui";
import { formatTimeRange, relativeDayInline } from "@/lib/dates";
import { nextBookingForJob, peopleOnJob } from "@/lib/schedule";
import { jobFinancials, type JobFinancials } from "@/lib/job-financials";
import { JobCover, jobCovers } from "@/components/jobs/job-cover";
import { PeopleStack } from "@/components/common/people";
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
import { Badge } from "@/components/ui/badge";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { MoneyRow } from "@/components/common/bits";
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
  const money = can("finance.read");
  const f = jobFinance(j, data.payments, data.expenses, data.invoices);
  const payments = paymentsForJob(data.payments, j.id);
  const expenses = data.expenses.filter((e) => e.jobId === j.id);
  const invoices = data.invoices.filter((i) => i.jobId === j.id);
  const [nextAction, setNextAction] = React.useState(j.nextAction ?? "");
  const [editingNext, setEditingNext] = React.useState(false);
  const router = useRouter();
  const manager = user.role === "owner" || user.role === "office";
  const allowed = (t?: JobTab): JobTab => {
    const v: JobTab | undefined = t === "money" ? "financials" : t === "report" ? "handover" : t === "files" || t === "photos" ? "updates" : t === "tasks" ? "materials" : t;
    return !v || (v === "financials" && !money) || (v === "handover" && !manager) ? "overview" : v;
  };
  const [tab, setTabState] = React.useState<JobTab>(allowed(initialTab));
  React.useEffect(() => setTabState(allowed(initialTab)), [initialTab, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (t: JobTab) => {
    setTabState(t);
    router.replace(`/jobs/${encodeURIComponent(id)}${t === "overview" ? "" : `?tab=${t}`}`, { scroll: false });
  };
  const today = todayKey();
  const nextBooking = nextBookingForJob(data.bookings, j.id, today);
  const jobFiles = data.files.filter((x) => x.jobId === id && !x.deletedAt);
  const photoCount = new Set(jobFiles.filter((x) => x.category === "progress" || x.category === "completion").map((x) => x.groupId)).size;
  const docCount = new Set(jobFiles.filter((x) => x.category === "drawing" || x.category === "other").map((x) => x.groupId)).size;
  const tabs: { value: JobTab; label: string; count?: number }[] = [
    { value: "overview", label: "Overview" },
    { value: "schedule", label: "Schedule", count: data.bookings.filter((b) => b.jobId === j.id && (b.endDate ?? b.date) >= today).length },
    { value: "updates", label: "Updates & photos", count: data.updates.filter((u) => u.jobId === j.id).length + photoCount },
    { value: "documents", label: "Documents", count: docCount },
    { value: "materials", label: "Materials & tasks", count: data.materials.filter((m) => m.jobId === j.id && m.status === "to_order").length + data.tasks.filter((t) => !t.done && t.relatedType === "job" && t.relatedId === j.id).length },
    ...(money ? [{ value: "financials" as const, label: "Financials" }] : []),
    ...(manager ? [{ value: "handover" as const, label: "Handover" }] : []),
  ];
  const fin = jobFinancials(j, data);
  const covers = jobCovers(data.files);
  const crew = peopleOnJob(data.bookings, data.people, j.id, today);
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.siteAddress || j.location)}`;
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
      ) : null
    ) : null;

  const goPhotos = () => {
    setTab("updates");
    setTimeout(() => document.getElementById("job-photos")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };
  // Phones: a 3-up grid of icon-over-label buttons (no sideways scrolling). Wider screens: one row.
  const quickBtn = "h-auto min-h-[58px] flex-col gap-1 px-1.5 py-2 text-[12.5px] leading-tight sm:min-h-0 sm:h-9 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-[13.5px]";
  const quick = [
    can("notes.write") ? <AddUpdateButton key="u" job={j} variant="secondary" size="sm" className={quickBtn} /> : null,
    can("notes.write") ? (
      <Button key="p" size="sm" variant="secondary" className={quickBtn} onClick={goPhotos}>
        <ImagePlus /> Upload photo
      </Button>
    ) : null,
    can("schedule.manage") && j.status !== "completed" && j.status !== "lost" ? (
      <Button key="s" size="sm" variant="secondary" className={quickBtn} onClick={() => ui.openForm({ form: "booking", jobId: j.id })}>
        <CalendarPlus /> Schedule work
      </Button>
    ) : null,
    can("materials.write") ? (
      <Button key="m" size="sm" variant="secondary" className={quickBtn} onClick={() => ui.openForm({ form: "material", jobId: j.id })}>
        <Package /> Add material
      </Button>
    ) : null,
    money && can("invoices.draft") ? (
      <Button key="i" size="sm" variant="secondary" className={quickBtn} onClick={invoice}>
        <ReceiptText /> Create invoice
      </Button>
    ) : null,
  ].filter(Boolean);

  const upcoming = data.bookings.filter((b) => b.jobId === j.id && (b.endDate ?? b.date) >= today).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 3);
  const openTasks = data.tasks.filter((t) => !t.done && t.relatedType === "job" && t.relatedId === j.id);
  const toOrder = data.materials.filter((m) => m.jobId === j.id && m.status === "to_order");

  return (
    <div className="mx-auto w-full max-w-[1480px]">
      <Link href="/jobs" className="mb-3 hidden h-9 items-center lg:inline-flex gap-1 rounded-lg pr-2 text-[13.5px] font-medium text-subtle hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Jobs
      </Link>

      {/* Project header: cover photo, name, customer, site and status */}
      <header className="overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-sm)] ring-1 ring-line">
        <JobCover job={j} file={covers.get(j.id)} large className="h-[190px] w-full sm:h-[230px] lg:h-[260px]">
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/5" />
          <div className="absolute left-4 top-4 flex flex-wrap gap-1.5 sm:left-6 sm:top-5">
            <span className="inline-flex h-6 items-center rounded-full bg-white/92 px-2.5 text-[12px] font-semibold text-[#18181b] shadow-sm backdrop-blur">{JOB_STATUS_LABEL[j.status]}</span>
            {paymentStatus && paymentStatus.tone !== "neutral" ? (
              <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold shadow-sm", paymentStatus.tone === "red" ? "bg-[#d6453d] text-white" : paymentStatus.tone === "green" ? "bg-[#2f9e6e] text-white" : "bg-[#fff4dd] text-[#8a5a00]")}>{paymentStatus.text}</span>
            ) : null}
          </div>
          <div className="absolute inset-x-0 bottom-0 px-4 pb-4 sm:px-6 sm:pb-5">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-white [text-shadow:0_1px_12px_rgb(0_0_0/0.35)] sm:text-[32px]">{j.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-white/85">
              <button className="flex items-center gap-1.5 font-medium hover:text-white hover:underline" onClick={() => ui.openCustomer(j.customerId)}>
                <UserRound className="size-4" aria-hidden /> {j.customerName}
              </button>
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin className="size-4 shrink-0" aria-hidden /> <span className="truncate">{j.siteAddress || j.location}</span>
              </span>
            </div>
          </div>
        </JobCover>

        {/* Key facts + actions */}
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-8">
            {money ? (
              <div>
                <dt className="text-[12px] font-medium text-subtle">Contract value</dt>
                <dd className="text-[18px] font-semibold tabular tracking-[-0.02em] text-heading">{gbp(fin.contractValue)}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[12px] font-medium text-subtle">Next visit</dt>
              <dd className="text-[14.5px] font-medium text-heading">
                {nextBooking ? (
                  <>
                    {nextBooking.date <= today ? "Today" : relativeDayInline(nextBooking.date, today).replace(/^./, (c) => c.toUpperCase())}
                    <span className="font-normal text-subtle"> · {formatTimeRange(nextBooking.startTime, nextBooking.endTime)}</span>
                  </>
                ) : (
                  <span className="font-normal text-subtle">Not scheduled</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] font-medium text-subtle">People</dt>
              <dd className="mt-0.5 flex h-7 items-center">{crew.length ? <PeopleStack people={crew} size={28} max={4} /> : <span className="text-[14px] text-subtle">{nextBooking ? "Unassigned" : "—"}</span>}</dd>
            </div>
            {j.customerPhone || j.customerEmail ? (
              <div>
                <dt className="text-[12px] font-medium text-subtle">Contact</dt>
                <dd className="text-[14.5px] font-medium text-heading">
                  {j.customerPhone ? (
                    <a href={`tel:${j.customerPhone.replace(/\s/g, "")}`} className="hover:text-accent-fg hover:underline">
                      {j.customerPhone}
                    </a>
                  ) : (
                    <a href={`mailto:${j.customerEmail}`} className="hover:text-accent-fg hover:underline">
                      {j.customerEmail}
                    </a>
                  )}
                </dd>
              </div>
            ) : null}
            {j.what3words ? (
              <div>
                <dt className="text-[12px] font-medium text-subtle">what3words</dt>
                <dd>
                  <a href={`https://what3words.com/${encodeURIComponent(j.what3words)}`} target="_blank" rel="noopener noreferrer" className="text-[14px] font-medium text-[#e11f26] hover:underline">
                    {"///"}
                    {j.what3words}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center [&>*]:min-w-0">
            {primary ? <div className="col-span-3 sm:order-last [&>*]:w-full">{primary}</div> : null}
            <Button asChild variant="secondary" size="sm">
              <a href={mapsHref} target="_blank" rel="noopener noreferrer">
                <Navigation /> Directions
              </a>
            </Button>
            {j.customerPhone ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`tel:${j.customerPhone.replace(/\s/g, "")}`}>
                  <Phone /> <span className="truncate">Call<span className="hidden sm:inline"> {firstName(j.customerName)}</span></span>
                </a>
              </Button>
            ) : null}
            <Menu
              label="More actions"
              items={[{ label: "Add task", icon: AlarmClock, onSelect: reminder }, ...more]}
              triggerClassName="flex h-10 w-full items-center justify-center sm:w-auto gap-1.5 rounded-[10px] bg-card px-3 text-[14px] font-semibold text-foreground shadow-[var(--shadow-xs)] ring-1 ring-line-strong transition hover:bg-raised-hover lg:h-9 lg:text-[13.5px]"
              trigger={
                <>
                  <MoreHorizontal className="size-4" aria-hidden /> More
                </>
              }
            />
          </div>
        </div>
        {quick.length ? (
          <div className="grid grid-cols-3 gap-2 border-t border-line px-4 py-3 sm:flex sm:flex-wrap sm:px-6" aria-label="Quick actions">
            {quick}
          </div>
        ) : null}
      </header>

      {/* Sections */}
      {/* Phones: one clear section picker instead of a sideways-scrolling tab strip. */}
      <div className="sticky top-0 z-10 -mx-4 mt-4 bg-background/90 px-4 py-2 backdrop-blur-xl sm:hidden">
        <label className="relative block">
          <span className="sr-only">Job section</span>
          <select
            value={tab}
            onChange={(e) => setTab(e.target.value as JobTab)}
            className="h-12 w-full appearance-none rounded-xl bg-card pl-4 pr-10 text-[16px] font-semibold text-heading shadow-[var(--shadow-xs)] outline-none ring-1 ring-line-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tabs.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
                {t.count ? ` (${t.count})` : ""}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 size-5 -translate-y-1/2 text-subtle" />
        </label>
      </div>
      <div role="tablist" aria-label="Job sections" className="scrollbar-none sticky top-0 z-10 -mx-4 mt-5 hidden gap-0.5 overflow-x-auto border-b border-line bg-background/90 px-4 backdrop-blur-xl sm:-mx-6 sm:flex sm:px-6 lg:mx-0 lg:px-0">
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
              "relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-[14px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              tab === t.value ? "font-semibold text-heading after:absolute after:inset-x-3 after:bottom-[-1px] after:h-[2px] after:rounded-full after:bg-copper-500" : "text-subtle hover:text-foreground",
            )}
          >
            {t.label}
            {t.count ? <span className={cn("tabular rounded-full px-1.5 text-[11.5px]", tab === t.value ? "bg-copper-500/12 text-accent-fg" : "bg-surface-3 text-subtle")}>{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-4 empty:hidden">
        <Tip id="job-page">On this page, Bob knows which job you mean — try “add another £450 for the shelving”.</Tip>
      </div>
      <div id="job-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === "overview" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-labelledby={`next-${j.id}`} className="panel px-5 py-4 sm:px-6">
                <h2 id={`next-${j.id}`} className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent-fg">
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
                    <p className="min-w-0 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-heading">{jobNextStep(j, data, money)}</p>
                    {can("jobs.write") ? (
                      <Button size="sm" variant="ghost" className="-mr-2" onClick={() => setEditingNext(true)}>
                        <Pencil /> Update
                      </Button>
                    ) : null}
                  </div>
                )}
              </section>

              {money ? <FinancialSummary fin={fin} onOpen={() => setTab("financials")} /> : null}

              <section className="panel px-5 py-4 sm:px-6" aria-labelledby={`upd-${j.id}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 id={`upd-${j.id}`} className="t-section">Recent updates</h2>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setTab("updates")}>
                      View all
                    </Button>
                    <AddUpdateButton job={j} />
                  </div>
                </div>
                <UpdatesTimeline job={j} limit={3} />
              </section>

              <section className="panel px-5 py-4 sm:px-6" aria-labelledby={`desc-${j.id}`}>
                <h2 id={`desc-${j.id}`} className="t-section">
                  About the job
                </h2>
                <p className="reading mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">{j.description || "No description yet."}</p>
              </section>

              <div className="panel overflow-hidden [&>section:first-child]:border-t-0">
                <SharedInstructions job={j} />
              </div>

              <section className="panel px-5 py-4 sm:px-6" aria-labelledby={`notes-${j.id}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 id={`notes-${j.id}`} className="t-section">
                    Internal notes
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
                    <Lock className="size-3" aria-hidden /> Office only — never shown to workers or customers
                  </span>
                </div>
                <NotesPanel notes={j.notes} onAdd={(t) => actions.addJobNote(j.id, t)} />
              </section>
            </div>

            <aside className="flex min-w-0 flex-col gap-5">
              <section className="panel px-5 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="t-section">Coming up</h2>
                  <Button size="sm" variant="ghost" className="-mr-2" onClick={() => setTab("schedule")}>
                    Schedule
                  </Button>
                </div>
                {upcoming.length ? (
                  <ul className="space-y-2">
                    {upcoming.map((b) => {
                      const who = b.personIds.map((pid) => data.people.find((p) => p.id === pid)).filter(Boolean) as typeof data.people;
                      return (
                        <li key={b.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                          <div className="w-11 shrink-0 text-center">
                            <div className="text-[11px] font-medium uppercase text-subtle">{new Date(`${b.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })}</div>
                            <div className="text-[17px] font-semibold tabular leading-tight text-heading">{Number(b.date.slice(8))}</div>
                          </div>
                          <div className="min-w-0 flex-1 text-[13.5px]">
                            <div className="font-medium text-heading">{formatTimeRange(b.startTime, b.endTime)}</div>
                            <div className="truncate text-subtle">{who.length ? who.map((p) => p.name.split(" ")[0]).join(", ") : "Unassigned"}</div>
                          </div>
                          <PeopleStack people={who} size={24} max={3} />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[14px] text-subtle">Nothing booked.</p>
                )}
              </section>

              {openTasks.length || toOrder.length ? (
                <section className="panel px-5 py-4">
                  <h2 className="t-section mb-2">Outstanding</h2>
                  <ul className="space-y-1.5 text-[14px]">
                    {openTasks.slice(0, 4).map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <AlarmClock className="size-4 shrink-0 text-subtle" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.dueDate ? <span className="shrink-0 text-[12.5px] text-subtle">{formatDateKey(t.dueDate)}</span> : null}
                      </li>
                    ))}
                    {toOrder.length ? (
                      <li>
                        <button type="button" onClick={() => setTab("materials")} className="flex w-full items-center gap-2 text-left text-accent-fg hover:underline">
                          <PackageCheck className="size-4 shrink-0" aria-hidden /> {toOrder.length} material{toOrder.length === 1 ? "" : "s"} to order
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </section>
              ) : null}

              <div className="panel overflow-hidden [&>section:first-child]:border-t-0">
                <JobCrew job={j} />
              </div>

              <section className="panel px-5 py-4" aria-labelledby={`dates-${j.id}`}>
                <h2 id={`dates-${j.id}`} className="t-section">
                  Key dates
                </h2>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
                  <dt className="text-subtle">Start</dt>
                  <dd>{j.startDate ? formatDateKey(j.startDate) : "Not set"}</dd>
                  <dt className="text-subtle">Next on site</dt>
                  <dd>{nextBooking ? formatDateKey(nextBooking.date) : "Nothing booked"}</dd>
                  {money ? (
                    <>
                      <dt className="text-subtle">Deposit due</dt>
                      <dd>{j.depositDueDate ? formatDateKey(j.depositDueDate) : "Not set"}</dd>
                    </>
                  ) : null}
                  <dt className="text-subtle">Added</dt>
                  <dd>{formatDateKey(j.createdAt.slice(0, 10))}</dd>
                </dl>
                {can("jobs.write") ? (
                  <label className="mt-3 block">
                    <span className="mb-1 block text-[13px] font-medium text-subtle">Job status</span>
                    <NativeSelect
                      value={j.status}
                      onChange={async (e) => {
                        const st = e.target.value as (typeof JOB_STATUSES)[number];
                        const res = await actions.setJobStatus(j.id, st);
                        toast(res.ok ? `Moved to ${JOB_STATUS_LABEL[st]}` : Object.values(res.errors)[0] ?? "Couldn't update", res.ok ? "success" : "error");
                      }}
                    >
                      {JOB_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {JOB_STATUS_LABEL[st]}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                ) : null}
              </section>

              <section className="panel px-5 py-4" aria-labelledby={`act-${j.id}`}>
                <h2 id={`act-${j.id}`} className="t-section">
                  Recent activity
                </h2>
                {activity.length ? (
                  <ol className="mt-2 space-y-2.5">
                    {activity.slice(0, 6).map((a) => (
                      <li key={a.id} className="text-[13.5px] leading-snug">
                        <span className="text-foreground">{a.summary}</span>
                        <span className="block text-[12.5px] text-subtle">
                          {a.actor} · {timeAgo(a.at)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-[14px] text-subtle">{can("activity.read") ? "Nothing yet." : "Activity is visible to owners and admins."}</p>
                )}
              </section>
            </aside>
          </div>
        ) : null}

        {tab === "updates" ? (
          <div className="panel px-4 py-4 sm:px-6 sm:py-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
              <div>
                <h2 className="t-section">Project timeline</h2>
                <p className="mt-0.5 text-[13.5px] text-subtle">Photos and notes from site, newest first. Dictate a note with the keyboard&apos;s microphone.</p>
              </div>
              <AddUpdateButton job={j} />
            </div>
            <UpdatesTimeline job={j} />
            <div id="job-photos" className="mt-6 scroll-mt-16 border-t border-line pt-5">
              <FilesPanel jobId={j.id} only={["progress", "completion"]} />
            </div>
          </div>
        ) : null}
        {tab === "documents" ? (
          <div className="panel px-4 py-4 sm:px-6 sm:py-5">
            <FilesPanel jobId={j.id} only={["drawing", "other"]} />
            {money && invoices.length ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="mb-2 text-[14px] font-semibold text-heading">Quotes and invoices</h3>
                <ul className="divide-y divide-line">
                  {invoices.map((i) => (
                    <li key={i.id}>
                      <Link href={`/invoices?open=${i.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent-fg">
                        <span className="flex items-center gap-2 text-[14.5px] font-medium">
                          <ReceiptText className="size-4 text-subtle" aria-hidden /> {i.number ?? i.draftRef}
                          <span className="text-[13px] font-normal text-subtle">{invoiceStatusLabel(i)}</span>
                        </span>
                        <span className="tabular text-[14.5px] font-semibold">{gbp(i.total)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {tab === "handover" ? (
          <div className="flex flex-col gap-5">
            <div className="panel px-4 py-4 sm:px-6 sm:py-5">
              <ReportTab job={j} />
            </div>
            <div className="panel px-4 py-4 sm:px-6 sm:py-5">
              <h2 className="t-section mb-3">Handover pack</h2>
              <HandoverPanel job={j} />
            </div>
          </div>
        ) : null}
        {tab === "schedule" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="panel overflow-hidden">
              <JobSchedule job={j} />
            </div>
            <div className="panel overflow-hidden [&>section:first-child]:border-t-0">
              <JobCrew job={j} />
            </div>
          </div>
        ) : null}
        {tab === "materials" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="panel overflow-hidden">
              <JobMaterials job={j} />
            </div>
            <div className="panel overflow-hidden">
              <JobTasks job={j} />
            </div>
          </div>
        ) : null}

        {tab === "financials" && money ? (
          <div className="flex flex-col gap-5">
            <FinancialDetail fin={fin} status={j.status} />
            <div className="panel overflow-hidden">
              <VariationsPanel job={j} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <span className="text-[14px] font-semibold text-heading">Payment</span>
                  {paymentStatus ? <Badge tone={paymentStatus.tone}>{paymentStatus.text}</Badge> : null}
                </div>
                {moneyAction ? (
                  <Button size="sm" onClick={moneyAction.run}>
                    <moneyAction.icon /> {moneyAction.label}
                  </Button>
                ) : null}
              </div>
              <Fold title="Payments received" summary={payments.length ? `${payments.length} · ${gbp(f.totalPaid)} received` : "None yet"}>
                <MoneyRow label="Deposit required" value={gbp(j.depositRequired)} />
                <MoneyRow label="Deposit received" value={gbp(Math.min(f.totalPaid, j.depositRequired))} tone={f.depositOutstanding === 0 && j.depositRequired > 0 ? "green" : f.depositOverdue ? "red" : "amber"} />
                {payments.length ? (
                  <ul className="mt-2 divide-y divide-line">
                    {payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="text-[14.5px] font-medium">{PAYMENT_TYPE_LABEL[p.type]}</div>
                          <div className="text-[13px] text-subtle">
                            {formatDateKey(p.receivedAt)} · {PAYMENT_METHOD_LABEL[p.method]}
                            {p.reference ? ` · ${p.reference}` : ""} · by {p.recordedBy}
                          </div>
                        </div>
                        <div className="tabular text-[15px] font-semibold text-good-fg">{gbp(p.amount)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[14px] text-subtle">No payments recorded yet.</p>
                )}
              </Fold>
              <Fold title="Invoices" summary={invoices.length ? invoices.map((i) => `${i.number ?? i.draftRef} ${invoiceStatusLabel(i).toLowerCase()}`).join(" · ") : "None yet"}>
                {invoices.length ? (
                  <ul className="divide-y divide-line">
                    {invoices.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div>
                          <div className="text-[14.5px] font-medium">{i.number ?? i.draftRef}</div>
                          <div className="text-[13px] text-subtle">
                            {invoiceStatusLabel(i)}
                            {i.dueDate ? ` · due ${formatDateKey(i.dueDate)}` : ""}
                          </div>
                        </div>
                        <div className="tabular text-[15px] font-semibold">{gbp(i.total)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-subtle">No invoices for this job yet.</p>
                )}
              </Fold>
              <Fold title="Recorded costs" summary={expenses.length ? `${expenses.length} · ${gbp(f.expenses)}` : "None recorded"} last>
                {expenses.length ? (
                  <ul className="divide-y divide-line">
                    {expenses.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-[14.5px] font-medium">{e.description}</div>
                          <div className="text-[13px] text-subtle">
                            {EXPENSE_CATEGORY_LABEL[e.category]} · {formatDateKey(e.incurredOn)} · by {e.recordedBy}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="tabular text-[15px] font-semibold">{gbp(e.amount)}</span>
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
                  <p className="text-[14px] text-subtle">No costs recorded. Tell Bob “add £450 of materials to this job”, or use More → Add a cost.</p>
                )}
              </Fold>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Overview card: the money position in four large numbers. */
function FinancialSummary({ fin, onOpen }: { fin: JobFinancials; onOpen: () => void }) {
  const cells: { label: string; value: string; sub: string; tone?: string; subTone?: string }[] = [
    { label: "Contract value", value: gbp(fin.contractValue), sub: fin.approvedVariations ? `incl. ${gbp(fin.approvedVariations)} variations` : "agreed price" },
    { label: "Received", value: gbp(fin.received), sub: `${fin.paidPercent}% paid`, tone: "text-good-fg" },
    { label: "Outstanding", value: gbp(fin.outstanding), sub: fin.outstanding ? "left to pay" : "paid in full" },
    {
      label: fin.basis === "actual" ? "Profit" : "Est. profit",
      value: fin.profit === null ? "—" : gbp(fin.profit),
      sub: fin.margin === null ? "no costs recorded" : fin.missing.length ? `${fin.margin}% · costs incomplete` : `${fin.margin}% margin`,
      subTone: fin.margin !== null && fin.missing.length ? "text-warn-fg" : undefined,
      tone: fin.profit !== null && fin.profit < 0 ? "text-danger-fg" : undefined,
    },
  ];
  return (
    <section className="panel px-5 py-4 sm:px-6" aria-label="Financial position">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="t-section">Financial position</h2>
        <Button size="sm" variant="ghost" className="-mr-2" onClick={onOpen}>
          Financials
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <div className="text-[12.5px] font-medium text-subtle">{c.label}</div>
            <div className={cn("t-figure-sm mt-0.5", c.tone)}>{c.value}</div>
            <div className={cn("mt-0.5 text-[12px] text-subtle", c.subTone)}>{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3" title={`${fin.paidPercent}% paid`}>
        <div className="h-full rounded-full bg-success" style={{ width: `${fin.paidPercent}%` }} />
      </div>
    </section>
  );
}

/** Financials tab: income, costs by type, profit and margin; gaps called out. */
function FinancialDetail({ fin, status }: { fin: JobFinancials; status: string }) {
  const costRows: [string, number, boolean][] = [
    ["Labour", fin.costs.labour, fin.missing.includes("labour")],
    ["Materials", fin.costs.materials, fin.missing.includes("materials") && !fin.costs.bills],
    ["Supplier bills", fin.costs.bills, false],
    ["Subcontractors", fin.costs.subcontractors, fin.missing.includes("subcontractors")],
    ["Other (plant, skips)", fin.costs.other, false],
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section className="panel px-5 py-5 sm:px-6">
        <h2 className="text-[12.5px] font-medium text-subtle">Agreed contract value</h2>
        <div className="t-figure mt-1">{gbp(fin.contractValue)}</div>
        <dl className="mt-4 space-y-2 text-[14px]">
          <div className="flex justify-between"><dt className="text-subtle">Agreed price</dt><dd className="tabular">{gbp(fin.price)}</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Approved variations</dt><dd className="tabular">{gbp(fin.approvedVariations)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2"><dt className="text-subtle">Payments received</dt><dd className="tabular font-medium text-good-fg">{gbp(fin.received)}</dd></div>
          <div className="flex justify-between"><dt className="font-medium">Outstanding balance</dt><dd className="tabular font-semibold">{gbp(fin.outstanding)}</dd></div>
        </dl>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-success" style={{ width: `${fin.paidPercent}%` }} /></div>
        <p className="mt-1.5 text-[12px] text-subtle">{fin.paidPercent}% of the contract value received</p>
      </section>
      <section className="panel px-5 py-5 sm:px-6">
        <h2 className="text-[12.5px] font-medium text-subtle">Recorded costs</h2>
        <div className="t-figure mt-1">{gbp(fin.costs.total)}</div>
        <dl className="mt-4 space-y-2 text-[14px]">
          {costRows.map(([label, v, gap]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <dt className="text-subtle">{label}</dt>
              <dd className="tabular">{gap ? <span className="rounded-full bg-warning/14 px-2 py-0.5 text-[12px] font-medium text-warn-fg">Not recorded</span> : gbp(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel px-5 py-5 sm:px-6">
        <h2 className="text-[12.5px] font-medium text-subtle">{fin.basis === "actual" ? "Actual profit" : "Estimated profit"}</h2>
        {fin.profit === null ? (
          <>
            <div className="t-figure mt-1 text-subtle">—</div>
            <p className="mt-3 text-[14px] text-subtle">No costs are recorded on this job yet, so Bob can&apos;t work out a profit. Add labour, materials and subcontractor costs (or link supplier bills) to see it.</p>
          </>
        ) : (
          <>
            <div className={cn("t-figure mt-1", fin.profit < 0 && "text-danger-fg")}>{gbp(fin.profit)}</div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className={cn("t-figure-sm", fin.margin! < 0 ? "text-danger-fg" : fin.margin! < 15 || fin.missing.length ? "text-warn-fg" : "text-good-fg")}>{fin.margin}%</span>
              <span className="text-[13px] text-subtle">margin</span>
            </div>
            <p className="mt-3 text-[13px] text-subtle">
              Contract value less recorded costs.{" "}
              {fin.missing.length ? `Incomplete: no ${fin.missing.join(" or ")} costs recorded, so the real figure is likely lower.` : status === "completed" ? "Based on all costs recorded." : "Will change as more costs are recorded."}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/** Activity about this job: its own entries plus its tasks', newest first. */
function jobActivity(data: ReturnType<typeof useStore>["data"], jobId: string) {
  const taskIds = new Set(data.tasks.filter((t) => t.relatedType === "job" && t.relatedId === jobId).map((t) => t.id));
  return data.activity.filter((a) => (a.entityType === "job" && a.entityId === jobId) || (a.entityType === "task" && a.entityId && taskIds.has(a.entityId)));
}
