"use client";

/**
 * Week: every booking across the visible days as blocks — multi-day work is one
 * continuous bar. Leave sits above the work. Drag a block to another day; the
 * clash check runs before anything is saved. Empty space shows who's free.
 */
import * as React from "react";
import { Plus } from "lucide-react";
import { absencesOnDay } from "@/lib/leave";
import { formatDayLong } from "@/lib/dates";
import { availability, byStartTime, layoutSegments, liveAbsence, type Conflict } from "@/lib/diary";
import { bookingEndDate } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BookingBlock, LeaveBlock, dayNum, dow, firstName, grabbedDay, shiftBetween } from "./shared";

export function WeekView({
  days,
  today,
  bookings,
  absences,
  jobs,
  people,
  team,
  conflicts,
  manage,
  onOpen,
  onAdd,
  onMove,
}: {
  days: string[];
  today: string;
  bookings: Booking[];
  absences: Absence[];
  jobs: Map<string, Job>;
  people: Map<string, Person>;
  /** Active people, for "free" hints. */
  team: Person[];
  conflicts: Conflict[];
  manage: boolean;
  onOpen: (b: Booking) => void;
  onAdd: (day: string) => void;
  onMove: (bookingId: string, shift: number) => void;
}) {
  const [drag, setDrag] = React.useState<{ id: string; grabbed: string } | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const live = absences.filter(liveAbsence);
  const leave = layoutSegments(live, days, (a) => [a.startDate, a.endDate]);
  const work = layoutSegments(bookings, days, (b) => [b.date, bookingEndDate(b)], byStartTime);
  const conflictText = (b: Booking) => {
    const c = conflicts.filter((x) => x.bookingIds.includes(b.id));
    if (!c.length) return undefined;
    return Array.from(new Set(c.map((x) => `${firstName(people.get(x.personId)?.name)} ${x.kind === "absence" ? "is off" : "is double-booked"}`))).join(", ");
  };
  const cols = days.map((d) => (dayIsWeekend(d) ? "minmax(0,0.72fr)" : "minmax(0,1fr)")).join(" ");
  const leaveRows = leave.lanes;
  const workRows = Math.max(work.lanes, 1);
  const firstWorkRow = 2 + leaveRows;

  return (
    <section aria-label="Week" className="panel overflow-hidden">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
        {days.map((d, i) => {
          const isToday = d === today;
          const n = new Set(bookings.filter((b) => b.date <= d && bookingEndDate(b) >= d).flatMap((b) => b.personIds)).size;
          return (
            <h2 key={d} title={formatDayLong(d)} className={cn("flex items-baseline gap-1.5 px-3 py-2.5", i && "border-l border-line", isToday && "bg-copper-50/70")}>
              <span className={cn("text-[13px] font-semibold uppercase tracking-[0.04em]", isToday ? "text-copper-600" : "text-subtle")}>{dow(d)}</span>
              <span className={cn("tabular grid h-7 min-w-7 place-items-center rounded-full px-1 text-[17px] font-bold", isToday ? "bg-copper-500 text-white" : "text-heading")}>{dayNum(d)}</span>
              {isToday ? <span className="sr-only">(today)</span> : null}
              {n ? <span className="tabular ml-auto text-[12.5px] text-subtle">{n} on site</span> : null}
            </h2>
          );
        })}
      </div>

      <div
        className="relative grid min-h-[calc(100dvh-380px)]"
        style={{ gridTemplateColumns: cols, gridTemplateRows: ["6px", leaveRows ? `repeat(${leaveRows}, 30px)` : "", `repeat(${workRows}, minmax(96px, auto))`, "1fr"].filter(Boolean).join(" ") }}
      >
        {/* Day columns: background, drop target, click empty space to add */}
        {days.map((d, i) => {
          const isToday = d === today;
          const free = team.filter((p) => p.kind === "employee" && availability(p.id, d, bookings, absences) === "free");
          return (
            <div
              key={d}
              style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
              className={cn("group/day relative flex flex-col justify-end", i && "border-l border-line", isToday && "bg-copper-50/50", dayIsWeekend(d) && !isToday && "bg-[#fbfaf8]", over === d && "bg-copper-500/[0.07]")}
              onDragOver={
                manage
                  ? (e) => {
                      if (!drag) return;
                      e.preventDefault();
                      setOver(d);
                    }
                  : undefined
              }
              onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={
                manage
                  ? (e) => {
                      e.preventDefault();
                      setOver(null);
                      if (drag) onMove(drag.id, shiftBetween(drag.grabbed, d));
                      setDrag(null);
                    }
                  : undefined
              }
            >
              <div className="relative z-0 px-2 pb-2">
                {free.length && d >= today ? (
                  <p className="mb-1.5 line-clamp-2 px-1 text-[12.5px] leading-snug text-subtle" title={`Free all day: ${free.map((p) => p.name).join(", ")}`}>
                    <span className="font-medium text-good-fg">Free</span> · {free.map((p) => firstName(p.name)).join(", ")}
                  </p>
                ) : null}
                {manage ? (
                  <button
                    type="button"
                    onClick={() => onAdd(d)}
                    aria-label={`Schedule work on ${formatDayLong(d)}`}
                    className="flex h-9 w-full items-center justify-center gap-1 rounded-md text-[13.5px] font-medium text-subtle opacity-0 transition hover:bg-card hover:text-foreground hover:ring-1 hover:ring-line-strong focus-visible:opacity-100 group-hover/day:opacity-100"
                  >
                    <Plus className="size-3.5" aria-hidden /> Add
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {leave.segments.map((s) => (
          <div key={`${s.item.id}-${s.col}`} className="relative z-10 px-1 py-[3px]" style={{ gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: 2 + s.lane }}>
            <LeaveBlock absence={s.item} people={people} continuesBefore={s.continuesBefore} continuesAfter={s.continuesAfter} />
          </div>
        ))}

        {work.segments.map((s) => (
          <div
            key={`${s.item.id}-${s.col}`}
            className={cn("relative z-10 px-1 py-1", drag && drag.id !== s.item.id && "pointer-events-none")}
            style={{ gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: firstWorkRow + s.lane }}
          >
            <BookingBlock
              booking={s.item}
              job={jobs.get(s.item.jobId)}
              people={people}
              conflict={conflictText(s.item)}
              continuesBefore={s.continuesBefore}
              continuesAfter={s.continuesAfter}
              draggable={manage}
              dimmed={drag?.id === s.item.id}
              onOpen={() => onOpen(s.item)}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/booking", s.item.id);
                e.dataTransfer.effectAllowed = "move";
                setDrag({ id: s.item.id, grabbed: grabbedDay(e, s.startDay, s.span) });
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
            />
          </div>
        ))}
      </div>
      <LeaveLegend absences={live} days={days} />
    </section>
  );
}

const dayIsWeekend = (d: string) => {
  const w = new Date(`${d}T12:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};

/** A quiet key, only when there's something to explain. */
function LeaveLegend({ absences, days }: { absences: Absence[]; days: string[] }) {
  const any = days.some((d) => absencesOnDay(absences, d).length);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[13px] text-subtle">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-[#fdf1e6] ring-1 ring-[#f6d9bf]" /> Each job keeps its colour
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-[#fffbf2] ring-1 ring-warning/60" /> Needs someone
      </span>
      {any ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-violet-50 ring-1 ring-violet-200" /> Holiday or unavailable
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-white ring-2 ring-destructive/70" /> Clash
      </span>
      <span className="hidden xl:inline">· Drag a booking to move it, click to edit</span>
    </div>
  );
}
