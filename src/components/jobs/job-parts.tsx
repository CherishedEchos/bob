"use client";

/** Job profile sections: shared instructions, schedule, tasks and materials. */
import * as React from "react";
import { CalendarPlus, Check, Eye, Package, Pencil, Plus } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { formatDayShort, formatTimeRange, relativeDay } from "@/lib/dates";
import { bookingEndDate } from "@/lib/schedule";
import type { Job, MaterialStatus } from "@/lib/types";
import { addDaysKey, cn, daysFromToday, todayKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { StatusText } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";
import { MATERIAL_STATUS_LABEL } from "@/components/forms/team-forms";

/** Where the work is and what the team booked on it should know. Shown in their My work. */
export function SharedInstructions({ job: j }: { job: Job }) {
  const { actions, can } = useStore();
  const [editing, setEditing] = React.useState(false);
  const [v, setV] = React.useState({ siteAddress: j.siteAddress ?? "", what3words: j.what3words ?? "", sharedNotes: j.sharedNotes ?? "" });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setV({ siteAddress: j.siteAddress ?? "", what3words: j.what3words ?? "", sharedNotes: j.sharedNotes ?? "" }), [j.id, j.siteAddress, j.what3words, j.sharedNotes]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await actions.updateJob(j.id, { ...v, what3words: v.what3words.replace(/^\/+/, "") });
    setBusy(false);
    if (!res.ok) return setError(res.errors._ || Object.values(res.errors)[0] || "Couldn't save");
    toast("Site details saved — the team sees them in My work");
    setEditing(false);
  };
  return (
    <section className="border-t border-line px-5 py-5 sm:px-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold uppercase tracking-wider text-subtle">Site & instructions</h3>
        <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[12.5px] font-medium text-info-fg">
          <Eye className="size-3.5" aria-hidden /> Shared with people booked
        </span>
      </div>
      {editing ? (
        <form onSubmit={save} className="space-y-3">
          {error ? (
            <p role="alert" className="text-[14px] text-danger-fg">
              {error} Your changes are still here.
            </p>
          ) : null}
          <Field label="Site address" htmlFor={`site-${j.id}`}>
            <Input id={`site-${j.id}`} value={v.siteAddress} onChange={(e) => setV({ ...v, siteAddress: e.target.value })} autoComplete="street-address" />
          </Field>
          <Field label="what3words (optional)" htmlFor={`w3w-${j.id}`} hint="Three words, e.g. lifted.copper.marble">
            <Input id={`w3w-${j.id}`} value={v.what3words} onChange={(e) => setV({ ...v, what3words: e.target.value })} />
          </Field>
          <Field label="Instructions for the team" htmlFor={`shared-${j.id}`} hint="Parking, access codes, working hours, anything to watch out for. No prices.">
            <Textarea id={`shared-${j.id}`} value={v.sharedNotes} onChange={(e) => setV({ ...v, sharedNotes: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              <Check /> {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{j.sharedNotes || <span className="text-muted-foreground">No instructions yet.</span>}</p>
          {can("jobs.write") ? (
            <Button size="sm" variant="ghost" className="-ml-2 mt-1" onClick={() => setEditing(true)}>
              <Pencil /> Edit site & instructions
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

export function JobSchedule({ job: j }: { job: Job }) {
  const { data, can } = useStore();
  const ui = useUI();
  const today = todayKey();
  const mine = data.bookings.filter((b) => b.jobId === j.id).sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = mine.filter((b) => bookingEndDate(b) >= today);
  const past = mine.filter((b) => bookingEndDate(b) < today).reverse();
  const people = new Map(data.people.map((p) => [p.id, p]));
  const Row = ({ b }: { b: (typeof mine)[number] }) => (
    <li>
      <button
        type="button"
        disabled={!can("schedule.manage")}
        onClick={() => ui.openForm({ form: "booking", bookingId: b.id })}
        className="row-open flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left disabled:cursor-default"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">
            {relativeDay(b.date, today)}
            {b.endDate ? ` – ${formatDayShort(b.endDate)}` : ""} · {formatTimeRange(b.startTime, b.endTime)}
          </span>
          <span className="block text-[14px] text-muted-foreground">
            {b.personIds.length ? b.personIds.map((id) => people.get(id)?.name ?? "Someone").join(", ") : <span className="font-semibold text-warn-fg">Needs someone</span>}
          </span>
          {b.notes ? <span className="mt-0.5 block text-[13.5px] text-muted-foreground">{b.notes}</span> : null}
        </span>
        {can("schedule.manage") ? <span className="text-[14px] font-semibold text-accent-fg">Edit</span> : null}
      </button>
    </li>
  );
  return (
    <section className="px-5 py-5 sm:px-6">
      {can("schedule.manage") ? (
        <Button onClick={() => ui.openForm({ form: "booking", jobId: j.id })} className="w-full sm:w-auto">
          <CalendarPlus /> Schedule work
        </Button>
      ) : null}
      <h3 className="mt-5 text-[14px] font-semibold uppercase tracking-wider text-subtle">Booked</h3>
      {upcoming.length ? <ul className="mt-1 divide-y divide-line">{upcoming.map((b) => <Row key={b.id} b={b} />)}</ul> : <p className="mt-2 text-[15px] text-muted-foreground">Nothing booked yet.</p>}
      {past.length ? (
        <>
          <h3 className="mt-6 text-[14px] font-semibold uppercase tracking-wider text-subtle">Done</h3>
          <ul className="mt-1 divide-y divide-line">{past.map((b) => <Row key={b.id} b={b} />)}</ul>
        </>
      ) : null}
    </section>
  );
}

export function JobTasks({ job: j }: { job: Job }) {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const tasks = data.tasks.filter((t) => t.relatedType === "job" && t.relatedId === j.id).sort((a, b) => Number(a.done) - Number(b.done) || a.dueDate.localeCompare(b.dueDate));
  const people = new Map(data.people.map((p) => [p.id, p]));
  return (
    <section className="px-5 py-5 sm:px-6">
      {can("tasks.write") ? (
        <Button variant="secondary" onClick={() => ui.openForm({ form: "reminder", title: "", dueDate: addDaysKey(1), customerId: j.customerId, relatedType: "job", relatedId: j.id })} className="w-full sm:w-auto">
          <Plus /> Add task
        </Button>
      ) : null}
      {tasks.length ? (
        <ul className="mt-3 divide-y divide-line">
          {tasks.map((t) => {
            const d = daysFromToday(t.dueDate);
            return (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <button
                  type="button"
                  aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`}
                  aria-pressed={t.done}
                  disabled={!can("tasks.write")}
                  onClick={async () => {
                    const r = await actions.setTaskDone(t.id, !t.done);
                    if (!r.ok) return toast("Couldn't update the task", "error");
                    if (!t.done) toast(`Done: ${t.title}`, "success", { action: { label: "Undo", run: () => void actions.setTaskDone(t.id, false) } });
                  }}
                  className="-m-1.5 grid size-11 shrink-0 place-items-center"
                >
                  <span className={cn("grid size-7 place-items-center rounded-full ring-2", t.done ? "bg-emerald-600 text-white ring-emerald-600" : "bg-card text-transparent ring-[rgb(16_24_40/0.25)] hover:text-subtle")}>
                    <Check className="size-4" strokeWidth={3} aria-hidden />
                  </span>
                </button>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[15px] font-medium leading-snug", t.done && "font-normal text-muted-foreground line-through")}>{t.title}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-[13.5px] text-muted-foreground">
                    {t.done ? <span>Done</span> : d < 0 ? <StatusText tone="red">Overdue</StatusText> : d === 0 ? <StatusText tone="amber">Due today</StatusText> : <span>Due {relativeDay(t.dueDate, todayKey()).toLowerCase()}</span>}
                    {t.assignedPersonId ? <span>For {people.get(t.assignedPersonId)?.name ?? "someone"}</span> : <span>Office</span>}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[15px] text-muted-foreground">No tasks on this job.</p>
      )}
    </section>
  );
}

export function JobMaterials({ job: j }: { job: Job }) {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const items = data.materials.filter((m) => m.jobId === j.id);
  const write = can("materials.write");
  return (
    <section className="px-5 py-5 sm:px-6">
      {write ? (
        <Button variant="secondary" onClick={() => ui.openForm({ form: "material", jobId: j.id })} className="w-full sm:w-auto">
          <Plus /> Add item
        </Button>
      ) : null}
      {items.length ? (
        <ul className="mt-3 divide-y divide-line">
          {items.map((m) => (
            <MaterialRow
              key={m.id}
              item={m}
              write={write}
              onStatus={async (status) => {
                const r = await actions.run("setMaterialStatus", { id: m.id, status });
                toast(r.ok ? `${m.item}: ${MATERIAL_STATUS_LABEL[status].toLowerCase()}` : r.errors._ || "Couldn't update", r.ok ? "success" : "error");
              }}
              onEdit={() => ui.openForm({ form: "material", materialId: m.id })}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-[15px] text-muted-foreground">
          <Package className="size-4" aria-hidden /> Nothing on the order list.
        </p>
      )}
    </section>
  );
}

export function MaterialRow({
  item: m,
  write,
  onStatus,
  onEdit,
  jobLabel,
}: {
  item: { id: string; item: string; quantity: string; supplier?: string; neededBy?: string; status: MaterialStatus };
  write: boolean;
  onStatus: (s: MaterialStatus) => void;
  onEdit: () => void;
  jobLabel?: string;
}) {
  const due = m.neededBy ? daysFromToday(m.neededBy) : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <button type="button" onClick={onEdit} disabled={!write} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <span className="block text-[15px] font-medium">
          {m.quantity} × {m.item}
        </span>
        <span className="block text-[13.5px] text-muted-foreground">
          {jobLabel ? `${jobLabel} · ` : ""}
          {m.supplier ?? "Supplier not set"}
          {m.neededBy ? (
            <>
              {" · "}
              <span className={cn(m.status === "to_order" && due !== null && due <= 2 && "font-semibold text-warn-fg")}>needed {relativeDay(m.neededBy, todayKey()).toLowerCase()}</span>
            </>
          ) : null}
        </span>
      </button>
      <label className="w-36 shrink-0">
        <span className="sr-only">Status for {m.item}</span>
        <NativeSelect value={m.status} disabled={!write} onChange={(e) => onStatus(e.target.value as MaterialStatus)} className={cn("h-11 text-[14.5px] font-medium", m.status === "to_order" ? "text-warn-fg" : m.status === "ordered" ? "text-info-fg" : "text-good-fg")}>
          {(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((s) => (
            <option key={s} value={s}>
              {MATERIAL_STATUS_LABEL[s]}
            </option>
          ))}
        </NativeSelect>
      </label>
    </li>
  );
}
