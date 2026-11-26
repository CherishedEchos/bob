"use client";

/**
 * Team view: people as rows, days as columns. Shows where everyone is, who is
 * free, who is off, double bookings and work that still needs people. Drag a
 * booking to another person or day to reassign or move it; the change is
 * checked for clashes before it's saved.
 */
import * as React from "react";
import { AlertTriangle, CalendarOff, CalendarPlus, Plus } from "lucide-react";
import { absencesOnDay } from "@/lib/leave";
import { formatDayLong, formatTimeRange, timeToMinutes, weekday } from "@/lib/dates";
import { bookingDays, coversDay } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PersonAvatar, jobTone } from "@/components/common/people";
import { type MoveRequest, doubleBookedOn, leaveLabel, readDragData, setDragData } from "./shared";

type Props = {
  days: string[];
  today: string;
  bookings: Booking[];
  absences: Absence[];
  jobs: Map<string, Job>;
  staff: Person[];
  subs: Person[];
  manage: boolean;
  onOpen: (b: Booking) => void;
  onAdd: (day: string, personId?: string) => void;
  onLeave: (day: string, personId: string) => void;
  onMove: (req: MoveRequest) => void;
};

const dow = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export function TeamView({ days, today, bookings, absences, jobs, staff, subs, manage, onOpen, onAdd, onLeave, onMove }: Props) {
  const cols = { gridTemplateColumns: `minmax(180px, 220px) repeat(${days.length}, minmax(0, 1fr))` } as const;
  const [over, setOver] = React.useState<string | null>(null);
  const unassigned = bookings.filter((b) => !b.personIds.length && days.some((d) => coversDay(b, d)));

  const drop = (e: React.DragEvent, day: string, personId: string | null) => {
    e.preventDefault();
    setOver(null);
    const p = readDragData(e);
    if (p) onMove({ bookingId: p.bookingId, fromDay: p.fromDay, toDay: day, fromPersonId: p.fromPersonId ?? null, toPersonId: personId });
  };
  const cellDrag = (key: string, day: string, personId: string | null) =>
    manage
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes("text/plain")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (over !== key) setOver(key);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o));
          },
          onDrop: (e: React.DragEvent) => drop(e, day, personId),
        }
      : {};

  const row = (p: Person) => {
    const mine = bookings.filter((b) => b.personIds.includes(p.id));
    const bookedDays = days.filter((d) => mine.some((b) => coversDay(b, d))).length;
    const offDays = days.filter((d) => absencesOnDay(absences, d).some((a) => a.personId === p.id)).length;
    return (
      <div key={p.id} role="row" className="grid border-b border-line last:border-b-0" style={cols}>
        <div role="rowheader" className="sticky left-0 z-10 flex min-w-0 items-center gap-2.5 border-r border-line bg-card px-3 py-2.5">
          <PersonAvatar person={p} size={30} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13.5px] font-semibold text-heading">{p.name}</span>
            <span className="block truncate text-[12px] text-subtle">{p.trade || (p.kind === "subcontractor" ? "Subcontractor" : "Employee")}</span>
            <span className="mt-0.5 block text-[11.5px] tabular text-subtle">
              {bookedDays ? `${bookedDays} ${bookedDays === 1 ? "day" : "days"} booked` : "Nothing booked"}
              {offDays ? ` · ${offDays} off` : ""}
            </span>
          </span>
        </div>
        {days.map((d) => {
          const list = mine.filter((b) => coversDay(b, d)).sort((a, z) => (a.startTime ?? "").localeCompare(z.startTime ?? ""));
          const leave = absencesOnDay(absences, d).filter((a) => a.personId === p.id);
          const clash = doubleBookedOn(list);
          const key = `${p.id}|${d}`;
          const lastEnd = list.length && list.every((b) => b.endTime) ? Math.max(...list.map((b) => timeToMinutes(b.endTime!))) : null;
          const freeFrom = lastEnd !== null && lastEnd <= 14 * 60 && !leave.length ? list.map((b) => b.endTime!).sort().at(-1) : null;
          return (
            <div
              key={d}
              role="gridcell"
              aria-label={`${p.name}, ${formatDayLong(d)}`}
              className={cn(
                "group/cell relative flex min-h-[76px] min-w-0 flex-col gap-1 border-r border-line p-1 last:border-r-0",
                d === today && "bg-copper-50/50",
                weekday(d) >= 5 && d !== today && "bg-surface-2",
                over === key && "bg-copper-500/[0.08] ring-2 ring-inset ring-copper-500/40",
                clash.size && "bg-destructive/[0.04]",
              )}
              {...cellDrag(key, d, p.id)}
            >
              {leave.map((a) => (
                <span
                  key={a.id}
                  title={`${p.name}: ${leaveLabel(a)}`}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium",
                    a.status === "pending" ? "border border-dashed border-violet-300 text-violet-700" : "bg-violet-500/[0.1] text-violet-800",
                  )}
                >
                  <CalendarOff className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{leaveLabel(a)}</span>
                </span>
              ))}
              {list.map((b) => (
                <Chip key={b.id} booking={b} day={d} job={jobs.get(b.jobId)} clash={clash.has(b.id)} draggable={manage} onOpen={() => onOpen(b)} onDragStart={(e) => setDragData(e, { bookingId: b.id, fromDay: d, fromPersonId: p.id })} />
              ))}
              {clash.size ? (
                <span className="flex items-center gap-1 px-1 text-[11.5px] font-semibold text-danger-fg">
                  <AlertTriangle className="size-3" aria-hidden /> Double-booked
                </span>
              ) : null}
              {!list.length && !leave.length ? (
                <span className="px-1.5 pt-1 text-[12px] font-medium text-good-fg/80">Free</span>
              ) : freeFrom ? (
                <span className="px-1.5 text-[11.5px] text-good-fg/80">Free from {freeFrom}</span>
              ) : null}
              {manage ? (
                <span className="mt-auto flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover/cell:opacity-100 [@media(hover:none)]:hidden">
                  <button type="button" onClick={() => onAdd(d, p.id)} aria-label={`Book ${p.name} on ${formatDayLong(d)}`} title="Book work" className="grid h-6 flex-1 place-items-center rounded-md text-subtle hover:bg-card hover:text-foreground hover:shadow-[0_0_0_1px_var(--color-line-strong)]">
                    <Plus className="size-3.5" />
                  </button>
                  {!leave.length ? (
                    <button type="button" onClick={() => onLeave(d, p.id)} aria-label={`Add time off for ${p.name} on ${formatDayLong(d)}`} title="Time off" className="grid h-6 flex-1 place-items-center rounded-md text-subtle hover:bg-card hover:text-violet-700 hover:shadow-[0_0_0_1px_var(--color-line-strong)]">
                      <CalendarOff className="size-3.5" />
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const group = (label: string, list: Person[]) =>
    list.length ? (
      <div role="rowgroup">
        <div className="grid border-b border-line bg-surface-2" style={cols}>
          <div className="sticky left-0 px-3 py-1.5 text-[11.5px] font-semibold text-subtle">
            {label} <span className="font-normal tabular">{list.length}</span>
          </div>
        </div>
        {list.map(row)}
      </div>
    ) : null;

  return (
    <section aria-label="Team schedule" className="panel overflow-x-auto">
      <div role="grid" className="min-w-[860px]">
        <div role="row" className="sticky top-0 z-20 grid border-b border-line bg-card" style={cols}>
          <div className="sticky left-0 z-10 flex items-center border-r border-line bg-card px-3 text-[12.5px] font-medium text-subtle">Team</div>
          {days.map((d) => (
            <div key={d} role="columnheader" title={formatDayLong(d)} className="flex h-11 items-center gap-1.5 border-r border-line px-2.5 last:border-r-0">
              <span className={cn("text-[12.5px] font-medium", d === today ? "text-accent-fg" : "text-subtle")}>{dow(d)}</span>
              <span className={cn("tabular text-[15px] font-semibold", d === today ? "text-accent-fg" : "text-heading")}>{Number(d.slice(8))}</span>
              {d === today ? <span className="rounded-sm bg-copper-500/12 px-1 text-[11px] font-semibold text-accent-fg">Today</span> : null}
            </div>
          ))}
        </div>

        {/* Work with nobody on it: drag onto a person to assign. */}
        {unassigned.length ? (
          <div role="row" className="grid border-b border-line bg-warning/[0.05]" style={cols}>
            <div role="rowheader" className="sticky left-0 z-10 flex items-center gap-2.5 border-r border-line bg-[#fdf9f0] px-3 py-2.5">
              <span className="grid size-[30px] place-items-center rounded-full bg-warning/15 text-warn-fg">
                <AlertTriangle className="size-4" aria-hidden />
              </span>
              <span className="leading-tight">
                <span className="block text-[13.5px] font-semibold text-heading">Needs people</span>
                <span className="block text-[12px] text-subtle">{manage ? "Drag onto someone" : `${unassigned.length} to assign`}</span>
              </span>
            </div>
            {days.map((d) => {
              const list = unassigned.filter((b) => coversDay(b, d));
              const key = `none|${d}`;
              return (
                <div key={d} role="gridcell" className={cn("flex min-h-[56px] min-w-0 flex-col gap-1 border-r border-line p-1 last:border-r-0", over === key && "bg-copper-500/[0.08]")} {...cellDrag(key, d, null)}>
                  {list.map((b) => (
                    <Chip key={b.id} booking={b} day={d} job={jobs.get(b.jobId)} draggable={manage} onOpen={() => onOpen(b)} onDragStart={(e) => setDragData(e, { bookingId: b.id, fromDay: d, fromPersonId: null })} />
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}

        {group("Staff", staff)}
        {group("Subcontractors", subs)}
        {!staff.length && !subs.length ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <p className="text-[14px] font-medium text-heading">No team members yet</p>
            <p className="text-[13.5px] text-subtle">Add people in Team to plan who goes where.</p>
          </div>
        ) : null}
      </div>
      {manage ? (
        <p className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-[12px] text-subtle">
          <CalendarPlus className="size-3.5" aria-hidden /> Drag a booking to another person or day. Clashes are checked before anything is saved.
        </p>
      ) : null}
    </section>
  );
}

function Chip({ booking: b, day, job, clash, draggable, onOpen, onDragStart }: { booking: Booking; day: string; job?: Job; clash?: boolean; draggable: boolean; onOpen: () => void; onDragStart: (e: React.DragEvent) => void }) {
  const tone = jobTone(b.jobId);
  const all = bookingDays(b);
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      aria-label={`${job?.title ?? "Job"}, ${job?.location ?? ""}, ${formatTimeRange(b.startTime, b.endTime)}${clash ? ", double-booked" : ""}`}
      className={cn(
        "relative block w-full min-w-0 overflow-hidden rounded-md py-1 pl-2.5 pr-1.5 text-left ring-1 transition hover:shadow-[var(--shadow-md)]",
        tone.card,
        clash && "ring-2 ring-destructive/60",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", b.personIds.length ? tone.bar : "bg-warning")} />
      <span className={cn("block truncate text-[12.5px] font-semibold leading-tight", tone.text)}>{job?.title ?? "Job"}</span>
      <span className="block truncate text-[11.5px] tabular text-foreground/70">
        {formatTimeRange(b.startTime, b.endTime)}
        {job?.location ? ` · ${job.location}` : ""}
        {all.length > 1 ? ` · ${all.indexOf(day) + 1}/${all.length}` : ""}
      </span>
    </button>
  );
}
