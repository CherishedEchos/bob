/** Leave helpers shared by the Diary, Team and My work. Pure functions on date keys (no time zones). */
import type { Absence } from "@/lib/types";

export const ABSENCE_LABEL: Record<Absence["kind"], string> = { holiday: "Holiday", unavailable: "Unavailable", sick: "Sick", other: "Away" };
export const PART_LABEL = { am: "Morning", pm: "Afternoon" } as const;

export const isLive = (a: Absence) => a.status === "approved" || a.status === "pending";

export function absencesOnDay(absences: Absence[], day: string): Absence[] {
  return absences.filter((a) => isLive(a) && a.startDate <= day && a.endDate >= day);
}

/** Working days counted Mon–Fri; a half day counts 0.5. */
export function leaveDays(a: Pick<Absence, "startDate" | "endDate" | "part">): number {
  if (a.part) return 0.5;
  let n = 0;
  const d = new Date(`${a.startDate}T12:00:00Z`);
  const end = new Date(`${a.endDate}T12:00:00Z`);
  while (d <= end) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

/* ------------------------------ History & reconciliation ------------------------------ */

const keyDate = (d: string) => new Date(`${d}T12:00:00Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);

/** First and last day of the month before `today` (date keys). */
export function lastMonthRange(today: string): [string, string] {
  const d = keyDate(today);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12));
  return [toKey(first), toKey(last)];
}

export function thisMonthRange(today: string): [string, string] {
  const d = keyDate(today);
  return [toKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12))), toKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)))];
}

/** Does this leave period touch the range at all? */
export const overlapsRange = (a: Pick<Absence, "startDate" | "endDate">, from: string, to: string) => a.startDate <= to && a.endDate >= from;

/**
 * Working days (Mon–Fri) of a leave period that fall INSIDE the range — so a
 * holiday from 28 Oct to 7 Nov counts only its November days when checking
 * November. A half day counts 0.5 (if its day is in the range).
 */
export function leaveDaysInRange(a: Pick<Absence, "startDate" | "endDate" | "part">, from: string, to: string): number {
  const start = a.startDate > from ? a.startDate : from;
  const end = a.endDate < to ? a.endDate : to;
  if (start > end) return 0;
  if (a.part) {
    const w = keyDate(start).getUTCDay();
    return w === 0 || w === 6 ? 0 : 0.5;
  }
  return leaveDays({ startDate: start, endDate: end });
}

/** Every calendar day in [from, to]. */
export function daysBetweenKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = keyDate(from); toKey(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(toKey(d));
  return out;
}

export interface BookedDay {
  date: string;
  bookingId: string;
  jobId: string;
  startTime?: string;
  endTime?: string;
}

/**
 * The days a person was BOOKED to work in the range (one row per booking per
 * day). This is the plan, not proof of attendance — Bob doesn't track who
 * actually turned up.
 */
export function bookedDaysInRange(bookings: { id: string; jobId: string; date: string; endDate?: string; startTime?: string; endTime?: string; personIds: string[] }[], personId: string, from: string, to: string): BookedDay[] {
  const out: BookedDay[] = [];
  for (const b of bookings) {
    if (!b.personIds.includes(personId)) continue;
    const end = b.endDate ?? b.date;
    if (b.date > to || end < from) continue;
    for (const d of daysBetweenKeys(b.date > from ? b.date : from, end < to ? end : to)) out.push({ date: d, bookingId: b.id, jobId: b.jobId, startTime: b.startTime, endTime: b.endTime });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || (x.startTime ?? "").localeCompare(y.startTime ?? ""));
}
