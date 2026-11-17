"use client";

/**
 * This week — the home screen. What's booked, who's on it, what still needs
 * sorting. Desktop: a seven-day planner. Phone: an agenda grouped by day.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, MapPin, Sparkles, UserPlus, Users } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { needsWrittenReply, todaysPriorities } from "@/lib/derive";
import { addDays, daysBetween, formatDayLong, formatDayShort, formatTimeRange, formatWeekRange, isDateKey, rangeKeys, weekStart } from "@/lib/dates";
import { bookingDays, bookingsNeedingPeople, bookingsOnDay, initials, jobsToSchedule } from "@/lib/schedule";
import type { Booking, Job, Person } from "@/lib/types";
import { cn, todayKey } from "@/lib/utils";
import { AttentionRow } from "@/components/common/attention";
import { ListPanel, ListRow, pageActionClass, textActionClass } from "@/components/common/bits";
import { JobTile } from "@/components/common/job-tile";
import { NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { Onboarding } from "@/components/common/onboarding";

export default function WeekPage() {
  return (
    <React.Suspense>
      <WeekInner />
    </React.Suspense>
  );
}

function WeekInner() {
  const { data, can, actions } = useStore();
  const ui = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const { send } = useBob();
  const today = todayKey();
  const start = weekStart(isDateKey(params.get("w")) ? params.get("w")! : today);
  const days = rangeKeys(start, addDays(start, 6));
  const personFilter = params.get("person") ?? "";
  const manage = can("schedule.manage");
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const people = new Map(data.people.map((p) => [p.id, p]));
  const activePeople = data.people.filter((p) => !p.archivedAt);
  const visible = data.bookings.filter((b) => (personFilter === "unassigned" ? !b.personIds.length : !personFilter || b.personIds.includes(personFilter)));
  const thisWeek = visible.filter((b) => b.date <= days[6] && (b.endDate ?? b.date) >= days[0]);
  const unscheduled = jobsToSchedule(data, today);
  const noOne = bookingsNeedingPeople(data.bookings, today);
  const priorities = todaysPriorities(data, { includeFinance: can("finance.read") });
  const toDraft = data.enquiries.filter(needsWrittenReply).length;
  const [showAllAttention, setShowAllAttention] = React.useState(false);
  const [showEarlier, setShowEarlier] = React.useState(false);
  const earlier = start === weekStart(today) ? days.filter((d) => d < today) : [];

  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (v) q.set(k, v);
    else q.delete(k);
    router.replace(`/week${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };
  const goWeek = (key: string | null) => setParam("w", key && weekStart(key) !== weekStart(today) ? weekStart(key) : null);
  const openBooking = (b: Booking) => (manage ? ui.openForm({ form: "booking", bookingId: b.id }) : ui.openJob(b.jobId, { tab: "schedule" }));
  const askBob = (t: string) => {
    void send(t, "text");
    ui.setAssistantOpen(true);
  };

  /** Drag a booking to another day (desktop shortcut). Clashes open the form so the planner decides. */
  const moveTo = async (bookingId: string, day: string) => {
    const b = data.bookings.find((x) => x.id === bookingId);
    if (!b || b.date === day) return;
    const shift = daysBetween(b.date, day);
    const res = await actions.run("saveBooking", {
      input: { id: b.id, jobId: b.jobId, date: day, endDate: b.endDate ? addDays(b.endDate, shift) : "", allDay: !b.startTime, startTime: b.startTime ?? "", endTime: b.endTime ?? "", personIds: b.personIds, notes: b.notes ?? "" },
    });
    if (res.ok) return toast(`Moved to ${formatDayShort(day)}`);
    if (res.clashes?.length) {
      toast(`${res.clashes[0].personName} is already booked then — check the clash`, "error");
      return ui.openForm({ form: "booking", bookingId: b.id, date: day });
    }
    toast(res.errors._ || "Couldn't move it", "error");
  };

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">{start === weekStart(today) ? "This week" : `Week of ${formatDayShort(start)}`}</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">{formatWeekRange(start)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {manage ? (
            <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "booking", date: start === weekStart(today) ? today : start })}>
              <CalendarPlus className="size-[18px]" aria-hidden /> Schedule work
            </button>
          ) : null}
        </div>
      </header>

      <Onboarding />

      {/* Week controls and person filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl bg-card ring-1 ring-line-strong">
          <button type="button" aria-label="Previous week" onClick={() => goWeek(addDays(start, -7))} className="grid size-11 place-items-center rounded-l-xl hover:bg-surface-2">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" onClick={() => goWeek(null)} disabled={start === weekStart(today)} className="h-11 border-x border-line px-4 text-[15px] font-semibold disabled:text-muted-foreground">
            Today
          </button>
          <button type="button" aria-label="Next week" onClick={() => goWeek(addDays(start, 7))} className="grid size-11 place-items-center rounded-r-xl hover:bg-surface-2">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-xs">
          <Users className="size-4 shrink-0 text-subtle" aria-hidden />
          <span className="sr-only">Show work for</span>
          <NativeSelect value={personFilter} onChange={(e) => setParam("person", e.target.value || null)} className="h-11">
            <option value="">Everyone</option>
            <option value="unassigned">Needs someone</option>
            {activePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.kind === "subcontractor" ? " (sub)" : ""}
              </option>
            ))}
          </NativeSelect>
        </label>
        {personFilter && personFilter !== "unassigned" ? (
          <button type="button" onClick={() => setParam("person", null)} className={textActionClass}>
            Show everyone
          </button>
        ) : null}
      </div>

      {/* Desktop planner */}
      <section aria-label={`Schedule ${formatWeekRange(start)}`} className="panel hidden overflow-hidden lg:block">
        <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,0.62fr)_minmax(0,0.62fr)] divide-x divide-line">
          {days.map((d) => {
            const isToday = d === today;
            const list = bookingsOnDay(thisWeek, d);
            const weekend = daysBetween(start, d) >= 5;
            return (
              <div
                key={d}
                className={cn("flex min-h-[340px] min-w-0 flex-col", weekend && "bg-surface-2/60", isToday && "bg-selected/60")}
                onDragOver={manage ? (e) => e.preventDefault() : undefined}
                onDrop={
                  manage
                    ? (e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/booking");
                        if (id) void moveTo(id, d);
                      }
                    : undefined
                }
              >
                <div className={cn("flex items-baseline justify-between gap-2 border-b border-line px-3 py-2.5", isToday && "border-b-2 border-b-copper-500")}>
                  <span className={cn("text-[14px] font-semibold", isToday ? "text-accent-fg" : "text-foreground")}>
                    {formatDayShort(d).split(" ")[0]} <span className="tabular">{formatDayShort(d).split(" ")[1]}</span>
                  </span>
                  {isToday ? <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11.5px] font-semibold text-white">Today</span> : null}
                </div>
                <ul className="flex flex-1 flex-col gap-2 p-2">
                  {list.map((b) => (
                    <li key={`${b.id}-${d}`}>
                      <BookingCard booking={b} day={d} job={jobs.get(b.jobId)} people={people} onOpen={() => openBooking(b)} draggable={manage} compact />
                    </li>
                  ))}
                  {manage ? (
                    <li className="mt-auto">
                      <button
                        type="button"
                        onClick={() => ui.openForm({ form: "booking", date: d, personIds: personFilter && personFilter !== "unassigned" ? [personFilter] : undefined })}
                        className="flex h-9 w-full items-center justify-center gap-1 rounded-lg text-[13px] font-medium text-subtle transition hover:bg-card hover:text-accent-fg focus-visible:text-accent-fg"
                        aria-label={`Schedule work on ${formatDayLong(d)}`}
                      >
                        <CalendarPlus className="size-3.5" aria-hidden /> Add
                      </button>
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
        {manage ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-muted-foreground">Tip: drag a booking to another day to move it. Click it to change the time or who&apos;s on it.</p> : null}
      </section>

      {/* Phone agenda */}
      <section aria-label={`Agenda ${formatWeekRange(start)}`} className="flex flex-col gap-3 lg:hidden">
        {/* This week starts at today; earlier days fold away so today is always first. */}
        {earlier.length && !showEarlier ? (
          <button type="button" onClick={() => setShowEarlier(true)} className="flex h-11 items-center justify-center gap-1 rounded-xl text-[14.5px] font-semibold text-accent-fg ring-1 ring-line-strong">
            Show earlier this week ({earlier.length} {earlier.length === 1 ? "day" : "days"})
          </button>
        ) : null}
        {(showEarlier ? days : days.filter((d) => !earlier.includes(d))).map((d) => (
          <AgendaDay key={d} day={d} today={today} bookings={bookingsOnDay(thisWeek, d)} jobs={jobs} people={people} onOpen={openBooking} />
        ))}
      </section>

      {/* What still needs sorting */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <ListPanel
          id="attn"
          title="Needs attention"
          count={priorities.length}
          className="lg:col-span-1"
          action={
            toDraft > 0 && can("enquiries.write") ? (
              <Link href="/replies" className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-selected px-3 text-[14px] font-semibold text-accent-fg ring-1 ring-copper-500/30 hover:bg-copper-500/15">
                <Sparkles className="size-4" aria-hidden /> Draft {toDraft} {toDraft === 1 ? "reply" : "replies"}
              </Link>
            ) : null
          }
          footer={
            priorities.length > 4 ? (
              <button type="button" onClick={() => setShowAllAttention((v) => !v)} aria-expanded={showAllAttention} className={textActionClass}>
                {showAllAttention ? "Show fewer" : `Show ${priorities.length - 4} more`}
                <ChevronDown className={cn("size-4 transition", showAllAttention && "rotate-180")} aria-hidden />
              </button>
            ) : null
          }
        >
          {priorities.length ? (
            <ul className="divide-y divide-line">
              {(showAllAttention ? priorities : priorities.slice(0, 4)).map((p) => (
                <AttentionRow key={p.key} item={p} onAskBob={askBob} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-5 text-[15px] text-muted-foreground lg:px-5">You&apos;re all caught up.</p>
          )}
        </ListPanel>

        <ListPanel id="unscheduled" title="Not scheduled yet" count={unscheduled.length}>
          {unscheduled.length ? (
            <ul className="divide-y divide-line">
              {unscheduled.slice(0, 6).map((j) => (
                <ListRow
                  key={j.id}
                  onOpen={() => ui.openJob(j.id, { tab: "schedule" })}
                  openLabel={`Open ${j.title} for ${j.customerName}`}
                  leading={<JobTile kind={j.kind} className="size-9 rounded-lg [&_svg]:size-[18px]" />}
                  title={j.title}
                  meta={`${j.customerName} · ${j.location}`}
                  action={
                    manage ? (
                      <button type="button" onClick={() => ui.openForm({ form: "booking", jobId: j.id })} className="inline-flex h-10 items-center rounded-[10px] bg-copper-500/[0.12] px-3 text-[14px] font-semibold text-accent-fg hover:bg-copper-500/20" aria-label={`Schedule ${j.title} for ${j.customerName}`}>
                        Schedule
                      </button>
                    ) : null
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-5 text-[15px] text-muted-foreground lg:px-5">Every active job has work booked.</p>
          )}
        </ListPanel>

        <ListPanel id="noone" title="Needs someone" count={noOne.length}>
          {noOne.length ? (
            <ul className="divide-y divide-line">
              {noOne.slice(0, 6).map((b) => {
                const j = jobs.get(b.jobId);
                return (
                  <ListRow
                    key={b.id}
                    onOpen={() => openBooking(b)}
                    openLabel={`Assign someone to ${j?.title ?? "this booking"}`}
                    leading={
                      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-amber-500/10 text-warn-fg">
                        <UserPlus className="size-[17px]" aria-hidden />
                      </span>
                    }
                    title={j ? `${j.title} · ${j.customerName}` : "Booking"}
                    meta={`${formatDayShort(b.date)}${b.endDate ? `–${formatDayShort(b.endDate)}` : ""} · ${formatTimeRange(b.startTime, b.endTime)}`}
                  />
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-5 text-[15px] text-muted-foreground lg:px-5">Everything booked has someone on it.</p>
          )}
        </ListPanel>
      </div>
    </div>
  );
}

function BookingCard({ booking: b, day, job, people, onOpen, draggable, compact }: { booking: Booking; day: string; job?: Job; people: Map<string, Person>; onOpen: () => void; draggable?: boolean; compact?: boolean }) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const days = bookingDays(b);
  const dayN = days.indexOf(day) + 1;
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/booking", b.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      aria-label={`${job?.title ?? "Booking"} for ${job?.customerName ?? ""}, ${formatTimeRange(b.startTime, b.endTime)}, ${who.length ? who.map((p) => p.name).join(", ") : "nobody assigned"}`}
      className={cn(
        "group block w-full rounded-xl bg-card px-2.5 py-2 text-left shadow-[0_1px_2px_rgb(16_24_40/0.06)] ring-1 transition hover:ring-copper-500/50 active:bg-surface-2",
        who.length ? "border-l-[3px] border-l-copper-500 ring-line-strong" : "border-l-[3px] border-dashed border-l-amber-500 ring-amber-500/40",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-1.5 text-[12.5px] font-semibold tabular text-muted-foreground">
        <span className="whitespace-nowrap">{formatTimeRange(b.startTime, b.endTime)}</span>
        {days.length > 1 ? <span className="whitespace-nowrap text-[11.5px] font-normal">Day {dayN} of {days.length}</span> : null}
      </span>
      <span className={cn("mt-0.5 block font-semibold leading-snug text-heading", compact ? "line-clamp-2 text-[14px]" : "text-[15.5px]")}>{job?.title ?? "Job"}</span>
      <span className="mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground">
        <MapPin className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{job ? `${job.location} · ${job.customerName}` : ""}</span>
      </span>
      <span className="mt-1.5 flex flex-wrap gap-1">
        {who.length ? (
          who.map((p) => (
            <span key={p.id} title={p.name} className={cn("inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium", p.kind === "subcontractor" ? "bg-sky-500/10 text-info-fg" : "bg-surface-3 text-foreground")}>
              <span aria-hidden>{initials(p.name)}</span>
              <span className={compact ? "hidden xl:inline" : ""}>{p.name.split(" ")[0]}</span>
            </span>
          ))
        ) : (
          <span className="inline-flex h-6 items-center rounded-md bg-amber-500/10 px-1.5 text-[12px] font-semibold text-warn-fg">Needs someone</span>
        )}
      </span>
    </button>
  );
}

function AgendaDay({ day, today, bookings, jobs, people, onOpen }: { day: string; today: string; bookings: Booking[]; jobs: Map<string, Job>; people: Map<string, Person>; onOpen: (b: Booking) => void }) {
  const isToday = day === today;
  return (
    <div>
      <h2 className={cn("mb-1.5 flex items-center gap-2 px-1 text-[15px] font-semibold", isToday ? "text-accent-fg" : "text-foreground")}>
        {isToday ? <span className="rounded-md bg-primary px-1.5 py-0.5 text-[12px] font-semibold text-white">Today</span> : null}
        {formatDayLong(day)}
      </h2>
      {bookings.length ? (
        <ul className="flex flex-col gap-2">
          {bookings.map((b) => (
            <li key={b.id}>
              <BookingCard booking={b} day={day} job={jobs.get(b.jobId)} people={people} onOpen={() => onOpen(b)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl px-3 py-2.5 text-[14px] text-muted-foreground ring-1 ring-dashed ring-line-strong">Nothing booked</p>
      )}
    </div>
  );
}

