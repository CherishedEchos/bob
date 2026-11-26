"use client";

/**
 * Phone diary: a day-grouped agenda for the week, not a squeezed calendar.
 * A day strip jumps to a day; each booking is a large card with the customer,
 * the site, the people, directions and the job.
 */
import * as React from "react";
import { CalendarDays, ChevronRight, Clock, MapPin, Navigation } from "lucide-react";
import { formatTimeRange } from "@/lib/dates";
import { byStartTime, jobTown, liveAbsence, type Conflict } from "@/lib/diary";
import { bookingDays, bookingEndDate } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PeopleStack, jobTone } from "@/components/common/people";
import { LeaveBlock, dayNum, dow, firstName } from "./shared";

export function Agenda({
  days,
  today,
  bookings,
  absences,
  jobs,
  people,
  conflicts,
  manage,
  onOpen,
  onJob,
  onAdd,
}: {
  days: string[];
  today: string;
  bookings: Booking[];
  absences: Absence[];
  jobs: Map<string, Job>;
  people: Map<string, Person>;
  conflicts: Conflict[];
  manage: boolean;
  onOpen: (b: Booking) => void;
  onJob: (jobId: string) => void;
  onAdd: (day: string) => void;
}) {
  const live = absences.filter(liveAbsence);
  // This week: start at today; the days already gone fold away under one line.
  const earlier = days.includes(today) ? days.filter((d) => d < today) : [];
  const [showEarlier, setShowEarlier] = React.useState(false);
  React.useEffect(() => setShowEarlier(false), [days[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = showEarlier ? days : days.filter((d) => !earlier.includes(d));
  const jump = (d: string) => {
    if (earlier.includes(d) && !showEarlier) setShowEarlier(true);
    requestAnimationFrame(() => document.getElementById(`agenda-${d}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const clashText = (b: Booking, d: string) => {
    const c = conflicts.filter((x) => x.day === d && x.bookingIds.includes(b.id));
    if (!c.length) return undefined;
    return Array.from(new Set(c.map((x) => `${firstName(people.get(x.personId)?.name)} ${x.kind === "absence" ? "is off" : "is double-booked"}`))).join(", ");
  };
  return (
    <section aria-label="Agenda" className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 pb-2 pt-1 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }} role="tablist" aria-label="Jump to a day">
          {days.map((d) => {
            const count = bookings.filter((b) => b.date <= d && bookingEndDate(b) >= d).length;
            const isToday = d === today;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={isToday}
                aria-label={`${dow(d, "long")} ${dayNum(d)}${count ? `, ${count} booked` : ""}`}
                onClick={() => jump(d)}
                className={cn("flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors", isToday ? "bg-copper-500 text-white" : "bg-card ring-1 ring-line active:bg-surface-2")}
              >
                <span className={cn("text-[12px] font-semibold uppercase", isToday ? "text-white/80" : "text-subtle")}>{dow(d, "narrow")}</span>
                <span className="tabular text-[18px] font-bold leading-none">{dayNum(d)}</span>
                <span className={cn("h-1 w-1 rounded-full", count ? (isToday ? "bg-white" : "bg-copper-500") : "bg-transparent")} />
              </button>
            );
          })}
        </div>
      </div>

      {earlier.length ? (
        <button type="button" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} className="-mt-1 self-start text-[13.5px] font-medium text-subtle">
          {showEarlier ? "Hide earlier this week" : `Show earlier this week (${earlier.length} ${earlier.length === 1 ? "day" : "days"})`}
        </button>
      ) : null}
      {shown.map((d) => {
        const list = bookings.filter((b) => b.date <= d && bookingEndDate(b) >= d).sort(byStartTime);
        const off = live.filter((a) => a.startDate <= d && a.endDate >= d);
        const past = d < today;
        return (
          <div key={d} id={`agenda-${d}`} className={cn("scroll-mt-20", past && "opacity-60")}>
            <h2 className="mb-2 flex items-baseline justify-between px-0.5">
              <span className="text-[19px] font-bold tracking-[-0.015em] text-heading">{d === today ? "Today" : dow(d, "long")}</span>
              <span className="text-[13px] text-subtle">{new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</span>
            </h2>
            {off.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {off.map((a) => (
                  <LeaveBlock key={a.id} absence={a} people={people} className="h-7 w-auto" />
                ))}
              </div>
            ) : null}
            {list.length ? (
              <ul className="flex flex-col gap-2">
                {list.map((b) => (
                  <li key={b.id}>
                    <AgendaCard booking={b} day={d} job={jobs.get(b.jobId)} people={people} clash={clashText(b, d)} onOpen={() => onOpen(b)} onJob={() => onJob(b.jobId)} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-dashed border-line-strong px-3.5 py-3">
                <span className="flex items-center gap-2 text-[14px] text-subtle">
                  <CalendarDays className="size-4" aria-hidden /> Nothing booked
                </span>
                {manage && !past ? (
                  <button type="button" onClick={() => onAdd(d)} aria-label={`Schedule work on ${dow(d, "long")} ${dayNum(d)}`} className="h-9 rounded-md px-2 text-[14px] font-medium text-accent-fg">
                    Add work
                  </button>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function AgendaCard({ booking: b, day, job, people, clash, onOpen, onJob }: { booking: Booking; day: string; job?: Job; people: Map<string, Person>; clash?: string; onOpen: () => void; onJob: () => void }) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const tone = jobTone(b.jobId);
  const days = bookingDays(b);
  const address = job?.siteAddress || job?.location || "";
  const maps = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-card ring-1", clash ? "ring-2 ring-destructive/60" : "ring-line")}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", who.length ? tone.bar : "bg-warning")} />
      <button type="button" onClick={onOpen} className="block w-full py-3 pl-4 pr-3 text-left" aria-label={`Booking: ${job?.title ?? "job"}, ${formatTimeRange(b.startTime, b.endTime)}`}>
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-semibold text-heading">{job?.title ?? "Job"}</span>
            <span className="mt-0.5 block truncate text-[15px] text-muted-foreground">
              {job?.customerName}
              {jobTown(job) ? ` · ${jobTown(job)}` : ""}
            </span>
          </span>
          <span className="tabular flex shrink-0 items-center gap-1 pt-0.5 text-[13.5px] font-medium text-foreground/80">
            <Clock className="size-3.5 text-subtle" aria-hidden />
            {formatTimeRange(b.startTime, b.endTime)}
          </span>
        </span>
        <span className="mt-2.5 flex items-center gap-2">
          {who.length ? (
            <>
              <PeopleStack people={who} size={24} max={3} />
              <span className="truncate text-[13.5px] text-foreground/80">{who.map((p) => firstName(p.name)).join(", ")}</span>
            </>
          ) : (
            <span className="rounded-md bg-warning/12 px-2 py-0.5 text-[12.5px] font-semibold text-warn-fg">Needs someone</span>
          )}
          {days.length > 1 ? <span className="ml-auto shrink-0 text-[12.5px] text-subtle">Day {days.indexOf(day) + 1} of {days.length}</span> : null}
        </span>
        {clash ? <span className="mt-2 block text-[13px] font-medium text-danger-fg">{clash} — tap to sort it</span> : null}
      </button>
      <div className="flex border-t border-line">
        {maps ? (
          <a href={maps} target="_blank" rel="noreferrer" className="flex h-12 flex-1 items-center justify-center gap-1.5 text-[15px] font-semibold text-foreground active:bg-surface-2">
            <Navigation className="size-4 text-subtle" aria-hidden /> Directions
          </a>
        ) : (
          <span className="flex h-11 flex-1 items-center justify-center gap-1.5 text-[13.5px] text-subtle">
            <MapPin className="size-4" aria-hidden /> No address yet
          </span>
        )}
        <button type="button" onClick={onJob} className="flex h-12 flex-1 items-center justify-center gap-1 border-l border-line text-[15px] font-semibold text-foreground active:bg-surface-2">
          Open job <ChevronRight className="size-4 text-subtle" aria-hidden />
        </button>
      </div>
    </div>
  );
}
