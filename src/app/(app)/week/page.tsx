"use client";

/**
 * Diary — Bob's landing page: where everyone is working, who's free, who's off
 * and what still needs someone.
 * Desktop: Week, Month and Team views (each person's choice is remembered).
 * Phone: a day-grouped agenda with large cards, directions and a team filter.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CalendarOff, CalendarPlus, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays, formatWeekRange, isDateKey, weekStart } from "@/lib/dates";
import { diarySummary, findConflicts, isDiaryView, monthWeeks, summaryParts, weekDays, type DiaryView } from "@/lib/diary";
import { bookingEndDate } from "@/lib/schedule";
import type { Booking } from "@/lib/types";
import { cn, todayKey } from "@/lib/utils";
import { PageHeader, pageActionClass, pageSecondaryClass } from "@/components/common/bits";
import { NativeSelect } from "@/components/ui/input";
import { Onboarding } from "@/components/common/onboarding";
import { DatePicker, ViewSwitch, firstName, useBookingMover, useJobsAndPeople } from "@/components/diary/shared";
import { WeekView } from "@/components/diary/week-view";
import { TeamView } from "@/components/diary/team-view";
import { MonthView } from "@/components/diary/month-view";
import { Agenda } from "@/components/diary/agenda";

export default function DiaryPage() {
  return (
    <React.Suspense>
      <Diary />
    </React.Suspense>
  );
}

function usePref<T extends string>(key: string, fallback: T, valid: (v: string) => boolean): [T, (v: T) => void] {
  const [value, setValue] = React.useState<T>(fallback);
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v && valid(v)) setValue(v as T);
    } catch {
      /* private mode */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per key
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* private mode */
    }
  };
  return [value, set];
}

const monthLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

