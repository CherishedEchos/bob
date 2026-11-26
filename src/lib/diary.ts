/**
 * Diary layout and planning helpers — pure functions shared by the Week, Team
 * and Month views (and their tests). No React, no storage.
 */
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { addDays, rangeKeys, timeToMinutes, weekStart } from "@/lib/dates";
import { bookingEndDate } from "@/lib/schedule";

export type DiaryView = "week" | "month" | "team";
export const DIARY_VIEWS: { value: DiaryView; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "team", label: "Team" },
];
export const isDiaryView = (v: unknown): v is DiaryView => v === "week" || v === "month" || v === "team";

/** Leave that actually takes someone out (not declined or cancelled). */
export const liveAbsence = (a: Pick<Absence, "status">) => a.status !== "declined" && a.status !== "cancelled";

/** Two bookings clash if their days overlap and their hours overlap (all day overlaps everything). */
export function bookingsOverlap(
  a: Pick<Booking, "date" | "endDate" | "startTime" | "endTime">,
  b: Pick<Booking, "date" | "endDate" | "startTime" | "endTime">,
): boolean {
  if (bookingEndDate(a) < b.date || bookingEndDate(b) < a.date) return false;
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return true;
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}

/** Does a part-day absence (am/pm) actually overlap a booking's hours? Full days always do. */
export function absenceOverlapsBooking(a: Pick<Absence, "part">, b: Pick<Booking, "startTime" | "endTime">): boolean {
  if (!a.part || !b.startTime || !b.endTime) return true;
  const noon = 12 * 60;
  return a.part === "am" ? timeToMinutes(b.startTime) < noon : timeToMinutes(b.endTime) > noon;
}

export interface Conflict {
  personId: string;
  day: string;
  kind: "double" | "absence";
  /** The bookings involved (two for a double booking, one for leave). */
  bookingIds: string[];
  absenceId?: string;
}

/**
 * Every clash in [from, to]: one person on two overlapping bookings, or booked
 * while on approved leave / unavailable. One entry per person, day and pair.
 */
