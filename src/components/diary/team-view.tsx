"use client";

/**
 * Team: one row per person, one column per day. Shows where everyone is, who's
 * free (and for which half of the day), leave, clashes, and work still needing
 * someone. Drag a block along a row to move it, or to another row to hand it
 * over; nothing is saved until the clash check passes or the planner confirms.
 */
import * as React from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { formatDayLong } from "@/lib/dates";
import { availability, byStartTime, layoutSegments, liveAbsence, personLabel, type Conflict } from "@/lib/diary";
import { bookingEndDate } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/common/people";
import { BookingBlock, LeaveBlock, dayNum, dow, firstName, grabbedDay, shiftBetween } from "./shared";

type Item = { kind: "booking"; b: Booking } | { kind: "leave"; a: Absence };
type Drag = { id: string; from: string | null; grabbed: string };
const UNASSIGNED = "__unassigned";

export function TeamView({
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
  team: Person[];
  conflicts: Conflict[];
  manage: boolean;
  onOpen: (b: Booking) => void;
  onAdd: (day: string, personId?: string) => void;
  onMove: (bookingId: string, opts: { shift: number; from: string | null; to: string | null }) => void;
}) {
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const cols = days.map((d) => (isWeekend(d) ? "minmax(0,0.72fr)" : "minmax(0,1fr)")).join(" ");
  const unassigned = bookings.filter((b) => !b.personIds.length);
  const staff = team.filter((p) => p.kind === "employee");
  const subs = team.filter((p) => p.kind === "subcontractor");

  const rowProps = { days, today, cols, jobs, people, bookings, absences, conflicts, manage, onOpen, onAdd, onMove, drag, setDrag, over, setOver };
  return (
    <section aria-label="Team schedule" className="panel overflow-x-auto">
      <div className="min-w-[920px]">
        <div className="sticky top-0 z-20 grid border-b border-line bg-card" style={{ gridTemplateColumns: `224px ${cols}` }}>
          <div className="px-4 py-2.5 text-[13px] font-medium text-subtle">{team.length} people</div>
          {days.map((d) => (
            <h2 key={d} title={formatDayLong(d)} className={cn("flex items-baseline gap-1.5 border-l border-line px-3 py-2.5", d === today && "bg-copper-50/70")}>
              <span className={cn("text-[13px] font-semibold uppercase tracking-[0.04em]", d === today ? "text-copper-600" : "text-subtle")}>{dow(d)}</span>
              <span className={cn("tabular grid h-7 min-w-7 place-items-center rounded-full px-1 text-[17px] font-bold", d === today ? "bg-copper-500 text-white" : "text-heading")}>{dayNum(d)}</span>
            </h2>
          ))}
        </div>

        {unassigned.length ? (
          <Row {...rowProps} rowId={UNASSIGNED} items={unassigned.map((b) => ({ kind: "booking", b }))} label={<UnassignedLabel n={unassigned.length} />} tone="unassigned" />
        ) : null}
        {staff.length ? <GroupLabel>Staff</GroupLabel> : null}
        {staff.map((p) => (
          <Row key={p.id} {...rowProps} rowId={p.id} person={p} items={itemsFor(p.id, bookings, absences)} label={<PersonLabel person={p} />} />
        ))}
        {subs.length ? <GroupLabel>Subcontractors</GroupLabel> : null}
        {subs.map((p) => (
          <Row key={p.id} {...rowProps} rowId={p.id} person={p} items={itemsFor(p.id, bookings, absences)} label={<PersonLabel person={p} />} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[13px] text-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" /> Free
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-violet-50 ring-1 ring-violet-200" /> Holiday or unavailable
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-white ring-2 ring-destructive/70" /> Clash
        </span>
        <span className="hidden lg:inline">· Drag along a row to move, or onto another person to reassign</span>
      </div>
    </section>
  );
}

function itemsFor(personId: string, bookings: Booking[], absences: Absence[]): Item[] {
  return [
    ...absences.filter((a) => a.personId === personId && liveAbsence(a)).map((a) => ({ kind: "leave" as const, a })),
    ...bookings.filter((b) => b.personIds.includes(personId)).map((b) => ({ kind: "booking" as const, b })),
  ];
}

const range = (i: Item): [string, string] => (i.kind === "leave" ? [i.a.startDate, i.a.endDate] : [i.b.date, bookingEndDate(i.b)]);
const order = (x: Item, y: Item) => (x.kind === "leave" ? -1 : y.kind === "leave" ? 1 : byStartTime(x.b, y.b));
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-line bg-[#faf7f2] px-4 py-1.5 text-[12.5px] font-semibold uppercase tracking-[0.05em] text-subtle">{children}</div>;
}

function PersonLabel({ person: p }: { person: Person }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar person={p} size={34} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold text-heading">{p.name}</span>
        <span className="block truncate text-[13px] text-subtle">{personLabel(p)}</span>
      </span>
    </span>
  );
}

function UnassignedLabel({ n }: { n: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-7 place-items-center rounded-full bg-warning/15 text-warn-fg">
        <AlertTriangle className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold text-heading">Needs someone</span>
        <span className="block truncate text-[13px] text-subtle">
          {n} {n === 1 ? "booking" : "bookings"} · drag onto a person
        </span>
      </span>
    </span>
  );
}

function Row({
  rowId,
  person,
  items,
  label,
  tone,
  days,
  today,
  cols,
  jobs,
  people,
  bookings,
  absences,
  conflicts,
  manage,
  onOpen,
  onAdd,
  onMove,
  drag,
  setDrag,
  over,
  setOver,
}: {
  rowId: string;
  person?: Person;
  items: Item[];
  label: React.ReactNode;
  tone?: "unassigned";
  days: string[];
  today: string;
  cols: string;
  jobs: Map<string, Job>;
  people: Map<string, Person>;
  bookings: Booking[];
  absences: Absence[];
  conflicts: Conflict[];
  manage: boolean;
  onOpen: (b: Booking) => void;
  onAdd: (day: string, personId?: string) => void;
  onMove: (bookingId: string, opts: { shift: number; from: string | null; to: string | null }) => void;
  drag: Drag | null;
  setDrag: (d: Drag | null) => void;
  over: string | null;
  setOver: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { segments, lanes } = layoutSegments(items, days, range, order);
  const target = rowId === UNASSIGNED ? null : rowId;
  const conflictFor = (b: Booking) => {
    const c = conflicts.filter((x) => x.personId === rowId && x.bookingIds.includes(b.id));
    if (!c.length) return undefined;
    return c[0].kind === "absence" ? `${firstName(person?.name)} is off` : `${firstName(person?.name)} is double-booked`;
  };
  return (
    <div className={cn("grid border-b border-line last:border-b-0", tone === "unassigned" && "bg-[#fffdf8]")} style={{ gridTemplateColumns: `224px ${cols}` }}>
      <div className="flex items-center px-4 py-2.5">{label}</div>
      <div className="relative grid" style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: cols, gridTemplateRows: `repeat(${Math.max(lanes, 1)}, minmax(58px, auto))` }}>
        {days.map((d, i) => {
          const key = `${rowId}|${d}`;
          const state = person ? availability(person.id, d, bookings, absences) : null;
          return (
            <div
              key={d}
              style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
              className={cn("group/cell relative border-l border-line", d === today && "bg-copper-50/40", over === key && "bg-copper-500/[0.08]")}
              onDragOver={
                manage
                  ? (e) => {
                      if (!drag) return;
                      e.preventDefault();
                      setOver(key);
                    }
                  : undefined
              }
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={
                manage
                  ? (e) => {
                      e.preventDefault();
                      setOver(null);
                      if (drag) onMove(drag.id, { shift: shiftBetween(drag.grabbed, d), from: drag.from, to: target });
                      setDrag(null);
                    }
                  : undefined
              }
            >
              {state && state !== "busy" && state !== "off" && d >= today ? (
                <span className="pointer-events-none absolute bottom-1.5 left-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-good-fg">
                  <span className="size-1.5 rounded-full bg-success" />
                  {state === "free" ? "Free" : state === "free_am" ? "Free AM" : "Free PM"}
                </span>
              ) : null}
              {manage && person && state !== "off" ? (
                <button
                  type="button"
                  onClick={() => onAdd(d, person.id)}
                  aria-label={`Book ${person.name} on ${formatDayLong(d)}`}
                  className="absolute bottom-1 right-1 grid size-6 place-items-center rounded-md text-subtle opacity-0 transition hover:bg-card hover:text-foreground hover:ring-1 hover:ring-line-strong focus-visible:opacity-100 group-hover/cell:opacity-100"
                >
                  <Plus className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
        {segments.map((s) => {
          const it = s.item;
          const style = { gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 1 };
          if (it.kind === "leave")
            return (
              <div key={`l-${it.a.id}-${s.col}`} className="relative z-10 p-1" style={style}>
                <LeaveBlock absence={it.a} people={people} withName={false} continuesBefore={s.continuesBefore} continuesAfter={s.continuesAfter} />
              </div>
            );
          return (
            <div key={`b-${it.b.id}-${s.col}`} className={cn("relative z-10 p-1", drag && drag.id !== it.b.id && "pointer-events-none")} style={style}>
              <BookingBlock
                booking={it.b}
                job={jobs.get(it.b.jobId)}
                people={people}
                compact
                conflict={conflictFor(it.b)}
                continuesBefore={s.continuesBefore}
                continuesAfter={s.continuesAfter}
                draggable={manage}
                dimmed={drag?.id === it.b.id}
                onOpen={() => onOpen(it.b)}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/booking", it.b.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDrag({ id: it.b.id, from: target, grabbed: grabbedDay(e, s.startDay, s.span) });
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
