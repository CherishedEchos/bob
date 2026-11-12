"use client";

import * as React from "react";
import { HardHat, Plus } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { isActiveJob, jobFinance, jobNextStep } from "@/lib/derive";
import type { Job } from "@/lib/types";
import { gbp } from "@/lib/utils";
import { EmptyState, ListRow, StatusText, Tabs } from "@/components/common/bits";
import { JobStatusBadge } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";

type Filter = "active" | "done" | "all";
const TESTS: Record<Filter, (j: Job) => boolean> = {
  active: isActiveJob,
  done: (j) => j.status === "completed" || j.status === "lost",
  all: () => true,
};

/** Name, status and next step. Photos, notes, costs and payments live in the job. */
export default function JobsPage() {
  const { data, can } = useStore();
  const ui = useUI();
  const finance = can("finance.read");
  const [filter, setFilter] = React.useState<Filter>("active");
  const list = data.jobs.filter(TESTS[filter]);
  const active = data.jobs.filter(isActiveJob);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Jobs</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">
            {active.length} active{finance ? ` · ${gbp(active.reduce((s, j) => s + j.quotedValue, 0))} on the books` : ""}
          </p>
        </div>
        {can("jobs.write") ? (
          <button type="button" onClick={() => ui.openForm({ form: "job" })} className="flex h-11 items-center gap-1.5 rounded-xl bg-raised px-4 text-[15px] font-semibold ring-1 ring-line-strong transition hover:bg-raised-hover">
            <Plus className="size-[18px]" /> Add job
          </button>
        ) : null}
      </div>
      <Tabs
        label="Jobs"
        className="mb-3"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "active", label: "Active", count: active.length },
          { value: "done", label: "Finished", count: data.jobs.filter(TESTS.done).length },
          { value: "all", label: "All", count: data.jobs.length },
        ]}
      />
      {list.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {list.map((j) => {
            const f = finance ? jobFinance(j, data.payments) : null;
            return (
              <ListRow
                key={j.id}
                onOpen={() => ui.openJob(j.id)}
                openLabel={`${j.title} for ${j.customerName}`}
                leading={<JobTile kind={j.kind} className="size-10 rounded-lg [&_svg]:size-5" />}
                title={`${j.title} · ${j.customerName}`}
                aside={f ? gbp(j.quotedValue) : undefined}
                meta={
                  <>
                    <span className="block">
                      <span className="text-accent-fg">Next:</span> {jobNextStep(j, data, finance)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3">
                      <JobStatusBadge status={j.status} />
                      {f && j.depositRequired > 0 && f.depositOutstanding > 0 && isActiveJob(j) ? (
                        <StatusText tone={f.depositOverdue ? "red" : "amber"}>
                          {gbp(f.depositOutstanding)} deposit {f.depositOverdue ? "overdue" : "due"}
                        </StatusText>
                      ) : null}
                      <span className="text-[13.5px] text-subtle">{j.location}</span>
                    </span>
                  </>
                }
              />
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={HardHat} title="No jobs here" body="Try another list, or add a new job." />
      )}
    </div>
  );
}
