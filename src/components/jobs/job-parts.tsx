"use client";

/** Job profile sections: shared instructions, schedule, tasks and materials. */
import * as React from "react";
import { CalendarPlus, Check, ExternalLink, Eye, MapPin, Package, Pencil, Phone, Plus } from "lucide-react";
import { W3W_HELP, normaliseW3w } from "@/lib/validation";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { formatDayShort, formatTimeRange, relativeDay, relativeDayInline } from "@/lib/dates";
import { bookingEndDate } from "@/lib/schedule";
import type { Job, MaterialStatus } from "@/lib/types";
import { addDaysKey, cn, daysFromToday, todayKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { StatusText } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";
import { MATERIAL_STATUS_LABEL } from "@/components/forms/team-forms";

/** Site address, what3words, access note and instructions — shown to the people booked (never in calendar feeds). */
export function SharedInstructions({ job: j }: { job: Job }) {
  const { data, actions, can } = useStore();
  const [editing, setEditing] = React.useState(false);
  const initial = { siteAddress: j.siteAddress ?? "", what3words: j.what3words ?? "", accessNote: j.accessNote ?? "", sharedNotes: j.sharedNotes ?? "" };
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setV({ siteAddress: j.siteAddress ?? "", what3words: j.what3words ?? "", accessNote: j.accessNote ?? "", sharedNotes: j.sharedNotes ?? "" }), [j.id, j.siteAddress, j.what3words, j.accessNote, j.sharedNotes]);
  const customer = data.customers.find((c) => c.id === j.customerId);
  const customerAddress = customer?.address ?? (customer?.town ? customer.town : undefined);
  const w3wState = v.what3words.trim() ? normaliseW3w(v.what3words) : "";
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (w3wState === null) return setErrors({ what3words: W3W_HELP });
    setBusy(true);
    setErrors({});
    const res = await actions.updateJob(j.id, v);
    setBusy(false);
    if (!res.ok) return setErrors(res.errors as Record<string, string>);
    toast("Site details saved — the people booked see them in My work");
    setEditing(false);
  };
  return (
    <section className="border-t border-line px-5 py-5 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold uppercase tracking-wider text-subtle">Site & access</h3>
        <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[12.5px] font-medium text-info-fg">
          <Eye className="size-3.5" aria-hidden /> Shared with people booked
        </span>
      </div>
      {editing ? (
        <form onSubmit={save} className="space-y-3" noValidate>
          {errors._ ? (
            <p role="alert" className="text-[14px] text-danger-fg">
              {errors._} Your changes are still here.
            </p>
          ) : null}
          <Field label="Site address" htmlFor={`site-${j.id}`} hint="Where the work is. Separate from the customer's contact address." error={errors.siteAddress}>
            <Input id={`site-${j.id}`} value={v.siteAddress} onChange={(e) => setV({ ...v, siteAddress: e.target.value })} autoComplete="off" />
          </Field>
          {customerAddress && v.siteAddress !== customerAddress ? (
            <button type="button" onClick={() => setV({ ...v, siteAddress: customerAddress })} className="-mt-1 h-9 text-[14px] font-semibold text-accent-fg">
              Copy customer address ({customerAddress})
            </button>
          ) : null}
          <Field label="what3words (optional)" htmlFor={`w3w-${j.id}`} error={errors.what3words ?? (w3wState === null ? W3W_HELP : undefined)} hint={w3wState ? `Saved as ///${w3wState}. Bob checks the format only — open it in what3words to confirm the spot.` : "Three words with dots, with or without ///"}>
            <Input id={`w3w-${j.id}`} value={v.what3words} onChange={(e) => setV({ ...v, what3words: e.target.value })} aria-invalid={w3wState === null} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="///filled.count.soap" />
          </Field>
          <Field label="Site access note (optional)" htmlFor={`access-${j.id}`} hint="Side gate, where to park, which entrance. Not included in calendar feeds." error={errors.accessNote}>
            <Textarea id={`access-${j.id}`} value={v.accessNote} onChange={(e) => setV({ ...v, accessNote: e.target.value })} className="min-h-16" />
          </Field>
          <Field label="Instructions for the team (optional)" htmlFor={`shared-${j.id}`} hint="Working hours, things to watch out for. No prices or passwords." error={errors.sharedNotes}>
            <Textarea id={`shared-${j.id}`} value={v.sharedNotes} onChange={(e) => setV({ ...v, sharedNotes: e.target.value })} className="min-h-16" />
          </Field>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => { setV(initial); setErrors({}); setEditing(false); }}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              <Check /> {busy ? "Saving…" : "Save site details"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <SiteActions job={j} />
          {j.sharedNotes ? (
            <div className="mt-3">
              <h4 className="text-[13.5px] font-semibold">Instructions</h4>
              <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed">{j.sharedNotes}</p>
            </div>
          ) : null}
          {can("jobs.write") ? (
            <Button size="sm" variant="ghost" className="-ml-2 mt-2" onClick={() => setEditing(true)}>
              <Pencil /> Edit site details
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const w3wUrl = (words: string) => `https://what3words.com/${encodeURIComponent(words.replace(/^\/+/, ""))}`;

/** Address, what3words and access note with Open in maps / Open in what3words. Same on the job profile and My work. */
export function SiteActions({ job: j, compact = false }: { job: Pick<Job, "siteAddress" | "location" | "what3words" | "accessNote">; compact?: boolean }) {
  const address = j.siteAddress || j.location;
  return (
    <div className="space-y-2">
      {compact ? (
        <Button asChild size="sm" className="w-full sm:w-auto">
          <a href={mapsUrl(address)} target="_blank" rel="noreferrer">
            <MapPin /> Open in maps
          </a>
        </Button>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 text-[15.5px] font-medium">
            {address}
            {!j.siteAddress ? <span className="block text-[13px] font-normal text-muted-foreground">Town only — add the site address.</span> : null}
          </p>
          <Button asChild size="sm" variant="secondary">
            <a href={mapsUrl(address)} target="_blank" rel="noreferrer">
              <MapPin /> Open in maps
            </a>
          </Button>
        </div>
      )}
      {j.what3words ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px] font-semibold">
            <span className="text-[#e11f26]" aria-hidden>
              {"///"}
            </span>
            {j.what3words}
          </p>
          <Button asChild size="sm" variant="secondary">
            <a href={w3wUrl(j.what3words)} target="_blank" rel="noreferrer">
              <ExternalLink /> Open in what3words
            </a>
          </Button>
        </div>
      ) : null}
      {j.accessNote ? (
        <div className="rounded-xl bg-amber-500/[0.08] px-3 py-2 ring-1 ring-amber-500/20">
          <h4 className="text-[13px] font-semibold text-warn-fg">Site access</h4>
          <p className="whitespace-pre-wrap text-[15px] leading-snug">{j.accessNote}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Who's booked on this job from today on. */
export function JobCrew({ job: j }: { job: Job }) {
  const { data } = useStore();
  const today = todayKey();
  const upcoming = data.bookings.filter((b) => b.jobId === j.id && bookingEndDate(b) >= today);
  const ids = [...new Set(upcoming.flatMap((b) => b.personIds))];
  const crew = ids.map((id) => data.people.find((p) => p.id === id)).filter(Boolean) as typeof data.people;
  return (
    <section className="border-t border-line px-5 py-5 sm:px-6">
      <h3 className="mb-2 text-[14px] font-semibold uppercase tracking-wider text-subtle">Crew</h3>
      {crew.length ? (
        <ul className="divide-y divide-line">
          {crew.map((p) => {
            const next = upcoming.filter((b) => b.personIds.includes(p.id)).sort((a, b) => a.date.localeCompare(b.date))[0];
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{p.name}</span>
                  <span className="block text-[13.5px] text-muted-foreground">
                    {p.kind === "subcontractor" ? `Subcontractor${p.trade ? ` · ${p.trade}` : ""}` : p.trade ?? "Employee"} · next {relativeDayInline(next.date, today)}
                  </span>
                </span>
                {p.phone ? (
                  <Button asChild size="sm" variant="ghost">
                    <a href={`tel:${p.phone.replace(/\s/g, "")}`} aria-label={`Call ${p.name}`}>
                      <Phone /> Call
                    </a>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[15px] text-muted-foreground">Nobody booked yet.</p>
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
                    {t.done ? <span>Done</span> : d < 0 ? <StatusText tone="red">Overdue</StatusText> : d === 0 ? <StatusText tone="amber">Due today</StatusText> : <span>Due {relativeDayInline(t.dueDate, todayKey())}</span>}
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
          <Plus /> Add material
        </Button>
      ) : null}
      {items.length ? (
        <ul className="mt-3 divide-y divide-line">
          {items.map((m) => (
            <MaterialRow
              key={m.id}
              item={m}
              merchantName={data.merchants.find((x) => x.id === m.merchantId)?.name}
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
  merchantName,
  hideMerchant,
}: {
  item: { id: string; item: string; quantity: string; unit?: string; supplier?: string; neededBy?: string; status: MaterialStatus; orderRef?: string; expectedDelivery?: string };
  write: boolean;
  onStatus: (s: MaterialStatus) => void;
  onEdit: () => void;
  jobLabel?: string;
  merchantName?: string;
  hideMerchant?: boolean;
}) {
  const today = todayKey();
  const due = m.neededBy ? daysFromToday(m.neededBy) : null;
  const late = m.status === "to_order" && due !== null && due <= 2;
  return (
    <li className="row-open flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <button type="button" onClick={onEdit} disabled={!write} aria-label={`Edit ${m.item}`} className="row-target min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-[''] disabled:cursor-default">
        <span className="block text-[15.5px] font-semibold text-heading">
          {m.item}
          <span className="ml-2 font-normal tabular text-foreground">
            × {m.quantity}
            {m.unit ? ` ${m.unit}` : ""}
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-[14px] text-muted-foreground">
          {jobLabel ? <span>{jobLabel}</span> : null}
          {hideMerchant ? null : <span>{merchantName ?? m.supplier ?? <span className="italic">No merchant yet</span>}</span>}
          {m.neededBy ? <span className={cn(late && "font-semibold text-danger-fg")}>Needed {relativeDayInline(m.neededBy, today)}</span> : null}
          {m.orderRef ? <span>Ref {m.orderRef}</span> : null}
          {m.status === "ordered" && m.expectedDelivery ? <span>Delivery {relativeDayInline(m.expectedDelivery, today)}</span> : null}
        </span>
      </button>
      <label className="row-secondary w-36 shrink-0">
        <span className="sr-only">Status for {m.item}</span>
        <NativeSelect value={m.status} disabled={!write} onChange={(e) => onStatus(e.target.value as MaterialStatus)} className={cn("h-11 text-[14.5px] font-semibold", m.status === "to_order" ? "text-warn-fg" : m.status === "ordered" ? "text-info-fg" : "text-good-fg")}>
          {(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((st) => (
            <option key={st} value={st}>
              {MATERIAL_STATUS_LABEL[st]}
            </option>
          ))}
        </NativeSelect>
      </label>
    </li>
  );
}
