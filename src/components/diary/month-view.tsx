"use client";

/**
 * Month: a calm overview. Each booking is one bar in its job's colour across
 * the days it's booked, showing only the job name; holidays are violet bars.
 * Click a bar for the full booking, or a day number to open that week.
 */
import * as React from "react";
import { formatDayLong, formatDayShort } from "@/lib/dates";
import { byStartTime, layoutSegments, liveAbsence, monthWeeks } from "@/lib/diary";
import { bookingEndDate } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { jobTone } from "@/components/common/people";
import { absenceText, dayNum, firstName } from "./shared";

const MAX_LANES = 4;
type Item = { kind: "leave"; a: Absence } | { kind: "booking"; b: Booking };

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
  const items: Item[] = [...live.map((a) => ({ kind: "leave" as const, a })), ...bookings.map((b) => ({ kind: "booking" as const, b }))];
  const range = (i: Item): [string, string] => (i.kind === "leave" ? [i.a.startDate, i.a.endDate] : [i.b.date, bookingEndDate(i.b)]);
  const order = (x: Item, y: Item) => (x.kind === "leave" ? -1 : y.kind === "leave" ? 1 : byStartTime(x.b, y.b));
  return (
    <section aria-label="Month" className="panel overflow-hidden">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
        {heads.map((h, i) => (
          <div key={h} className={cn("px-3 py-2.5 text-[13px] font-semibold uppercase tracking-[0.04em] text-subtle", i && "border-l border-line")}>
            {h}
          </div>
        ))}
      </div>
      {weeks.map((w) => {
        const { segments } = layoutSegments(items, w, range, order);
        const shown = segments.filter((s) => s.lane < MAX_LANES);
        const hiddenOn = (i: number) => segments.filter((s) => s.lane >= MAX_LANES && s.col <= i && s.col + s.span - 1 >= i).length;
        return (
          <div key={w[0]} className="relative grid border-b border-line last:border-b-0" style={{ gridTemplateColumns: cols, gridTemplateRows: `36px repeat(${MAX_LANES}, 30px) 28px` }}>
            {w.map((d, i) => {
              const inMonth = d.slice(0, 7) === month;
              const more = hiddenOn(i);
              return (
                <div key={d} style={{ gridColumn: i + 1, gridRow: "1 / -1" }} className={cn("relative", i && "border-l border-line", !inMonth && "bg-[#fbf9f6]", d === today && "bg-copper-50/60")}>
                  <button
                    type="button"
                    onClick={() => onDay(d)}
                    aria-label={`Open the week of ${formatDayLong(d)}`}
                    className={cn(
                      "tabular absolute left-2 top-2 grid size-7 place-items-center rounded-full text-[14px] font-semibold transition-colors hover:bg-surface-3",
                      inMonth ? "text-heading" : "text-subtle/70",
                      d === today && "bg-copper-500 text-white hover:bg-copper-600",
                    )}
                  >
                    {dayNum(d)}
                  </button>
                  {more ? (
                    <button type="button" onClick={() => onDay(d)} className="absolute bottom-1 left-2 text-[13px] font-semibold text-subtle hover:text-foreground">
                      +{more} more
                    </button>
                  ) : null}
                </div>
              );
            })}
            {shown.map((s) => {
              const style = { gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 2 };
              if (s.item.kind === "leave") {
                const a = s.item.a;
                return (
                  <div key={`l-${a.id}-${s.col}`} style={style} className="relative z-10 px-1 py-[3px]">
                    <div
                      title={absenceText(a, people)}
                      className={cn(
                        "flex h-full items-center truncate rounded px-2 text-[13px] font-semibold",
                        a.status === "pending" ? "border border-dashed border-violet-300 bg-white text-violet-700" : "bg-violet-100 text-violet-800",
                        s.continuesBefore && "rounded-l-none",
                        s.continuesAfter && "rounded-r-none",
                      )}
                    >
                      {firstName(people.get(a.personId)?.name)} off
                    </div>
                  </div>
                );
              }
              const b = s.item.b;
              const job = jobs.get(b.jobId);
              const tone = jobTone(b.jobId);
              const end = bookingEndDate(b);
              const dates = end !== b.date ? `${formatDayShort(b.date)} – ${formatDayShort(end)}` : formatDayShort(b.date);
              return (
                <div key={`b-${b.id}-${s.col}`} style={style} className="relative z-10 px-1 py-[3px]">
                  <button
                    type="button"
                    onClick={() => onOpen(b)}
                    title={`${job?.title ?? "Job"} · ${dates}`}
                    aria-label={`${job?.title ?? "Job"}, ${dates}`}
                    className={cn(
                      "flex h-full w-full items-center gap-1.5 truncate rounded px-2 text-left text-[13px] font-semibold text-white transition-[filter] hover:brightness-95",
                      b.personIds.length ? tone.bar : "bg-warning",
                      s.continuesBefore && "rounded-l-none",
                      s.continuesAfter && "rounded-r-none",
                    )}
                  >
                    <span className="truncate">{job?.title ?? "Job"}</span>
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
