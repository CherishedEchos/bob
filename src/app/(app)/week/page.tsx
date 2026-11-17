"use client";

/**
 * Diary — the owner's home page: what's booked, when, where and who's on it.
 * Desktop: a seven-day planner (drag a booking to move it, click to edit).
 * Phone: an agenda grouped by day, starting today. The page ends after the
 * schedule — replies live in Enquiries, to-dos in Tasks, bills in Money and
 * unscheduled won jobs in Jobs.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, ChevronLeft, ChevronRight, Pencil, Users } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays, daysBetween, formatDayLong, formatDayShort, formatTimeRange, formatWeekRange, isDateKey, rangeKeys, weekStart } from "@/lib/dates";
import { bookingDays, bookingsOnDay, initials } from "@/lib/schedule";
import type { Booking, Job, Person } from "@/lib/types";
import { cn, todayKey } from "@/lib/utils";
import { pageActionClass } from "@/components/common/bits";
import { NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { Onboarding } from "@/components/common/onboarding";

export default function DiaryPage() {
  return (
    <React.Suspense>
      <Diary />
    </React.Suspense>
  );
}

function Diary() {
  const { data, can, actions } = useStore();
  const ui = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayKey();
  const start = weekStart(isDateKey(params.get("w")) ? params.get("w")! : today);
  const days = rangeKeys(start, addDays(start, 6));
  const personFilter = params.get("person") ?? "";
  const manage = can("schedule.manage");
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const people = new Map(data.people.map((p) => [p.id, p]));
  const activePeople = data.people.filter((p) => !p.archivedAt);
  const staff = activePeople.filter((p) => p.kind === "employee");
  const subs = activePeople.filter((p) => p.kind === "subcontractor");
  const visible = data.bookings.filter((b) => (personFilter === "unassigned" ? !b.personIds.length : !personFilter || b.personIds.includes(personFilter)));
  const thisWeek = visible.filter((b) => b.date <= days[6] && (b.endDate ?? b.date) >= days[0]);
  const isThisWeek = start === weekStart(today);
  const [showEarlier, setShowEarlier] = React.useState(false);
  const earlier = isThisWeek ? days.filter((d) => d < today) : [];

  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (v) q.set(k, v);
    else q.delete(k);
    router.replace(`/week${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };
  const goWeek = (key: string | null) => setParam("w", key && weekStart(key) !== weekStart(today) ? weekStart(key) : null);
  /** Click, Enter or tap: open the editor. Unassigned bookings open at the people picker. */
  const openBooking = (b: Booking) => (manage ? ui.openForm({ form: "booking", bookingId: b.id, focus: b.personIds.length ? undefined : "people" }) : ui.openJob(b.jobId, { tab: "schedule" }));

  /** Drag a booking to another day (desktop shortcut). Clashes open the editor so the planner decides. */
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
    toast(res.errors._ || "Couldn't move it — nothing was changed", "error");
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="t-page">Diary</h1>
        {manage ? (
          <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "booking", date: isThisWeek ? today : start, personIds: personFilter && personFilter !== "unassigned" ? [personFilter] : undefined })}>
            <CalendarPlus className="size-[18px]" aria-hidden /> Schedule work
          </button>
        ) : null}
      </header>

      <Onboarding />

      {/* Week navigation, range and person filter — together */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Diary controls">
        <div className="flex items-center rounded-xl bg-card ring-1 ring-line-strong">
          <button type="button" aria-label="Previous week" onClick={() => goWeek(addDays(start, -7))} className="grid size-11 place-items-center rounded-l-xl hover:bg-surface-2">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" onClick={() => goWeek(null)} aria-pressed={isThisWeek} className={cn("h-11 border-x border-line px-4 text-[15px] font-semibold", isThisWeek ? "text-accent-fg" : "text-foreground hover:bg-surface-2")}>
            Today
          </button>
          <button type="button" aria-label="Next week" onClick={() => goWeek(addDays(start, 7))} className="grid size-11 place-items-center rounded-r-xl hover:bg-surface-2">
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        <p className="px-1 text-[16px] font-semibold tabular text-heading" aria-live="polite">
          {formatWeekRange(start)}
        </p>
        <label className="flex min-w-[200px] flex-1 items-center gap-2 sm:max-w-[280px]">
          <Users className="size-4 shrink-0 text-subtle" aria-hidden />
          <span className="sr-only">Show work for</span>
          <NativeSelect value={personFilter} onChange={(e) => setParam("person", e.target.value || null)} className="h-11">
            <option value="">Everyone</option>
            <option value="unassigned">Unassigned only</option>
            {staff.length ? (
              <optgroup label="Staff">
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {subs.length ? (
              <optgroup label="Subcontractors">
                {subs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.trade ? ` · ${p.trade}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </NativeSelect>
        </label>
        {personFilter ? (
          <button type="button" onClick={() => setParam("person", null)} className="h-11 px-2 text-[14.5px] font-semibold text-accent-fg">
            Show everyone
          </button>
        ) : null}
      </div>

      {/* Desktop planner */}
      <section aria-label={`Diary ${formatWeekRange(start)}`} className="panel hidden overflow-hidden lg:block">
        <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,0.7fr)_minmax(0,0.7fr)] divide-x divide-line">
          {days.map((d) => {
            const isToday = d === today;
            const list = bookingsOnDay(thisWeek, d);
            const weekend = daysBetween(start, d) >= 5;
            return (
              <div
                key={d}
                className={cn("flex min-h-[460px] min-w-0 flex-col", weekend && !isToday && "bg-surface-2/50", isToday && "bg-selected/50")}
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
                <div className={cn("flex items-baseline gap-2 border-b px-3 py-2.5", isToday ? "border-b-2 border-b-copper-500" : "border-line")}>
                  <span className={cn("text-[14.5px] font-semibold", isToday ? "text-accent-fg" : "text-foreground")}>{formatDayShort(d).split(" ")[0]}</span>
                  <span className={cn("tabular text-[14.5px]", isToday ? "font-semibold text-accent-fg" : "text-muted-foreground")}>{formatDayShort(d).split(" ").slice(1).join(" ")}</span>
                  {isToday ? <span className="sr-only">(today)</span> : null}
                </div>
                <ul className="flex flex-1 flex-col gap-2 p-2">
                  {list.map((b) => (
                    <li key={`${b.id}-${d}`}>
                      <BookingCard booking={b} day={d} job={jobs.get(b.jobId)} people={people} onOpen={() => openBooking(b)} draggable={manage} />
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
      </section>

      {/* Phone agenda: today first; earlier days fold away */}
      <section aria-label={`Agenda ${formatWeekRange(start)}`} className="flex flex-col gap-3 lg:hidden">
        {earlier.length && !showEarlier ? (
          <button type="button" onClick={() => setShowEarlier(true)} className="flex h-11 items-center justify-center rounded-xl text-[14.5px] font-semibold text-accent-fg ring-1 ring-line-strong">
            Show earlier this week ({earlier.length} {earlier.length === 1 ? "day" : "days"})
          </button>
        ) : null}
        {(showEarlier ? days : days.filter((d) => !earlier.includes(d))).map((d) => {
          const list = bookingsOnDay(thisWeek, d);
          return (
            <div key={d}>
              <h2 className={cn("mb-1.5 flex items-center gap-2 px-1 text-[15px] font-semibold", d === today ? "text-accent-fg" : "text-foreground")}>
                {d === today ? <span className="rounded-md bg-primary px-1.5 py-0.5 text-[12px] font-semibold text-white">Today</span> : null}
                {formatDayLong(d)}
              </h2>
              {list.length ? (
                <ul className="flex flex-col gap-2">
                  {list.map((b) => (
                    <li key={b.id}>
                      <BookingCard booking={b} day={d} job={jobs.get(b.jobId)} people={people} onOpen={() => openBooking(b)} large />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[14px] text-muted-foreground ring-1 ring-line-strong">
                  Nothing booked
                  {manage ? (
                    <button type="button" onClick={() => ui.openForm({ form: "booking", date: d })} className="h-9 px-2 font-semibold text-accent-fg" aria-label={`Schedule work on ${formatDayLong(d)}`}>
                      Add
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function BookingCard({ booking: b, day, job, people, onOpen, draggable, large }: { booking: Booking; day: string; job?: Job; people: Map<string, Person>; onOpen: () => void; draggable?: boolean; large?: boolean }) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const days = bookingDays(b);
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/booking", b.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      aria-label={`Edit booking: ${job?.title ?? "job"}, ${job?.location ?? ""}, ${formatTimeRange(b.startTime, b.endTime)}, ${who.length ? who.map((p) => p.name).join(", ") : "unassigned"}`}
      className={cn(
        "group relative block w-full rounded-xl bg-card px-3 py-2.5 text-left shadow-[0_1px_2px_rgb(16_24_40/0.06)] ring-1 ring-line-strong transition hover:ring-copper-500/50 active:bg-surface-2",
        "border-l-[3px]",
        who.length ? "border-l-copper-500" : "border-l-amber-400",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <Pencil aria-hidden className="absolute right-2 top-2.5 size-3.5 text-subtle opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
      <span className={cn("block pr-4 font-semibold leading-snug text-heading", large ? "text-[16.5px]" : "line-clamp-2 text-[15px]")}>{job?.title ?? "Job"}</span>
      <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[13.5px] tabular text-foreground">
        <span className="whitespace-nowrap">{formatTimeRange(b.startTime, b.endTime)}</span>
        {days.length > 1 ? <span className="whitespace-nowrap text-[12.5px] text-muted-foreground">· day {days.indexOf(day) + 1} of {days.length}</span> : null}
      </span>
      <span className="block truncate text-[13.5px] text-muted-foreground">{job?.location ?? ""}</span>
      <span className="mt-1.5 flex flex-wrap gap-1">
        {who.length ? (
          who.map((p) => (
            <span key={p.id} title={p.name} className={cn("inline-flex h-6 max-w-full items-center gap-1 rounded-md px-1.5 text-[12.5px] font-medium", p.kind === "subcontractor" ? "bg-sky-500/10 text-info-fg" : "bg-surface-3 text-foreground")}>
              <span aria-hidden className="text-[11px] opacity-70">{initials(p.name)}</span>
              <span className="truncate">{p.name.split(" ")[0]}</span>
            </span>
          ))
        ) : (
          <span className="inline-flex h-6 items-center rounded-md bg-amber-500/12 px-1.5 text-[12.5px] font-semibold text-warn-fg">Unassigned</span>
        )}
      </span>
    </button>
  );
}
