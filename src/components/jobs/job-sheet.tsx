"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Job } from "@/lib/types";
import { FilesPanel } from "@/components/files/files-panel";
import { AddUpdateButton, UpdatesTimeline } from "@/components/updates/updates-timeline";
import { HANDOVER_STATUS_LABEL, downloadFile, handoverStatus, isFinished, longDate, publishedVersion, type HandoverStatus } from "@/components/reports/handover-wizard";
import { fileUrl } from "@/lib/files/upload";
import { FollowUpTrail, SendToCustomer } from "@/components/reports/send-to-customer";
import { ExtrasPanel } from "@/components/jobs/variations";

import * as React from "react";
import { PackageCheck } from "lucide-react";
import { AlarmClock, Camera, Download, FileArchive, Loader2, Mail, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Lock, Hammer, Inbox, MapPin, MoreHorizontal, Navigation, Package, Pencil, Phone, PoundSterling, ReceiptText, Trash2, UserRound } from "lucide-react";
import type { JobTab } from "@/lib/store/ui";
import { jobFinancials, type JobFinancials } from "@/lib/job-financials";
import { JobCover, jobCovers } from "@/components/jobs/job-cover";
import { JOB_STATUS_STYLE } from "@/components/jobs/job-status";
import { JobCrew, JobMaterials, JobSchedule, JobTasks, SharedInstructions } from "./job-parts";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import {
  EXPENSE_CATEGORY_LABEL, JOB_STATUSES, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, invoiceStatusLabel, jobFinance, paymentsForJob,
} from "@/lib/derive";
import { addDaysKey, cn, firstName, formatDateKey, gbp, timeAgo, todayKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
          {summary && !open ? <span className="mt-0.5 block truncate text-[15px] text-muted-foreground">{summary}</span> : null}
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
      <h3 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-heading">{title}</h3>
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
  const router = useRouter();
  const manager = user.role === "owner" || user.role === "office";
  const allowed = (t?: JobTab): JobTab => {
    const v: JobTab | undefined = t === "money" ? "financials" : (t as string) === "variations" ? "extras" : t === "report" ? "handover" : t === "files" || t === "photos" ? "updates" : t === "tasks" ? "materials" : t;
    return !v || ((v === "financials" || v === "extras") && !money) || (v === "handover" && !manager) ? "overview" : v;
  };
  const [tab, setTabState] = React.useState<JobTab>(allowed(initialTab));
  // Re-check once permissions are known, so a link straight to ?tab=extras (or financials/handover) opens it.
  React.useEffect(() => setTabState(allowed(initialTab)), [initialTab, id, money, manager]); // eslint-disable-line react-hooks/exhaustive-deps
  // Arriving on a particular section (e.g. back from the handover): bring it into view.
  React.useEffect(() => {
    if (!initialTab || initialTab === "overview") return;
    const t = setTimeout(() => document.getElementById("job-tabpanel")?.scrollIntoView({ block: "start", behavior: "smooth" }), 150);
    return () => clearTimeout(t);
  }, [initialTab, id]);
  const setTab = (t: JobTab) => {
    setTabState(t);
    router.replace(`/jobs/${encodeURIComponent(id)}${t === "overview" ? "" : `?tab=${t}`}`, { scroll: false });
  };
  const today = todayKey();
  const jobFiles = data.files.filter((x) => x.jobId === id && !x.deletedAt);
  const photoCount = new Set(jobFiles.filter((x) => x.category === "progress" || x.category === "completion").map((x) => x.groupId)).size;
  const docCount = new Set(jobFiles.filter((x) => x.category === "drawing" || x.category === "other").map((x) => x.groupId)).size;
  const tabs: { value: JobTab; label: string; count?: number }[] = [
    { value: "overview", label: "Overview" },
    { value: "updates", label: "Progress & photos", count: data.updates.filter((u) => u.jobId === j.id).length + photoCount },
    { value: "documents", label: "Documents", count: docCount },
    { value: "schedule", label: "Schedule", count: data.bookings.filter((b) => b.jobId === j.id && (b.endDate ?? b.date) >= today).length },
    { value: "materials", label: "Materials & tasks", count: data.materials.filter((m) => m.jobId === j.id && m.status === "to_order").length + data.tasks.filter((t) => !t.done && t.relatedType === "job" && t.relatedId === j.id).length },
    ...(money ? [{ value: "extras" as const, label: "Extras", count: data.variations.filter((v) => v.jobId === j.id && v.status === "proposed").length || undefined }, { value: "financials" as const, label: "Financials" }] : []),
    ...(manager ? [{ value: "handover" as const, label: "Handover" }] : []),
  ];
  const fin = jobFinancials(j, data);
  const covers = jobCovers(data.files);
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.siteAddress || j.location)}`;

  const reminder = () =>
    ui.openForm({ form: "reminder", title: j.nextAction ?? `Check in on ${j.customerName}'s ${j.title.toLowerCase()}`, dueDate: addDaysKey(1), customerId: j.customerId, relatedType: "job", relatedId: j.id });
  const invoice = () => ui.openForm({ form: "invoice", customerId: j.customerId, jobId: j.id });
  const payment = () => ui.openForm({ form: "payment", jobId: j.id });
  // Money actions live with the payment status, not with the job's next step.
  const moneyAction =
    money && can("payments.record") && f.depositOutstanding > 0 && j.status !== "quoted"
      ? { label: "Record deposit", icon: PoundSterling, run: payment }
      : money && can("invoices.draft") && fin.outstanding > 0 && (j.status === "snagging" || j.status === "completed") && !invoices.some((i) => i.status !== "void")
        ? { label: "Create invoice draft", icon: ReceiptText, run: invoice }
        : money && can("payments.record") && fin.outstanding > 0 && j.status !== "quoted"
          ? { label: "Record payment", icon: PoundSterling, run: payment }
          : null;
  const paymentStatus = !money
    ? null
    : j.depositRequired > 0 && f.depositOutstanding > 0 && j.status !== "quoted"
      ? {
          tone: f.depositOverdue ? ("red" as const) : ("amber" as const),
          text: `${gbp(f.depositOutstanding)} deposit ${f.depositOverdue ? "overdue" : f.depositDaysUntilDue !== null ? (f.depositDaysUntilDue === 0 ? "due today" : `due in ${f.depositDaysUntilDue} day${f.depositDaysUntilDue === 1 ? "" : "s"}`) : "not yet paid"}`,
        }
      : fin.outstanding === 0 && fin.contractValue > 0
        ? { tone: "green" as const, text: "Paid in full" }
        : { tone: "neutral" as const, text: j.depositRequired > 0 ? `Deposit paid · ${gbp(fin.outstanding)} left to pay` : `${gbp(fin.outstanding)} left to pay` };
  const more: MenuItem[] = [
    ...(money && can("payments.record") && fin.outstanding > 0 && moneyAction?.run !== payment ? [{ label: "Record payment", icon: PoundSterling, onSelect: payment }] : []),
    ...(money && can("invoices.draft") && moneyAction?.run !== invoice ? [{ label: "Create invoice draft", icon: ReceiptText, onSelect: invoice }] : []),
    ...(can("expenses.write") ? [{ label: "Add a cost", icon: Hammer, onSelect: () => ui.openForm({ form: "expense", jobId: j.id }) }] : []),
    { label: "Customer details", icon: UserRound, onSelect: () => ui.openCustomer(j.customerId) },
    ...(j.enquiryId ? [{ label: "Original enquiry", icon: Inbox, onSelect: () => ui.openEnquiry(j.enquiryId!) }] : []),
  ];

  const hStatus = handoverStatus(data.reports.find((r) => r.jobId === j.id), data.reportVersions.filter((v) => v.jobId === j.id));
  // One clear primary action for finished jobs: the handover.
  const primary =
    (j.status === "completed" || j.status === "snagging") && manager ? (
      <Button asChild variant={isFinished(hStatus) ? "secondary" : "default"} className="w-full sm:w-auto">
        <Link href={`/jobs/${encodeURIComponent(j.id)}/handover${isFinished(hStatus) ? "?step=5" : ""}`}>
          <PackageCheck /> {hStatus === "not_started" ? "Create handover" : isFinished(hStatus) ? "View handover" : "Continue handover"}
        </Link>
      </Button>
    ) : null;

  const goPhotos = () => {
    setTab("updates");
    setTimeout(() => document.getElementById("job-photos")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };
  // Four everyday actions, large enough to hit on site. Money actions live in Financials.
  const quickBtn = "h-auto min-h-[64px] flex-col gap-1.5 px-2 py-2.5 text-[14.5px] leading-tight sm:min-h-0 sm:h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-[15px]";
  const quick = [
    can("notes.write") ? <AddUpdateButton key="u" job={j} variant="secondary" className={quickBtn} /> : null,
    can("notes.write") ? (
      <Button key="p" variant="secondary" className={quickBtn} onClick={goPhotos}>
        <Camera /> Upload photo
      </Button>
    ) : null,
    can("schedule.manage") && j.status !== "completed" && j.status !== "lost" ? (
      <Button key="s" variant="secondary" className={quickBtn} onClick={() => ui.openForm({ form: "booking", jobId: j.id })}>
        <CalendarPlus /> Schedule work
      </Button>
    ) : null,
    can("materials.write") ? (
      <Button key="m" variant="secondary" className={quickBtn} onClick={() => ui.openForm({ form: "material", jobId: j.id })}>
        <Package /> Add material
      </Button>
    ) : null,
  ].filter(Boolean);

  const latestUpdate = data.updates.filter((u) => u.jobId === j.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
  const updateCount = data.updates.filter((u) => u.jobId === j.id).length;
  const openTasks = data.tasks.filter((t) => !t.done && t.relatedType === "job" && t.relatedId === j.id);
  const toOrder = data.materials.filter((m) => m.jobId === j.id && m.status === "to_order");

  return (
    <div className="mx-auto w-full max-w-[1480px]">
      <Link href="/jobs" className="mb-3 hidden h-9 items-center gap-1 rounded-lg pr-2 text-[15px] font-medium text-subtle hover:text-foreground lg:inline-flex">
        <ChevronLeft className="size-4" aria-hidden /> Jobs
      </Link>

      {/* The job at a glance: what, who, where, status, when — and how to update it. */}
      <header className="overflow-hidden rounded-2xl bg-card ring-1 ring-line">
        <div className="flex flex-col gap-4 p-4 sm:p-6 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 gap-4">
            <JobCover job={j} file={covers.get(j.id)} className="hidden h-[92px] w-[124px] shrink-0 rounded-lg ring-1 ring-line sm:block" small />
            <div className="min-w-0 flex-1">
              <StatusControl job={j} />
              <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.025em] text-heading sm:text-[30px]">{j.title}</h1>
              <div className="mt-1.5 flex flex-col gap-1 text-[15.5px] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
                <button className="flex items-center gap-1.5 self-start font-semibold text-foreground hover:text-accent-fg" onClick={() => ui.openCustomer(j.customerId)}>
                  <UserRound className="size-4 text-subtle" aria-hidden /> {j.customerName}
                </button>
                <span className="flex min-w-0 items-start gap-1.5">
                  <MapPin className="mt-1 size-4 shrink-0 text-subtle" aria-hidden /> <span>{j.siteAddress || j.location}</span>
                </span>
                {j.what3words ? (
                  <a href={`https://what3words.com/${encodeURIComponent(j.what3words)}`} target="_blank" rel="noopener noreferrer" className="self-start font-semibold text-[#c8161d] hover:underline">
                    {"///"}
                    {j.what3words}
                  </a>
                ) : null}
              </div>
              <JobDates job={j} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:items-center xl:justify-end [&>*]:min-w-0">
            <Button asChild variant="secondary">
              <a href={mapsHref} target="_blank" rel="noopener noreferrer">
                <Navigation /> Directions
              </a>
            </Button>
            {j.customerPhone ? (
              <Button asChild variant="secondary">
                <a href={`tel:${j.customerPhone.replace(/\s/g, "")}`}>
                  <Phone /> <span className="truncate">Call<span className="hidden sm:inline"> {firstName(j.customerName)}</span></span>
                </a>
              </Button>
            ) : null}
            <Menu
              label="More actions"
              items={[{ label: "Add task", icon: AlarmClock, onSelect: reminder }, ...more]}
              triggerClassName="flex h-11 w-full items-center justify-center sm:w-auto gap-1.5 rounded-lg bg-card px-4 text-[15px] font-semibold text-foreground ring-1 ring-line-strong transition-colors hover:bg-raised-hover"
              trigger={
                <>
                  <MoreHorizontal className="size-4" aria-hidden /> More
                </>
              }
            />
            {primary ? <div className="col-span-3 [&>*]:w-full">{primary}</div> : null}
          </div>
        </div>
        {quick.length ? (
          <div className="grid grid-cols-2 gap-2 border-t border-line bg-[#fbf8f4] px-4 py-3 sm:flex sm:flex-wrap sm:px-6" aria-label="Quick actions">
            {quick}
          </div>
        ) : null}
      </header>

      {/* Sections: one at a time, each with a clear name. Phones get a grid of big buttons, not a sideways strip. */}
      <nav aria-label="Job sections" className="mt-4 grid grid-cols-2 gap-2 sm:hidden">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-current={tab === t.value ? "page" : undefined}
            onClick={() => {
              setTab(t.value);
              setTimeout(() => document.getElementById("job-tabpanel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
            }}
            className={cn(
              "flex h-12 items-center justify-between gap-2 rounded-lg px-3.5 text-left text-[15px] font-semibold ring-1 transition-colors",
              tab === t.value ? "bg-selected text-accent-fg ring-copper-500/50" : "bg-card text-foreground ring-line-strong",
              t.value === "handover" && tabs.length % 2 === 1 && "col-span-2",
            )}
          >
            <span className="truncate">{t.label}</span>
            {t.count ? <span className="tabular text-[13.5px] font-medium text-subtle">{t.count}</span> : null}
          </button>
        ))}
      </nav>
      <div role="tablist" aria-label="Job sections" className="sticky top-0 z-10 -mx-4 mt-5 hidden flex-wrap gap-1 border-b border-line bg-background/95 px-4 backdrop-blur-xl sm:-mx-6 sm:flex sm:px-6 lg:mx-0 lg:px-0">
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
              "relative flex h-12 shrink-0 items-center gap-1.5 px-3.5 text-[15.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              tab === t.value ? "font-semibold text-heading after:absolute after:inset-x-3 after:bottom-[-1px] after:h-[3px] after:rounded-full after:bg-copper-500" : "text-subtle hover:text-foreground",
            )}
          >
            {t.label}
            {t.count ? <span className="tabular text-[13.5px] text-subtle">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div id="job-tabpanel" role="tabpanel" style={{ scrollMarginTop: 72 }} aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === "overview" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-5">
              {money ? <FinancialSummary fin={fin} onOpen={() => setTab("financials")} /> : null}
              <RecentUpdates job={j} latest={latestUpdate} count={updateCount} onViewAll={() => setTab("updates")} />
              {manager ? <HandoverLine job={j} status={hStatus} onOpen={() => setTab("handover")} /> : null}
            </div>
            <aside className="flex min-w-0 flex-col gap-5">
              <div className="panel overflow-hidden [&>section:first-child]:border-t-0">
                <JobCrew job={j} />
              </div>
              {openTasks.length || toOrder.length ? (
                <section className="panel px-5 py-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="t-section">Still to do</h2>
                    <button type="button" onClick={() => setTab("materials")} className="text-[14.5px] font-semibold text-accent-fg">
                      Open
                    </button>
                  </div>
                  <ul className="space-y-2 text-[15px]">
                    {openTasks.slice(0, 3).map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <AlarmClock className="size-4 shrink-0 text-subtle" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.dueDate ? <span className="shrink-0 text-[14px] text-subtle">{formatDateKey(t.dueDate)}</span> : null}
                      </li>
                    ))}
                    {toOrder.length ? (
                      <li className="flex items-center gap-2 font-medium text-accent-fg">
                        <Package className="size-4 shrink-0" aria-hidden /> {toOrder.length} material{toOrder.length === 1 ? "" : "s"} to order
                      </li>
                    ) : null}
                  </ul>
                </section>
              ) : null}
            </aside>
          </div>
        ) : null}

        {tab === "updates" ? (
          <div className="panel px-4 py-4 sm:px-6 sm:py-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
              <div>
                <h2 className="t-section">Project timeline</h2>
                <p className="mt-0.5 text-[14.5px] text-subtle">Photos and notes from site, newest first. Dictate a note with the keyboard&apos;s microphone.</p>
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
            {manager ? (
              <section className="mt-6 border-t border-line pt-5" aria-label="Internal notes">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[16.5px] font-semibold text-heading">Internal notes</h3>
                  <span className="inline-flex items-center gap-1 text-[13.5px] font-medium text-subtle">
                    <Lock className="size-3.5" aria-hidden /> Office only — never shown to workers or customers
                  </span>
                </div>
                <NotesPanel notes={j.notes} onAdd={(t) => actions.addJobNote(j.id, t)} />
              </section>
            ) : null}
            {money && invoices.length ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="mb-2 text-[15px] font-semibold text-heading">Quotes and invoices</h3>
                <ul className="divide-y divide-line">
                  {invoices.map((i) => (
                    <li key={i.id}>
                      <Link href={`/invoices?open=${i.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent-fg">
                        <span className="flex items-center gap-2 text-[15px] font-medium">
                          <ReceiptText className="size-4 text-subtle" aria-hidden /> {i.number ?? i.draftRef}
                          <span className="text-[14px] font-normal text-subtle">{invoiceStatusLabel(i)}</span>
                        </span>
                        <span className="tabular text-[15px] font-semibold">{gbp(i.total)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {tab === "handover" ? (
          <HandoverSummary job={j} status={hStatus} />
        ) : null}
        {tab === "schedule" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="panel overflow-hidden">
              <JobSchedule job={j} />
            </div>
            <div className="flex flex-col gap-5">
              <div className="panel overflow-hidden [&>section:first-child]:border-t-0">
                <JobCrew job={j} />
              </div>
              <div className="panel overflow-hidden [&>section:first-child]:border-t-0">
                <SharedInstructions job={j} />
              </div>
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

        {tab === "extras" && money ? <ExtrasPanel job={j} /> : null}

        {tab === "financials" && money ? (
          <div className="flex flex-col gap-5">
            <FinancialDetail fin={fin} status={j.status} />
            <div className="panel overflow-hidden">
              <button type="button" onClick={() => setTab("extras")} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-surface-2 sm:px-6">
                <span className="text-[15px] font-semibold text-heading">Extras</span>
                <span className="text-[15px] text-muted-foreground">
                  {fin.approvedVariations ? `${gbp(fin.approvedVariations)} approved` : "None approved"} · open Extras
                </span>
              </button>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <span className="text-[15px] font-semibold text-heading">Payment</span>
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
                          <div className="text-[15px] font-medium">{PAYMENT_TYPE_LABEL[p.type]}</div>
                          <div className="text-[14px] text-subtle">
                            {formatDateKey(p.receivedAt)} · {PAYMENT_METHOD_LABEL[p.method]}
                            {p.reference ? ` · ${p.reference}` : ""} · by {p.recordedBy}
                          </div>
                        </div>
                        <div className="tabular text-[15px] font-semibold text-good-fg">{gbp(p.amount)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[15px] text-subtle">No payments recorded yet.</p>
                )}
              </Fold>
              <Fold title="Invoices" summary={invoices.length ? invoices.map((i) => `${i.number ?? i.draftRef} ${invoiceStatusLabel(i).toLowerCase()}`).join(" · ") : "None yet"}>
                {invoices.length ? (
                  <ul className="divide-y divide-line">
                    {invoices.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div>
                          <div className="text-[15px] font-medium">{i.number ?? i.draftRef}</div>
                          <div className="text-[14px] text-subtle">
                            {invoiceStatusLabel(i)}
                            {i.dueDate ? ` · due ${formatDateKey(i.dueDate)}` : ""}
                          </div>
                        </div>
                        <div className="tabular text-[15px] font-semibold">{gbp(i.total)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[15px] text-subtle">No invoices for this job yet.</p>
                )}
              </Fold>
              <Fold title="Recorded costs" summary={expenses.length ? `${expenses.length} · ${gbp(f.expenses)}` : "None recorded"} last>
                {expenses.length ? (
                  <ul className="divide-y divide-line">
                    {expenses.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-medium">{e.description}</div>
                          <div className="text-[14px] text-subtle">
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
                  <p className="text-[15px] text-subtle">No costs recorded. Tell Bob “add £450 of materials to this job”, or use More → Add a cost.</p>
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
    { label: "Contract value", value: gbp(fin.contractValue), sub: fin.approvedVariations ? `incl. ${gbp(fin.approvedVariations)} extras` : "agreed price" },
    { label: "Received", value: gbp(fin.received), sub: `${fin.paidPercent}% paid` },
    { label: "Outstanding", value: gbp(fin.outstanding), sub: fin.outstanding ? "left to pay" : "paid in full", tone: fin.outstanding ? undefined : "text-good-fg" },
    { label: "Costs recorded", value: fin.costs.total ? gbp(fin.costs.total) : "—", sub: fin.costs.total ? (fin.missing.length ? `no ${fin.missing[0]} yet` : "all types recorded") : "none yet", subTone: fin.costs.total && fin.missing.length ? "text-warn-fg" : undefined },
    {
      label: fin.basis === "actual" ? "Profit" : "Est. profit",
      value: fin.profit === null ? "—" : gbp(fin.profit),
      sub: fin.margin === null ? "needs costs" : fin.missing.length ? `${fin.margin}% · incomplete` : `${fin.margin}% margin`,
      subTone: fin.margin !== null && fin.missing.length ? "text-warn-fg" : undefined,
      tone: fin.profit !== null && fin.profit < 0 ? "text-danger-fg" : undefined,
    },
  ];
  return (
    <section className="panel overflow-hidden" aria-label="Financial position">
      <div className="flex items-center justify-between px-5 pb-1 pt-3.5 sm:px-6">
        <h2 className="t-section">Financial position</h2>
        <button type="button" onClick={onOpen} className="text-[14.5px] font-medium text-accent-fg hover:text-copper-700">
          Details
        </button>
      </div>
      <div className="grid grid-cols-2 gap-px bg-line xl:grid-cols-5 [&>div]:bg-card">
        {cells.map((c, i) => (
          <div key={c.label} className={cn("px-5 py-3 sm:px-6", i === 4 && "col-span-2 xl:col-span-1")}>
            <div className="text-[13px] font-medium text-subtle">{c.label}</div>
            <div className={cn("mt-0.5 text-[19px] font-semibold tabular tracking-[-0.02em] text-heading", c.tone)}>{c.value}</div>
            <div className={cn("text-[13px] text-subtle", c.subTone)}>{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" title={`${fin.paidPercent}% paid`}>
          <div className="h-full rounded-full bg-success" style={{ width: `${fin.paidPercent}%` }} />
        </div>
        <span className="tabular text-[13px] text-subtle">{fin.paidPercent}% received · internal figures, never shown to customers</span>
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
        <h2 className="text-[13.5px] font-medium text-subtle">Agreed contract value</h2>
        <div className="t-figure mt-1">{gbp(fin.contractValue)}</div>
        <dl className="mt-4 space-y-2 text-[15px]">
          <div className="flex justify-between"><dt className="text-subtle">Agreed price</dt><dd className="tabular">{gbp(fin.price)}</dd></div>
          <div className="flex justify-between"><dt className="text-subtle">Approved extras</dt><dd className="tabular">{gbp(fin.approvedVariations)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2"><dt className="text-subtle">Payments received</dt><dd className="tabular font-medium text-good-fg">{gbp(fin.received)}</dd></div>
          <div className="flex justify-between"><dt className="font-medium">Outstanding balance</dt><dd className="tabular font-semibold">{gbp(fin.outstanding)}</dd></div>
        </dl>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-success" style={{ width: `${fin.paidPercent}%` }} /></div>
        <p className="mt-1.5 text-[13px] text-subtle">{fin.paidPercent}% of the contract value received</p>
      </section>
      <section className="panel px-5 py-5 sm:px-6">
        <h2 className="text-[13.5px] font-medium text-subtle">Recorded costs</h2>
        <div className="t-figure mt-1">{gbp(fin.costs.total)}</div>
        <dl className="mt-4 space-y-2 text-[15px]">
          {costRows.map(([label, v, gap]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <dt className="text-subtle">{label}</dt>
              <dd className="tabular">{gap ? <span className="text-[14px] font-medium text-warn-fg">Not recorded</span> : gbp(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel px-5 py-5 sm:px-6">
        <h2 className="text-[13.5px] font-medium text-subtle">{fin.basis === "actual" ? "Actual profit" : "Estimated profit"}</h2>
        {fin.profit === null ? (
          <>
            <div className="t-figure mt-1 text-subtle">—</div>
            <p className="mt-3 text-[15px] text-subtle">No costs are recorded on this job yet, so Bob can&apos;t work out a profit. Add labour, materials and subcontractor costs (or link supplier bills) to see it.</p>
          </>
        ) : (
          <>
            <div className={cn("t-figure mt-1", fin.profit < 0 && "text-danger-fg")}>{gbp(fin.profit)}</div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className={cn("t-figure-sm", fin.margin! < 0 ? "text-danger-fg" : fin.margin! < 15 || fin.missing.length ? "text-warn-fg" : "text-good-fg")}>{fin.margin}%</span>
              <span className="text-[14px] text-subtle">margin</span>
            </div>
            <p className="mt-3 text-[14px] text-subtle">
              Contract value less recorded costs.{" "}
              {fin.missing.length ? `Incomplete: no ${fin.missing.join(" or ")} costs recorded, so the real figure is likely lower.` : status === "completed" ? "Based on all costs recorded." : "Will change as more costs are recorded."}
            </p>
          </>
        )}
      </section>
    </div>
  );
}


/** The handover on the job page: its status, one main button, and — once finished — the PDF, the pack and Edit. */
function HandoverSummary({ job, status }: { job: Job; status: HandoverStatus }) {
  const { data, actions, refresh } = useStore();
  const [busy, setBusy] = React.useState<null | "pdf" | "pack">(null);
  const report = data.reports.find((r) => r.jobId === job.id);
  const versions = data.reportVersions.filter((v) => v.jobId === job.id).sort((a, b) => b.version - a.version);
  const pub = publishedVersion(report, versions);
  const href = `/jobs/${encodeURIComponent(job.id)}/handover`;
  const finished = isFinished(status);
  const tone = status === "completed" || status === "sent" || status === "changes" ? "bg-emerald-500/12 text-good-fg" : status === "in_progress" ? "bg-copper-500/12 text-accent-fg" : "bg-surface-3 text-muted-foreground";

  const pdf = async () => {
    if (!pub) return;
    setBusy("pdf");
    await downloadFile(fileUrl(pub.fileId, { download: true }), pub.filename).then(() => toast(`Version ${pub.version} downloaded`, "success"), (e) => toast(e.message, "error"));
    setBusy(null);
  };
  const pack = async () => {
    if (!report) return;
    setBusy("pack");
    const r = await actions.run<{ id: string }>("reportPack", { id: report.id });
    if (!r.ok) {
      toast(r.errors._ || "Couldn't make the handover pack", "error");
      return setBusy(null);
    }
    await downloadFile(`/api/handovers/${r.value.id}`, `${job.title} handover.zip`).then(() => toast("Handover pack downloaded", "success"), (e) => toast(e.message, "error"));
    void refresh();
    setBusy(null);
  };
  const [sending, setSending] = React.useState(false);
  const emailed = data.followUps.some((f) => f.jobId === job.id && f.status === "sent");

  return (
    <div className="panel max-w-2xl px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="t-section">Customer handover</h2>
        <span data-testid="handover-status" className={cn("rounded-full px-2.5 py-0.5 text-[13.5px] font-semibold", tone)}>{status === "changes" ? "Completed" : HANDOVER_STATUS_LABEL[status]}</span>
        {status === "changes" ? <span className="rounded-full bg-amber-500/12 px-2.5 py-0.5 text-[13.5px] font-semibold text-warn-fg">Unpublished changes</span> : null}
      </div>

      {finished && report ? (
        <dl className="mt-3 space-y-1.5 text-[15px]">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Completed</dt>
            <dd className="font-medium text-heading">
              {longDate(report.completedAt)} by {report.completedBy}
              {pub ? <span className="font-normal text-muted-foreground"> · version {pub.version}</span> : null}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Customer</dt>
            <dd className="text-heading">
              {report.sentAt ? (
                <>
                  Sent {longDate(report.sentAt)} by {report.sentBy}
                  {report.sentVersion ? <span className="text-muted-foreground"> (version {report.sentVersion})</span> : null}
                </>
              ) : (
                <span className="text-muted-foreground">Not sent yet</span>
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          {status === "not_started" ? `A branded report for ${job.customerName} with photos, what was done and the documents — Bob does most of the writing.` : `Last changed by ${report?.updatedBy} ${report ? timeAgo(report.updatedAt) : ""}. Pick up where you left off, then Finish handover.`}
        </p>
      )}

      {status === "changes" ? (
        <p role="status" className="mt-3 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-[15px] text-warn-fg ring-1 ring-amber-500/25">
          The report has been edited since version {pub?.version} was finished. Those changes aren&apos;t in the PDF yet — open the handover and Finish it again to publish them.
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {finished && status !== "changes" && !emailed ? (
          <Button className="h-11 text-[15px] sm:px-5" variant={sending ? "secondary" : "default"} onClick={() => setSending((v) => !v)}>
            <Mail /> Send to customer
          </Button>
        ) : null}
        <Button asChild variant={finished ? "secondary" : "default"} className="h-11 text-[15px] sm:px-5">
          <Link href={finished ? `${href}?step=5` : href}>
            <PackageCheck /> {status === "not_started" ? "Create handover report" : finished ? "View handover" : "Continue handover"}
          </Link>
        </Button>
        {finished ? (
          <>
            <Button variant="secondary" className="h-11 text-[15px]" disabled={!!busy || !pub} onClick={() => void pdf()}>
              {busy === "pdf" ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
            </Button>
            <Button variant="secondary" className="h-11 text-[15px]" disabled={!!busy} onClick={() => void pack()}>
              {busy === "pack" ? <Loader2 className="animate-spin" /> : <FileArchive />} Download handover pack
            </Button>
            <Button asChild variant="secondary" className="h-11 text-[15px]">
              <Link href={`${href}?step=3`}>
                <Pencil /> Edit report
              </Link>
            </Button>
          </>
        ) : null}
      </div>
      {sending ? <SendToCustomer job={job} onClose={() => setSending(false)} /> : null}
      <FollowUpTrail job={job} />
      {versions.length > 1 ? <p className="mt-2 text-[14px] text-subtle">{versions.length} versions kept — all are listed in the handover.</p> : null}
    </div>
  );
}

/* ------------------------------ Job header pieces ------------------------------ */

/** The job's status as a big coloured control: tap to change it. */
function StatusControl({ job: j }: { job: Job }) {
  const { actions, can } = useStore();
  const editable = can("jobs.write");
  return (
    <label className="relative inline-flex">
      <span className="sr-only">Job status</span>
      <select
        value={j.status}
        disabled={!editable}
        onChange={async (e) => {
          const st = e.target.value as (typeof JOB_STATUSES)[number];
          const res = await actions.setJobStatus(j.id, st);
          toast(res.ok ? `Status: ${JOB_STATUS_LABEL[st]}` : Object.values(res.errors)[0] ?? "Couldn't update", res.ok ? "success" : "error");
        }}
        className={cn("h-9 cursor-pointer appearance-none rounded-lg pl-3 text-[15px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default", editable ? "pr-8" : "pr-3", JOB_STATUS_STYLE[j.status])}
      >
        {JOB_STATUSES.map((st) => (
          <option key={st} value={st}>
            {JOB_STATUS_LABEL[st]}
          </option>
        ))}
      </select>
      {editable ? <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 opacity-80" /> : null}
    </label>
  );
}

/** Start and finish dates: shown plainly, edited in place, and fine to leave blank. */
function JobDates({ job: j }: { job: Job }) {
  const { actions, can } = useStore();
  const [editing, setEditing] = React.useState(false);
  const [start, setStart] = React.useState(j.startDate ?? "");
  const [end, setEnd] = React.useState(j.endDate ?? "");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setStart(j.startDate ?? "");
    setEnd(j.endDate ?? "");
  }, [j.startDate, j.endDate]);
  const show = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "Not set");
  const save = async () => {
    if (start && end && end < start) return setError("The finish date can't be before the start.");
    const res = await actions.updateJob(j.id, { startDate: start || null, endDate: end || null });
    if (!res.ok) return setError(Object.values(res.errors)[0] ?? "Couldn't save the dates");
    toast("Dates saved", "success");
    setError(null);
    setEditing(false);
  };
  if (editing)
    return (
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[13.5px] font-medium text-subtle">Start</span>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-[170px]" aria-label="Start date" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13.5px] font-medium text-subtle">Finish</span>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-[170px]" aria-label="Finish date" />
        </label>
        <Button type="submit">
          <Check /> Save dates
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {error ? <p role="alert" className="w-full text-[14px] text-danger-fg">{error}</p> : <p className="w-full text-[13.5px] text-subtle">Leave a date empty if you don&apos;t know it yet.</p>}
      </form>
    );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[15.5px]">
      <span>
        <span className="text-subtle">Start </span>
        <strong className={cn("font-semibold", j.startDate ? "text-heading" : "text-subtle")}>{show(j.startDate)}</strong>
      </span>
      <span>
        <span className="text-subtle">Finish </span>
        <strong className={cn("font-semibold", j.endDate ? "text-heading" : "text-subtle")}>{show(j.endDate)}</strong>
      </span>
      {can("jobs.write") ? (
        <button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[14.5px] font-semibold text-accent-fg hover:bg-copper-500/[0.08]">
          <Pencil className="size-4" aria-hidden /> Edit dates
        </button>
      ) : null}
    </div>
  );
}

/** The latest update in a line or two; open it for the last few, or go to the full timeline. */
function RecentUpdates({ job, latest, count, onViewAll }: { job: Job; latest?: { note?: string; authorName: string; createdAt: string }; count: number; onViewAll: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <section className="panel overflow-hidden" aria-label="Recent updates">
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4 sm:px-6">
        <h2 className="t-section">
          Recent updates
          {count ? <span className="ml-2 text-[15px] font-medium text-subtle tabular">{count}</span> : null}
        </h2>
        <AddUpdateButton job={job} variant="ghost" />
      </div>
      {latest ? (
        open ? (
          <div className="px-5 pb-2 sm:px-6">
            <UpdatesTimeline job={job} limit={3} />
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className="block w-full px-5 pb-3 text-left sm:px-6">
            <span className="block text-[13.5px] font-medium text-subtle">
              {timeAgo(latest.createdAt)} · {latest.authorName}
            </span>
            <span className="mt-0.5 line-clamp-2 text-[15.5px] text-foreground">{latest.note || "Photos added"}</span>
          </button>
        )
      ) : (
        <p className="px-5 pb-4 text-[15px] text-subtle sm:px-6">No updates yet. Add one from site with a photo and a line about what&apos;s been done.</p>
      )}
      {latest ? (
        <div className="flex items-center gap-1 border-t border-line px-3 py-1.5 sm:px-4">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[14.5px] font-semibold text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden /> {open ? "Show less" : "Show more"}
          </button>
          <button type="button" onClick={onViewAll} className="ml-auto inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[14.5px] font-semibold text-accent-fg">
            View all updates <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** One line on the overview: where the customer handover is up to. */
function HandoverLine({ job, status, onOpen }: { job: Job; status: HandoverStatus; onOpen: () => void }) {
  const done = isFinished(status);
  return (
    <section className="panel flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6" aria-label="Customer handover">
      <PackageCheck className={cn("size-6 shrink-0", done ? "text-good-fg" : "text-subtle")} aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="text-[16.5px] font-semibold text-heading">Customer handover</h2>
        <p className="text-[14.5px] text-subtle">{HANDOVER_STATUS_LABEL[status]}</p>
      </div>
      {job.status === "completed" || job.status === "snagging" || status !== "not_started" ? (
        <Button variant="secondary" onClick={onOpen}>
          {status === "not_started" ? "Create handover" : done ? "View handover" : "Continue"}
        </Button>
      ) : null}
    </section>
  );
}
