"use client";

/**
 * Diary — Bob's home page: an intelligent workforce planner.
 * Desktop: Week (all work, multi-day jobs as continuous bars), Month (jobs and
 * holidays across the month) and Team (people as rows, days as columns, drag to
 * reassign). Each user's preferred view and weekend setting are remembered.
 * Phone: a day-grouped agenda with large cards, built for use on site.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AudioLines, CalendarDays, CalendarOff, CalendarPlus, ChevronLeft, ChevronRight, MapPin, Navigation, Phone, Users } from "lucide-react";
import { absencesOnDay } from "@/lib/leave";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays, formatTimeRange, formatWeekRange, isDateKey, rangeKeys, weekStart, weekday } from "@/lib/dates";
import { bookingDays, bookingsOnDay, coversDay } from "@/lib/schedule";
import type { Booking, Job, Person } from "@/lib/types";
import { cn, todayKey } from "@/lib/utils";
import { PageHeader, pageActionClass, pageSecondaryClass } from "@/components/common/bits";
import { PeopleStack, jobTone } from "@/components/common/people";
import { NativeSelect } from "@/components/ui/input";
import { Onboarding } from "@/components/common/onboarding";
import { LeaveForm } from "@/components/team/leave";
import { DatePicker } from "@/components/diary/date-picker";
import { WeekView } from "@/components/diary/week-view";
import { TeamView } from "@/components/diary/team-view";
import { MonthView, monthGrid } from "@/components/diary/month-view";
import { type DiaryView, LeaveChip, namesLine, useBookingMover, useDiaryPrefs } from "@/components/diary/shared";

export default function DiaryPage() {
  return (
    <React.Suspense>
      <Diary />
    </React.Suspense>
  );
}

const VIEWS: { value: DiaryView; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "team", label: "Team" },
];

const monthOf = (key: string) => `${key.slice(0, 7)}-01`;
const shiftMonth = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};
const monthName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** "23–27 Nov 2026" or "30 Nov – 4 Dec 2026". */
const rangeLabel = (a: string, b: string) => {
  const f = (k: string, o: Intl.DateTimeFormatOptions) => new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  return a.slice(0, 7) === b.slice(0, 7) ? `${f(a, { day: "numeric" })}–${f(b, { day: "numeric", month: "short", year: "numeric" })}` : `${f(a, { day: "numeric", month: "short" })} – ${f(b, { day: "numeric", month: "short", year: "numeric" })}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Diary() {
  const { data, can, user } = useStore();
  const ui = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const prefs = useDiaryPrefs(user.id);
  const mover = useBookingMover();
  const today = todayKey();
  const anchor = isDateKey(params.get("w")) ? params.get("w")! : today;
  const urlView = params.get("view");
  const view: DiaryView = urlView === "week" || urlView === "month" || urlView === "team" ? urlView : prefs.view;
  const personFilter = params.get("person") ?? "";
  const manage = can("schedule.manage");
  const [leaveFor, setLeaveFor] = React.useState<{ day: string; personId: string } | null>(null);

  const jobs = React.useMemo(() => new Map(data.jobs.map((j) => [j.id, j])), [data.jobs]);
  const people = React.useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const activePeople = data.people.filter((p) => !p.archivedAt);
  const staff = activePeople.filter((p) => p.kind === "employee");
  const subs = activePeople.filter((p) => p.kind === "subcontractor");

  const start = weekStart(anchor);
  const visible = data.bookings.filter((b) => (personFilter === "unassigned" ? !b.personIds.length : !personFilter || b.personIds.includes(personFilter)));
  // Weekends stay hidden unless switched on, but a weekend day with work booked (or the day asked for) always shows.
  const weekDays = rangeKeys(start, addDays(start, 6)).filter((d) => prefs.weekends || weekday(d) < 5 || d === anchor || visible.some((b) => coversDay(b, d)));
  const month = monthOf(anchor);
  const rangeDays = view === "month" ? monthGrid(month).filter((d) => d.slice(0, 7) === month.slice(0, 7)) : weekDays;

  const leave = data.absences.filter((a) => !personFilter || personFilter === "unassigned" || a.personId === personFilter);
  const inRange = (list: Booking[], days: string[]) => list.filter((b) => b.date <= days[days.length - 1] && (b.endDate ?? b.date) >= days[0]);
  const rangeBookings = inRange(visible, rangeDays);

  // The diary's own summary: sites, people, who's off, what needs people.
  const sites = new Set(rangeBookings.map((b) => b.jobId)).size;
  const scheduled = new Set(rangeBookings.flatMap((b) => b.personIds)).size;
  const off = new Set(leave.filter((a) => ["approved", "pending"].includes(a.status) && a.startDate <= rangeDays[rangeDays.length - 1] && a.endDate >= rangeDays[0]).map((a) => a.personId)).size;
  const needPeople = rangeBookings.filter((b) => !b.personIds.length).length;

  const setParams = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.replace(`/week${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };
  const goTo = (key: string | null) => setParams({ w: key && key !== today ? key : null });
  const step = (dir: 1 | -1) => goTo(view === "month" ? shiftMonth(month, dir) : addDays(start, 7 * dir));
  const setView = (v: DiaryView) => {
    prefs.setView(v);
    setParams({ view: null });
  };
  const isCurrent = view === "month" ? month === monthOf(today) : start === weekStart(today);

  const openBooking = (b: Booking) => (manage ? ui.openForm({ form: "booking", bookingId: b.id, focus: b.personIds.length ? undefined : "people" }) : ui.openJob(b.jobId, { tab: "schedule" }));
  const addBooking = (day: string, personId?: string) => ui.openForm({ form: "booking", date: day, personIds: personId ? [personId] : personFilter && personFilter !== "unassigned" ? [personFilter] : undefined });

  const pendingLeave = data.absences.filter((a) => a.status === "pending").length;
  const label = view === "month" ? monthName(month) : rangeLabel(weekDays[0], weekDays[weekDays.length - 1]);
  const marked = [...new Set(visible.flatMap((b) => bookingDays(b)))];

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <PageHeader
        title="Diary"
        subtitle={
          <span className="tabular">
            {sites ? plural(sites, "active site") : "Nothing booked"}
            {scheduled ? ` · ${plural(scheduled, "person", "people")} scheduled` : ""}
            {off ? ` · ${plural(off, "person", "people")} off` : ""}
            {needPeople ? <span className="font-medium text-warn-fg"> · {needPeople} {needPeople === 1 ? "needs" : "need"} people</span> : null}
          </span>
        }
        actions={
          <>
            <button type="button" onClick={() => ui.setAssistantOpen(true)} className={cn(pageSecondaryClass, "hidden px-3 lg:flex")}>
              <AudioLines className="size-4 text-copper-600" aria-hidden /> Ask Bob
            </button>
            {can("schedule.read") ? (
              <Link href="/team?view=holidays" className={cn(pageSecondaryClass, "px-3")} aria-label={`Holidays${pendingLeave ? `, ${pendingLeave} waiting for approval` : ""}`}>
                <CalendarOff className="size-4 text-subtle" aria-hidden /> <span className="hidden sm:inline">Holidays</span>
                {pendingLeave ? <span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-warning/15 px-1.5 text-[11.5px] font-semibold text-warn-fg">{pendingLeave}</span> : null}
              </Link>
            ) : null}
            {manage ? (
              <button type="button" className={cn(pageActionClass, "hidden sm:flex")} onClick={() => addBooking(isCurrent && view !== "month" ? today : weekDays[0])}>
                <CalendarPlus className="size-[17px]" aria-hidden /> Schedule work
              </button>
            ) : null}
          </>
        }
      />

      <Onboarding />

      {/* Controls */}
      <div className="hidden flex-wrap items-center gap-2 lg:flex" role="toolbar" aria-label="Diary controls">
        <div className="flex items-center rounded-lg bg-card ring-1 ring-line-strong">
          <button type="button" aria-label={view === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)} className="grid size-9 place-items-center rounded-l-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button type="button" onClick={() => goTo(null)} aria-pressed={isCurrent} className="h-9 border-x border-line px-3 text-[13.5px] font-medium text-foreground hover:bg-surface-2">
            Today
          </button>
          <button type="button" aria-label={view === "month" ? "Next month" : "Next week"} onClick={() => step(1)} className="grid size-9 place-items-center rounded-r-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        <DatePicker value={anchor} today={today} label={label} onChange={(d) => goTo(d)} highlight={marked} />

        <div className="ml-auto flex items-center gap-2">
          {view !== "team" ? <PersonFilter value={personFilter} onChange={(v) => setParams({ person: v || null })} staff={staff} subs={subs} /> : null}
          {view !== "team" && personFilter ? (
            <button type="button" onClick={() => setParams({ person: null })} className="h-9 rounded-md px-2 text-[14px] font-medium text-muted-foreground hover:bg-surface-3 hover:text-foreground">
              Show everyone
            </button>
          ) : null}
          <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 text-[13.5px] font-medium text-muted-foreground hover:bg-surface-3">
            <input type="checkbox" checked={prefs.weekends} onChange={(e) => prefs.setWeekends(e.target.checked)} className="size-4 rounded accent-[#18181b]" />
            Weekends
          </label>
          <div role="tablist" aria-label="Diary view" className="inline-flex rounded-lg bg-[#ecebe7] p-[3px]">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                onClick={() => setView(v.value)}
                className={cn("h-[30px] rounded-md px-3.5 text-[13px] font-medium transition", view === v.value ? "bg-card font-semibold text-heading shadow-[0_1px_2px_rgb(24_24_27/0.08),0_0_0_0.5px_rgb(24_24_27/0.06)]" : "text-muted-foreground hover:text-foreground")}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop views (wait for the saved preference so the view doesn't flash) */}
      <div className="hidden lg:block">
        {!prefs.ready ? (
          <div className="panel h-[60vh]" aria-hidden />
        ) : view === "week" ? (
          <WeekView days={weekDays} today={today} bookings={inRange(visible, weekDays)} absences={leave} jobs={jobs} people={people} activePeople={activePeople} manage={manage} onOpen={openBooking} onAdd={(d) => addBooking(d)} onMove={mover.request} />
        ) : view === "team" ? (
          <TeamView days={weekDays} today={today} bookings={inRange(data.bookings, weekDays)} absences={data.absences} jobs={jobs} staff={staff} subs={subs} manage={manage} onOpen={openBooking} onAdd={addBooking} onLeave={(day, personId) => setLeaveFor({ day, personId })} onMove={mover.request} />
        ) : (
          <MonthView month={month} weekends={prefs.weekends} today={today} bookings={visible} absences={leave} jobs={jobs} people={people} onOpen={openBooking} onPickDay={(d) => { prefs.setView("week"); setParams({ w: d, view: null }); }} />
        )}
      </div>

      <PhoneAgenda
        anchor={anchor}
        today={today}
        bookings={visible}
        absences={leave}
        jobs={jobs}
        people={people}
        manage={manage}
        personFilter={personFilter}
        staff={staff}
        subs={subs}
        onFilter={(v) => setParams({ person: v || null })}
        onGo={goTo}
        onOpen={openBooking}
        onJob={(id) => ui.openJob(id)}
        onAdd={(d) => addBooking(d)}
      />

      {mover.dialog}
      {leaveFor ? <LeaveForm personId={leaveFor.personId} date={leaveFor.day} onClose={() => setLeaveFor(null)} /> : null}
    </div>
  );
}

