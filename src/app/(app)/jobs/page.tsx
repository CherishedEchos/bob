"use client";

import * as React from "react";
import { CalendarPlus, HardHat, Plus, Search } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { jobFinance, jobNextStep } from "@/lib/derive";
import { formatTimeRange, relativeDayInline } from "@/lib/dates";
import { JOB_STAGE_LABEL, jobStage, nextBookingForJob, peopleOnJob, type JobStage } from "@/lib/schedule";
import { gbp, todayKey } from "@/lib/utils";
import { EmptyState, ListRow, StatusText, Tabs, pageActionClass } from "@/components/common/bits";
import { JobTile } from "@/components/common/job-tile";
import { Input } from "@/components/ui/input";

type Filter = "ready" | "booked" | "on_site" | "complete" | "all";
const IN: Record<Filter, (s: JobStage) => boolean> = {
  ready: (s) => s === "ready" || s === "awaiting_deposit",
  booked: (s) => s === "booked",
  on_site: (s) => s === "in_progress" || s === "snagging",
  complete: (s) => s === "complete" || s === "lost",
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

/** Won jobs by where they are: ready to schedule, booked, on site, complete. */
export default function JobsPage() {
  const { data, can } = useStore();
  const ui = useUI();
  const finance = can("finance.read");
  const today = todayKey();
  const stages = new Map(data.jobs.map((j) => [j.id, jobStage(j, data.bookings, today)]));
  const count = (f: Filter) => data.jobs.filter((j) => IN[f](stages.get(j.id)!)).length;
  const [filter, setFilter] = React.useState<Filter>(count("ready") ? "ready" : "booked");
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const list = data.jobs
    .filter((j) => IN[filter](stages.get(j.id)!) && (!q || [j.title, j.customerName, j.location, j.siteAddress].some((x) => x?.toLowerCase().includes(q))))
    .sort((a, b) => (nextBookingForJob(data.bookings, a.id, today)?.date ?? "9999").localeCompare(nextBookingForJob(data.bookings, b.id, today)?.date ?? "9999"));
  const active = data.jobs.filter((j) => !IN.complete(stages.get(j.id)!));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Jobs</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">
            {active.length} active{finance ? ` · Value of active jobs ${gbp(active.reduce((s, j) => s + j.quotedValue, 0))}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("jobs.write") ? (
            <button type="button" onClick={() => ui.openForm({ form: "job" })} className={pageActionClass}>
              <Plus className="size-[18px]" aria-hidden /> Add job
            </button>
          ) : null}
        </div>
      </div>
      <div className="mb-3 flex flex-col gap-2">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search job, customer or town" aria-label="Search jobs" className="pl-10" />
        </div>
        <div className="scrollbar-none -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <Tabs
            label="Jobs by stage"
            className="min-w-[520px]"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ready", label: "Unscheduled", count: count("ready"), highlight: true },
              { value: "booked", label: "Booked", count: count("booked") },
              { value: "on_site", label: "On site", count: count("on_site") },
              { value: "complete", label: "Complete", count: count("complete") },
              { value: "all", label: "All", count: data.jobs.length },
            ]}
          />
        </div>
      </div>
      {list.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
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
                    <span className="mt-0.5 block text-foreground">
                      {next ? (
                        <>
                          <span className="font-semibold">{next.date < today ? "On site today" : `Booked ${relativeDayInline(next.date, today)}`}</span>, {formatTimeRange(next.startTime, next.endTime)}
                          {who.length ? ` · ${who.map((p) => p.name.split(" ")[0]).join(", ")}` : " · needs someone"}
                        </>
                      ) : (
                        <>
                          <span className="font-semibold text-accent-fg">Next:</span> {jobNextStep(j, data, finance)}
                        </>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3">
                      <StatusText tone={STAGE_TONE[stage]}>{JOB_STAGE_LABEL[stage]}</StatusText>
                      {f && j.depositRequired > 0 && f.depositOutstanding > 0 && !IN.complete(stage) ? (
                        <StatusText tone={f.depositOverdue ? "red" : "amber"}>
                          Payment: {gbp(f.depositOutstanding)} deposit {f.depositOverdue ? "overdue" : "due"}
                        </StatusText>
                      ) : null}
                    </span>
                  </>
                }
                action={
                  stage === "ready" && can("schedule.manage") ? (
                    <button type="button" onClick={() => ui.openForm({ form: "booking", jobId: j.id })} aria-label={`Schedule ${j.title} for ${j.customerName}`} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-copper-500/[0.12] px-3 text-[14px] font-semibold text-accent-fg hover:bg-copper-500/20">
                      <CalendarPlus className="size-4" aria-hidden /> <span className="hidden sm:inline">Schedule</span>
                    </button>
                  ) : undefined
                }
              />
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={HardHat}
          title={q ? "No matches" : filter === "ready" ? "No unscheduled jobs" : "No jobs here"}
          body={q ? "Try a different search." : data.jobs.length ? "Try another list." : "Add your first job, or turn a won enquiry into one."}
          action={!data.jobs.length && can("jobs.write") ? <button type="button" onClick={() => ui.openForm({ form: "job" })} className={pageActionClass}><Plus className="size-[18px]" /> Add job</button> : undefined}
        />
      )}
    </div>
  );
}
