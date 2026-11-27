"use client";

import { JOB_STATUS_LABEL } from "@/lib/derive";
import type { JobStatus } from "@/lib/types";
import { cn, todayKey } from "@/lib/utils";

/** A job's status as one clear, coloured label. */
export const JOB_STATUS_STYLE: Record<JobStatus, string> = {
  quoted: "bg-surface-3 text-muted-foreground",
  awaiting_deposit: "bg-[#fff1d6] text-[#8a5a00]",
  scheduled: "bg-[#e6eeff] text-[#2f4fa8]",
  in_progress: "bg-copper-500 text-white",
  snagging: "bg-[#efe9ff] text-[#5b3fc4]",
  completed: "bg-[#e3f3ea] text-[#1f6b45]",
  lost: "bg-surface-3 text-subtle",
};

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return <span className={cn("inline-flex h-7 items-center whitespace-nowrap rounded-md px-2.5 text-[13.5px] font-semibold", JOB_STATUS_STYLE[status], className)}>{JOB_STATUS_LABEL[status]}</span>;
}

/** "30 Nov" this year, "30 Nov 2027" otherwise; "—" when not set. */
export function shortDate(d?: string, today = todayKey()) {
  if (!d) return "—";
  const dt = new Date(`${d}T12:00:00`);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
}

