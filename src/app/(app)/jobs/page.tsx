"use client";

/**
 * Jobs: the state of the business at a glance. A pipeline of filters (to
 * quote → quoted → won → unscheduled → in progress → completed), photo cards
 * or an aligned list, search across every job and a person filter.
 */
import * as React from "react";
import { Tip } from "@/components/common/tip";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CalendarPlus, ChevronDown, ClipboardList, HardHat, LayoutGrid, List, MapPin, Plus, Search, User } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { jobNextStep } from "@/lib/derive";
import { formatTimeRange, relativeDayInline } from "@/lib/dates";
import { JOB_STAGE_LABEL, bookingDays, jobStage, nextBookingForJob, peopleOnJob, type JobStage } from "@/lib/schedule";
import type { Booking, Enquiry, Job, JobFile } from "@/lib/types";
import { cn, gbp, todayKey } from "@/lib/utils";
import { EmptyState, PageHeader, StatusText, pageActionClass } from "@/components/common/bits";
import { PeopleStack } from "@/components/common/people";
import { JobCover, useJobCovers } from "@/components/jobs/job-cover";
import { Input, NativeSelect } from "@/components/ui/input";

type View = "active" | "to_quote" | "quoted" | "won" | "unscheduled" | "in_progress" | "completed" | "all";
const VIEWS: View[] = ["active", "to_quote", "quoted", "won", "unscheduled", "in_progress", "completed", "all"];
/** The four everyday filters; the finer stages sit under "More stages". */
const PRIMARY: View[] = ["to_quote", "quoted", "active", "completed"];
const MORE: View[] = ["won", "unscheduled", "in_progress", "all"];
const VIEW_LABEL: Record<View, string> = { active: "Active", to_quote: "To quote", quoted: "Quoted", won: "Won", unscheduled: "Unscheduled", in_progress: "In progress", completed: "Completed", all: "All" };

const STAGE_TONE: Record<JobStage, "neutral" | "amber" | "green" | "blue" | "violet" | "red"> = {
  ready: "amber",
  awaiting_deposit: "amber",
  booked: "blue",
  in_progress: "green",
  snagging: "violet",
  complete: "neutral",
  lost: "neutral",
};
/** Solid labels over photos. */
const STAGE_PILL: Record<JobStage, string> = {
  ready: "bg-[#fff4dd] text-[#8a5a00]",
  awaiting_deposit: "bg-[#fff4dd] text-[#8a5a00]",
  booked: "bg-[#e6eeff] text-[#2f4fa8]",
  in_progress: "bg-[#f38735] text-white",
  snagging: "bg-[#efe9ff] text-[#5b3fc4]",
  complete: "bg-white text-[#3f3f46]",
  lost: "bg-white text-[#71717a]",
};

const VIEW_KEY = "bob.jobs.layout";

export default function JobsPage() {
  return (
    <React.Suspense>
      <Jobs />
    </React.Suspense>
  );
}

function stageLabel(j: Job, s: JobStage) {
  return j.status === "quoted" ? "Quoted" : JOB_STAGE_LABEL[s];
}

