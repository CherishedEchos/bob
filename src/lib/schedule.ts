/**
 * Schedule helpers shared by This week, Jobs, Team and the job profile.
 * Pure functions over the snapshot (no storage, no React).
 */
import type { Booking, Job, Person, Snapshot } from "@/lib/types";
import { isActiveJob } from "@/lib/derive";
import { rangeKeys } from "@/lib/dates";

export const bookingEndDate = (b: Pick<Booking, "date" | "endDate">) => b.endDate ?? b.date;
export const bookingDays = (b: Pick<Booking, "date" | "endDate">) => rangeKeys(b.date, bookingEndDate(b));
export const coversDay = (b: Pick<Booking, "date" | "endDate">, day: string) => b.date <= day && bookingEndDate(b) >= day;

export function bookingsOnDay(bookings: Booking[], day: string): Booking[] {
  return bookings.filter((b) => coversDay(b, day)).sort((a, b) => (a.startTime ?? "00:00").localeCompare(b.startTime ?? "00:00"));
}

/** Active jobs with nothing booked from today on — the "ready to schedule" pile. */
export function jobsToSchedule(data: Pick<Snapshot, "jobs" | "bookings">, today: string): Job[] {
  return data.jobs.filter((j) => isActiveJob(j) && !data.bookings.some((b) => b.jobId === j.id && bookingEndDate(b) >= today));
}

/** Booked work from today on with nobody assigned. */
export function bookingsNeedingPeople(bookings: Booking[], today: string): Booking[] {
  return bookings.filter((b) => !b.personIds.length && bookingEndDate(b) >= today).sort((a, b) => a.date.localeCompare(b.date));
}

export function nextBookingForJob(bookings: Booking[], jobId: string, today: string): Booking | undefined {
  return bookings.filter((b) => b.jobId === jobId && bookingEndDate(b) >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
}

export function peopleOnJob(bookings: Booking[], people: Person[], jobId: string, today: string): Person[] {
  const ids = new Set(bookings.filter((b) => b.jobId === jobId && bookingEndDate(b) >= today).flatMap((b) => b.personIds));
  return people.filter((p) => ids.has(p.id));
}

/** Where a job is, in planner terms. Keeps the job's own status where it says more. */
export type JobStage = "ready" | "booked" | "in_progress" | "snagging" | "awaiting_deposit" | "complete" | "lost";
export const JOB_STAGE_LABEL: Record<JobStage, string> = {
  ready: "Unscheduled",
  booked: "Booked",
  in_progress: "In progress",
  snagging: "Snagging",
  awaiting_deposit: "Awaiting deposit",
  complete: "Complete",
  lost: "Lost",
};
export function jobStage(job: Job, bookings: Booking[], today: string): JobStage {
  if (job.status === "completed") return "complete";
  if (job.status === "lost") return "lost";
  if (job.status === "in_progress") return "in_progress";
  if (job.status === "snagging") return "snagging";
  if (nextBookingForJob(bookings, job.id, today)) return "booked";
  if (job.status === "awaiting_deposit") return "awaiting_deposit";
  return "ready";
}

export const initials = (name: string) =>
  name
    .replace(/^the\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
