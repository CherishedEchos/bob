"use client";

/**
 * Jobs: everything on the go, and everything finished. One list (or photo
 * cards), search across every job and a person filter. Quotes and enquiries
 * waiting for a price live in Enquiries.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HardHat, LayoutGrid, List, MapPin, Plus, Search, User } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { Job, JobFile } from "@/lib/types";
import { JobStatusBadge, shortDate } from "@/components/jobs/job-status";
import { cn, gbp, todayKey } from "@/lib/utils";
import { EmptyState, PageHeader, pageActionClass } from "@/components/common/bits";
import { JobCover, useJobCovers } from "@/components/jobs/job-cover";
import { Input, NativeSelect } from "@/components/ui/input";

/** Two filters only: work on the go, and work that's finished. Quotes live in Enquiries. */
type View = "active" | "completed";
const VIEWS: View[] = ["active", "completed"];
const VIEW_LABEL: Record<View, string> = { active: "Active", completed: "Completed" };
const VIEW_KEY = "bob.jobs.layout";

const isActiveJob = (j: Job) => !["quoted", "completed", "lost"].includes(j.status);
const isCompletedJob = (j: Job) => j.status === "completed";

const town = (j: Job) => (j.siteAddress ? j.siteAddress.split(",").map((x) => x.trim()).filter((x) => !/^[A-Z]{1,2}\d/.test(x)).at(-1) : "") || j.location;

export default function JobsPage() {
  return (
    <React.Suspense>
      <Jobs />
    </React.Suspense>
  );
}