function PersonFilter({ value, onChange, staff, subs, className }: { value: string; onChange: (v: string) => void; staff: Person[]; subs: Person[]; className?: string }) {
  return (
    <label className={cn("relative block w-[200px]", className)}>
      <span className="sr-only">Show work for</span>
      <Users className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="pl-9">
        <option value="">Everyone</option>
        <option value="unassigned">Needs people</option>
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
  );
}

/* ------------------------------ Phone agenda ------------------------------ */

function PhoneAgenda({
  anchor,
  today,
  bookings,
  absences,
  jobs,
  people,
  manage,
  personFilter,
  staff,
  subs,
  onFilter,
  onGo,
  onOpen,
  onJob,
  onAdd,
}: {
  anchor: string;
  today: string;
  bookings: Booking[];
  absences: import("@/lib/types").Absence[];
  jobs: Map<string, Job>;
  people: Map<string, Person>;
  manage: boolean;
  personFilter: string;
  staff: Person[];
  subs: Person[];
  onFilter: (v: string) => void;
  onGo: (key: string | null) => void;
  onOpen: (b: Booking) => void;
  onJob: (id: string) => void;
  onAdd: (day: string) => void;
}) {
  const start = weekStart(anchor);
  const days = rangeKeys(start, addDays(start, 6));
  const [selected, setSelected] = React.useState(anchor);
  React.useEffect(() => setSelected(anchor), [anchor]);
  const list = bookingsOnDay(bookings, selected);
  const off = absencesOnDay(absences, selected);
  const sel = new Date(`${selected}T12:00:00Z`);
  return (
    <section aria-label="Agenda" className="flex flex-col gap-3 lg:hidden">
      {/* Week strip with previous / next week */}
      <div className="rounded-xl bg-card p-1.5 ring-1 ring-line">
        <div className="mb-1 flex items-center justify-between px-1">
          <button type="button" aria-label="Previous week" onClick={() => onGo(addDays(start, -7))} className="grid size-10 place-items-center rounded-lg text-muted-foreground active:bg-surface-3">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" onClick={() => onGo(null)} className="h-10 rounded-lg px-3 text-[14px] font-semibold text-heading active:bg-surface-3">
            {formatWeekRange(start)}
          </button>
          <button type="button" aria-label="Next week" onClick={() => onGo(addDays(start, 7))} className="grid size-10 place-items-center rounded-lg text-muted-foreground active:bg-surface-3">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Choose a day">
          {days.map((d) => {
            const isSel = d === selected;
            const isToday = d === today;
            const count = bookings.filter((b) => coversDay(b, d)).length;
            const dayOff = absencesOnDay(absences, d).length;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={isSel}
                aria-label={`${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}${count ? `, ${count} booked` : ""}`}
                onClick={() => setSelected(d)}
                className={cn("flex h-[58px] flex-col items-center justify-center gap-0.5 rounded-lg transition", isSel ? "bg-heading text-white" : "active:bg-surface-2")}
              >
                <span className={cn("text-[11px] font-medium", isSel ? "text-white/60" : isToday ? "text-brand-fg" : "text-subtle")}>{new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }).slice(0, 2)}</span>
                <span className={cn("tabular text-[17px] font-semibold", !isSel && isToday && "text-brand-fg")}>{Number(d.slice(8))}</span>
                <span className="flex h-1.5 gap-0.5">
                  {count ? <span className={cn("size-1.5 rounded-full", isSel ? "bg-white/70" : "bg-foreground/35")} /> : null}
                  {dayOff ? <span className="size-1.5 rounded-full bg-violet-400" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Team filter and Schedule work */}
      <div className="flex items-center gap-2">
        <PersonFilter value={personFilter} onChange={onFilter} staff={staff} subs={subs} className="w-auto min-w-0 flex-1" />
        {manage ? (
          <button type="button" onClick={() => onAdd(selected)} className={cn(pageActionClass, "px-3.5")}>
            <CalendarPlus className="size-[17px]" aria-hidden /> Schedule work
          </button>
        ) : null}
      </div>

      <div>
        <h2 className="mb-2 flex items-baseline justify-between px-0.5">
          <span className="text-[18px] font-semibold tracking-[-0.015em] text-heading">{selected === today ? "Today" : selected === addDays(today, 1) ? "Tomorrow" : sel.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}</span>
          <span className="text-[13.5px] text-subtle">
            {sel.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}
            {list.length ? ` · ${list.length} booked` : ""}
          </span>
        </h2>
        {off.length ? (
          <div className="mb-2.5 flex flex-wrap gap-1">
            {off.map((a) => (
              <LeaveChip key={a.id} absence={a} person={people.get(a.personId)} className="h-7 px-2 text-[12.5px]" />
            ))}
          </div>
        ) : null}
        {list.length ? (
          <ul className="flex flex-col gap-2.5">
            {list.map((b) => (
              <li key={b.id}>
                <AgendaCard booking={b} day={selected} job={jobs.get(b.jobId)} people={people} onOpen={() => onOpen(b)} onJob={() => onJob(b.jobId)} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-4 py-9 text-center">
            <CalendarDays className="size-6 text-subtle" aria-hidden />
            <p className="mt-2 text-[15px] font-medium text-heading">Nothing booked</p>
            {manage ? (
              <button type="button" onClick={() => onAdd(selected)} className="mt-3 h-11 rounded-lg px-4 text-[14.5px] font-semibold text-heading ring-1 ring-line-strong">
                Schedule work
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/** A large, glanceable booking: time, job, customer, site, who's on it, and the actions used on site. */
function AgendaCard({ booking: b, day, job, people, onOpen, onJob }: { booking: Booking; day: string; job?: Job; people: Map<string, Person>; onOpen: () => void; onJob: () => void }) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const days = bookingDays(b);
  const tone = jobTone(b.jobId);
  const address = job?.siteAddress || job?.location;
  return (
    <article className="relative overflow-hidden rounded-xl bg-card ring-1 ring-line">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", who.length ? tone.bar : "bg-warning")} />
      <button type="button" onClick={onOpen} className="block w-full px-4 pb-2.5 pt-3.5 text-left" aria-label={`Booking: ${job?.title ?? "job"}, ${formatTimeRange(b.startTime, b.endTime)}`}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="tabular text-[14px] font-semibold text-heading">{formatTimeRange(b.startTime, b.endTime)}</span>
          {days.length > 1 ? <span className="text-[12.5px] text-subtle">Day {days.indexOf(day) + 1} of {days.length}</span> : null}
        </span>
        <span className="mt-1 block text-[17px] font-semibold leading-snug tracking-[-0.012em] text-heading">{job?.title ?? "Job"}</span>
        <span className="mt-0.5 block text-[14px] text-muted-foreground">{job?.customerName}</span>
        {address ? (
          <span className="mt-1 flex items-center gap-1 text-[14px] text-muted-foreground">
            <MapPin className="size-3.5 shrink-0 text-subtle" aria-hidden />
            <span className="truncate">{address}</span>
          </span>
        ) : null}
        <span className="mt-2.5 flex items-center gap-2">
          {who.length ? (
            <>
              <PeopleStack people={who} size={26} max={4} />
              <span className="truncate text-[14px] font-medium text-foreground/80">{namesLine(who, 3)}</span>
            </>
          ) : (
            <span className="rounded-md bg-warning/15 px-2 py-0.5 text-[13px] font-semibold text-warn-fg">Needs people</span>
          )}
        </span>
      </button>
      <div className="grid grid-cols-3 border-t border-line text-[13.5px] font-medium">
        {address ? (
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 text-foreground active:bg-surface-2">
            <Navigation className="size-4 text-subtle" aria-hidden /> Directions
          </a>
        ) : (
          <span className="flex h-11 items-center justify-center text-subtle">No address</span>
        )}
        {job?.customerPhone ? (
          <a href={`tel:${job.customerPhone.replace(/\s+/g, "")}`} className="flex h-11 items-center justify-center gap-1.5 border-l border-line text-foreground active:bg-surface-2">
            <Phone className="size-4 text-subtle" aria-hidden /> Call
          </a>
        ) : (
          <span className="flex h-11 items-center justify-center border-l border-line text-subtle">No phone</span>
        )}
        <button type="button" onClick={onJob} className="flex h-11 items-center justify-center gap-1 border-l border-line text-foreground active:bg-surface-2">
          Open job <ChevronRight className="size-4 text-subtle" aria-hidden />
        </button>
      </div>
    </article>
  );
}
