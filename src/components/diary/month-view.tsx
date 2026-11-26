"use client";

/** Month view: upcoming jobs and holidays across the month. Pick a day to open its week. */
import * as React from "react";
import { CalendarOff } from "lucide-react";
import { absencesOnDay } from "@/lib/leave";
import { addDays, formatDayLong, rangeKeys, weekStart, weekday } from "@/lib/dates";
import { coversDay } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { jobTone } from "@/components/common/people";
import { firstName } from "./shared";

type Props = {
  month: string; // YYYY-MM-01
  weekends: boolean;
  today: string;
  bookings: Booking[];
  absences: Absence[];
  jobs: Map<string, Job>;
  people: Map<string, Person>;
  onOpen: (b: Booking) => void;
  onPickDay: (day: string) => void;
};

export function monthGrid(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return rangeKeys(weekStart(month), addDays(weekStart(last), 6));
}

export function MonthView({ month, weekends, today, bookings, absences, jobs, people, onOpen, onPickDay }: Props) {
  const all = monthGrid(month).filter((d) => weekends || weekday(d) < 5);
  const n = weekends ? 7 : 5;
  const heads = (weekends ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  return (
    <section aria-label="Month" className="panel overflow-hidden">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {heads.map((h) => (
          <div key={h} className="px-3 py-2 text-[12.5px] font-medium text-subtle">
            {h}
          </div>
        ))}
      </div>
      <div className="-mb-px -mr-px grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {all.map((d) => {
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          const list = bookings.filter((b) => coversDay(b, d)).sort((a, z) => (a.startTime ?? "").localeCompare(z.startTime ?? ""));
          const off = absencesOnDay(absences, d);
          const isToday = d === today;
          const shown = list.slice(0, 3);
          return (
            <div key={d} className={cn("group/m flex min-h-[132px] min-w-0 flex-col gap-1 border-b border-r border-line p-1.5", !inMonth && "bg-surface-2", isToday && "bg-copper-50/50")}>
              <button type="button" onClick={() => onPickDay(d)} aria-label={`Open the week of ${formatDayLong(d)}`} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-surface-3">
                <span className={cn("tabular text-[13px] font-semibold", isToday ? "text-brand-fg" : inMonth ? "text-heading" : "text-subtle")}>{Number(d.slice(8))}</span>
                {isToday ? <span className="rounded-sm bg-copper-500/12 px-1 text-[10.5px] font-semibold text-brand-fg">Today</span> : null}
                {list.length ? <span className="ml-auto text-[11.5px] tabular text-subtle">{list.length}</span> : null}
              </button>
              {off.length ? (
                <span className="flex min-w-0 items-center gap-1 rounded-sm bg-violet-500/[0.09] px-1.5 py-0.5 text-[11.5px] font-medium text-violet-800" title={off.map((a) => people.get(a.personId)?.name).join(", ")}>
                  <CalendarOff className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{off.map((a) => firstName(people.get(a.personId))).join(", ")} off</span>
                </span>
              ) : null}
              {shown.map((b) => {
                const j = jobs.get(b.jobId);
                const tone = jobTone(b.jobId);
                return (
                  <button key={b.id} type="button" onClick={() => onOpen(b)} className="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left text-[12px] hover:bg-surface-3" title={`${j?.title ?? "Job"} · ${j?.customerName ?? ""} · ${j?.location ?? ""}`}>
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", b.personIds.length ? tone.dot : "bg-warning")} />
                    <span className="truncate font-medium text-foreground">{j?.title ?? "Job"}</span>
                    {j?.location ? <span className="hidden shrink-0 truncate text-subtle xl:inline">{j.location}</span> : null}
                  </button>
                );
              })}
              {list.length > shown.length ? (
                <button type="button" onClick={() => onPickDay(d)} className="px-1.5 text-left text-[11.5px] font-medium text-subtle hover:text-foreground">
                  +{list.length - shown.length} more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
