import { describe, expect, it } from "vitest";
import { availability, diarySummary, findConflicts, jobTown, layoutSegments, monthWeeks, weekDays } from "@/lib/diary";
import type { Absence, Booking, Job } from "@/lib/types";

const bk = (id: string, date: string, endDate: string | undefined, times: [string, string] | null, personIds: string[], jobId = "j1"): Booking => ({
  id,
  jobId,
  date,
  endDate,
  startTime: times?.[0],
  endTime: times?.[1],
  personIds,
  createdAt: "",
  updatedAt: "",
  createdBy: "",
});
const abs = (id: string, personId: string, startDate: string, endDate: string, extra: Partial<Absence> = {}): Absence => ({
  id,
  personId,
  kind: "holiday",
  startDate,
  endDate,
  status: "approved",
  requestedBy: "",
  createdAt: "",
  updatedAt: "",
  ...extra,
});

describe("diary layout", () => {
  it("weeks start on Monday and can hide weekends", () => {
    expect(weekDays("2026-11-26", true)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(weekDays("2026-11-28", false)).toHaveLength(5);
  });

  it("a month grid covers the whole month in Monday-start weeks", () => {
    const w = monthWeeks("2026-11-15");
    expect(w[0][0]).toBe("2026-10-26");
    expect(w.at(-1)!.includes("2026-11-30")).toBe(true);
    expect(w.every((x) => x.length === 7)).toBe(true);
  });

  it("multi-day bookings become one block, packed into the fewest lanes", () => {
    const days = weekDays("2026-11-23", true);
    const items = [bk("a", "2026-11-23", "2026-11-25", null, ["p1"]), bk("b", "2026-11-26", undefined, null, ["p1"]), bk("c", "2026-11-24", undefined, null, ["p2"])];
    const { segments, lanes } = layoutSegments(items, days, (b) => [b.date, b.endDate ?? b.date]);
    const a = segments.find((s) => s.item.id === "a")!;
    expect([a.col, a.span, a.lane]).toEqual([0, 3, 0]);
    expect(segments.find((s) => s.item.id === "b")!.lane).toBe(0); // reuses the free lane
    expect(segments.find((s) => s.item.id === "c")!.lane).toBe(1);
    expect(lanes).toBe(2);
  });

  it("hidden weekends split a booking and mark where it carries on", () => {
    const days = weekDays("2026-11-23", false);
    const { segments } = layoutSegments([bk("a", "2026-11-26", "2026-12-01", null, [])], days, (b) => [b.date, b.endDate ?? b.date]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ col: 3, span: 2, continuesAfter: true, continuesBefore: false });
  });
});

describe("clashes and availability", () => {
  const bookings = [
    bk("tops", "2026-11-26", undefined, ["08:00", "13:00"], ["liam"]),
    bk("island", "2026-11-26", "2026-11-27", ["08:30", "16:30"], ["liam"]),
    bk("later", "2026-11-26", undefined, ["13:00", "15:00"], ["ellie"]),
    bk("plaster", "2026-11-27", undefined, ["08:00", "17:00"], ["sam"]),
  ];

  it("finds a double booking once per person and day", () => {
    const c = findConflicts(bookings, [], "2026-11-23", "2026-11-29");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ personId: "liam", day: "2026-11-26", kind: "double" });
  });

  it("back-to-back bookings don't clash", () => {
    const c = findConflicts([bk("a", "2026-11-26", undefined, ["08:00", "12:00"], ["x"]), bk("b", "2026-11-26", undefined, ["12:00", "16:00"], ["x"])], [], "2026-11-26", "2026-11-26");
    expect(c).toHaveLength(0);
  });

  it("approved leave clashes with work; a morning off doesn't clash with afternoon work; pending leave isn't a clash", () => {
    expect(findConflicts(bookings, [abs("x", "sam", "2026-11-27", "2026-11-27")], "2026-11-27", "2026-11-27")).toMatchObject([{ personId: "sam", kind: "absence" }]);
    expect(findConflicts(bookings, [abs("x", "ellie", "2026-11-26", "2026-11-26", { part: "am" })], "2026-11-26", "2026-11-26").filter((c) => c.personId === "ellie")).toHaveLength(0);
    expect(findConflicts(bookings, [abs("x", "sam", "2026-11-27", "2026-11-27", { status: "pending" })], "2026-11-27", "2026-11-27").filter((c) => c.personId === "sam")).toHaveLength(0);
  });

  it("knows who's free, for which half of the day", () => {
    expect(availability("ellie", "2026-11-26", bookings, [])).toBe("free_am");
    expect(availability("liam", "2026-11-26", bookings, [])).toBe("busy");
    expect(availability("priya", "2026-11-26", bookings, [])).toBe("free");
    expect(availability("priya", "2026-11-26", bookings, [abs("x", "priya", "2026-11-26", "2026-11-26")])).toBe("off");
  });

  it("summarises the week in diary terms", () => {
    const jobs = new Map<string, Job>([["j1", { id: "j1", siteAddress: "1 Mill Lane, Copthorne" } as Job]]);
    const s = diarySummary([...bookings, bk("u", "2026-11-25", undefined, null, [], "j2")], [abs("x", "mark", "2026-11-26", "2026-11-27")], jobs, "2026-11-23", "2026-11-29");
    expect(s).toEqual({ sites: 2, scheduled: 3, off: 1, unassigned: 1, conflicts: 1 });
  });

  it("finds the town for a booking card", () => {
    expect(jobTown({ location: "Copthorne", siteAddress: "" })).toBe("Copthorne");
    expect(jobTown({ location: "", siteAddress: "12 Mill Lane, Copthorne, RH10 3HQ" })).toBe("Copthorne");
    expect(jobTown({ location: "Horsham, RH12 1JE" })).toBe("Horsham");
  });
});
