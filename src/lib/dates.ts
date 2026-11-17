/**
 * Workspace-local calendar dates. Pure functions, shared by server and client.
 *
 * Bob stores schedule dates as "YYYY-MM-DD" keys and times as wall-clock
 * "HH:MM" in the workspace's time zone (UK: Europe/London). Arithmetic on date
 * keys is done in UTC, so a day is always one day — clocks going forward or
 * back never move a booking, and a 08:00 start stays 08:00 on both sides of a
 * daylight-saving change. "Today" is worked out in the workspace's zone, not
 * the server's (Render runs in UTC).
 */

export const DEFAULT_TIME_ZONE = "Europe/London";

const keyFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar date in `timeZone` at instant `now`, as YYYY-MM-DD. */
export function dateKeyIn(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  let f = keyFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    keyFormatters.set(timeZone, f);
  }
  return f.format(now);
}

/** Minutes since local midnight in `timeZone` (for "now" lines and today's next booking). */
export function minutesNowIn(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const toUTC = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isDateKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTC(s));
export const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function addDays(key: string, days: number): string {
  return fromUTC(toUTC(key) + days * 86_400_000);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(key: string): number {
  return (new Date(toUTC(key)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `key` (UK weeks start on Monday). */
export function weekStart(key: string): string {
  return addDays(key, -weekday(key));
}

export function rangeKeys(start: string, end: string): string[] {
  const n = Math.max(0, daysBetween(start, end));
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const fmt = (key: string, opts: Intl.DateTimeFormatOptions) => new Date(toUTC(key)).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

/** "Mon 16 Nov" */
export const formatDayShort = (key: string) => fmt(key, { weekday: "short", day: "numeric", month: "short" });
/** "Monday 16 November" */
export const formatDayLong = (key: string) => fmt(key, { weekday: "long", day: "numeric", month: "long" });
/** "16 Nov 2026" */
export const formatDateUK = (key: string) => fmt(key, { day: "numeric", month: "short", year: "numeric" });
/** "16–22 Nov 2026" or "30 Nov – 6 Dec 2026" */
export function formatWeekRange(start: string): string {
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${fmt(start, { day: "numeric" })}–${fmt(end, { day: "numeric", month: "short", year: "numeric" })}` : `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** "08:00–16:30", or "All day". */
export function formatTimeRange(start?: string, end?: string): string {
  if (!start && !end) return "All day";
  if (start && end) return `${start}–${end}`;
  return start ? `From ${start}` : `Until ${end}`;
}

/** Relative label for a day: Today / Tomorrow / Yesterday / "Thu 19 Nov". */
export function relativeDay(key: string, today: string): string {
  const d = daysBetween(today, key);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return formatDayShort(key);
}

/** Mid-sentence form: "today", "tomorrow", "yesterday" or "Thu 19 Nov" (month keeps its capital). */
export function relativeDayInline(key: string, today: string): string {
  const r = relativeDay(key, today);
  return /^(Today|Tomorrow|Yesterday)$/.test(r) ? r.toLowerCase() : r;
}