function Jobs() {
  const { data, can } = useStore();
  const ui = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const finance = can("finance.read");
  const today = todayKey();
  const covers = useJobCovers(data.files);
  const view: View = VIEWS.includes(params.get("view") as View) ? (params.get("view") as View) : "active";
  const [query, setQuery] = React.useState("");
  const [person, setPerson] = React.useState("");
  const [layout, setLayout] = React.useState<"grid" | "list">("list");
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
  const test = view === "active" ? isActiveJob : isCompletedJob;
  const list = data.jobs
    .filter((j) => (q ? true : test(j)))
    .filter((j) => !q || [j.title, j.customerName, j.location, j.siteAddress, j.description].some((x) => x?.toLowerCase().includes(q)))
    .filter((j) => !person || data.bookings.some((b) => b.jobId === j.id && b.personIds.includes(person)))
    .sort((a, b) => (view === "completed" ? (b.endDate ?? b.createdAt).localeCompare(a.endDate ?? a.createdAt) : (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || a.title.localeCompare(b.title)));
  const active = data.jobs.filter(isActiveJob);
  const inProgress = active.filter((j) => j.status === "in_progress" || j.status === "snagging").length;
  const count = (v: View) => data.jobs.filter(v === "active" ? isActiveJob : isCompletedJob).length;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Jobs"
        subtitle={
          <span className="tabular">
            {active.length} active · {inProgress} in progress
            {finance ? ` · ${gbp(active.reduce((s, j) => s + j.quotedValue, 0))} of work` : ""}
          </span>
        }
        actions={
          can("jobs.write") ? (
            <button type="button" onClick={() => ui.openForm({ form: "job" })} className={pageActionClass}>
              <Plus className="size-[18px]" aria-hidden /> Add job
            </button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Jobs" className="flex items-center gap-2">
          {VIEWS.map((v) => {
            const on = !q && view === v;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setQuery("");
                  setView(v);
                }}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-lg px-4 text-[15.5px] font-semibold ring-1 transition-colors",
                  on ? "bg-selected text-accent-fg ring-copper-500/45" : "bg-card text-muted-foreground ring-line-strong hover:text-foreground",
                )}
              >
                {VIEW_LABEL[v]}
                <span className={cn("tabular text-[14px] font-medium", on ? "text-accent-fg/70" : "text-subtle")}>{count(v)}</span>
              </button>
            );
          })}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-[340px]">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search jobs, customers, towns" aria-label="Search jobs" className="pl-10" />
        </div>
        {data.people.length ? (
          <label className="w-full sm:w-[200px]">
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
        <div className="ml-auto hidden h-11 items-center rounded-lg bg-[#efeae2] p-1 sm:flex" role="group" aria-label="Layout">
          {(
            [
              ["list", List, "List"],
              ["grid", LayoutGrid, "Photo cards"],
            ] as const
          ).map(([l, Icon, label]) => (
            <button
              key={l}
              type="button"
              aria-pressed={layout === l}
              aria-label={label}
              title={label}
              onClick={() => chooseLayout(l)}
              className={cn("grid h-9 w-10 place-items-center rounded-md transition-colors", layout === l ? "bg-card text-heading shadow-[0_1px_2px_rgb(17_17_17/0.08)]" : "text-subtle hover:text-foreground")}
            >
              <Icon className="size-[18px]" />
            </button>
          ))}
        </div>
      </div>
      {q ? <p className="-mt-2 text-[14.5px] text-subtle">Searching every job, including completed ones.</p> : null}

      {list.length ? (
        layout === "grid" ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.map((j) => (
              <li key={j.id}>
                <JobCard job={j} cover={covers.get(j.id)} finance={finance} today={today} onOpen={() => ui.openJob(j.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <JobList jobs={list} covers={covers} today={today} finance={finance} onOpen={(j) => ui.openJob(j.id)} />
        )
      ) : (
        <EmptyState
          icon={HardHat}
          title={q || person ? "No matches" : view === "completed" ? "No completed jobs yet" : "No active jobs"}
          body={q || person ? "Try a different search or person." : data.jobs.length ? undefined : "Add your first job, or turn a won enquiry into one."}
          action={
            !data.jobs.length && can("jobs.write") ? (
              <button type="button" onClick={() => ui.openForm({ form: "job" })} className={pageActionClass}>
                <Plus className="size-[18px]" /> Add job
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

function JobCard({ job: j, cover, finance, today, onOpen }: { job: Job; cover?: JobFile; finance: boolean; today: string; onOpen: () => void }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-line transition-shadow duration-150 hover:shadow-[var(--shadow-md)]">
      <JobCover job={j} file={cover} className="aspect-[16/10] w-full">
        <JobStatusBadge status={j.status} className="absolute left-3 top-3 shadow-[0_1px_2px_rgb(0_0_0/0.12)]" />
      </JobCover>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="text-[17px] font-bold leading-snug tracking-[-0.01em] text-heading">
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
        <div className="mt-1.5 space-y-1 text-[14.5px] text-muted-foreground">
          <div className="flex items-center gap-1.5 truncate">
            <User className="size-4 shrink-0 text-subtle" aria-hidden /> <span className="truncate">{j.customerName}</span>
          </div>
          <div className="flex items-center gap-1.5 truncate">
            <MapPin className="size-4 shrink-0 text-subtle" aria-hidden /> <span className="truncate">{town(j)}</span>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3" style={{ marginTop: 14 }}>
          <span className="tabular text-[14px] text-muted-foreground">
            {shortDate(j.startDate, today)} – {shortDate(j.endDate, today)}
          </span>
          {finance ? <span className="text-[16px] font-bold tabular text-heading">{gbp(j.quotedValue)}</span> : null}
        </div>
      </div>
    </article>
  );
}

/** The list: job, customer, location, status, start, finish and value. */
const LIST_COLS = "lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_150px_96px_96px_110px] xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_160px_104px_104px_120px]";

function JobList({ jobs, covers, today, finance, onOpen }: { jobs: Job[]; covers: Map<string, JobFile>; today: string; finance: boolean; onOpen: (j: Job) => void }) {
  const head = "text-[13px] font-semibold text-subtle";
  return (
    <div className="panel overflow-hidden">
      <div role="row" className={cn("hidden items-center gap-4 border-b border-line bg-[#faf7f2] px-5 py-2.5 lg:grid", LIST_COLS)}>
        <span className={head}>Job</span>
        <span className={head}>Customer</span>
        <span className={head}>Location</span>
        <span className={head}>Status</span>
        <span className={head}>Start</span>
        <span className={head}>Finish</span>
        <span className={cn(head, "text-right")}>{finance ? "Value" : ""}</span>
      </div>
      <ul className="divide-y divide-line">
        {jobs.map((j) => (
          <li key={j.id} className={cn("row-open relative grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 px-4 py-3 lg:gap-4 lg:px-5", LIST_COLS)}>
            <div className="contents lg:flex lg:min-w-0 lg:items-center lg:gap-3">
              <JobCover job={j} file={covers.get(j.id)} small className="h-11 w-14 shrink-0 rounded-md ring-1 ring-line" />
              <div className="min-w-0">
                <button type="button" onClick={() => onOpen(j)} className="row-target block w-full text-left text-[16px] font-bold leading-snug tracking-[-0.01em] text-heading after:absolute after:inset-0 after:content-[''] lg:truncate">
                  {j.title}
                </button>
                <div className="truncate text-[14px] text-muted-foreground lg:hidden">
                  {j.customerName} · {town(j)}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 lg:hidden">
                  <JobStatusBadge status={j.status} />
                  <span className="tabular text-[13.5px] text-subtle">
                    {shortDate(j.startDate, today)} – {shortDate(j.endDate, today)}
                  </span>
                  {finance ? <span className="ml-auto text-[15px] font-bold tabular text-heading">{gbp(j.quotedValue)}</span> : null}
                </div>
              </div>
            </div>
            <div className="hidden min-w-0 truncate text-[15px] text-foreground lg:block">{j.customerName}</div>
            <div className="hidden min-w-0 truncate text-[15px] text-muted-foreground lg:block">{town(j)}</div>
            <div className="hidden lg:block">
              <JobStatusBadge status={j.status} />
            </div>
            <div className="hidden text-[14.5px] tabular text-foreground lg:block">{shortDate(j.startDate, today)}</div>
            <div className="hidden text-[14.5px] tabular text-foreground lg:block">{shortDate(j.endDate, today)}</div>
            <div className="hidden text-right text-[15px] font-bold tabular text-heading lg:block">{finance ? gbp(j.quotedValue) : null}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
