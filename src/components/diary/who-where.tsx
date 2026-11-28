"use client";

/**
 * Phone: "Who's where today?" — the team calendar on a phone. One day at a
 * time (today first, tomorrow and the rest of the week a tap away), grouped by
 * person: where they are, when, the address and directions. Then who's off,
 * work that still needs someone, and who's free. No squeezed week grid.
 */
import * as React from "react";
import { CalendarPlus, ChevronRight, Clock, MapPin, Navigation } from "lucide-react";
import { formatTimeRange } from "@/lib/dates";
import { byStartTime, liveAbsence } from "@/lib/diary";
import { ABSENCE_LABEL, PART_LABEL } from "@/lib/leave";
import { bookingDays, bookingEndDate } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PersonAvatar, jobTone } from "@/components/common/people";
import { dayNum, dow, firstName } from "./shared";

const mapsUrl = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

export function WhoWhere({
  days,
  today,
  day,
  onDay,
  bookings,
  absences,
  jobs,
  team,
  manage,
  onOpen,
  onJob,
  onAdd,
}: {
  days: string[];
  today: string;
  day: string;
  onDay: (d: string) => void;
  bookings: Booking[];
  absences: Absence[];
  jobs: Map<string, Job>;
  team: Person[];
  manage: boolean;
  onOpen: (b: Booking) => void;
  onJob: (jobId: string) => void;
  onAdd: (day: string, personId?: string) => void;
}) {
  const onDayList = bookings.filter((b) => b.date <= day && bookingEndDate(b) >= day).sort(byStartTime);
  const off = absences.filter((a) => liveAbsence(a) && a.startDate <= day && a.endDate >= day);
  const offIds = new Set(off.filter((a) => !a.part).map((a) => a.personId));
  const working = team
    .map((p) => ({ person: p, list: onDayList.filter((b) => b.personIds.includes(p.id)) }))
    .filter((x) => x.list.length)
    .sort((a, b) => (a.list[0].startTime ?? "").localeCompare(b.list[0].startTime ?? "") || a.person.name.localeCompare(b.person.name));
  const unassigned = onDayList.filter((b) => !b.personIds.length);
  const free = team.filter((p) => !onDayList.some((b) => b.personIds.includes(p.id)) && !offIds.has(p.id));
  const title = day === today ? "Who's where today" : day === days[days.indexOf(today) + 1] ? "Who's where tomorrow" : `Who's where on ${dow(day, "long")}`;
  const people = new Map(team.map((p) => [p.id, p]));

  return (
    <section aria-label="Who's where" className="flex flex-col gap-4">
      <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Choose a day">
        {days.map((d) => {
          const count = bookings.filter((b) => b.date <= d && bookingEndDate(b) >= d).length;
          const selected = d === day;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${d === today ? "Today" : dow(d, "long")} ${dayNum(d)}${count ? `, ${count} booked` : ""}`}
              onClick={() => onDay(d)}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors",
                selected ? "bg-copper-500 text-white" : d === today ? "bg-card text-copper-600 ring-2 ring-copper-500/50" : "bg-card ring-1 ring-line active:bg-surface-2",
              )}
            >
              <span className={cn("text-[12px] font-semibold uppercase", selected ? "text-white/80" : "text-subtle")}>{dow(d, "narrow")}</span>
              <span className="tabular text-[18px] font-bold leading-none">{dayNum(d)}</span>
              <span className={cn("h-1 w-1 rounded-full", count ? (selected ? "bg-white" : "bg-copper-500") : "bg-transparent")} />
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <h2 className="text-[20px] font-bold tracking-[-0.015em] text-heading">{title}</h2>
        <span className="shrink-0 text-[13.5px] text-subtle">{new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</span>
      </div>

      {working.length ? (
        <ul className="flex flex-col gap-2.5">
          {working.map(({ person, list }) => (
            <li key={person.id} className="overflow-hidden rounded-xl bg-card ring-1 ring-line">
              <div className="flex items-center gap-2.5 px-4 pb-1 pt-3">
                <PersonAvatar person={person} size={30} />
                <span className="min-w-0">
                  <span className="block text-[16px] font-bold leading-tight text-heading">{person.name}</span>
                  {person.trade || person.kind === "subcontractor" ? <span className="block truncate text-[13.5px] text-subtle">{person.trade ?? "Subcontractor"}</span> : null}
                </span>
                {off.some((a) => a.personId === person.id && a.part) ? (
                  <span className="ml-auto rounded-md bg-violet-50 px-2 py-0.5 text-[12.5px] font-semibold text-violet-800">{PART_LABEL[off.find((a) => a.personId === person.id)!.part!]} off</span>
                ) : null}
              </div>
              {list.map((b) => (
                <PlaceRow key={b.id} booking={b} day={day} job={jobs.get(b.jobId)} withPeople={b.personIds.filter((id) => id !== person.id).map((id) => firstName(people.get(id)?.name)).filter(Boolean)} onOpen={() => onOpen(b)} onJob={() => onJob(b.jobId)} />
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-4 text-[15.5px] text-muted-foreground">Nobody is booked {day === today ? "today" : "this day"}.</p>
      )}

      {unassigned.length ? (
        <div>
          <h3 className="mb-1.5 px-0.5 text-[14px] font-semibold uppercase tracking-[0.04em] text-warn-fg">Needs someone</h3>
          <ul className="flex flex-col gap-2">
            {unassigned.map((b) => (
              <li key={b.id} className="overflow-hidden rounded-xl bg-card ring-1 ring-warning/40">
                <PlaceRow booking={b} day={day} job={jobs.get(b.jobId)} withPeople={[]} onOpen={() => onOpen(b)} onJob={() => onJob(b.jobId)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {off.length ? (
        <div>
          <h3 className="mb-1.5 px-0.5 text-[14px] font-semibold uppercase tracking-[0.04em] text-subtle">Off</h3>
          <ul className="flex flex-col gap-1.5">
            {off.map((a) => {
              const p = people.get(a.personId);
              if (!p) return null;
              // Subcontractors aren't employees on holiday: they're unavailable.
              const label = p.kind === "subcontractor" && a.kind === "holiday" ? "Unavailable" : ABSENCE_LABEL[a.kind];
              return (
                <li key={a.id} className="flex items-center gap-2.5 rounded-xl bg-violet-50/70 px-3.5 py-2.5 text-[15px]">
                  <PersonAvatar person={p} size={26} />
                  <span className="font-semibold text-violet-900">{p.name}</span>
                  <span className="text-violet-800">
                    {label}
                    {a.part ? ` · ${PART_LABEL[a.part].toLowerCase()}` : ""}
                    {a.status === "pending" ? " · requested" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {free.length ? (
        <div className="rounded-xl bg-surface-2 px-4 py-3">
          <h3 className="text-[14px] font-semibold uppercase tracking-[0.04em] text-good-fg">Free</h3>
          <p className="mt-1 text-[15.5px] leading-relaxed text-foreground">{free.map((p) => p.name).join(", ")}</p>
          {manage && day >= today ? (
            <button type="button" onClick={() => onAdd(day, free.length === 1 ? free[0].id : undefined)} className="mt-2 inline-flex h-11 items-center gap-2 rounded-lg bg-card px-3.5 text-[15px] font-semibold text-accent-fg ring-1 ring-line-strong">
              <CalendarPlus className="size-4" aria-hidden /> Schedule work
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PlaceRow({ booking: b, day, job, withPeople, onOpen, onJob }: { booking: Booking; day: string; job?: Job; withPeople: string[]; onOpen: () => void; onJob: () => void }) {
  const address = job?.siteAddress || job?.location || "";
  const span = bookingDays(b);
  return (
    <div className="border-t border-line first:border-t-0">
      <button type="button" onClick={onOpen} className="relative block w-full py-3 pl-[54px] pr-4 text-left" aria-label={`Booking: ${job?.title ?? "job"}, ${formatTimeRange(b.startTime, b.endTime)}`}>
        <span aria-hidden className={cn("absolute bottom-3 left-[29px] top-3 w-1 rounded-full", jobTone(b.jobId).bar)} />
        <span className="flex items-center gap-1.5 text-[14.5px] font-semibold tabular text-foreground/80">
          <Clock className="size-4 text-subtle" aria-hidden /> {formatTimeRange(b.startTime, b.endTime)}
          {span.length > 1 ? <span className="font-medium text-subtle">· day {span.indexOf(day) + 1} of {span.length}</span> : null}
        </span>
        <span className="mt-0.5 block text-[17.5px] font-bold leading-snug text-heading">{job?.title ?? "Job"}</span>
        {job?.customerName ? <span className="block text-[15px] text-muted-foreground">{job.customerName}</span> : null}
        {withPeople.length ? <span className="mt-1 block text-[14.5px] text-foreground/80">With {withPeople.join(", ")}</span> : null}
      </button>
      <div className="flex border-t border-line">
        {address ? (
          <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left text-[15px] font-medium text-foreground active:bg-surface-2">
            <Navigation className="size-4 shrink-0 text-copper-600" aria-hidden />
            <span className="min-w-0 leading-snug">
              <span className="block font-semibold">Directions</span>
              <span className="block break-words text-[14px] font-normal text-muted-foreground">{address}</span>
            </span>
          </a>
        ) : (
          <span className="flex min-h-12 flex-1 items-center gap-1.5 px-4 text-[14px] text-subtle">
            <MapPin className="size-4" aria-hidden /> No address yet
          </span>
        )}
        <button type="button" onClick={onJob} className="flex min-h-12 shrink-0 items-center gap-1 border-l border-line px-4 text-[15px] font-semibold text-foreground active:bg-surface-2">
          Job <ChevronRight className="size-4 text-subtle" aria-hidden />
        </button>
      </div>
    </div>
  );
}
