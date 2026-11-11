"use client";

import * as React from "react";
import { HardHat, MapPin, Plus, ArrowRight } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { JOB_STATUS_LABEL, isActiveJob, jobFinance } from "@/lib/derive";
import type { Job, JobStatus } from "@/lib/types";
import { gbp } from "@/lib/utils";
import { EmptyState, FilterChips, PageHeader, ProgressBar } from "@/components/common/bits";
import { JobStatusBadge } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";
import { Button } from "@/components/ui/button";

type Filter = "active" | JobStatus | "all";

export default function JobsPage() {
  const { data, can } = useStore();
  const ui = useUI();
  const [filter, setFilter] = React.useState<Filter>("active");
  const match = (j: Job) => (filter === "all" ? true : filter === "active" ? isActiveJob(j) : j.status === filter);
  const list = data.jobs.filter(match);
  const statuses: JobStatus[] = ["awaiting_deposit", "scheduled", "in_progress", "snagging", "quoted", "completed", "lost"];

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle={`${data.jobs.filter(isActiveJob).length} active${can("finance.read") ? ` · ${gbp(data.jobs.filter(isActiveJob).reduce((s, j) => s + j.quotedValue, 0))} on the books` : ""}`}
        actions={
          can("jobs.write") ? (
            <Button onClick={() => ui.openForm({ form: "job" })}>
              <Plus /> New job
            </Button>
          ) : null
        }
      />
      <div className="mb-4">
        <FilterChips
          label="Filter jobs"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active" as Filter, label: "Active", count: data.jobs.filter(isActiveJob).length },
            ...statuses.map((s) => ({ value: s as Filter, label: JOB_STATUS_LABEL[s], count: data.jobs.filter((j) => j.status === s).length })),
            { value: "all" as Filter, label: "All", count: data.jobs.length },
          ]}
        />
      </div>
      {list.length ? (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {list.map((j) => {
            const f = jobFinance(j, data.payments);
            return (
              <li key={j.id}>
                <button
                  onClick={() => ui.openJob(j.id)}
                  className="card-surface flex h-full w-full flex-col rounded-2xl p-4 text-left transition hover:bg-white/[0.05]"
                >
                  <div className="flex w-full items-start gap-4">
                    <JobTile kind={j.kind} className="size-[72px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[16px] font-semibold">{j.title}</div>
                          <div className="truncate text-[14px] text-foreground/85">{j.customerName}</div>
                          <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
                            <MapPin className="size-3.5 text-copper-400" /> {j.location}
                          </div>
                        </div>
                        <JobStatusBadge status={j.status} />
                      </div>
                    </div>
                  </div>
                  {can("finance.read") ? (
                    <>
                      <div className="mt-4 grid w-full grid-cols-3 gap-2 text-[13px]">
                        <Stat label="Price" value={gbp(j.quotedValue)} />
                        <Stat
                          label="Deposit"
                          value={j.depositRequired === 0 ? "None" : f.depositOutstanding === 0 ? "Paid" : `${gbp(f.depositOutstanding)} due`}
                          tone={j.depositRequired === 0 ? undefined : f.depositOutstanding === 0 ? "green" : f.depositOverdue ? "red" : "amber"}
                        />
                        <Stat label="Left to pay" value={gbp(f.balance)} />
                      </div>
                      <div className="mt-3 flex w-full items-center gap-3">
                        <ProgressBar value={f.paidPercent} className="flex-1" />
                        <span className="tabular text-[12px] text-muted-foreground">{f.paidPercent}%</span>
                      </div>
                    </>
                  ) : null}
                  {j.nextAction ? (
                    <div className="mt-3 flex w-full items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-[13px] text-foreground/85 ring-1 ring-white/[0.06]">
                      <ArrowRight className="size-3.5 shrink-0 text-copper-400" />
                      <span className="truncate">{j.nextAction}</span>
                    </div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={HardHat} title="No jobs here" body="Try another filter, or add a new job." />
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "red" }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2 ring-1 ring-white/[0.06]">
      <div className="text-[11.5px] text-subtle">{label}</div>
      <div
        className={
          "tabular mt-0.5 truncate font-semibold " +
          (tone === "green" ? "text-emerald-300" : tone === "amber" ? "text-amber-200" : tone === "red" ? "text-red-300" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
