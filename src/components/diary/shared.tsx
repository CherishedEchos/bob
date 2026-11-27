"use client";

/**
 * Pieces shared by the diary views: the booking block, leave block, the
 * move/reassign flow (with the clash check before anything is saved), the
 * date picker and the view switch.
 */
import * as React from "react";
import { AlertTriangle, CalendarDays, CalendarOff, ChevronLeft, ChevronRight, Mic } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { ABSENCE_LABEL, PART_LABEL } from "@/lib/leave";
import { useStore } from "@/lib/store/store";
import { addDays, daysBetween, formatDayShort, formatTimeRange, weekStart } from "@/lib/dates";
import { bookingDays } from "@/lib/schedule";
import { jobTown, monthWeeks, type DiaryView, DIARY_VIEWS } from "@/lib/diary";
import type { Absence, Booking, Job, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PeopleStack, jobTone } from "@/components/common/people";
import { Sheet, DialogContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

export const firstName = (n?: string) => (n ?? "").split(" ")[0] || "Someone";
export const dow = (d: string, style: "short" | "narrow" | "long" = "short") => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: style });
export const dayNum = (d: string) => Number(d.slice(8));

/* --------------------------------- Blocks --------------------------------- */

export function BookingBlock({
  booking: b,
  job,
  people,
  compact,
  conflict,
  continuesBefore,
  continuesAfter,
  draggable,
  dimmed,
  onOpen,
  onDragStart,
  onDragEnd,
  className,
}: {
  booking: Booking;
  job?: Job;
  people: Map<string, Person>;
  /** Team view: one person per row, so no avatars. */
  compact?: boolean;
  conflict?: string;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  draggable?: boolean;
  dimmed?: boolean;
  onOpen: () => void;
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  className?: string;
}) {
  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const tone = jobTone(b.jobId);
  const town = jobTown(job);
  const days = bookingDays(b);
  const time = formatTimeRange(b.startTime, b.endTime);
  const unassigned = !who.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={`${job?.title ?? "Job"}, ${job?.customerName ?? ""}, ${town}, ${time}${days.length > 1 ? `, ${formatDayShort(days[0])} to ${formatDayShort(days.at(-1)!)}` : ""}, ${unassigned ? "nobody assigned" : who.map((p) => p.name).join(", ")}${conflict ? `. Clash: ${conflict}` : ""}`}
      title={conflict ? `Clash: ${conflict}` : undefined}
      className={cn(
        "@container group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-md text-left ring-1 transition-[box-shadow,opacity] duration-100 hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-copper-500",
        unassigned ? "bg-[#fffbf2] ring-warning/50 [background-image:repeating-linear-gradient(135deg,transparent_0_7px,rgb(209_138_28/0.06)_7px_14px)]" : tone.card,
        conflict && "ring-2 ring-destructive/70",
        continuesBefore && "rounded-l-none",
        continuesAfter && "rounded-r-none",
        compact ? "px-2.5 py-1.5" : "px-3 py-2.5",
        draggable && "cursor-grab active:cursor-grabbing",
        dimmed && "opacity-40",
        className,
      )}
    >
      {continuesBefore ? null : <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", unassigned ? "bg-warning" : tone.bar)} />}
      <span className="flex min-w-0 items-start gap-1.5">
        <span className={cn("min-w-0 flex-1 truncate font-semibold leading-tight", compact ? "text-[13.5px]" : "text-[14.5px]", unassigned ? "text-[#7a5410]" : tone.text)}>{job?.title ?? "Job"}</span>
        {conflict ? <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-destructive" /> : null}
      </span>
      <span className={cn("mt-0.5 truncate leading-tight text-foreground/75", compact ? "text-[12.5px]" : "text-[13px]")}>
        {compact ? (
          <>
            <span className="tabular">{time}</span>
            {town ? ` · ${town}` : ""}
          </>
        ) : (
          <>
            {job?.customerName ?? ""}
            {town ? ` · ${town}` : ""}
          </>
        )}
      </span>
      {compact ? null : (
        <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
          {unassigned ? (
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-[#8a5c0a]">Needs someone</span>
          ) : (
            <>
              <PeopleStack people={who} size={20} max={3} />
              <span className="min-w-0 truncate text-[12.5px] text-foreground/75 @max-[160px]:hidden">{who.map((p) => firstName(p.name)).join(", ")}</span>
            </>
          )}
          <span className="tabular ml-auto shrink-0 pl-1 text-[12.5px] font-semibold text-foreground/70 @max-[130px]:hidden">{time}</span>
        </span>
      )}
    </button>
  );
}

export function absenceText(a: Absence, people: Map<string, Person>, withName = true) {
  const name = people.get(a.personId)?.name;
  const kind = a.kind === "unavailable" ? "Unavailable" : ABSENCE_LABEL[a.kind];
  return `${withName ? `${firstName(name)} · ` : ""}${kind}${a.part ? ` (${PART_LABEL[a.part].toLowerCase()})` : ""}${a.status === "pending" ? " — pending" : ""}`;
}

/** Holiday / unavailable: violet, hatched; pending requests dashed. */
export function LeaveBlock({ absence: a, people, withName = true, className, continuesBefore, continuesAfter }: { absence: Absence; people: Map<string, Person>; withName?: boolean; className?: string; continuesBefore?: boolean; continuesAfter?: boolean }) {
  const pending = a.status === "pending";
  return (
    <div
      title={`${people.get(a.personId)?.name ?? "Someone"}: ${absenceText(a, people, false)}`}
      className={cn(
        "flex h-full min-w-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium",
        pending ? "border border-dashed border-violet-300 bg-white text-violet-700" : "bg-violet-50 text-violet-800 ring-1 ring-violet-200 [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(124_58_237/0.06)_6px_12px)]",
        continuesBefore && "rounded-l-none",
        continuesAfter && "rounded-r-none",
        className,
      )}
    >
      <CalendarOff aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{absenceText(a, people, withName)}</span>
    </div>
  );
}

/* ------------------------- Move / reassign with clash check ------------------------- */

type Clash = { kind?: "booking" | "absence"; personName: string; jobTitle: string; when: string };
type Pending = { input: Record<string, unknown>; clashes: Clash[]; done: string };

/**
 * Moves and reassignments go through the same save as the booking form. If the
 * server finds a clash, nothing is saved: the planner sees who clashes and
 * chooses to go ahead or leave it.
 */
export function useBookingMover() {
  const { data, actions } = useStore();
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);

  const save = async (input: Record<string, unknown>, done: string, confirm = false) => {
    setBusy(true);
    const res = await actions.run("saveBooking", { input: { ...input, confirmOverlap: confirm } });
    setBusy(false);
    if (res.ok) {
      setPending(null);
      toast(done);
      return true;
    }
    if (res.clashes?.length) {
      setPending({ input, clashes: res.clashes, done });
      return false;
    }
    toast(res.errors._ || res.errors.date || "Couldn't change it — nothing was changed", "error");
    return false;
  };

  /** Shift a booking by whole days and/or swap one person for another (or add/remove). */
  const move = (bookingId: string, opts: { shift?: number; from?: string | null; to?: string | null }) => {
    const b = data.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    const shift = opts.shift ?? 0;
    let personIds = b.personIds;
    const name = (id: string) => firstName(data.people.find((p) => p.id === id)?.name);
    let what = "";
    if (opts.to !== undefined && opts.to !== opts.from) {
      if (opts.to === null) {
        personIds = personIds.filter((p) => p !== opts.from);
        what = `${name(opts.from!)} taken off`;
      } else if (opts.from) {
        personIds = Array.from(new Set(personIds.map((p) => (p === opts.from ? opts.to! : p))));
        what = `${name(opts.to)} instead of ${name(opts.from)}`;
      } else {
        personIds = Array.from(new Set([...personIds, opts.to]));
        what = `${name(opts.to)} assigned`;
      }
    }
    if (!shift && personIds === b.personIds) return;
    const job = data.jobs.find((j) => j.id === b.jobId);
    const date = addDays(b.date, shift);
    const done = [job?.title ?? "Booking", shift ? `moved to ${formatDayShort(date)}` : "", what].filter(Boolean).join(" — ");
    void save(
      { id: b.id, jobId: b.jobId, date, endDate: b.endDate ? addDays(b.endDate, shift) : "", allDay: !b.startTime, startTime: b.startTime ?? "", endTime: b.endTime ?? "", personIds, notes: b.notes ?? "" },
      done,
    );
  };

  const dialog = (
    <Sheet open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
      {pending ? (
        <DialogContent title="That would double-book someone" description="Nothing has been changed yet.">
          <ul className="space-y-2">
            {pending.clashes.map((c, i) => (
              <li key={i} className="flex gap-2.5 rounded-lg bg-destructive/[0.06] px-3 py-2.5 text-[14px] ring-1 ring-destructive/20">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>
                  <strong className="font-semibold">{c.personName}</strong> {c.kind === "absence" ? `is on ${c.jobTitle}` : `is already on ${c.jobTitle}`} <span className="text-subtle">({c.when})</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Leave it as it was
            </Button>
            <Button disabled={busy} onClick={() => void save(pending.input, `${pending.done} (overlap confirmed)`, true)}>
              Book anyway
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Sheet>
  );
  return { move, dialog };
}

/** Which day of a multi-day block the pointer grabbed (so the drop keeps that day under the pointer). */
export function grabbedDay(e: React.DragEvent<HTMLElement>, startDay: string, span: number) {
  const r = e.currentTarget.getBoundingClientRect();
  const idx = Math.min(span - 1, Math.max(0, Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * span)));
  return addDays(startDay, idx);
}

export const shiftBetween = (from: string, to: string) => daysBetween(from, to);

/* -------------------------------- View switch -------------------------------- */

export function ViewSwitch({ value, onChange }: { value: DiaryView; onChange: (v: DiaryView) => void }) {
  return (
    <div role="radiogroup" aria-label="Diary view" className="flex h-11 items-center rounded-lg bg-[#efeae2] p-1">
      {DIARY_VIEWS.map((v) => (
        <button
          key={v.value}
          type="button"
          role="radio"
          aria-checked={value === v.value}
          onClick={() => onChange(v.value)}
          className={cn(
            "h-9 rounded-md px-4 text-[15px] font-medium transition-colors",
            value === v.value ? "bg-card text-heading shadow-[0_1px_2px_rgb(17_17_17/0.08),0_0_0_1px_rgb(17_17_17/0.04)]" : "text-muted-foreground hover:text-heading",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- Date picker -------------------------------- */

const monthTitle = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** A proper month-grid date picker in a popover; picks a day (the diary shows its week or month). */
export function DatePicker({ value, today, label, mode, onPick }: { value: string; today: string; label: string; mode: DiaryView; onPick: (d: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(value);
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setCursor(value), [value, open]);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const shiftMonth = (n: number) => {
    const d = new Date(`${cursor.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setCursor(d.toISOString().slice(0, 10));
  };
  const weeks = monthWeeks(cursor);
  const selWeek = weekStart(value);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-[15.5px] font-semibold tracking-[-0.01em] text-heading transition-colors hover:bg-surface-3 sm:gap-2 sm:px-3 sm:text-[17px]"
      >
        <CalendarDays aria-hidden className="size-[18px] text-subtle" />
        <span className="tabular" aria-live="polite">
          {label}
        </span>
      </button>
      {open ? (
        <div role="dialog" aria-label="Choose a date" className="absolute left-0 top-full z-40 mt-1.5 w-[296px] rounded-lg border border-line-strong bg-popover p-3 shadow-[var(--shadow-lg)]">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-3">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-[14px] font-semibold text-heading">{monthTitle(cursor)}</span>
            <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-3">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11.5px] font-medium text-subtle">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="py-1">
                {d}
              </span>
            ))}
          </div>
          {weeks.map((w) => {
            const inSel = mode !== "month" && w[0] === selWeek;
            return (
              <div key={w[0]} className={cn("grid grid-cols-7 rounded-md", inSel && "bg-copper-500/10")}>
                {w.map((d) => {
                  const other = d.slice(0, 7) !== cursor.slice(0, 7);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        onPick(d);
                        setOpen(false);
                      }}
                      aria-label={new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                      aria-current={d === today ? "date" : undefined}
                      className={cn(
                        "tabular m-0.5 grid h-8 place-items-center rounded-md text-[13px] transition-colors hover:bg-surface-3",
                        other ? "text-subtle/60" : "text-foreground",
                        d === today && "font-semibold text-copper-600",
                        d === value && "bg-copper-500 font-semibold text-white hover:bg-copper-600",
                      )}
                    >
                      {dayNum(d)}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="mt-2 flex justify-between border-t border-line pt-2">
            <button type="button" onClick={() => { onPick(today); setOpen(false); }} className="h-8 rounded-md px-2 text-[13px] font-medium text-accent-fg hover:bg-copper-500/10">
              Today
            </button>
            <button type="button" onClick={() => { onPick(addDays(today, 7)); setOpen(false); }} className="h-8 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-surface-3">
              Next week
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function useJobsAndPeople() {
  const { data } = useStore();
  const jobs = React.useMemo(() => new Map(data.jobs.map((j) => [j.id, j])), [data.jobs]);
  const people = React.useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  return { jobs, people };
}

export { PeopleStack };

/* ------------------------------ Ask Bob from the diary ------------------------------ */

const DIARY_PROMPTS = ["Who's free next Wednesday?", "Have I double-booked anyone this week?", "Where is everyone working tomorrow?"];

/**
 * The diary can be run by talking to Bob: a dark strip with Bob's microphone and
 * a few things to try. A tap asks Bob there and then; changes still come back as
 * previews to approve, with the usual clash checks.
 */
export function AskBobDiaryBar({ compact }: { compact?: boolean }) {
  const ui = useUI();
  const bob = useBob();
  const router = useRouter();
  const ask = (text: string) => {
    ui.setAssistantOpen(true);
    void bob.send(text, "text");
  };
  const talk = () => {
    if (compact) router.push("/assistant?listen=1");
    else ui.setAssistantOpen(true);
  };
  return (
    <section aria-label="Ask Bob about the diary" className={cn("flex items-center gap-3 rounded-xl bg-[#1d1b19] text-white", compact ? "px-3 py-2.5" : "px-4 py-3")}>
      <button type="button" onClick={talk} aria-label="Ask Bob — tap to talk" className="grid size-10 shrink-0 place-items-center rounded-full bg-copper-500 shadow-[0_0_0_4px_rgb(243_135_53/0.18)] transition hover:bg-copper-600">
        <Mic className="size-5" strokeWidth={2.2} aria-hidden />
      </button>
      <div className="min-w-0 flex-1 xl:min-w-[300px]">
        <p className="text-[15.5px] font-semibold leading-tight">{compact ? "Ask Bob about the diary" : "Talk to Bob about the diary"}</p>
        <p className="truncate text-[13.5px] text-white/60">{compact ? "“Move Liam onto the Copthorne kitchen tomorrow”" : "“Move Liam onto the Copthorne kitchen tomorrow” · “Book Ryan in for a site visit on Friday”"}</p>
      </div>
      {compact ? null : (
        <div className="hidden shrink-0 flex-wrap justify-end gap-2 xl:flex">
          {DIARY_PROMPTS.map((t, i) => (
            <button key={t} type="button" onClick={() => ask(t)} className={cn("h-9 rounded-full bg-white/[0.08] px-3.5 text-[14px] font-medium text-white/90 ring-1 ring-white/10 transition hover:bg-white/[0.14]", i === 2 && "hidden 2xl:block")}>
              {t}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
