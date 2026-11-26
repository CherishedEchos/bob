"use client";

/**
 * Pieces shared by the Diary's Week, Month and Team views: the move/reassign
 * flow (with clash checks before anything is saved), preferences and the
 * small building blocks (leave chips, people names).
 */
import * as React from "react";
import { CalendarOff } from "lucide-react";
import { ABSENCE_LABEL, PART_LABEL } from "@/lib/leave";
import { addDays, daysBetween, formatDayShort, timeToMinutes } from "@/lib/dates";
import { bookingEndDate } from "@/lib/schedule";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { Absence, Booking, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";

export type DiaryView = "week" | "month" | "team";

/* ------------------------------ Preferences ------------------------------ */

/** Per user and per device: the preferred view and whether weekends show. */
export function useDiaryPrefs(userId: string) {
  const key = (k: string) => `bob.diary.${k}.${userId}`;
  const [view, setViewState] = React.useState<DiaryView>("week");
  const [weekends, setWeekendsState] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(key("view"));
      if (v === "week" || v === "month" || v === "team") setViewState(v);
      setWeekendsState(localStorage.getItem(key("weekends")) === "1");
    } catch {
      /* private mode */
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per user
  }, [userId]);
  const save = (k: string, v: string) => {
    try {
      localStorage.setItem(key(k), v);
    } catch {
      /* private mode */
    }
  };
  return {
    view,
    weekends,
    ready,
    setView: (v: DiaryView) => {
      setViewState(v);
      save("view", v);
    },
    setWeekends: (w: boolean) => {
      setWeekendsState(w);
      save("weekends", w ? "1" : "0");
    },
  };
}

/* ------------------------------ Clash helpers ------------------------------ */

/** Same rule as the server: days overlap and hours overlap (all day overlaps everything). */
export function bookingsOverlap(a: Booking, b: Booking): boolean {
  if (bookingEndDate(a) < b.date || bookingEndDate(b) < a.date) return false;
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return true;
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}