function Jobs() {
  const { data, can } = useStore();
  const ui = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const finance = can("finance.read");
  const today = todayKey();
  const covers = useJobCovers(data.files);
  const stages = React.useMemo(() => new Map(data.jobs.map((j) => [j.id, jobStage(j, data.bookings, today)])), [data.jobs, data.bookings, today]);
  const toQuote = data.enquiries.filter((e) => e.status === "quote_required");
  const IN: Record<Exclude<View, "to_quote">, (j: Job) => boolean> = {
    active: (j) => !["complete", "lost"].includes(stages.get(j.id)!),
    quoted: (j) => j.status === "quoted",
    won: (j) => !["quoted", "lost", "completed"].includes(j.status),
    unscheduled: (j) => j.status !== "quoted" && ["ready", "awaiting_deposit"].includes(stages.get(j.id)!),
    in_progress: (j) => ["in_progress", "snagging"].includes(stages.get(j.id)!),
    completed: (j) => stages.get(j.id) === "complete",
    all: () => true,
  };
  const count = (v: View) => (v === "to_quote" ? toQuote.length : data.jobs.filter(IN[v]).length);
  const view: View = VIEWS.includes(params.get("view") as View) ? (params.get("view") as View) : "active";
  const [query, setQuery] = React.useState("");
  const [person, setPerson] = React.useState("");
  const [layout, setLayout] = React.useState<"grid" | "list">("grid");
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "list" || v === "grid") setLayout(v);
    } catch {
      /* private mode */
    }
  }, []);
  const chooseLayout = (l: "grid" | "list") => {
    setLayout(l);
    try {
      localStorage.setItem(VIEW_KEY, l);
    } catch {
      /* private mode */
    }
  };
  const q = query.trim().toLowerCase();
  const setView = (v: View) => router.replace(v === "active" ? "/jobs" : `/jobs?view=${v}`, { scroll: false });
  const showEnquiries = view === "to_quote" && !q;
  const list = showEnquiries
    ? []
    : data.jobs
        .filter((j) => (q ? true : IN[view as Exclude<View, "to_quote">](j)))
        .filter((j) => !q || [j.title, j.customerName, j.location, j.siteAddress, j.description].some((x) => x?.toLowerCase().includes(q)))
        .filter((j) => !person || data.bookings.some((b) => b.jobId === j.id && b.personIds.includes(person)))
        .sort((a, b) => {
          const na = nextBookingForJob(data.bookings, a.id, today)?.date ?? "9999";
          const nb = nextBookingForJob(data.bookings, b.id, today)?.date ?? "9999";
          return view === "completed" ? b.createdAt.localeCompare(a.createdAt) : na.localeCompare(nb) || a.title.localeCompare(b.title);
        });
  const active = data.jobs.filter(IN.active);
  const inProgress = data.jobs.filter(IN.in_progress).length;
  const unscheduled = data.jobs.filter(IN.unscheduled).length;
  const schedule = (j: Job) => ui.openForm({ form: "booking", jobId: j.id });

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Jobs"
        subtitle={
          <span className="tabular">
            {active.length} active · {inProgress} in progress · {unscheduled} to schedule
            {finance ? ` · ${gbp(active.reduce((s, j) => s + j.quotedValue, 0))} of work` : ""}
          </span>
        }
        actions={
          can("jobs.write") ? (
            <button type="button" onClick={() => ui.openForm({ form: "job" })} className={pageActionClass}>
              <Plus className="size-[17px]" aria-hidden /> Add job
            </button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3">
        {/* Pipeline filters */}
        {/* Wraps onto a second line on narrow screens instead of scrolling (nothing is cut off). */}
        <div>
          <div role="tablist" aria-label="Pipeline" className="flex flex-wrap items-center gap-2">
            {PRIMARY.map((v) => {
              const on = (q ? "all" : view) === v;
              const n = count(v);
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setView(v)}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    on ? "bg-sidebar text-white shadow-[var(--shadow-sm)]" : "bg-card text-muted-foreground ring-1 ring-line hover:text-foreground hover:ring-line-strong",
                  )}
                >
                  {VIEW_LABEL[v]}
                  <span className={cn("tabular text-[12px]", on ? "text-white/55" : "text-subtle", !on && v === "unscheduled" && n ? "font-semibold text-accent-fg" : "")}>{n}</span>
                </button>
              );
            })}
            <label className="relative">
              <span className="sr-only">More stages</span>
              <select
                value={MORE.includes(q ? "all" : view) ? (q ? "all" : view) : ""}
                onChange={(e) => setView((e.target.value || "active") as View)}
                className={cn(
                  "h-10 appearance-none rounded-full pl-4 pr-9 text-[14px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  MORE.includes(q ? "all" : view) ? "bg-sidebar text-white" : "bg-card text-muted-foreground ring-1 ring-line hover:text-foreground",
                )}
              >
                <option value="">More stages</option>
                {MORE.map((v) => (
                  <option key={v} value={v}>
                    {VIEW_LABEL[v]} ({count(v)})
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-60" />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 lg:max-w-[360px]">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search jobs, customers, towns" aria-label="Search jobs" className="pl-9" />
          </div>
          {data.people.length ? (
            <label className="w-[calc(100%-100px)] sm:w-[200px]">
              <span className="sr-only">Person</span>
              <NativeSelect value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Anyone</option>
                {data.people
                  .filter((p) => !p.archivedAt)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </NativeSelect>
            </label>
          ) : null}
          <div className="ml-auto flex rounded-lg bg-card p-[3px] shadow-[var(--shadow-xs)] ring-1 ring-line-strong" role="group" aria-label="Layout">
            {(
              [
                ["grid", LayoutGrid, "Cards"],
                ["list", List, "List"],
              ] as const
            ).map(([l, Icon, label]) => (
              <button
                key={l}
                type="button"
                aria-pressed={layout === l}
                aria-label={label}
                title={label}
                onClick={() => chooseLayout(l)}
                className={cn("grid size-9 place-items-center rounded-[8px] transition lg:size-8", layout === l ? "bg-sidebar text-white" : "text-subtle hover:text-foreground")}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
        {q ? <p className="text-[13.5px] text-subtle">Searching every job, including completed ones.</p> : null}
        <Tip id="jobs">Ask Bob about any job in plain words — “what&apos;s left to pay on the Patels&apos; kitchen?”</Tip>
      </div>

      {showEnquiries ? (
        toQuote.length ? (
          <ToQuoteList enquiries={toQuote} onOpen={(id) => ui.openEnquiry(id)} onQuote={can("quotes.write") ? (e) => ui.openForm({ form: "quote", enquiryId: e.id, customerId: e.customerId }) : undefined} />
        ) : (
          <EmptyState icon={ClipboardList} title="Nothing waiting for a quote" body="Enquiries marked “Quote needed” appear here." />
        )
      ) : list.length ? (
        layout === "grid" ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5">
            {list.map((j) => (
              <li key={j.id}>
                <JobCard job={j} stage={stages.get(j.id)!} cover={covers.get(j.id)} bookings={data.bookings} finance={finance} today={today} onOpen={() => ui.openJob(j.id)} onSchedule={can("schedule.manage") ? () => schedule(j) : undefined} nextStep={jobNextStep(j, data, finance)} people={peopleOnJob(data.bookings, data.people, j.id, today)} />
              </li>
            ))}
          </ul>
        ) : (
          <JobList jobs={list} stages={stages} covers={covers} today={today} finance={finance} onOpen={(j) => ui.openJob(j.id)} onSchedule={can("schedule.manage") ? schedule : undefined} />
        )
      ) : (
        <EmptyState
          icon={HardHat}
          title={q || person ? "No matches" : view === "unscheduled" ? "Everything is scheduled" : view === "completed" ? "No completed jobs yet" : "No jobs here"}
          body={q || person ? "Try a different search or person." : data.jobs.length ? "Try another view." : "Add your first job, or turn a won enquiry into one."}
          action={
            !data.jobs.length && can("jobs.write") ? (
              <button type="button" onClick={() => ui.openForm({ form: "job" })} className={pageActionClass}>
                <Plus className="size-[17px]" /> Add job
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

/** Days on site done out of booked, when the job has a multi-day booking plan. */
function siteProgress(bookings: Booking[], jobId: string, today: string) {
  const days = new Set(bookings.filter((b) => b.jobId === jobId).flatMap((b) => bookingDays(b)));
  if (days.size < 2) return null;
  const done = [...days].filter((d) => d < today).length;
  return { done, total: days.size };
}

function nextLabel(next: Booking, today: string) {
  return next.date <= today ? "On site today" : relativeDayInline(next.date, today).replace(/^./, (c) => c.toUpperCase());
}

function JobCard({
  job: j,
  stage,
  cover,
  bookings,
  finance,
  today,
  onOpen,
  onSchedule,
  nextStep,
  people,
}: {
  job: Job;
  stage: JobStage;
  cover?: JobFile;
  bookings: Booking[];
  finance: boolean;
  today: string;
  onOpen: () => void;
  onSchedule?: () => void;
  nextStep: string;
  people: { id: string; name: string; kind: "employee" | "subcontractor" }[];
}) {
  const next = nextBookingForJob(bookings, j.id, today);
  const progress = ["in_progress", "booked", "snagging"].includes(stage) ? siteProgress(bookings, j.id, today) : null;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-sm)] ring-1 ring-line transition duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg)]">
      <JobCover job={j} file={cover} className="aspect-[16/10] w-full">
        <span className={cn("absolute left-3 top-3 inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.18)]", STAGE_PILL[stage], j.status === "quoted" && "bg-[#f4f4f5] text-[#3f3f46]")}>
          {stageLabel(j, stage)}
        </span>
      </JobCover>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="truncate text-[15.5px] font-semibold tracking-[-0.01em] text-heading">
          <a
            href={`/jobs/${j.id}`}
            onClick={(e) => {
              e.preventDefault();
              onOpen();
            }}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {j.title}
          </a>
        </h2>
        <div className="mt-1.5 space-y-1 text-[13px] text-subtle">
          <div className="flex items-center gap-1.5 truncate">
            <User className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{j.customerName}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{j.siteAddress ? j.siteAddress.split(",").slice(-2).join(",").trim() : j.location}</span>
            </span>
            {finance ? <span className="shrink-0 text-[14.5px] font-semibold tabular tracking-[-0.01em] text-heading">{gbp(j.quotedValue)}</span> : null}
          </div>
        </div>
        {progress ? (
          <div className="mt-3" title={`${progress.done} of ${progress.total} booked days done`}>
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-copper-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
            <div className="mt-1 text-[11.5px] tabular text-subtle">
              {progress.done} of {progress.total} days on site
            </div>
          </div>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3" style={{ marginTop: progress ? 12 : 14 }}>
          {next ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
              <CalendarDays className="size-3.5 shrink-0 text-subtle" aria-hidden />
              <span className="truncate">
                <span className="font-medium text-foreground">{nextLabel(next, today)}</span>
                <span className="text-subtle"> · {formatTimeRange(next.startTime, next.endTime)}</span>
              </span>
            </span>
          ) : stage === "ready" && j.status !== "quoted" && onSchedule ? (
            <button
              type="button"
              onClick={onSchedule}
              className="relative z-10 inline-flex h-8 items-center gap-1.5 rounded-lg bg-copper-500/10 px-2.5 text-[12.5px] font-semibold text-accent-fg hover:bg-copper-500/15"
              aria-label={`Schedule ${j.title} for ${j.customerName}`}
            >
              <CalendarPlus className="size-3.5" aria-hidden /> Schedule work
            </button>
          ) : (
            <span className="truncate text-[12.5px] text-subtle">{stage === "complete" ? "Completed" : nextStep}</span>
          )}
          {people.length ? <PeopleStack people={people} size={24} max={3} /> : null}
        </div>
      </div>
    </article>
  );
}

function JobList({ jobs, stages, covers, today, finance, onOpen, onSchedule }: { jobs: Job[]; stages: Map<string, JobStage>; covers: Map<string, JobFile>; today: string; finance: boolean; onOpen: (j: Job) => void; onSchedule?: (j: Job) => void }) {
  const { data } = useStore();
  return (
    <div className="panel overflow-hidden shadow-[var(--shadow-sm)]">
      <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_100px] gap-4 border-b border-line px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.06em] text-subtle lg:grid">
        <span>Job</span>
        <span>Customer</span>
        <span>Status</span>
        <span>Next on site</span>
        <span>Team</span>
        <span className="text-right">{finance ? "Value" : ""}</span>
      </div>
      <ul className="divide-y divide-line">
        {jobs.map((j) => {
          const stage = stages.get(j.id)!;
          const next = nextBookingForJob(data.bookings, j.id, today);
          const who = peopleOnJob(data.bookings, data.people, j.id, today);
          return (
            <li key={j.id} className="row-open relative grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_100px] lg:gap-4 lg:px-5">
              <div className="contents lg:flex lg:min-w-0 lg:items-center lg:gap-3">
                <JobCover job={j} file={covers.get(j.id)} className="h-11 w-14 shrink-0 rounded-lg ring-1 ring-line" />
                <div className="min-w-0">
                  <button type="button" onClick={() => onOpen(j)} className="row-target block w-full truncate text-left text-[14.5px] font-semibold text-heading after:absolute after:inset-0 after:content-['']">
                    {j.title}
                  </button>
                  <div className="truncate text-[13px] text-subtle">
                    <span className="lg:hidden">{j.customerName} · </span>
                    {j.siteAddress || j.location}
                  </div>
                  <div className="mt-1 lg:hidden">
                    <StatusText tone={STAGE_TONE[stage]}>{stageLabel(j, stage)}</StatusText>
                  </div>
                </div>
              </div>
              <div className="hidden min-w-0 truncate text-[14px] lg:block">
                {j.customerName}
                <div className="truncate text-[13px] text-subtle">{j.location}</div>
              </div>
              <div className="hidden lg:block">
                <StatusText tone={STAGE_TONE[stage]}>{stageLabel(j, stage)}</StatusText>
              </div>
              <div className="hidden min-w-0 text-[13.5px] lg:block">
                {next ? (
                  <>
                    <div className="font-medium">{nextLabel(next, today)}</div>
                    <div className="text-[12.5px] text-subtle">{formatTimeRange(next.startTime, next.endTime)}</div>
                  </>
                ) : stage === "ready" && j.status !== "quoted" && onSchedule ? (
                  <button type="button" onClick={() => onSchedule(j)} className="row-secondary inline-flex h-8 items-center gap-1.5 rounded-lg bg-copper-500/10 px-2.5 text-[12.5px] font-semibold text-accent-fg hover:bg-copper-500/15" aria-label={`Schedule ${j.title} for ${j.customerName}`}>
                    <CalendarPlus className="size-3.5" aria-hidden /> Schedule
                  </button>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </div>
              <div className="hidden lg:block">{who.length ? <PeopleStack people={who} size={26} max={4} /> : <span className="text-[13px] text-subtle">—</span>}</div>
              <div className="text-right text-[14px] font-semibold tabular text-heading">{finance ? gbp(j.quotedValue) : null}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ToQuoteList({ enquiries, onOpen, onQuote }: { enquiries: Enquiry[]; onOpen: (id: string) => void; onQuote?: (e: Enquiry) => void }) {
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {enquiries.map((e) => (
        <li key={e.id} className="relative flex items-start gap-3 rounded-2xl bg-card p-4 shadow-[var(--shadow-sm)] ring-1 ring-line transition hover:shadow-[var(--shadow-md)]">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-copper-500/10 text-accent-icon">
            <ClipboardList className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => onOpen(e.id)} className="block w-full truncate text-left text-[15px] font-semibold text-heading after:absolute after:inset-0 after:content-['']">
              {e.title}
            </button>
            <div className="mt-0.5 truncate text-[13px] text-subtle">
              {e.customerName} · {e.location}
            </div>
            <div className="mt-1 text-[12.5px] text-subtle">Received {new Date(e.receivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
          </div>
          {onQuote ? (
            <button type="button" onClick={() => onQuote(e)} className="relative z-10 h-9 shrink-0 rounded-lg bg-copper-500/10 px-3 text-[13px] font-semibold text-accent-fg hover:bg-copper-500/15">
              Create quote
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
