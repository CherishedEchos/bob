"use client";

/**
 * Holidays & availability: requests to approve, upcoming leave, and a form to
 * record or request leave. Dates are plain date keys (no time zones).
 */
import * as React from "react";
import { AlertTriangle, CalendarOff, Check, History, Info, Plane, Plus, X } from "lucide-react";
import type { Absence, Person } from "@/lib/types";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { ABSENCE_LABEL, PART_LABEL, bookedDaysInRange, lastMonthRange, leaveDays, leaveDaysInRange, overlapsRange, thisMonthRange } from "@/lib/leave";
import { addDays, formatTimeRange } from "@/lib/dates";
import { formatDayShort } from "@/lib/dates";
import { cn, todayKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/sheet";
import { StatusText } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";

type Affected = { bookingId: string; jobId: string; jobTitle: string; date: string };

export const absenceRange = (a: Pick<Absence, "startDate" | "endDate" | "part">) =>
  `${formatDayShort(a.startDate)}${a.endDate !== a.startDate ? ` – ${formatDayShort(a.endDate)}` : ""}${a.part ? ` · ${PART_LABEL[a.part]}` : ""}`;

const STATUS: Record<Absence["status"], { label: string; tone: "amber" | "green" | "neutral" | "red" }> = {
  pending: { label: "Waiting for approval", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  declined: { label: "Declined", tone: "red" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function HolidaysView() {
  const { data, can, actions, org } = useStore();
  const [adding, setAdding] = React.useState(false);
  const [affected, setAffected] = React.useState<{ name: string; list: Affected[] } | null>(null);
  const today = todayKey();
  const people = new Map(data.people.map((p) => [p.id, p]));
  const manage = can("team.manage");
  const pending = data.absences.filter((a) => a.status === "pending").sort((a, b) => a.startDate.localeCompare(b.startDate));
  const upcoming = data.absences.filter((a) => a.status === "approved" && a.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const selfApprove = org.leavePolicy?.managersSelfApprove ?? true;

  const decide = async (a: Absence, decision: "approve" | "decline") => {
    const r = await actions.run<Absence & { affected: Affected[] }>("decideAbsence", { id: a.id, decision });
    if (!r.ok) return toast(r.errors._ || "Couldn't update", "error");
    toast(decision === "approve" ? `Approved — ${people.get(a.personId)?.name ?? "their"} leave is on the diary` : "Declined", "success");
    if (r.value.affected?.length) setAffected({ name: people.get(a.personId)?.name ?? "They", list: r.value.affected });
  };
  const cancel = async (a: Absence) => {
    const r = await actions.run("cancelAbsence", { id: a.id });
    toast(r.ok ? "Leave cancelled — removed from the diary" : r.errors._ || "Couldn't cancel", r.ok ? "success" : "error");
  };

  const Row = ({ a, actionsSlot }: { a: Absence; actionsSlot?: React.ReactNode }) => {
    const p = people.get(a.personId);
    return (
      <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center lg:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-[15.5px] font-semibold text-heading">{p?.name ?? "Someone"}</span>
            <span className="text-[15px] text-muted-foreground">{ABSENCE_LABEL[a.kind]}</span>
          </div>
          <div className="text-[15px] tabular text-foreground">
            {absenceRange(a)} <span className="text-muted-foreground">· {leaveDays(a)} working day{leaveDays(a) === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[14.5px] text-muted-foreground">
            <StatusText tone={STATUS[a.status].tone}>{STATUS[a.status].label}</StatusText>
            <span>{a.kind === "unavailable" && a.status === "approved" && a.decidedBy === a.requestedBy ? "Added" : "Requested"} by {a.requestedBy}</span>
            {a.decidedBy && a.status !== "pending" && a.decidedBy !== a.requestedBy ? <span>{a.status === "approved" ? "Approved" : a.status === "declined" ? "Declined" : "Decided"} by {a.decidedBy}</span> : null}
          </div>
          {a.reason ? <p className="mt-1 text-[15px] text-foreground/85">“{a.reason}” <span className="text-[13.5px] text-subtle">· private</span></p> : null}
        </div>
        {actionsSlot ? <div className="flex flex-wrap gap-2">{actionsSlot}</div> : null}
      </li>
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[15px] text-muted-foreground">
          Approved leave and unavailability show on the Diary, and Bob warns before anyone is booked during them. Policy: {selfApprove ? "owners and admins can record their own leave as approved and approve team requests" : "an owner or admin's own leave needs approving by another owner or admin"} — change it in Settings.
        </p>
        <Button onClick={() => setAdding(true)}>
          <Plus /> {manage ? "Record leave" : "Request leave"}
        </Button>
      </div>

      {affected ? (
        <div role="alert" className="mb-4 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-warn-fg">
            <AlertTriangle className="size-4" aria-hidden /> {affected.name} is booked during this leave
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-[15px]">
            {affected.list.map((b) => (
              <li key={b.bookingId}>
                <AffectedLink b={b} />
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAffected(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="hol-pending" className="mb-5">
        <h2 id="hol-pending" className="mb-2 text-[16px] font-semibold text-heading">
          Waiting for approval <span className="font-normal text-muted-foreground">{pending.length}</span>
        </h2>
        {pending.length ? (
          <ul className="panel divide-y divide-line overflow-hidden">
            {pending.map((a) => (
              <Row
                key={a.id}
                a={a}
                actionsSlot={
                  manage ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => void decide(a, "decline")}>
                        <X /> Decline
                      </Button>
                      <Button size="sm" onClick={() => void decide(a, "approve")}>
                        <Check /> Approve
                      </Button>
                    </>
                  ) : undefined
                }
              />
            ))}
          </ul>
        ) : (
          <p className="panel px-4 py-3 text-[15px] text-muted-foreground">No requests waiting.</p>
        )}
      </section>

      <section aria-labelledby="hol-upcoming" className="mb-5">
        <h2 id="hol-upcoming" className="mb-2 text-[16px] font-semibold text-heading">
          Upcoming <span className="font-normal text-muted-foreground">{upcoming.length}</span>
        </h2>
        {upcoming.length ? (
          <ul className="panel divide-y divide-line overflow-hidden">
            {upcoming.map((a) => (
              <Row key={a.id} a={a} actionsSlot={manage ? <Button size="sm" variant="ghost" onClick={() => void cancel(a)}>Cancel leave</Button> : undefined} />
            ))}
          </ul>
        ) : (
          <p className="panel px-4 py-3 text-[15px] text-muted-foreground">Nobody is off.</p>
        )}
      </section>

      <TimeOffHistory />

      {adding ? (
        <LeaveForm
          onClose={() => setAdding(false)}
          onSaved={(a, list) => {
            if (list.length) setAffected({ name: people.get(a.personId)?.name ?? "They", list });
          }}
        />
      ) : null}
    </div>
  );
}

function AffectedLink({ b }: { b: Affected }) {
  const ui = useUI();
  return (
    <button type="button" className="font-medium text-accent-fg underline-offset-2 hover:underline" onClick={() => ui.openForm({ form: "booking", bookingId: b.bookingId })}>
      {b.jobTitle}, {formatDayShort(b.date)} — reassign
    </button>
  );
}

export function LeaveForm({ personId, onClose, onSaved }: { personId?: string; onClose: () => void; onSaved?: (a: Absence, affected: Affected[]) => void }) {
  const { data, can, actions, user } = useStore();
  const manage = can("team.manage");
  const me = data.people.find((p) => p.userId === user.id);
  const active = data.people.filter((p) => !p.archivedAt);
  const [v, setV] = React.useState({ personId: personId ?? (manage ? "" : me?.id ?? ""), kind: "holiday" as Absence["kind"], startDate: todayKey(), endDate: "", part: "full", reason: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const person: Person | undefined = data.people.find((p) => p.id === v.personId);
  const isSub = person?.kind === "subcontractor";
  const single = !v.endDate || v.endDate === v.startDate;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const r = await actions.run<Absence & { affected: Affected[] }>("addAbsence", { input: { ...v, kind: isSub && v.kind === "holiday" ? "unavailable" : v.kind, part: single ? v.part : "full", endDate: v.endDate || v.startDate } });
    setBusy(false);
    if (!r.ok) return setErrors(r.errors as Record<string, string>);
    toast(r.value.status === "pending" ? "Request sent — waiting for approval" : `${ABSENCE_LABEL[r.value.kind]} saved — it's on the diary`, "success");
    onSaved?.(r.value, r.value.affected ?? []);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={manage ? "Record leave or unavailability" : "Request leave"} description={manage ? "Recorded leave is approved straight away and shows on the Diary." : "An owner or admin approves it. You'll see the answer in My work."}>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {errors._ ? (
            <p role="alert" className="text-[15px] text-danger-fg">
              {errors._}
            </p>
          ) : null}
          {manage ? (
            <Field label="Who" htmlFor="lv-person" error={errors.personId}>
              <NativeSelect id="lv-person" value={v.personId} onChange={(e) => setV({ ...v, personId: e.target.value })} required>
                <option value="">Choose a person</option>
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.kind === "subcontractor" ? " (subcontractor)" : ""}
                    {p.id === me?.id ? " (you)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field label="Type" htmlFor="lv-kind">
            <NativeSelect id="lv-kind" value={isSub ? "unavailable" : v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Absence["kind"] })} disabled={isSub}>
              {!isSub ? <option value="holiday">Holiday</option> : null}
              <option value="unavailable">Unavailable</option>
              {manage && !isSub ? <option value="sick">Sick</option> : null}
              {manage ? <option value="other">Other / away</option> : null}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day" htmlFor="lv-start" error={errors.startDate}>
              <Input id="lv-start" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} required />
            </Field>
            <Field label="Last day" htmlFor="lv-end" error={errors.endDate} hint="Leave blank for one day">
              <Input id="lv-end" type="date" value={v.endDate} min={v.startDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
            </Field>
          </div>
          {single ? (
            <fieldset>
              <legend className="mb-1.5 text-[15px] font-medium text-foreground/90">How long</legend>
              <div className="inline-flex gap-1 rounded-xl bg-surface-3 p-1">
                {([["full", "Full day"], ["am", "Morning"], ["pm", "Afternoon"]] as const).map(([val, label]) => (
                  <label key={val} className={cn("flex h-9 cursor-pointer items-center rounded-lg px-3 text-[15px] font-semibold", v.part === val ? "bg-card text-heading ring-1 ring-line" : "text-muted-foreground")}>
                    <input type="radio" name="lv-part" value={val} checked={v.part === val} onChange={() => setV({ ...v, part: val })} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
              {errors.part ? <p className="mt-1 text-[15px] text-danger-fg">{errors.part}</p> : null}
            </fieldset>
          ) : null}
          <Field label="Reason (optional, private)" htmlFor="lv-reason" hint="Only the person and the owners and admins see this." error={errors.reason}>
            <Textarea id="lv-reason" rows={2} value={v.reason} maxLength={300} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {manage ? <CalendarOff /> : <Plane />} {busy ? "Saving…" : manage ? "Save" : "Send request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A person's leave, for their Team record. */
export function PersonLeave({ person }: { person: Person }) {
  const { data, can } = useStore();
  const [adding, setAdding] = React.useState(false);
  const today = todayKey();
  const list = data.absences.filter((a) => a.personId === person.id && a.endDate >= today && (a.status === "approved" || a.status === "pending")).sort((a, b) => a.startDate.localeCompare(b.startDate));
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-eyebrow">{person.kind === "subcontractor" ? "Unavailable" : "Holidays & leave"}</h3>
        {can("team.manage") && !person.archivedAt ? (
          <button type="button" onClick={() => setAdding(true)} className="h-9 px-1 text-[15px] font-semibold text-accent-fg">
            + Add
          </button>
        ) : null}
      </div>
      {list.length ? (
        <ul className="mt-1 divide-y divide-line">
          {list.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
              <span>
                {ABSENCE_LABEL[a.kind]} · {absenceRange(a)}
              </span>
              <StatusText tone={STATUS[a.status].tone}>{a.status === "pending" ? "Pending" : "Approved"}</StatusText>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[15px] text-muted-foreground">Nothing coming up.</p>
      )}
      {adding ? <LeaveForm personId={person.id} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}

/** Requested, approved, declined and cancelled — distinct at a glance. */
const HISTORY_STATUS: Record<Absence["status"], { label: string; tone: "amber" | "green" | "neutral" | "red" }> = {
  pending: { label: "Requested", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  declined: { label: "Declined", tone: "red" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Subcontractors aren't on holiday: they're unavailable. */
const leaveLabel = (a: Absence, p?: Person) => (p?.kind === "subcontractor" && a.kind === "holiday" ? "Unavailable" : ABSENCE_LABEL[a.kind]);
const dayLabel = (d: number) => `${d % 1 ? d.toFixed(1) : d} working day${d === 1 ? "" : "s"}`;

/**
 * Time off, looking back as easily as forward: pick a person and a period
 * ("Last month" is one tap). Only the part of each leave period inside the
 * period counts. For one person it also lists the work they were BOOKED for,
 * separately — a booking isn't proof they worked, and an empty day isn't a
 * holiday. Bob doesn't track attendance, and says so.
 */
export function TimeOffHistory() {
  const { data } = useStore();
  const today = todayKey();
  const [lmFrom, lmTo] = lastMonthRange(today);
  const [who, setWho] = React.useState("");
  const [from, setFrom] = React.useState(lmFrom);
  const [to, setTo] = React.useState(lmTo);
  const people = new Map(data.people.map((p) => [p.id, p]));
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const person = who ? people.get(who) : undefined;
  const valid = from && to && from <= to;
  const rows = valid
    ? data.absences
        .filter((a) => (!who || a.personId === who) && overlapsRange(a, from, to))
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
    : [];
  const approvedDays = rows.filter((a) => a.status === "approved").reduce((n, a) => n + leaveDaysInRange(a, from, to), 0);
  const booked = person && valid ? bookedDaysInRange(data.bookings, person.id, from, to) : [];
  const bookedDates = new Set(booked.map((b) => b.date));
  const quick = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const [tmFrom, tmTo] = thisMonthRange(today);
  const active = data.people.filter((p) => !p.archivedAt || data.absences.some((a) => a.personId === p.id));

  return (
    <section aria-labelledby="hol-history" className="mt-2">
      <h2 id="hol-history" className="mb-2 flex items-center gap-2 text-[16px] font-semibold text-heading">
        <History className="size-[18px] text-subtle" aria-hidden /> Time off history
      </h2>
      <div className="panel flex flex-col gap-3 px-4 py-3.5 lg:px-5">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <label className="block">
            <span className="text-[14px] font-medium text-muted-foreground">Person</span>
            <NativeSelect value={who} onChange={(e) => setWho(e.target.value)} className="mt-0.5" aria-label="Person">
              <option value="">Everyone</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.kind === "subcontractor" ? " (subcontractor)" : ""}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="block">
            <span className="text-[14px] font-medium text-muted-foreground">From</span>
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-0.5" aria-label="From" />
          </label>
          <label className="block">
            <span className="text-[14px] font-medium text-muted-foreground">To</span>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-0.5" aria-label="To" />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick periods">
          {([
            ["Last month", lmFrom, lmTo],
            ["This month", tmFrom, tmTo],
            ["Last 3 months", thisMonthRange(addDays(lmFrom, -45))[0], lmTo],
          ] as const).map(([label, f, t]) => (
            <button key={label} type="button" onClick={() => quick(f, t)} aria-pressed={from === f && to === t} className={cn("h-9 rounded-lg px-3 text-[14.5px] font-medium ring-1", from === f && to === t ? "bg-selected text-heading ring-accent/40" : "bg-card text-muted-foreground ring-line hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        {!valid ? <p className="text-[15px] text-danger-fg">Choose a start date before the end date.</p> : null}
      </div>

      {valid ? (
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <h3 className="mb-1.5 px-1 text-[15px] font-semibold text-heading">
              Recorded time off{person ? ` — ${person.name}` : ""}{" "}
              <span className="font-normal text-muted-foreground">
                · {formatDayShort(from)} – {formatDayShort(to)} · {dayLabel(approvedDays)} approved
              </span>
            </h3>
            {rows.length ? (
              <ul className="panel divide-y divide-line overflow-hidden" aria-label="Time off in this period">
                {rows.map((a) => {
                  const p = people.get(a.personId);
                  const inRange = leaveDaysInRange(a, from, to);
                  const all = leaveDays(a);
                  return (
                    <li key={a.id} className="flex flex-col gap-0.5 px-4 py-3 lg:px-5" data-testid="history-row">
                      <div className="flex flex-wrap items-center justify-between gap-x-3">
                        <span className="text-[15.5px] font-semibold text-heading">
                          {who ? leaveLabel(a, p) : `${p?.name ?? "Someone"} · ${leaveLabel(a, p)}`}
                        </span>
                        <StatusText tone={HISTORY_STATUS[a.status].tone}>{HISTORY_STATUS[a.status].label}</StatusText>
                      </div>
                      <span className="text-[15px] tabular">{absenceRange(a)}</span>
                      <span className="text-[14.5px] text-muted-foreground">
                        {dayLabel(inRange)} in this period{inRange !== all ? ` (of ${dayLabel(all)} in total)` : ""}
                        {a.status === "declined" || a.status === "cancelled" ? " — not taken" : a.status === "pending" ? " — not approved yet" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="panel px-4 py-3 text-[15px] text-muted-foreground">No time off recorded{person ? ` for ${person.name}` : ""} in this period.</p>
            )}
          </div>

          {person ? (
            <div>
              <h3 className="mb-1.5 px-1 text-[15px] font-semibold text-heading">
                Booked work — {person.name}{" "}
                <span className="font-normal text-muted-foreground">
                  · {bookedDates.size} day{bookedDates.size === 1 ? "" : "s"} booked
                </span>
              </h3>
              {booked.length ? (
                <ul className="panel divide-y divide-line overflow-hidden" aria-label="Booked work in this period">
                  {booked.map((b) => (
                    <li key={`${b.bookingId}-${b.date}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5 text-[15px] lg:px-5">
                      <span className="tabular font-medium">{formatDayShort(b.date)}</span>
                      <span className="min-w-0 flex-1 text-foreground/90">{jobs.get(b.jobId)?.title ?? "Job"}</span>
                      <span className="tabular text-muted-foreground">{b.startTime ? formatTimeRange(b.startTime, b.endTime) : "All day"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panel px-4 py-3 text-[15px] text-muted-foreground">No work booked for {person.name} in this period.</p>
              )}
              <div className="mt-3 flex gap-2.5 rounded-xl bg-surface-2 p-3.5 text-[14.5px]" role="note" data-testid="attendance-note">
                <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
                <p>
                  <strong className="font-semibold">Bob doesn&apos;t track attendance.</strong> Booked days are what was planned — not proof {person.name.split(" ")[0]} worked them. A day with nothing booked or recorded isn&apos;t a holiday either. Check an invoice against your own records; Bob never works out a payable day.
                  <span className="mt-1 block text-subtle">Decision for later: whether to add &ldquo;confirmed days worked&rdquo; to bookings.</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="px-1 text-[14.5px] text-muted-foreground">Choose a person to see the work they were booked for alongside their time off — useful when checking a subcontractor&apos;s invoice.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