export function findConflicts(bookings: Booking[], absences: Absence[], from: string, to: string): Conflict[] {
  const out: Conflict[] = [];
  const seen = new Set<string>();
  const inRange = bookings.filter((b) => b.date <= to && bookingEndDate(b) >= from);
  for (const day of rangeKeys(from, to)) {
    const today = inRange.filter((b) => b.date <= day && bookingEndDate(b) >= day);
    for (let i = 0; i < today.length; i++)
      for (let j = i + 1; j < today.length; j++) {
        const [a, b] = [today[i], today[j]];
        if (!bookingsOverlap({ ...a, date: day, endDate: day }, { ...b, date: day, endDate: day })) continue;
        for (const pid of a.personIds) {
          if (!b.personIds.includes(pid)) continue;
          const key = `d|${pid}|${day}|${[a.id, b.id].sort().join("|")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ personId: pid, day, kind: "double", bookingIds: [a.id, b.id] });
        }
      }
    for (const abs of absences) {
      if (abs.status !== "approved" || abs.startDate > day || abs.endDate < day) continue;
      for (const b of today) {
        if (!b.personIds.includes(abs.personId) || !absenceOverlapsBooking(abs, b)) continue;
        out.push({ personId: abs.personId, day, kind: "absence", bookingIds: [b.id], absenceId: abs.id });
      }
    }
  }
  return out;
}

/** A booking (or absence) cut to the visible columns: start column, span, and the lane it sits in. */
export interface Segment<T> {
  item: T;
  col: number;
  span: number;
  lane: number;
  /** The booking carries on before / after the visible range. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** The first visible day of this segment. */
  startDay: string;
}

/**
 * Lay items out as horizontal blocks over the visible days. Hidden days (e.g.
 * weekends) split a booking into separate segments. Items are packed into the
 * fewest lanes, longest first, so multi-day work reads as one continuous bar.
 */
export function layoutSegments<T>(items: T[], days: string[], range: (t: T) => [string, string], order: (a: T, b: T) => number = () => 0): { segments: Segment<T>[]; lanes: number } {
  const raw: Omit<Segment<T>, "lane">[] = [];
  for (const item of items) {
    const [start, end] = range(item);
    if (end < days[0] || start > days[days.length - 1]) continue;
    let run: number[] = [];
    const flush = () => {
      if (!run.length) return;
      const first = days[run[0]];
      const last = days[run[run.length - 1]];
      raw.push({ item, col: run[0], span: run.length, continuesBefore: first > start, continuesAfter: last < end, startDay: first });
      run = [];
    };
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d < start || d > end) {
        flush();
        continue;
      }
      // A gap between consecutive visible columns (a hidden weekend) breaks the run.
      if (run.length && i - run[run.length - 1] !== 1) flush();
      run.push(i);
    }
    flush();
  }
  raw.sort((a, b) => a.col - b.col || b.span - a.span || order(a.item, b.item));
  const laneEnds: number[] = [];
  const segments = raw.map((s) => {
    let lane = laneEnds.findIndex((end) => end < s.col);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(-1);
    }
    laneEnds[lane] = s.col + s.span - 1;
    return { ...s, lane };
  });
  return { segments, lanes: laneEnds.length };
}

export const byStartTime = (a: Pick<Booking, "startTime">, b: Pick<Booking, "startTime">) => (a.startTime ?? "00:00").localeCompare(b.startTime ?? "00:00");

/** The visible days of a week, optionally without Saturday and Sunday. */
export function weekDays(anyDay: string, showWeekends: boolean): string[] {
  const start = weekStart(anyDay);
  return rangeKeys(start, addDays(start, showWeekends ? 6 : 4));
}

/** Monday-start weeks covering a whole month (5 or 6 rows). */
export function monthWeeks(anyDay: string): string[][] {
  const first = `${anyDay.slice(0, 7)}-01`;
  const start = weekStart(first);
  const next = new Date(`${first}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = addDays(next.toISOString().slice(0, 10), -1);
  const weeks: string[][] = [];
  for (let w = start; w <= lastDay; w = addDays(w, 7)) weeks.push(rangeKeys(w, addDays(w, 6)));
  return weeks;
}

export interface DiarySummary {
  sites: number;
  scheduled: number;
  off: number;
  unassigned: number;
  conflicts: number;
}

/** "5 active sites · 6 people scheduled · 1 person off" for the visible range. */
export function diarySummary(bookings: Booking[], absences: Absence[], jobs: Map<string, Job>, from: string, to: string): DiarySummary {
  const inRange = bookings.filter((b) => b.date <= to && bookingEndDate(b) >= from);
  const sites = new Set(inRange.map((b) => jobs.get(b.jobId)?.siteAddress || jobs.get(b.jobId)?.location || b.jobId));
  const scheduled = new Set(inRange.flatMap((b) => b.personIds));
  const off = new Set(absences.filter((a) => liveAbsence(a) && a.startDate <= to && a.endDate >= from).map((a) => a.personId));
  const conflicts = new Set(findConflicts(bookings, absences, from, to).map((c) => `${c.personId}|${c.day}`));
  return { sites: sites.size, scheduled: scheduled.size, off: off.size, unassigned: inRange.filter((b) => !b.personIds.length).length, conflicts: conflicts.size };
}

export function summaryParts(s: DiarySummary): string[] {
  const parts = [`${s.sites} active ${s.sites === 1 ? "site" : "sites"}`, `${s.scheduled} ${s.scheduled === 1 ? "person" : "people"} scheduled`];
  if (s.off) parts.push(`${s.off} ${s.off === 1 ? "person" : "people"} off`);
  return parts;
}

/** Town for a booking card: the job's location, or the town in the site address. */
export function jobTown(job?: Pick<Job, "location" | "siteAddress">): string {
  if (!job) return "";
  if (job.location) return job.location.split(",").map((s) => s.trim()).filter((s) => !/^[A-Z]{1,2}\d/.test(s)).at(-1) ?? job.location;
  const parts = (job.siteAddress ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.filter((s) => !/^[A-Z]{1,2}\d/.test(s)).at(-1) ?? "";
}

export type Availability = "free" | "free_am" | "free_pm" | "busy" | "off";

/** Is a person free on a day? Whole day, morning only, afternoon only, booked, or off. */
export function availability(personId: string, day: string, bookings: Booking[], absences: Absence[]): Availability {
  const leave = absences.find((a) => a.personId === personId && liveAbsence(a) && a.status === "approved" && a.startDate <= day && a.endDate >= day);
  if (leave && !leave.part) return "off";
  let am = leave?.part === "am";
  let pm = leave?.part === "pm";
  for (const b of bookings) {
    if (!b.personIds.includes(personId) || b.date > day || bookingEndDate(b) < day) continue;
    if (!b.startTime || !b.endTime) return "busy";
    if (timeToMinutes(b.startTime) < 12 * 60) am = true;
    if (timeToMinutes(b.endTime) > 12 * 60) pm = true;
  }
  if (am && pm) return leave ? "off" : "busy";
  if (am) return "free_pm";
  if (pm) return "free_am";
  return "free";
}

export const personLabel = (p: Pick<Person, "name" | "trade" | "kind">) => p.trade || (p.kind === "subcontractor" ? "Subcontractor" : "Team");
