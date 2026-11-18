"use client";

/**
 * Jobs: Active, Unscheduled, Completed and All. Desktop: an aligned table
 * (whole row opens the job). Phone: stacked rows. Completed jobs stay
 * searchable and open with all their records.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, HardHat, Plus, Search } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { jobFinance, jobNextStep } from "@/lib/derive";
import { formatTimeRange, relativeDayInline } from "@/lib/dates";
import { JOB_STAGE_LABEL, jobStage, nextBookingForJob, peopleOnJob, type JobStage } from "@/lib/schedule";
import type { Job } from "@/lib/types";
import { cn, gbp, todayKey } from "@/lib/utils";
import { EmptyState, ListRow, StatusText, Tabs, pageActionClass } from "@/components/common/bits";
import { JobTile } from "@/components/common/job-tile";
import { Input, NativeSelect } from "@/components/ui/input";

type View = "active" | "unscheduled" | "completed" | "all";
const IN: Record<View, (s: JobStage) => boolean> = {
  active: (s) => s !== "complete" && s !== "lost",
  unscheduled: (s) => s === "ready" || s === "awaiting_deposit",
  completed: (s) => s === "complete",
  all: () => true,
};
const STAGE_TONE: Record<JobStage, "neutral" | "amber" | "green" | "blue" | "violet" | "red"> = {
  ready: "amber",
  awaiting_deposit: "amber",
  booked: "blue",
  in_progress: "green",
  snagging: "violet",
  complete: "neutral",
  lost: "neutral",
};
const VIEWS: View[] = ["active", "unscheduled", "completed", "all"];

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
  const stages = new Map(data.jobs.map((j) => [j.id, jobStage(j, data.bookings, today)]));
  const count = (v: View) => data.jobs.filter((j) => IN[v](stages.get(j.id)!)).length;
  const view: View = VIEWS.includes(params.get("view") as View) ? (params.get("view") as View) : "active";
  const [query, setQuery] = React.useState("");
  const [person, setPerson] = React.useState("");
  const q = query.trim().toLowerCase();
  const setView = (v: View) => router.replace(v === "active" ? "/jobs" : `/jobs?view=${v}`, { scroll: false });
  const list = data.jobs
    .filter((j) => (q ? true : IN[view](stages.get(j.id)!)))
    .filter((j) => !q || [j.title, j.customerName, j.location, j.siteAddress, j.description].some((x) => x?.toLowerCase().includes(q)))
    .filter((j) => !person || data.bookings.some((b) => b.jobId === j.id && b.personIds.includes(person)))
    .sort((a, b) => {
      const na = nextBookingForJob(data.bookings, a.id, today)?.date ?? "9999";
      const nb = nextBookingForJob(data.bookings, b.id, today)?.date ?? "9999";
      return view === "completed" ? b.createdAt.localeCompare(a.createdAt) : na.localeCompare(nb) || a.title.localeCompare(b.title);
    });
  const active = data.jobs.filter((j) => IN.active(stages.get(j.id)!));
  const schedule = (j: Job) => ui.openForm({ form: "booking", jobId: j.id });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Jobs</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">
            {active.length} active{finance ? ` · ${gbp(active.reduce((s, j) => s + j.quotedValue, 0))} of work` : ""}
          </p>
        </div>
        {can("jobs.write") ? (
          <button type="button" onClick={() => ui.openForm({ form: "job" })} className={pageActionClass}>
            <Plus className="size-[18px]" aria-hidden /> Add job
          </button>
        ) : null}
      </div>
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="scrollbar-none -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <Tabs
            label="Jobs"
            value={q ? ("all" as View) : view}
            onChange={setView}
            options={[
              { value: "active", label: "Active", count: count("active") },
              { value: "unscheduled", label: "Unscheduled", count: count("unscheduled"), highlight: true },
              { value: "completed", label: "Completed", count: count("completed") },
              { value: "all", label: "All", count: data.jobs.length },
            ]}
          />
        </div>
        <div className="flex flex-1 flex-wrap gap-2 lg:justify-end">
          <div className="relative min-w-[220px] flex-1 lg:max-w-[340px]">
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all jobs, customers, towns" aria-label="Search jobs" className="h-11 pl-10" />
          </div>
          {data.people.length ? (
            <label className="w-full sm:w-[200px]">
              <span className="sr-only">Person</span>
              <NativeSelect value={person} onChange={(e) => setPerson(e.target.value)} className="h-11">
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
        </div>
      </div>
      {q ? <p className="mb-2 text-[14px] text-muted-foreground">Searching every job, including completed ones.</p> : null}

      {list.length ? (
        <>
          {/* Desktop table */}
          <div className="panel hidden overflow-hidden lg:block">
            <table className="w-full table-fixed text-left text-[15px]">
              <thead className="border-b border-line bg-surface-2/60 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="w-[30%] px-5 py-3">Job</th>
                  <th scope="col" className="w-[16%] px-3 py-3">Customer</th>
                  <th scope="col" className="w-[12%] px-3 py-3">Status</th>
                  <th scope="col" className="w-[20%] px-3 py-3">Next booking</th>
                  <th scope="col" className="w-[14%] px-3 py-3">Team</th>
                  <th scope="col" className="w-[8%] px-5 py-3 text-right">{finance ? "Value" : <span className="sr-only">Action</span>}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((j) => {
                  const stage = stages.get(j.id)!;
                  const next = nextBookingForJob(data.bookings, j.id, today);
                  const who = peopleOnJob(data.bookings, data.people, j.id, today);
                  return (
                    <tr key={j.id} className="row-open group relative cursor-pointer align-top transition hover:bg-surface-2/70" onClick={() => ui.openJob(j.id)}>
                      <td className="px-5 py-3">
                        <div className="flex items-start gap-3">
                          <JobTile kind={j.kind} className="mt-0.5 size-9 shrink-0 rounded-lg [&_svg]:size-[18px]" />
                          <div className="min-w-0">
                            <a
                              href={`/jobs/${j.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                ui.openJob(j.id);
                              }}
                              className="block truncate font-semibold text-heading group-hover:text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {j.title}
                            </a>
                            <div className="truncate text-[14px] text-muted-foreground">{j.siteAddress || j.location}</div>
                          </div>
                        </div>
                      </td>
                      <td className="truncate px-3 py-3 text-foreground/90">
                        {j.customerName}
                        <div className="truncate text-[14px] text-muted-foreground">{j.location}</div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusText tone={STAGE_TONE[stage]}>{JOB_STAGE_LABEL[stage]}</StatusText>
                      </td>
                      <td className="px-3 py-3">
                        {next ? (
                          <>
                            <div className="font-medium">{next.date < today ? "On site today" : relativeDayInline(next.date, today).replace(/^./, (c) => c.toUpperCase())}</div>
                            <div className="text-[14px] text-muted-foreground">{formatTimeRange(next.startTime, next.endTime)}</div>
                          </>
                        ) : stage === "ready" && can("schedule.manage") ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              schedule(j);
                            }}
                            className="relative inline-flex h-9 items-center gap-1.5 rounded-lg bg-copper-500/[0.12] px-3 text-[14px] font-semibold text-accent-fg hover:bg-copper-500/20"
                            aria-label={`Schedule ${j.title} for ${j.customerName}`}
                          >
                            <CalendarPlus className="size-4" aria-hidden /> Schedule work
                          </button>
                        ) : (
                          <span className="text-[14px] text-muted-foreground">{stage === "complete" ? "—" : jobNextStep(j, data, finance)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[14px]">
                        {who.length ? who.map((p) => p.name.split(" ")[0]).join(", ") : next ? <span className="font-semibold text-warn-fg">Unassigned</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular text-foreground/90">{finance ? gbp(j.quotedValue) : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone rows */}
          <ul className="panel divide-y divide-line overflow-hidden lg:hidden">
            {list.map((j) => {
              const f = finance ? jobFinance(j, data.payments) : null;
              const stage = stages.get(j.id)!;
              const next = nextBookingForJob(data.bookings, j.id, today);
              const who = peopleOnJob(data.bookings, data.people, j.id, today);
              return (
                <ListRow
                  key={j.id}
                  onOpen={() => ui.openJob(j.id)}
                  openLabel={`Open ${j.title} for ${j.customerName}`}
                  leading={<JobTile kind={j.kind} className="size-10 rounded-lg [&_svg]:size-5" />}
                  title={j.title}
                  aside={f ? gbp(j.quotedValue) : undefined}
                  meta={
                    <>
                      <span className="block truncate">
                        {j.customerName} · {j.location}
                      </span>
                      <span className={cn("mt-0.5 block", next ? "text-foreground" : "")}>
                        {next ? (
                          <>
                            <span className="font-semibold">{next.date < today ? "On site today" : `Booked ${relativeDayInline(next.date, today)}`}</span>, {formatTimeRange(next.startTime, next.endTime)}
                            {who.length ? ` · ${who.map((p) => p.name.split(" ")[0]).join(", ")}` : ""}
                          </>
                        ) : (
                          jobNextStep(j, data, finance)
                        )}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3">
                        <StatusText tone={STAGE_TONE[stage]}>{JOB_STAGE_LABEL[stage]}</StatusText>
                        {next && !who.length ? <StatusText tone="amber">Unassigned</StatusText> : null}
                      </span>
                    </>
                  }
                  action={
                    stage === "ready" && can("schedule.manage") ? (
                      <button type="button" onClick={() => schedule(j)} aria-label={`Schedule ${j.title} for ${j.customerName}`} className="inline-flex size-11 items-center justify-center rounded-[10px] bg-copper-500/[0.12] text-accent-fg hover:bg-copper-500/20">
                        <CalendarPlus className="size-5" aria-hidden />
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={HardHat}
          title={q || person ? "No matches" : view === "unscheduled" ? "Everything is scheduled" : view === "completed" ? "No completed jobs yet" : "No jobs here"}
          body={q || person ? "Try a different search or person." : data.jobs.length ? "Try another view." : "Add your first job, or turn a won enquiry into one."}
          action={!data.jobs.length && can("jobs.write") ? <button type="button" onClick={() => ui.openForm({ form: "job" })} className={pageActionClass}><Plus className="size-[18px]" /> Add job</button> : undefined}
        />
      )}
    </div>
  );
}