function Diary() {
  const { data, can, user } = useStore();
  const ui = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayKey();
  const { jobs, people } = useJobsAndPeople();
  const { move, dialog } = useBookingMover();
  const manage = can("schedule.manage");

  const [savedView, saveView] = usePref<DiaryView>(`bob.diary.view.${user.id}`, "week", isDiaryView);
  const [weekendsPref, saveWeekends] = usePref<"show" | "hide">(`bob.diary.weekends.${user.id}`, "show", (v) => v === "show" || v === "hide");
  const urlView = params.get("view");
  const view: DiaryView = isDiaryView(urlView) ? urlView : savedView;
  const anchorParam = params.get("d") ?? params.get("w");
  const anchor = isDateKey(anchorParam) ? anchorParam! : today;
  const personFilter = params.get("person") ?? "";

  const setParams = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    q.delete("w");
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.replace(`/week${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };
  const chooseView = (v: DiaryView) => {
    saveView(v);
    setParams({ view: null });
  };
  // A view in the URL (e.g. a shared link) becomes this person's choice too.
  React.useEffect(() => {
    if (isDiaryView(urlView) && urlView !== savedView) saveView(urlView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlView]);

  const goTo = (d: string | null) => setParams({ d: d && d !== today ? d : null });
  const step = (n: number) => {
    if (view === "month") {
      const m = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
      m.setUTCMonth(m.getUTCMonth() + n);
      goTo(m.toISOString().slice(0, 10));
    } else goTo(addDays(anchor, 7 * n));
  };

  // Weekends: hidden only by choice, and never when today is one of them.
  const todayInWeek = weekStart(today) === weekStart(anchor);
  const todayIsWeekend = [0, 6].includes(new Date(`${today}T12:00:00Z`).getUTCDay());
  const showWeekends = weekendsPref === "show" || (todayInWeek && todayIsWeekend && view !== "month");
  const days = weekDays(anchor, showWeekends);
  const allWeek = weekDays(anchor, true);
  const weeks = monthWeeks(anchor);
  const [from, to] = view === "month" ? [weeks[0][0], weeks.at(-1)![6]] : [days[0], days.at(-1)!];

  const active = data.people.filter((p) => !p.archivedAt);
  const filtered = (b: Booking) => (personFilter === "unassigned" ? !b.personIds.length : !personFilter || b.personIds.includes(personFilter));
  const inRange = (b: Booking, a: string, z: string) => b.date <= z && bookingEndDate(b) >= a;
  const visible = data.bookings.filter((b) => inRange(b, from, to) && (view === "team" || filtered(b)));
  const leave = data.absences.filter((a) => view === "team" || !personFilter || personFilter === "unassigned" || a.personId === personFilter);
  const conflicts = React.useMemo(() => findConflicts(data.bookings, data.absences, view === "month" ? from : allWeek[0], view === "month" ? to : allWeek[6]), [data.bookings, data.absences, from, to, allWeek, view]);
  const summary = diarySummary(data.bookings.filter(filtered), leave, jobs, view === "month" ? `${anchor.slice(0, 7)}-01` : allWeek[0], view === "month" ? weeks.at(-1)!.filter((d) => d.slice(0, 7) === anchor.slice(0, 7)).at(-1)! : allWeek[6]);
  const label = view === "month" ? monthLabel(anchor) : formatWeekRange(weekStart(anchor));
  const isCurrent = view === "month" ? anchor.slice(0, 7) === today.slice(0, 7) : todayInWeek;

  const openBooking = (b: Booking) => (manage ? ui.openForm({ form: "booking", bookingId: b.id, focus: b.personIds.length ? undefined : "people" }) : ui.openJob(b.jobId, { tab: "schedule" }));
  const add = (day?: string, personId?: string) =>
    ui.openForm({ form: "booking", date: day ?? (todayInWeek ? today : weekStart(anchor)), personIds: personId ? [personId] : personFilter && personFilter !== "unassigned" ? [personFilter] : undefined });

  const pending = data.absences.filter((a) => a.status === "pending").length;
  const filterOptions = (
    <>
      <option value="">Everyone</option>
      <option value="unassigned">Needs someone</option>
      {active.filter((p) => p.kind === "employee").length ? (
        <optgroup label="Staff">
          {active.filter((p) => p.kind === "employee").map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {active.filter((p) => p.kind === "subcontractor").length ? (
        <optgroup label="Subcontractors">
          {active.filter((p) => p.kind === "subcontractor").map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.trade ? ` · ${p.trade}` : ""}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <PageHeader
        title="Diary"
        subtitle={
          <span className="tabular">
            {summaryParts(summary).join(" · ")}
            {summary.unassigned ? <span className="text-warn-fg"> · {summary.unassigned} needs someone</span> : null}
            {summary.conflicts ? <span className="font-medium text-danger-fg"> · {summary.conflicts} {summary.conflicts === 1 ? "clash" : "clashes"}</span> : null}
          </span>
        }
        actions={
          <>
            {can("schedule.read") ? (
              <Link href="/team?view=holidays" className={cn(pageSecondaryClass, "px-3")}>
                <CalendarOff className="size-4 text-subtle" aria-hidden /> <span className="hidden sm:inline">Holidays</span>
                {pending ? <span className="tabular text-[12.5px] font-semibold text-warn-fg">{pending}</span> : null}
              </Link>
            ) : null}
            {manage ? (
              <button type="button" className={pageActionClass} onClick={() => add()}>
                <CalendarPlus className="size-[17px]" aria-hidden /> Schedule work
              </button>
            ) : null}
          </>
        }
      />

      <Onboarding />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Diary controls">
        <div className="flex h-9 items-center rounded-lg bg-card ring-1 ring-line-strong">
          <button type="button" aria-label={view === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)} className="grid h-full w-9 place-items-center rounded-l-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button type="button" onClick={() => goTo(null)} aria-pressed={isCurrent} className={cn("h-full border-x border-line px-3 text-[13.5px] font-medium", isCurrent ? "text-copper-600" : "text-foreground hover:bg-surface-2")}>
            Today
          </button>
          <button type="button" aria-label={view === "month" ? "Next month" : "Next week"} onClick={() => step(1)} className="grid h-full w-9 place-items-center rounded-r-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        <DatePicker value={anchor} today={today} label={label} mode={view} onPick={(d) => goTo(d)} />

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          {view !== "team" ? (
            <label className="flex w-[200px] items-center">
              <span className="sr-only">Show work for</span>
              <span className="relative w-full">
                <Users className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle" aria-hidden />
                <NativeSelect value={personFilter} onChange={(e) => setParams({ person: e.target.value || null })} className="h-9 pl-8 text-[13.5px] lg:h-9">
                  {filterOptions}
                </NativeSelect>
              </span>
            </label>
          ) : null}
          <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 text-[13.5px] font-medium text-muted-foreground hover:bg-surface-3">
            <input type="checkbox" checked={weekendsPref === "show"} onChange={(e) => saveWeekends(e.target.checked ? "show" : "hide")} className="size-4 accent-[#1a1a1a]" />
            Weekends
          </label>
          <ViewSwitch value={view} onChange={chooseView} />
        </div>
      </div>

      {/* Desktop and tablet */}
      <div className="hidden lg:block">
        {view === "week" ? (
          <WeekView days={days} today={today} bookings={visible} absences={leave} jobs={jobs} people={people} team={active} conflicts={conflicts} manage={manage} onOpen={openBooking} onAdd={(d) => add(d)} onMove={(id, shift) => move(id, { shift })} />
        ) : view === "team" ? (
          <TeamView days={days} today={today} bookings={visible} absences={data.absences} jobs={jobs} people={people} team={active} conflicts={conflicts} manage={manage} onOpen={openBooking} onAdd={add} onMove={(id, o) => move(id, o)} />
        ) : (
          <MonthView anchor={anchor} today={today} showWeekends={weekendsPref === "show"} bookings={visible} absences={leave} jobs={jobs} people={people} onOpen={openBooking} onDay={(d) => setParams({ d: d === today ? null : d, view: "week" })} />
        )}
      </div>

      {/* Phone: team filter chips, then the agenda */}
      <div className="lg:hidden">
        <div role="radiogroup" aria-label="Show work for" className="scrollbar-none -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          {[{ id: "", label: "Everyone" }, ...active.map((p) => ({ id: p.id, label: firstName(p.name) })), { id: "unassigned", label: "Needs someone" }].map((o) => (
            <button
              key={o.id || "all"}
              type="button"
              role="radio"
              aria-checked={personFilter === o.id}
              onClick={() => setParams({ person: o.id || null })}
              className={cn("h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium ring-1 transition-colors", personFilter === o.id ? "bg-[#1a1a1a] text-white ring-[#1a1a1a]" : "bg-card text-muted-foreground ring-line-strong")}
            >
              {o.label}
            </button>
          ))}
        </div>
        <Agenda
          days={allWeek}
          today={today}
          bookings={data.bookings.filter((b) => inRange(b, allWeek[0], allWeek[6]) && filtered(b))}
          absences={leave}
          jobs={jobs}
          people={people}
          conflicts={conflicts}
          manage={manage}
          onOpen={openBooking}
          onJob={(id) => ui.openJob(id)}
          onAdd={(d) => add(d)}
        />
      </div>
      {dialog}
    </div>
  );
}