/** Booking ids that double-book someone on `day` (for the Team view's warning). */
export function doubleBookedOn(list: Booking[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (bookingsOverlap(list[i], list[j])) {
        out.add(list[i].id);
        out.add(list[j].id);
      }
  return out;
}

/* ------------------------------ Move / reassign ------------------------------ */

type Clash = { kind?: "booking" | "absence"; personId: string; personName: string; jobTitle: string; when: string };
type Pending = { booking: Booking; next: Booking; summary: string; clashes: Clash[] };

export interface MoveRequest {
  bookingId: string;
  /** The day the booking was picked up from (for multi-day bookings, the day under the pointer). */
  fromDay: string;
  toDay: string;
  /** Team view: the row it came from and the row it was dropped on. */
  fromPersonId?: string | null;
  toPersonId?: string | null;
}

/**
 * Moving and reassigning from the planner. The change is checked on the server
 * first; if it would double-book someone or clash with their leave, nothing is
 * saved until the planner confirms in a dialog that lists the clashes.
 */
export function useBookingMover() {
  const { data, actions } = useStore();
  const ui = useUI();
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  const people = React.useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const jobs = React.useMemo(() => new Map(data.jobs.map((j) => [j.id, j])), [data.jobs]);

  const save = async (next: Booking, confirmOverlap: boolean) =>
    actions.run("saveBooking", {
      input: {
        id: next.id,
        jobId: next.jobId,
        date: next.date,
        endDate: next.endDate ?? "",
        allDay: !next.startTime,
        startTime: next.startTime ?? "",
        endTime: next.endTime ?? "",
        personIds: next.personIds,
        notes: next.notes ?? "",
        ...(confirmOverlap ? { confirmOverlap: true } : {}),
      },
    });

  const describe = (b: Booking, next: Booking, req: MoveRequest) => {
    const job = jobs.get(b.jobId)?.title ?? "Booking";
    const moved = next.date !== b.date;
    const toName = req.toPersonId ? people.get(req.toPersonId)?.name : undefined;
    const reassigned = req.toPersonId !== undefined && req.toPersonId !== req.fromPersonId && toName;
    if (moved && reassigned) return `${job}: ${toName}, ${formatDayShort(req.toDay)}`;
    if (reassigned) return `${job} given to ${toName}`;
    return `${job} moved to ${formatDayShort(next.date)}`;
  };

  const request = async (req: MoveRequest) => {
    const b = data.bookings.find((x) => x.id === req.bookingId);
    if (!b) return;
    const shift = daysBetween(req.fromDay, req.toDay);
    let personIds = b.personIds;
    if (req.toPersonId !== undefined && req.toPersonId !== req.fromPersonId) {
      if (req.toPersonId === null) personIds = b.personIds.filter((id) => id !== req.fromPersonId);
      else personIds = [...new Set([...b.personIds.filter((id) => id !== req.fromPersonId), req.toPersonId])];
    }
    if (!shift && personIds.join() === b.personIds.join()) return;
    const next: Booking = { ...b, date: addDays(b.date, shift), endDate: b.endDate ? addDays(b.endDate, shift) : undefined, personIds };
    const summary = describe(b, next, req);
    const res = await save(next, false);
    if (res.ok) return toast(summary, "success");
    if (res.clashes?.length) return setPending({ booking: b, next, summary, clashes: res.clashes });
    toast(res.errors._ || "Couldn't move it. Nothing was changed.", "error");
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    const res = await save(pending.next, true);
    setBusy(false);
    setPending(null);
    if (res.ok) toast(`${pending.summary} (overlap confirmed)`, "success");
    else toast(res.errors._ || "Couldn't save it. Nothing was changed.", "error");
  };

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
      {pending ? (
        <DialogContent title="Check this change" description={`${pending.summary}. This would clash:`}>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {pending.clashes.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5 px-3 py-2.5 text-[14px]">
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", c.kind === "absence" ? "bg-violet-500" : "bg-destructive")} />
                <span>
                  <span className="font-semibold text-heading">{c.personName}</span>{" "}
                  {c.kind === "absence" ? <>is on {c.jobTitle}</> : <>is already on {c.jobTitle}</>}
                  <span className="block text-[13px] text-subtle">{c.when}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const id = pending.booking.id;
                setPending(null);
                ui.openForm({ form: "booking", bookingId: id });
              }}
            >
              Open booking
            </Button>
            <Button onClick={() => void confirm()} disabled={busy}>
              {busy ? "Saving…" : "Save anyway"}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );

  return { request, dialog };
}

/* ------------------------------ Drag data ------------------------------ */

export const DRAG_TYPE = "text/x-bob-booking";
export type DragPayload = { bookingId: string; fromDay: string; fromPersonId?: string | null };

export function setDragData(e: React.DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
  e.dataTransfer.setData("text/plain", payload.bookingId);
  e.dataTransfer.effectAllowed = "move";
}

export function readDragData(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

/* ------------------------------ Small pieces ------------------------------ */

export const firstName = (p?: Pick<Person, "name">) => (p ? p.name.replace(/^the\s+/i, "").split(/\s+/)[0] : "");

/** "Liam, Callum" / "Liam, Callum +2". */
export function namesLine(list: Person[], max = 2) {
  if (!list.length) return "";
  const shown = list.slice(0, max).map(firstName).join(", ");
  return list.length > max ? `${shown} +${list.length - max}` : shown;
}

export function leaveLabel(a: Absence) {
  return `${a.kind === "unavailable" ? "Unavailable" : ABSENCE_LABEL[a.kind]}${a.part ? ` (${PART_LABEL[a.part].toLowerCase()})` : ""}${a.status === "pending" ? ", pending" : ""}`;
}

/** Who's off. Approved: solid violet; pending requests: dashed and labelled. */
export function LeaveChip({ absence: a, person, className }: { absence: Absence; person?: Person; className?: string }) {
  const pending = a.status === "pending";
  return (
    <span
      title={`${person?.name ?? "Someone"}: ${leaveLabel(a)}`}
      className={cn(
        "inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 text-[12px] font-medium",
        pending ? "border border-dashed border-violet-300 text-violet-700" : "bg-violet-500/[0.09] text-violet-800",
        className,
      )}
    >
      <CalendarOff className="size-3 shrink-0" aria-hidden />
      <span className="truncate">
        {firstName(person) || "Someone"} · {a.kind === "unavailable" ? "Unavailable" : ABSENCE_LABEL[a.kind]}
        {a.part ? ` ${a.part.toUpperCase()}` : ""}
        {pending ? " (pending)" : ""}
      </span>
    </span>
  );
}
