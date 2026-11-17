"use client";

/**
 * Forms for the schedule, team, order lists and bills. All checks run again
 * on the server; on failure the form keeps everything that was typed.
 */
import * as React from "react";
import { AlertTriangle, Check, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI, type FormPrefill } from "@/lib/store/ui";
import { isActiveJob } from "@/lib/derive";
import type { FieldErrors } from "@/lib/validation";
import type { MaterialStatus } from "@/lib/types";
import { todayKey } from "@/lib/utils";
import { addDays, daysBetween } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

type Change = React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
type Clash = { personId: string; personName: string; jobTitle: string; when: string };

function useForm<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof T) => (e: Change) => setValues((s) => ({ ...s, [k]: e.target.value }));
  return { values, setValues, errors, setErrors, busy, setBusy, set };
}

function FormError({ errors }: { errors: FieldErrors }) {
  return errors._ ? (
    <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-[14.5px] text-danger-fg ring-1 ring-red-500/25">
      {errors._} <span className="text-muted-foreground">Your details are still here.</span>
    </p>
  ) : null;
}

function Actions({ label, busy, onCancel, extra }: { label: string; busy?: boolean; onCancel: () => void; extra?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-6 flex flex-wrap gap-2 border-t border-line bg-card px-5 pb-1 pt-3 sm:-mx-6 sm:px-6">
      {extra}
      <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" className="flex-1" disabled={busy}>
        <Check /> {busy ? "Saving…" : label}
      </Button>
    </div>
  );
}

/* ------------------------------ Schedule work ------------------------------ */

