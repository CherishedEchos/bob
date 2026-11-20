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
import Link from "next/link";
import { CalendarDays, CalendarOff, CalendarPlus, ChevronLeft, ChevronRight, MapPin, Pencil, Plus, Users } from "lucide-react";
import { ABSENCE_LABEL, PART_LABEL, absencesOnDay } from "@/lib/leave";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays, daysBetween, formatDayLong, formatDayShort, formatTimeRange, formatWeekRange, isDateKey, rangeKeys, weekStart } from "@/lib/dates";
import { bookingDays, bookingsOnDay } from "@/lib/schedule";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn, todayKey } from "@/lib/utils";
import { PageHeader, pageActionClass, pageSecondaryClass } from "@/components/common/bits";
import { PeopleStack, jobTone } from "@/components/common/people";
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
  const leave = data.absences.filter((a) => !personFilter || personFilter === "unassigned" || a.personId === personFilter);
  const thisWeek = visible.filter((b) => b.date <= days[6] && (b.endDate ?? b.date) >= days[0]);
  const isThisWeek = start === weekStart(today);

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

  const weekBookings = thisWeek.length;
  const offThisWeek = new Set(leave.filter((a) => !["declined", "cancelled"].includes(a.status) && a.startDate <= days[6] && a.endDate >= days[0]).map((a) => a.personId)).size;
  const [selected, setSelected] = React.useState<string>(isThisWeek ? today : start);
  React.useEffect(() => setSelected(isThisWeek ? today : start), [start, isThisWeek, today]);
  const selectedList = bookingsOnDay(thisWeek, selected);
  const holidaysLink = can("schedule.read") ? (
    <Link href="/team?view=holidays" className={cn(pageSecondaryClass, "px-3")}>
      <CalendarOff className="size-4 text-subtle" aria-hidden /> <span className="hidden sm:inline">Holidays</span>
      {data.absences.some((a) => a.status === "pending") ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-warning/15 px-1.5 text-[11.5px] font-semibold text-warn-fg">{data.absences.filter((a) => a.status === "pending").length}</span> : null}
    </Link>
  ) : null;
  const scheduleBtn = manage ? (
    <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "booking", date: isThisWeek ? selected : start, personIds: personFilter && personFilter !== "unassigned" ? [personFilter] : undefined })}>
      <CalendarPlus className="size-[17px]" aria-hidden /> Schedule work
    </button>
  ) : null;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Diary"
        subtitle={
          <span className="tabular">
            {formatWeekRange(start)} · {weekBookings} {weekBookings === 1 ? "booking" : "bookings"}
            {offThisWeek ? ` · ${offThisWeek} off` : ""}
          </span>
        }
        actions={
          <>
            {holidaysLink}
            {scheduleBtn}
          </>
        }
      />

      <Onboarding />

      {/* Week navigation and person filter */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Diary controls">
        <div className="flex items-center rounded-[10px] bg-card p-0.5 shadow-[var(--shadow-xs)] ring-1 ring-line-strong">
          <button type="button" aria-label="Previous week" onClick={() => goWeek(addDays(start, -7))} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:size-9">
            <ChevronLeft className="size-[18px]" aria-hidden />
          </button>
          <button type="button" onClick={() => goWeek(null)} aria-pressed={isThisWeek} className={cn("h-10 rounded-lg px-3.5 text-[14px] font-semibold lg:h-9", isThisWeek ? "text-accent-fg" : "text-foreground hover:bg-surface-2")}>
            Today
          </button>
          <button type="button" aria-label="Next week" onClick={() => goWeek(addDays(start, 7))} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:size-9">
            <ChevronRight className="size-[18px]" aria-hidden />
          </button>
        </div>
        <p className="hidden px-1 text-[16px] font-semibold tabular tracking-[-0.01em] text-heading lg:block" aria-live="polite">
          {monthLabel(start)}
        </p>
        <label className="ml-auto flex min-w-[170px] flex-1 items-center gap-2 sm:max-w-[240px] lg:flex-none">
          <span className="sr-only">Show work for</span>
          <span className="relative w-full">
            <Users className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <NativeSelect value={personFilter} onChange={(e) => setParam("person", e.target.value || null)} className="pl-9">
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
          </span>
        </label>
        {personFilter ? (
          <button type="button" onClick={() => setParam("person", null)} className="h-10 px-2 text-[14px] font-semibold text-accent-fg">
            Show everyone
          </button>
        ) : null}
      </div>

      {/* Desktop planner */}
      <section aria-label={`Diary ${formatWeekRange(start)}`} className="panel hidden overflow-hidden shadow-[var(--shadow-sm)] lg:block">
        <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,0.7fr)_minmax(0,0.7fr)] divide-x divide-line">
          {days.map((d) => {
            const isToday = d === today;
            const list = bookingsOnDay(thisWeek, d);
            const weekend = daysBetween(start, d) >= 5;
            const [dow, num] = [new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" }), Number(d.slice(8))];
            return (
              <div
                key={d}
                className={cn("flex min-h-[calc(100dvh-300px)] min-w-0 flex-col", weekend && !isToday && "bg-[#fafaf8]", isToday && "bg-copper-50/60")}
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
                <h2 title={formatDayLong(d)} className="flex items-center gap-2 border-b border-line px-3 py-3">
                  <span className={cn("text-[12px] font-medium uppercase tracking-[0.06em]", isToday ? "text-accent-fg" : "text-subtle")}>{dow}</span>
                  <span className={cn("tabular grid h-7 min-w-7 place-items-center rounded-full px-1 text-[15px] font-semibold", isToday ? "bg-copper-500 text-white shadow-[0_1px_3px_rgb(243_135_53/0.45)]" : "text-heading")}>{num}</span>
                  {isToday ? <span className="sr-only">(today)</span> : null}
                  {list.length ? <span className="ml-auto text-[12px] tabular text-subtle">{list.length}</span> : null}
                </h2>
                <LeaveChips list={absencesOnDay(leave, d)} people={people} />
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
                        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-subtle opacity-70 transition hover:bg-card hover:text-accent-fg hover:opacity-100 hover:shadow-[var(--shadow-xs)] focus-visible:opacity-100"
                        aria-label={`Schedule work on ${formatDayLong(d)}`}
                      >
                        <Plus className="size-3.5" aria-hidden /> Add
                      </button>
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* Phone agenda: a day strip, then the chosen day */}
      <section aria-label={`Agenda ${formatWeekRange(start)}`} className="-mt-1 flex flex-col gap-4 lg:hidden">
        <div className="grid grid-cols-7 gap-1 rounded-2xl bg-card p-1.5 shadow-[var(--shadow-sm)] ring-1 ring-line" role="tablist" aria-label="Choose a day">
          {days.map((d) => {
            const isSel = d === selected;
            const isToday = d === today;
            const count = bookingsOnDay(thisWeek, d).length;
            const off = absencesOnDay(leave, d).length;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={isSel}
                aria-label={`${formatDayLong(d)}${count ? `, ${count} booked` : ""}`}
                onClick={() => setSelected(d)}
                className={cn("flex h-[62px] flex-col items-center justify-center gap-0.5 rounded-xl transition", isSel ? "bg-sidebar text-white" : "active:bg-surface-2")}
              >
                <span className={cn("text-[11px] font-medium uppercase tracking-wide", isSel ? "text-white/60" : isToday ? "text-accent-fg" : "text-subtle")}>{new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "narrow" })}</span>
                <span className={cn("tabular text-[17px] font-semibold", !isSel && isToday && "text-accent-fg")}>{Number(d.slice(8))}</span>
                <span className="flex h-1.5 gap-0.5">
                  {count ? <span className={cn("size-1.5 rounded-full", isSel ? "bg-copper-400" : "bg-copper-500")} /> : null}
                  {off ? <span className="size-1.5 rounded-full bg-violet-400" /> : null}
                </span>
              </button>
            );
          })}
        </div>

        <div>
          <h2 className="mb-2 flex items-baseline justify-between px-0.5">
            <span className="text-[17px] font-semibold tracking-[-0.01em] text-heading">{selected === today ? "Today" : formatDayLong(selected).split(" ")[0]}</span>
            <span className="text-[13.5px] text-subtle">{new Date(`${selected}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</span>
          </h2>
          <LeaveChips list={absencesOnDay(leave, selected)} people={people} phone />
          {selectedList.length ? (
            <ul className="flex flex-col gap-2.5">
              {selectedList.map((b) => (
                <li key={b.id}>
                  <AgendaRow booking={b} day={selected} job={jobs.get(b.jobId)} people={people} onOpen={() => openBooking(b)} onJob={() => ui.openJob(b.jobId)} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center">
              <CalendarDays className="size-6 text-subtle" aria-hidden />
              <p className="mt-2 text-[14.5px] font-medium text-heading">Nothing booked</p>
              {manage ? (
                <button type="button" onClick={() => ui.openForm({ form: "booking", date: selected })} className="mt-3 h-10 rounded-[10px] px-4 text-[14px] font-semibold text-accent-fg ring-1 ring-copper-500/40">
                  Schedule work
                </button>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const monthLabel = (start: string) => {
  const end = addDays(start, 6);
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  const m = (d: Date) => d.toLocaleDateString("en-GB", { month: "long" });
  return a.getMonth() === b.getMonth() ? `${m(a)} ${a.getFullYear()}` : `${m(a)} – ${m(b)} ${b.getFullYear()}`;
};

/** Who's off that day. Approved: solid; pending requests: dashed and labelled. */
function LeaveChips({ list, people, phone }: { list: Absence[]; people: Map<string, Person>; phone?: boolean }) {
  if (!list.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", phone ? "mb-2.5" : "border-b border-line px-2 py-1.5")} aria-label="Leave">
      {list.map((a) => {
        const name = people.get(a.personId)?.name.split(" ")[0] ?? "Someone";
        const pending = a.status === "pending";
        return (
          <li
            key={a.id}
            title={`${people.get(a.personId)?.name ?? "Someone"}: ${ABSENCE_LABEL[a.kind]}${a.part ? ` (${PART_LABEL[a.part].toLowerCase()})` : ""}${pending ? " — waiting for approval" : ""}`}
            className={cn(
              "inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-[12px] font-medium",
              pending ? "border border-dashed border-violet-300 text-violet-700" : "bg-violet-500/10 text-violet-800",
            )}
          >
            <CalendarOff className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {name} · {a.kind === "unavailable" ? "Unavailable" : ABSENCE_LABEL[a.kind]}
              {a.part ? ` ${a.part.toUpperCase()}` : ""}
              {pending ? " (pending)" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function BookingCard({ booking: b, day, job, people, onOpen, draggable }: { booking: Booking; day: string; job?: Job; people: Map<string, Person>; onOpen: () => void; draggable?: boolean }) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const days = bookingDays(b);
  const tone = jobTone(b.jobId);
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
      className={cn("group relative block w-full overflow-hidden rounded-[10px] py-2 pl-3 pr-2 text-left ring-1 transition duration-150 hover:shadow-[var(--shadow-md)] active:scale-[0.99]", tone.card, draggable && "cursor-grab active:cursor-grabbing")}
    >
      <span aria-hidden className={cn("absolute inset-y-1.5 left-1 w-[3px] rounded-full", who.length ? tone.bar : "bg-warning")} />
      <span className={cn("block line-clamp-2 text-[13.5px] font-semibold leading-snug [overflow-wrap:anywhere]", tone.text)} lang="en-GB">
        {job?.title ?? "Job"}
      </span>
      <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[12.5px] tabular text-foreground/80">
        <span className="whitespace-nowrap font-medium">{formatTimeRange(b.startTime, b.endTime)}</span>
        {days.length > 1 ? <span className="whitespace-nowrap text-[11.5px] text-subtle" title={`Day ${days.indexOf(day) + 1} of ${days.length}`}>day {days.indexOf(day) + 1}/{days.length}</span> : null}
      </span>
      {job?.location ? (
        <span className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-subtle">
          <MapPin className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{job.location}</span>
        </span>
      ) : null}
      <span className="mt-2 flex items-center justify-between gap-1">
        {who.length ? <PeopleStack people={who} size={22} max={3} /> : <span className="inline-flex h-[22px] items-center rounded-full bg-warning/15 px-2 text-[11.5px] font-semibold text-warn-fg">Unassigned</span>}
        <Pencil aria-hidden className="size-3.5 text-subtle opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
      </span>
    </button>
  );
}

/** Phone: time on the left, the booking in its job colour, team on the right; tap the site to open the job. */
function AgendaRow({ booking: b, day, job, people, onOpen, onJob }: { booking: Booking; day: string; job?: Job; people: Map<string, Person>; onOpen: () => void; onJob: () => void }) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const days = bookingDays(b);
  const tone = jobTone(b.jobId);
  return (
    <div className="flex gap-3">
      <div className="w-[46px] shrink-0 pt-2.5 text-right tabular">
        {b.startTime ? (
          <>
            <div className="text-[14px] font-semibold text-heading">{b.startTime}</div>
            <div className="text-[12.5px] text-subtle">{b.endTime}</div>
          </>
        ) : (
          <div className="text-[12.5px] font-medium text-subtle">All day</div>
        )}
      </div>
      <div className={cn("relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-2xl py-3 pl-4 pr-3 ring-1", tone.card)}>
        <span aria-hidden className={cn("absolute inset-y-2.5 left-1.5 w-[3px] rounded-full", who.length ? tone.bar : "bg-warning")} />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" aria-label={`Booking: ${job?.title ?? "job"}, ${formatTimeRange(b.startTime, b.endTime)}`}>
          <span className={cn("block truncate text-[15.5px] font-semibold", tone.text)}>{job?.title ?? "Job"}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[13px] text-subtle">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{job?.location ?? "No site set"}</span>
            {days.length > 1 ? <span className="shrink-0">· day {days.indexOf(day) + 1}/{days.length}</span> : null}
          </span>
        </button>
        {who.length ? <PeopleStack people={who} size={28} max={2} /> : <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11.5px] font-semibold text-warn-fg">Unassigned</span>}
        <button type="button" onClick={onJob} aria-label={`Open job ${job?.title ?? ""}`} className="-mr-1 grid size-9 shrink-0 place-items-center rounded-full text-subtle active:bg-black/5">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
