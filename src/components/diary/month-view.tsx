"use client";

/** Month: what's coming up and who's off, a day per cell. Click a day number to open its week. */
import * as React from "react";
import { formatDayLong } from "@/lib/dates";
import { byStartTime, liveAbsence, monthWeeks } from "@/lib/diary";
import { bookingEndDate } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { jobTone } from "@/components/common/people";
import { absenceText, dayNum, firstName } from "./shared";

const MAX = 3;

export function MonthView({
  anchor,
  today,
  showWeekends,
  bookings,
  absences,
  jobs,
  people,
  onOpen,
  onDay,
}: {
  anchor: string;
  today: string;
  showWeekends: boolean;
  bookings: Booking[];
  absences: Absence[];
  jobs: Map<string, Job>;
  people: Map<string, Person>;
  onOpen: (b: Booking) => void;
  onDay: (day: string) => void;
}) {
  const month = anchor.slice(0, 7);
  const weeks = monthWeeks(anchor).map((w) => (showWeekends ? w : w.slice(0, 5)));
  const heads = showWeekends ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const cols = `repeat(${heads.length}, minmax(0, 1fr))`;
  const live = absences.filter(liveAbsence);
  return (
    <section aria-label="Month" className="panel overflow-hidden">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
        {heads.map((h, i) => (
          <div key={h} className={cn("px-3 py-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-subtle", i && "border-l border-line")}>
            {h}
          </div>
        ))}
      </div>
      {weeks.map((w) => (
        <div key={w[0]} className="grid border-b border-line last:border-b-0" style={{ gridTemplateColumns: cols }}>
          {w.map((d, i) => {
            const inMonth = d.slice(0, 7) === month;
            const list = bookings.filter((b) => b.date <= d && bookingEndDate(b) >= d).sort(byStartTime);
            const off = live.filter((a) => a.startDate <= d && a.endDate >= d);
            const shown = list.slice(0, Math.max(0, MAX - Math.min(off.length, 1)));
            const more = list.length - shown.length;
            return (
              <div key={d} className={cn("flex min-h-[132px] min-w-0 flex-col gap-1 p-1.5", i && "border-l border-line", !inMonth && "bg-[#fbfaf8]", d === today && "bg-copper-50/60")}>
                <button
                  type="button"
                  onClick={() => onDay(d)}
                  aria-label={`Open the week of ${formatDayLong(d)}`}
                  className={cn(
                    "tabular grid size-6 place-items-center self-start rounded-md text-[13.5px] font-semibold transition-colors hover:bg-surface-3",
                    inMonth ? "text-heading" : "text-subtle/70",
                    d === today && "bg-copper-500 text-white hover:bg-copper-600",
                  )}
                >
                  {dayNum(d)}
                </button>
                {off.length ? (
                  <span title={off.map((a) => absenceText(a, people)).join("\n")} className="truncate rounded px-1.5 py-0.5 text-[12.5px] font-medium text-violet-800 bg-violet-50">
                    {off.map((a) => firstName(people.get(a.personId)?.name)).join(", ")} off
                  </span>
                ) : null}
                {shown.map((b) => {
                  const tone = jobTone(b.jobId);
                  const job = jobs.get(b.jobId);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onOpen(b)}
                      title={`${job?.title ?? "Job"} · ${job?.customerName ?? ""}`}
                      className={cn("flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[12.5px] font-medium ring-1", b.personIds.length ? tone.card : "bg-[#fffbf2] ring-warning/50")}
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", b.personIds.length ? tone.dot : "bg-warning")} />
                      <span className={cn("truncate", b.personIds.length ? tone.text : "text-[#7a5410]")}>{job?.title ?? "Job"}</span>
                    </button>
                  );
                })}
                {more > 0 ? (
                  <button type="button" onClick={() => onDay(d)} className="self-start rounded px-1.5 text-[12.5px] font-medium text-subtle hover:text-foreground">
                    +{more} more
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