export function BookingForm({ prefill }: { prefill: Extract<FormPrefill, { form: "booking" }> }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const existing = prefill.bookingId ? data.bookings.find((b) => b.id === prefill.bookingId) : undefined;
  const jobs = data.jobs.filter((j) => isActiveJob(j) || j.id === existing?.jobId || j.id === prefill.jobId);
  const people = data.people.filter((p) => !p.archivedAt || existing?.personIds.includes(p.id));
  // Dragged to a new day: start from that day and keep the same length.
  const shift = existing && prefill.date ? daysBetween(existing.date, prefill.date) : 0;
  const f = useForm({
    jobId: existing?.jobId ?? prefill.jobId ?? "",
    date: prefill.date ?? existing?.date ?? todayKey(),
    endDate: existing?.endDate ? addDays(existing.endDate, shift) : "",
    startTime: existing?.startTime ?? "08:00",
    endTime: existing?.endTime ?? "16:30",
    notes: existing?.notes ?? "",
  });
  const [allDay, setAllDay] = React.useState(existing ? !existing.startTime : false);
  const [multiDay, setMultiDay] = React.useState(!!existing?.endDate);
  const [who, setWho] = React.useState<string[]>(existing?.personIds ?? prefill.personIds ?? []);
  const [clashes, setClashes] = React.useState<Clash[] | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const { values, errors, set } = f;

  const save = async (confirmOverlap: boolean) => {
    f.setBusy(true);
    f.setErrors({});
    const res = await actions.run<{ id: string }>("saveBooking", {
      input: {
        id: existing?.id,
        jobId: values.jobId,
        date: values.date,
        endDate: multiDay ? values.endDate : "",
        allDay,
        startTime: allDay ? "" : values.startTime,
        endTime: allDay ? "" : values.endTime,
        personIds: who,
        notes: values.notes,
        confirmOverlap,
      },
    });
    f.setBusy(false);
    if (!res.ok) {
      if (res.clashes?.length) return setClashes(res.clashes);
      return f.setErrors(res.errors);
    }
    const job = data.jobs.find((j) => j.id === values.jobId);
    toast(`${existing ? "Booking updated" : "Work scheduled"}: ${job?.title ?? "job"}${who.length ? "" : " — nobody assigned yet"}`);
    ui.closeForm();
  };

  const remove = async () => {
    if (!existing) return;
    f.setBusy(true);
    const res = await actions.run("deleteBooking", { id: existing.id });
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast("Booking removed");
    ui.closeForm();
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setClashes(null);
        void save(false);
      }}
    >
      <FormError errors={errors} />
      <Field label="Job" htmlFor="bk-job" error={errors.jobId}>
        <NativeSelect id="bk-job" value={values.jobId} onChange={set("jobId")} aria-invalid={!!errors.jobId}>
          <option value="">Choose a job…</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} · {j.customerName} ({j.location})
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={multiDay ? "First day" : "Day"} htmlFor="bk-date" error={errors.date}>
          <Input id="bk-date" type="date" value={values.date} onChange={set("date")} />
        </Field>
        {multiDay ? (
          <Field label="Last day" htmlFor="bk-end" error={errors.endDate}>
            <Input id="bk-end" type="date" min={values.date} value={values.endDate} onChange={set("endDate")} aria-invalid={!!errors.endDate} />
          </Field>
        ) : (
          <div className="flex items-end">
            <button type="button" onClick={() => setMultiDay(true)} className="h-12 text-[14.5px] font-semibold text-accent-fg">
              + More than one day
            </button>
          </div>
        )}
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[14px] font-medium text-foreground/90">Time</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex h-12 items-center gap-2 rounded-xl px-3 text-[15px] ring-1 ring-line-strong">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[#d4621a]" /> All day
          </label>
          {!allDay ? (
            <>
              <div className="w-32">
                <label htmlFor="bk-start" className="sr-only">
                  Start time
                </label>
                <Input id="bk-start" type="time" step={900} value={values.startTime} onChange={set("startTime")} aria-invalid={!!errors.startTime} />
              </div>
              <span className="pb-3 text-muted-foreground">to</span>
              <div className="w-32">
                <label htmlFor="bk-endt" className="sr-only">
                  End time
                </label>
                <Input id="bk-endt" type="time" step={900} value={values.endTime} onChange={set("endTime")} aria-invalid={!!errors.endTime} />
              </div>
            </>
          ) : null}
        </div>
        {errors.startTime || errors.endTime ? (
          <p role="alert" className="mt-1.5 text-[14px] text-danger-fg">
            {errors.startTime ?? errors.endTime}
          </p>
        ) : null}
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-[14px] font-medium text-foreground/90">Who&apos;s on it</legend>
        {people.length ? (
          <div className="flex flex-wrap gap-2">
            {people.map((p) => {
              const on = who.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setClashes(null);
                    setWho((w) => (on ? w.filter((x) => x !== p.id) : [...w, p.id]));
                  }}
                  className={cn(
                    "flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-left text-[14.5px] ring-1 transition",
                    on ? "bg-selected font-semibold text-accent-fg ring-copper-500/50" : "bg-card text-foreground ring-line-strong hover:bg-surface-2",
                  )}
                >
                  {on ? <Check className="size-4" aria-hidden /> : null}
                  <span>
                    {p.name}
                    <span className="block text-[12.5px] font-normal text-muted-foreground">{p.kind === "subcontractor" ? `Sub · ${p.trade ?? p.company ?? ""}` : p.trade ?? "Employee"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[14.5px] text-muted-foreground">
            No one in your team yet.{" "}
            <button type="button" className="font-semibold text-accent-fg" onClick={() => ui.openForm({ form: "person" })}>
              Add person
            </button>
          </p>
        )}
        {!who.length && people.length ? <p className="mt-1.5 text-[13.5px] text-muted-foreground">You can save it without anyone and assign people later.</p> : null}
      </fieldset>
      <Field label="Instructions for the team (optional)" htmlFor="bk-notes" hint="Shown to the people booked, in My work.">
        <Textarea id="bk-notes" value={values.notes} onChange={set("notes")} className="min-h-20" />
      </Field>
      {clashes ? (
        <div role="alert" className="rounded-2xl bg-amber-500/10 p-3.5 ring-1 ring-amber-500/30">
          <p className="flex items-start gap-2 text-[15px] font-semibold text-warn-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> Double booking
          </p>
          <ul className="mt-1 space-y-1 pl-6 text-[14.5px] text-foreground">
            {clashes.map((c, i) => (
              <li key={i}>
                <strong>{c.personName}</strong> is already on {c.jobTitle} ({c.when}).
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2 pl-6">
            <Button type="button" size="sm" variant="secondary" onClick={() => setClashes(null)}>
              Change it
            </Button>
            <Button type="button" size="sm" disabled={f.busy} onClick={() => void save(true)}>
              Book anyway
            </Button>
          </div>
        </div>
      ) : null}
      <p className="text-[13px] text-muted-foreground">Nobody is notified automatically. People with access see the change next time they open My work.</p>
      {existing && confirmDelete ? (
        <div className="rounded-xl bg-red-500/[0.06] p-3 ring-1 ring-red-500/25">
          <p className="text-[14.5px]">Remove this booking? The job stays; only this slot goes.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={() => void remove()}>
              Remove booking
            </Button>
          </div>
        </div>
      ) : null}
      <Actions
        label={existing ? "Save changes" : "Schedule work"}
        busy={f.busy}
        onCancel={ui.closeForm}
        extra={
          existing && !confirmDelete ? (
            <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Remove
            </Button>
          ) : null
        }
      />
    </form>
  );
}

/* --------------------------------- Person --------------------------------- */

export function PersonForm({ prefill }: { prefill: Extract<FormPrefill, { form: "person" }> }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const p = prefill.personId ? data.people.find((x) => x.id === prefill.personId) : undefined;
  const f = useForm({ name: p?.name ?? "", kind: p?.kind ?? "subcontractor", company: p?.company ?? "", trade: p?.trade ?? "", phone: p?.phone ?? "", email: p?.email ?? "" });
  const { values, errors, set } = f;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = p ? await actions.run("updatePerson", { id: p.id, input: values }) : await actions.run<{ id: string; name: string }>("createPerson", { input: values });
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(p ? "Details saved" : `${values.name} added — you can book them now`);
    ui.closeForm();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <Field label="Name" htmlFor="pf-name" error={errors.name}>
        <Input id="pf-name" value={values.name} onChange={set("name")} autoFocus aria-invalid={!!errors.name} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[14px] font-medium text-foreground/90">They are</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["employee", "subcontractor"] as const).map((k) => (
            <label key={k} className={cn("flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl text-[15px] font-medium ring-1", values.kind === k ? "bg-selected text-accent-fg ring-copper-500/50" : "ring-line-strong")}>
              <input type="radio" name="kind" value={k} checked={values.kind === k} onChange={set("kind")} className="sr-only" />
              {k === "employee" ? "Employee" : "Subcontractor"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Trade (optional)" htmlFor="pf-trade" error={errors.trade}>
          <Input id="pf-trade" value={values.trade} onChange={set("trade")} placeholder="e.g. Electrician" />
        </Field>
        {values.kind === "subcontractor" ? (
          <Field label="Company (optional)" htmlFor="pf-company" error={errors.company}>
            <Input id="pf-company" value={values.company} onChange={set("company")} />
          </Field>
        ) : null}
        <Field label="Mobile (optional)" htmlFor="pf-phone" error={errors.phone}>
          <Input id="pf-phone" type="tel" value={values.phone} onChange={set("phone")} />
        </Field>
        <Field label="Email (optional)" htmlFor="pf-email" error={errors.email} hint="Needed to invite them to Bob.">
          <Input id="pf-email" type="email" value={values.email} onChange={set("email")} aria-invalid={!!errors.email} />
        </Field>
      </div>
      <Actions label={p ? "Save" : "Add person"} busy={f.busy} onCancel={ui.closeForm} />
    </form>
  );
}

/* ------------------------------- Order list ------------------------------- */

export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = { to_order: "To order", ordered: "Ordered", on_site: "On site" };

export function MaterialForm({ prefill }: { prefill: Extract<FormPrefill, { form: "material" }> }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const m = prefill.materialId ? data.materials.find((x) => x.id === prefill.materialId) : undefined;
  const f = useForm({ jobId: m?.jobId ?? prefill.jobId ?? "", item: m?.item ?? "", quantity: m?.quantity ?? "", supplier: m?.supplier ?? "", neededBy: m?.neededBy ?? "", status: m?.status ?? "to_order" });
  const { values, errors, set } = f;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.run("saveMaterial", { input: { ...values, id: m?.id } });
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(m ? "Item updated" : `${values.item} added to the order list`);
    ui.closeForm();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <Field label="Job" htmlFor="mf-job" error={errors.jobId}>
        <NativeSelect id="mf-job" value={values.jobId} onChange={set("jobId")}>
          <option value="">Choose a job…</option>
          {data.jobs.filter((j) => isActiveJob(j) || j.id === values.jobId).map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} · {j.customerName}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field label="Item" htmlFor="mf-item" error={errors.item}>
          <Input id="mf-item" value={values.item} onChange={set("item")} placeholder="e.g. Plasterboard 12.5mm" aria-invalid={!!errors.item} />
        </Field>
        <Field label="Quantity" htmlFor="mf-qty" error={errors.quantity}>
          <Input id="mf-qty" value={values.quantity} onChange={set("quantity")} placeholder="e.g. 40" aria-invalid={!!errors.quantity} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Supplier (optional)" htmlFor="mf-sup">
          <Input id="mf-sup" value={values.supplier} onChange={set("supplier")} />
        </Field>
        <Field label="Needed by (optional)" htmlFor="mf-need" error={errors.neededBy}>
          <Input id="mf-need" type="date" value={values.neededBy} onChange={set("neededBy")} />
        </Field>
      </div>
      <Field label="Status" htmlFor="mf-status">
        <NativeSelect id="mf-status" value={values.status} onChange={set("status")}>
          {(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((s) => (
            <option key={s} value={s}>
              {MATERIAL_STATUS_LABEL[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Actions label={m ? "Save item" : "Add item"} busy={f.busy} onCancel={ui.closeForm} />
    </form>
  );
}

/* ---------------------------------- Bill ---------------------------------- */

export function BillForm({ prefill }: { prefill: Extract<FormPrefill, { form: "bill" }> }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const f = useForm({ supplier: "", description: "", amount: "", dueDate: todayKey(), jobId: prefill.jobId ?? "", reference: "" });
  const { values, errors, set } = f;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.run("createBill", { input: values });
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(`Bill from ${values.supplier} added`);
    ui.closeForm();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="From" htmlFor="bf-sup" error={errors.supplier}>
          <Input id="bf-sup" value={values.supplier} onChange={set("supplier")} placeholder="Supplier or subcontractor" aria-invalid={!!errors.supplier} />
        </Field>
        <Field label="Amount (£)" htmlFor="bf-amt" error={errors.amount}>
          <Input id="bf-amt" inputMode="decimal" value={values.amount} onChange={set("amount")} aria-invalid={!!errors.amount} />
        </Field>
        <Field label="What for" htmlFor="bf-desc" error={errors.description} className="sm:col-span-2">
          <Input id="bf-desc" value={values.description} onChange={set("description")} aria-invalid={!!errors.description} />
        </Field>
        <Field label="Due" htmlFor="bf-due" error={errors.dueDate}>
          <Input id="bf-due" type="date" value={values.dueDate} onChange={set("dueDate")} />
        </Field>
        <Field label="Their reference (optional)" htmlFor="bf-ref">
          <Input id="bf-ref" value={values.reference} onChange={set("reference")} />
        </Field>
        <Field label="Job (optional)" htmlFor="bf-job" className="sm:col-span-2">
          <NativeSelect id="bf-job" value={values.jobId} onChange={set("jobId")}>
            <option value="">Not for a particular job</option>
            {data.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} · {j.customerName}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Actions label="Add bill" busy={f.busy} onCancel={ui.closeForm} />
    </form>
  );
}
