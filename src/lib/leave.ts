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
