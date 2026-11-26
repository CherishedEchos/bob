"use client";

/**
 * Week view: every booking across the week. Multi-day work runs as one
 * continuous bar across the days it covers; single-day visits sit under their
 * day. Drag anything to another day; clashes are checked before saving.
 */
import * as React from "react";
import { MapPin, Plus } from "lucide-react";
import { absencesOnDay } from "@/lib/leave";
import { formatDayLong, formatTimeRange, weekday } from "@/lib/dates";
import { bookingDays, coversDay } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PeopleStack, jobTone } from "@/components/common/people";
import { LeaveChip, type MoveRequest, namesLine, readDragData, setDragData } from "./shared";

type Props = {
  days: string[];
  today: string;
  bookings: Booking[];
  absences: Absence[];
  jobs: Map<string, Job>;
  people: Map<string, Person>;
  activePeople: Person[];
  manage: boolean;
  onOpen: (b: Booking) => void;
  onAdd: (day: string) => void;
  onMove: (req: MoveRequest) => void;
};

const dow = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export function WeekView({ days, today, bookings, absences, jobs, people, activePeople, manage, onOpen, onAdd, onMove }: Props) {
  const n = days.length;
  const grid = React.useRef<HTMLDivElement>(null);
  const [over, setOver] = React.useState<number | null>(null);
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` } as const;

  const multi = bookings.filter((b) => b.endDate && b.endDate > b.date && days.some((d) => coversDay(b, d)));
  const single = bookings.filter((b) => !(b.endDate && b.endDate > b.date));

  // Pack multi-day bars into lanes so they never overlap.
  const bars = multi
    .map((b) => {
      const idx = days.map((d, i) => (coversDay(b, d) ? i : -1)).filter((i) => i >= 0);
      return { b, s: idx[0], e: idx[idx.length - 1], before: b.date < days[0], after: (b.endDate ?? b.date) > days[n - 1] };
    })
    .sort((a, z) => a.s - z.s || z.e - z.s - (a.e - a.s) || (a.b.startTime ?? "").localeCompare(z.b.startTime ?? ""));
  const laneEnds: number[] = [];
  const placed = bars.map((x) => {
    let lane = laneEnds.findIndex((end) => end < x.s);
    if (lane < 0) lane = laneEnds.push(x.e) - 1;
    else laneEnds[lane] = x.e;
    return { ...x, lane };
  });

  const leaveByDay = days.map((d) => absencesOnDay(absences, d));
  const anyLeave = leaveByDay.some((l) => l.length);

  const colAt = (clientX: number) => {
    const r = grid.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)));
  };

  const dragProps = manage
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("text/plain")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(colAt(e.clientX));
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!grid.current?.contains(e.relatedTarget as Node)) setOver(null);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setOver(null);
          const p = readDragData(e);
          if (p) onMove({ bookingId: p.bookingId, fromDay: p.fromDay, toDay: days[colAt(e.clientX)] });
        },
      }
    : {};

  return (
    <section aria-label="Week" className="panel overflow-hidden">
      <div ref={grid} className="relative" {...dragProps}>
        {/* Column backgrounds: today, weekends, drop target */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid divide-x divide-line" style={cols}>
          {days.map((d, i) => (
            <div key={d} className={cn("transition-colors", d === today && "bg-copper-50/50", over === i && "bg-copper-500/[0.07]", weekday(d) >= 5 && d !== today && "bg-surface-2")} />
          ))}
        </div>

        {/* Day headers */}
        <div className="relative grid border-b border-line" style={cols}>
          {days.map((d) => {
            const isToday = d === today;
            const count = bookings.filter((b) => coversDay(b, d)).length;
            return (
              <h3 key={d} title={formatDayLong(d)} className="flex h-11 items-center gap-1.5 px-3">
                <span className={cn("text-[12.5px] font-medium", isToday ? "text-brand-fg" : "text-subtle")}>{dow(d)}</span>
                <span className={cn("tabular text-[15px] font-semibold", isToday ? "text-brand-fg" : "text-heading")}>{Number(d.slice(8))}</span>
                {isToday ? <span className="ml-0.5 rounded-sm bg-copper-500/12 px-1 text-[11px] font-semibold text-brand-fg">Today</span> : null}
                {count ? <span className="ml-auto text-[12px] tabular text-subtle" aria-label={`${count} booked`}>{count}</span> : null}
              </h3>
            );
          })}
        </div>

        {/* Who's off */}
        {anyLeave ? (
          <div className="relative grid border-b border-line" style={cols}>
            {leaveByDay.map((list, i) => (
              <div key={days[i]} className="flex min-w-0 flex-col gap-1 px-1.5 py-1.5">
                {list.map((a) => (
                  <LeaveChip key={a.id} absence={a} person={people.get(a.personId)} />
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {/* Multi-day work as continuous bars */}
        {placed.length ? (
          <div className="relative grid gap-y-1.5 border-b border-line py-2" style={{ ...cols, gridTemplateRows: `repeat(${laneEnds.length}, auto)` }}>
            {placed.map(({ b, s, e, lane, before, after }) => (
              <SpanBar
                key={b.id}
                booking={b}
                job={jobs.get(b.jobId)}
                people={people}
                style={{ gridColumn: `${s + 1} / ${e + 2}`, gridRow: lane + 1 }}
                before={before}
                after={after}
                draggable={manage}
                onOpen={() => onOpen(b)}
                onDragStart={(ev) => setDragData(ev, { bookingId: b.id, fromDay: days[colAt(ev.clientX)] })}
              />
            ))}
          </div>
        ) : null}

        {/* Single-day visits, then the free people and an Add button */}
        <div className="relative grid min-h-[calc(100dvh-420px)]" style={cols}>
          {days.map((d) => {
            const list = single.filter((b) => b.date === d).sort((a, z) => (a.startTime ?? "00:00").localeCompare(z.startTime ?? "00:00"));
            const busy = new Set(bookings.filter((b) => coversDay(b, d)).flatMap((b) => b.personIds));
            const off = new Set(absencesOnDay(absences, d).map((a) => a.personId));
            const free = activePeople.filter((p) => !busy.has(p.id) && !off.has(p.id));
            return (
              <div key={d} className="group/day flex min-w-0 flex-col gap-1.5 p-1.5">
                {list.map((b) => (
                  <BookingCard key={b.id} booking={b} job={jobs.get(b.jobId)} people={people} draggable={manage} onOpen={() => onOpen(b)} onDragStart={(ev) => setDragData(ev, { bookingId: b.id, fromDay: d })} />
                ))}
                <div className="mt-auto pt-2">
                  {free.length ? (
                    <p className="truncate px-1.5 pb-1 text-[12px] text-subtle" title={`Free: ${free.map((p) => p.name).join(", ")}`}>
                      <span className="font-medium text-good-fg">Free</span> · {namesLine(free, 2)}
                    </p>
                  ) : null}
                  {manage ? (
                    <button
                      type="button"
                      onClick={() => onAdd(d)}
                      aria-label={`Schedule work on ${formatDayLong(d)}`}
                      className="flex h-8 w-full items-center justify-center gap-1 rounded-md text-[12.5px] font-medium text-subtle opacity-0 transition hover:bg-card hover:text-foreground hover:shadow-[0_0_0_1px_var(--color-line-strong)] focus-visible:opacity-100 group-hover/day:opacity-100 [@media(hover:none)]:opacity-100"
                    >
                      <Plus className="size-3.5" aria-hidden /> Add
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SpanBar({
  booking: b,
  job,
  people,
  style,
  before,
  after,
  draggable,
  onOpen,
  onDragStart,
}: {
  booking: Booking;
  job?: Job;
  people: Map<string, Person>;
  style: React.CSSProperties;
  before: boolean;
  after: boolean;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const tone = jobTone(b.jobId);
  const n = bookingDays(b).length;
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      style={style}
      aria-label={`${job?.title ?? "Job"}, ${job?.customerName ?? ""}, ${job?.location ?? ""}, ${n} days, ${formatTimeRange(b.startTime, b.endTime)}, ${who.length ? who.map((p) => p.name).join(", ") : "nobody assigned"}`}
      className={cn(
        "relative mx-1.5 flex min-w-0 items-center gap-3 overflow-hidden rounded-md py-1.5 pl-3 pr-2 text-left ring-1 transition hover:shadow-[var(--shadow-md)]",
        tone.card,
        before && "ml-0 rounded-l-none",
        after && "mr-0 rounded-r-none",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", who.length ? tone.bar : "bg-warning")} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={cn("truncate text-[13.5px] font-semibold", tone.text)}>{job?.title ?? "Job"}</span>
          <span className="hidden truncate text-[12.5px] text-foreground/70 xl:inline">{job?.customerName}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-foreground/70">
          {job?.location ? (
            <span className="flex min-w-0 items-center gap-0.5 truncate">
              <MapPin className="size-3 shrink-0 text-subtle" aria-hidden />
              {job.location}
            </span>
          ) : null}
          <span className="shrink-0 tabular">{formatTimeRange(b.startTime, b.endTime)}</span>
          <span className="shrink-0 text-subtle">· {n} days</span>
        </span>
      </span>
      {who.length ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="hidden max-w-[140px] truncate text-[12px] font-medium text-foreground/75 2xl:inline">{namesLine(who, 2)}</span>
          <PeopleStack people={who} size={22} max={3} />
        </span>
      ) : (
        <span className="shrink-0 rounded-sm bg-warning/15 px-1.5 py-0.5 text-[11.5px] font-semibold text-warn-fg">Needs people</span>
      )}
    </button>
  );
}

function BookingCard({ booking: b, job, people, draggable, onOpen, onDragStart }: { booking: Booking; job?: Job; people: Map<string, Person>; draggable: boolean; onOpen: () => void; onDragStart: (e: React.DragEvent) => void }) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const tone = jobTone(b.jobId);
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      aria-label={`${job?.title ?? "Job"}, ${job?.customerName ?? ""}, ${job?.location ?? ""}, ${formatTimeRange(b.startTime, b.endTime)}, ${who.length ? who.map((p) => p.name).join(", ") : "nobody assigned"}`}
      className={cn("relative block w-full overflow-hidden rounded-md py-2 pl-3 pr-2 text-left ring-1 transition hover:shadow-[var(--shadow-md)]", tone.card, draggable && "cursor-grab active:cursor-grabbing")}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", who.length ? tone.bar : "bg-warning")} />
      <span className="block text-[12px] font-medium tabular text-foreground/70">{formatTimeRange(b.startTime, b.endTime)}</span>
      <span className={cn("mt-0.5 block line-clamp-2 text-[13.5px] font-semibold leading-snug", tone.text)}>{job?.title ?? "Job"}</span>
      <span className="mt-0.5 block truncate text-[12.5px] text-foreground/70">
        {job?.customerName}
        {job?.location ? <span className="text-subtle"> · {job.location}</span> : null}
      </span>
      <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
        {who.length ? (
          <>
            <PeopleStack people={who} size={20} max={3} />
            <span className="truncate text-[12px] font-medium text-foreground/75">{namesLine(who, 2)}</span>
          </>
        ) : (
          <span className="rounded-sm bg-warning/15 px-1.5 py-0.5 text-[11.5px] font-semibold text-warn-fg">Needs people</span>
        )}
      </span>
    </button>
  );
}
