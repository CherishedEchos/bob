import "server-only";
/**
 * Read-only schedule questions Bob answers from the workspace's own records:
 *  - "Who's on the kitchen job tomorrow?" / "Who's working tomorrow?"
 *  - "What still needs ordering this week?"
 * Permission-checked: the schedule needs schedule.read, materials records.read.
 */
import type { Chip } from "@/lib/bob/types";
import { can } from "@/lib/auth/permissions";
import { addDays, formatDayLong, formatTimeRange, weekStart, weekday } from "@/lib/dates";
import { todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";
import { listJobs } from "@/server/services/records";
import { bookingsOverlap, listBookings, listMaterials, listPeople } from "@/server/services/team";
import { listNames, plural } from "./compose";

export const WHO_IS_ON = /\bwho('?s| is| are)\b[^?]*\b(working|booked|on site|on the [a-z ]*job|on [a-z' ]+ (tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
export const NEEDS_ORDERING = /\b(what|anything)\b[^?]*\b(needs? ordering|to order|still to order|needs? to be ordered)\b|\bmaterials?\b[^?]*\b(to order|need ordering|needed)\b/i;

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function whichDay(lower: string): { day: string; label: string } {
  const today = todayKey();
  if (/\btomorrow\b/.test(lower)) return { day: addDays(today, 1), label: "tomorrow" };
  const d = DAYS.findIndex((n) => new RegExp(`\\b${n}\\b`).test(lower));
  if (d >= 0) {
    let key = addDays(weekStart(today), d);
    if (key < today || /\bnext\b/.test(lower)) key = addDays(key, 7);
    return { day: key, label: `on ${formatDayLong(key)}` };
  }
  return { day: today, label: "today" };
}

type Answer = { text: string; chips?: Chip[] };

export function whoIsOn(ctx: Ctx, lower: string): Answer {
  if (!can(ctx.role, "schedule.read")) return { text: "Your account can't see the company schedule." };
  const { day, label } = whichDay(lower);
  const jobs = listJobs(ctx);
  const people = new Map(listPeople(ctx).map((p) => [p.id, p.name]));
  const onDay = listBookings(ctx).filter((b) => b.date <= day && (b.endDate ?? b.date) >= day);
  const words = lower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["whos", "working", "tomorrow", "today", "booked", "job", "site", "this", "week", "there", ...DAYS].includes(w));
  const matches = words.length ? jobs.filter((j) => words.some((w) => `${j.title} ${j.customerName} ${j.location}`.toLowerCase().includes(w))) : [];
  const chipsFor = (ids: string[]): Chip[] => ids.slice(0, 3).map((id) => ({ kind: "open" as const, label: `Open ${jobs.find((j) => j.id === id)?.title ?? "job"}`, record: "job" as const, id }));
  if (matches.length) {
    const booked = onDay.filter((b) => matches.some((j) => j.id === b.jobId));
    if (!booked.length) {
      const names = listNames(matches.map((j) => `${j.title} for ${j.customerName}`), 3);
      return { text: `Nobody is booked on ${names} ${label}.`, chips: [...chipsFor(matches.map((j) => j.id)), { kind: "link", label: "Open diary", href: "/week" }] };
    }
    const lines = booked.map((b) => {
      const j = jobs.find((x) => x.id === b.jobId)!;
      const who = b.personIds.map((id) => people.get(id) ?? "someone");
      return `${j.title} for ${j.customerName} (${formatTimeRange(b.startTime, b.endTime)}): ${who.length ? listNames(who, 5) : "nobody assigned yet"}`;
    });
    return { text: `${label[0].toUpperCase()}${label.slice(1)}: ${lines.join(". ")}.`, chips: chipsFor([...new Set(booked.map((b) => b.jobId))]) };
  }
  if (!onDay.length) return { text: `Nothing is booked ${label}.`, chips: [{ kind: "link", label: "Open diary", href: "/week" }] };
  const lines = onDay.map((b) => {
    const j = jobs.find((x) => x.id === b.jobId);
    const who = b.personIds.map((id) => people.get(id) ?? "someone");
    return `${who.length ? listNames(who, 4) : "Nobody yet"} on ${j?.title ?? "a job"} in ${j?.location ?? "?"} (${formatTimeRange(b.startTime, b.endTime)})`;
  });
  const unassigned = onDay.filter((b) => !b.personIds.length).length;
  return {
    text: `${label[0].toUpperCase()}${label.slice(1)} there ${onDay.length === 1 ? "is" : "are"} ${plural(onDay.length, "booking")}: ${lines.join("; ")}.${unassigned ? ` ${plural(unassigned, "booking")} still ${unassigned === 1 ? "needs" : "need"} someone.` : ""}`,
    chips: [{ kind: "link", label: "Open diary", href: "/week" }],
  };
}

export function needsOrdering(ctx: Ctx): Answer {
  if (!can(ctx.role, "records.read")) return { text: "Your account can't see the order lists." };
  const today = todayKey();
  const end = addDays(weekStart(today), 6);
  const jobs = new Map(listJobs(ctx).map((j) => [j.id, j]));
  const toOrder = listMaterials(ctx).filter((m) => m.status === "to_order");
  const week = toOrder.filter((m) => !m.neededBy || m.neededBy <= end);
  if (!toOrder.length) return { text: "Nothing is waiting to be ordered.", chips: [{ kind: "link", label: "Open materials", href: "/materials" }] };
  const list = (week.length ? week : toOrder).slice(0, 6).map((m) => `${m.quantity} × ${m.item} for ${jobs.get(m.jobId)?.title ?? "a job"}${m.neededBy ? ` (needed ${formatDayLong(m.neededBy).replace(/ \w+$/, "")})` : ""}${m.supplier ? ` from ${m.supplier}` : ""}`);
  void weekday;
  return {
    text: week.length
      ? `${plural(week.length, "item")} still to order this week: ${list.join("; ")}.${toOrder.length > week.length ? ` ${toOrder.length - week.length} more needed later.` : ""}`
      : `Nothing needed this week. Later: ${list.join("; ")}.`,
    chips: [{ kind: "link", label: "Open materials", href: "/materials" }],
  };
}

/* ------------------------------ Double bookings ------------------------------ */

export const DOUBLE_BOOKED = /\b(double[- ]?book\w*|overbook\w*)\b|\b(any|are there|check( for)?|got)\b[^?]*\b(clash\w*|conflicts?)\b/i;

export type DoubleBooking = { person: string; date: string; first: { bookingId: string; job: string; time: string }; second: { bookingId: string; job: string; time: string } };

/** Every person booked on two overlapping visits, day by day, between two dates. */
export function findDoubleBookings(ctx: Ctx, from: string, to: string): DoubleBooking[] {
  if (!can(ctx.role, "schedule.read")) return [];
  const jobs = new Map(listJobs(ctx).map((j) => [j.id, j]));
  const people = listPeople(ctx).filter((p) => !p.archivedAt);
  const bookings = listBookings(ctx).filter((b) => b.date <= to && (b.endDate ?? b.date) >= from);
  const out: DoubleBooking[] = [];
  const label = (id: string) => {
    const j = jobs.get(id);
    return j ? `${j.title} for ${j.customerName}` : "a job";
  };
  for (const p of people) {
    const mine = bookings.filter((b) => b.personIds.includes(p.id));
    for (let i = 0; i < mine.length; i++)
      for (let k = i + 1; k < mine.length; k++) {
        const [a, b] = [mine[i], mine[k]];
        if (!bookingsOverlap(a, b)) continue;
        const start = [a.date, b.date, from].sort().at(-1)!;
        out.push({
          person: p.name,
          date: start,
          first: { bookingId: a.id, job: label(a.jobId), time: formatTimeRange(a.startTime, a.endTime) },
          second: { bookingId: b.id, job: label(b.jobId), time: formatTimeRange(b.startTime, b.endTime) },
        });
      }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

function whichRange(lower: string): { from: string; to: string; label: string } {
  const today = todayKey();
  if (/\bnext week\b/.test(lower)) {
    const s = addDays(weekStart(today), 7);
    return { from: s, to: addDays(s, 6), label: "next week" };
  }
  if (/\btomorrow\b/.test(lower)) return { from: addDays(today, 1), to: addDays(today, 1), label: "tomorrow" };
  if (/\btoday\b/.test(lower)) return { from: today, to: today, label: "today" };
  if (/\b(next|coming) (two|2) weeks\b|\bfortnight\b/.test(lower)) return { from: today, to: addDays(today, 13), label: "in the next two weeks" };
  return { from: weekStart(today), to: addDays(weekStart(today), 6), label: "this week" };
}

export function doubleBookings(ctx: Ctx, lower: string): Answer {
  if (!can(ctx.role, "schedule.read")) return { text: "Your account can't see the company schedule." };
  const { from, to, label } = whichRange(lower);
  const list = findDoubleBookings(ctx, from, to);
  if (!list.length) return { text: `No one is double-booked ${label}.`, chips: [{ kind: "link", label: "Open team view", href: `/week?view=team&w=${from}` }] };
  const lines = list.slice(0, 5).map((d) => `${d.person} on ${formatDayLong(d.date)}: ${d.first.job} (${d.first.time}) and ${d.second.job} (${d.second.time})`);
  return {
    text: `Yes, ${plural(list.length, "clash", "clashes")} ${label}. ${lines.join(". ")}.${list.length > 5 ? ` And ${list.length - 5} more.` : ""} Tell me who to move and I'll prepare the change for you to approve.`,
    chips: [{ kind: "link", label: "Open team view", href: `/week?view=team&w=${from}` }],
  };
}
