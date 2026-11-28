"use client";

/**
 * Extras on a job (stored as variations). The figures read plainly:
 * original agreed price + approved extras = revised agreed total, with
 * proposed extras shown separately and never counted. Recording an approval
 * says who logged it, when and how the customer said so — it never implies the
 * customer approved in Bob. Nothing here invoices or emails anyone.
 */
import * as React from "react";
import { Camera, Check, Plus, Trash2, X } from "lucide-react";
import type { ApprovalVia, Job, Variation } from "@/lib/types";
import { useStore } from "@/lib/store/store";
import { gbp } from "@/lib/utils";
import { newClientRef, uploadFile } from "@/lib/files/upload";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { StatusText } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";
import { Thumb } from "@/components/files/files-panel";

const VAT: Record<Variation["amountsAre"], string> = { inclusive: "incl. VAT", exclusive: "+ VAT", no_vat: "no VAT" };
const VIA: Record<ApprovalVia, string> = { phone: "by phone", email: "by email", text: "by text", in_person: "in person", written: "in writing", other: "" };
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Original price, approved extras and the revised total (proposed kept apart). Pure, for tests and the screen. */
export function extrasSummary(job: Pick<Job, "id" | "quotedValue">, variations: Variation[]) {
  const mine = variations.filter((v) => v.jobId === job.id);
  const approved = mine.filter((v) => v.status === "approved").reduce((s, v) => s + v.amount, 0);
  const proposed = mine.filter((v) => v.status === "proposed").reduce((s, v) => s + v.amount, 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { original: r(job.quotedValue), approved: r(approved), revised: r(job.quotedValue + approved), proposed: r(proposed), count: mine.length };
}

export function ExtrasPanel({ job }: { job: Job }) {
  const { data, can, org } = useStore();
  const list = data.variations.filter((v) => v.jobId === job.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sum = extrasSummary(job, data.variations);
  const defaultVat: Variation["amountsAre"] = org.finance.vatRegistered === false ? "no_vat" : org.finance.pricesAre === "inclusive" ? "inclusive" : org.finance.vatRegistered ? "exclusive" : "no_vat";
  const [adding, setAdding] = React.useState(false);
  const write = can("quotes.write");

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Agreed price with extras" className="panel grid grid-cols-1 overflow-hidden sm:grid-cols-3">
        {[
          { label: "Original agreed price", value: sum.original, cls: "text-heading" },
          { label: "Approved extras", value: sum.approved, cls: "text-heading", prefix: "+ " },
          { label: "Revised agreed total", value: sum.revised, cls: "text-heading font-bold", strong: true },
        ].map((c, i) => (
          <div key={c.label} className={i ? "border-t border-line px-5 py-4 sm:border-l sm:border-t-0" : "px-5 py-4"}>
            <div className="text-[14px] font-medium text-subtle">{c.label}</div>
            <div className={`mt-0.5 tabular ${c.strong ? "text-[30px]" : "text-[24px]"} font-semibold leading-tight ${c.cls}`} data-testid={c.strong ? "revised-total" : undefined}>
              {c.prefix ?? ""}
              {gbp(c.value)}
            </div>
          </div>
        ))}
      </section>
      {sum.proposed ? (
        <p className="-mt-2 px-1 text-[15px] text-warn-fg" data-testid="proposed-total">
          {gbp(sum.proposed)} proposed and waiting for the customer — not in the total until you record their approval.
        </p>
      ) : null}

      <section className="panel overflow-hidden" aria-labelledby={`extras-${job.id}`}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-4 sm:px-6">
          <h2 id={`extras-${job.id}`} className="t-section">Extras</h2>
          {write && !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add an extra
            </Button>
          ) : null}
        </div>
        {adding ? <AddExtra job={job} defaultVat={defaultVat} onDone={() => setAdding(false)} /> : null}
        {list.length ? (
          <ul className="divide-y divide-line">
            {list.map((x) => (
              <ExtraRow key={x.id} extra={x} write={write} />
            ))}
          </ul>
        ) : !adding ? (
          <p className="px-5 py-5 text-[15px] text-muted-foreground sm:px-6">No extras yet. Add one when extra work comes up — e.g. &ldquo;Additional oak shelving — £450&rdquo;.</p>
        ) : null}
        <p className="border-t border-line px-5 py-3 text-[13.5px] text-subtle sm:px-6">
          Adding or approving an extra doesn&apos;t send an invoice or an email. Subcontractors never see extras or prices.
        </p>
      </section>
    </div>
  );
}

function AddExtra({ job, defaultVat, onDone }: { job: Job; defaultVat: Variation["amountsAre"]; onDone: () => void }) {
  const { actions, refresh } = useStore();
  const [v, setV] = React.useState({ description: "", amount: "", amountsAre: defaultVat, note: "", status: "proposed" as Variation["status"], approvalVia: "phone" as ApprovalVia, decisionNote: "" });
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const save = async () => {
    setErrors({});
    let fileId: string | undefined;
    if (photo) {
      setProgress(0);
      const up = await uploadFile(photo, { jobId: job.id, category: "progress", title: `Extra: ${v.description || "photo"}`, visibility: "office", clientRef: newClientRef() }, (f) => setProgress(f));
      setProgress(null);
      if (!up.ok) return setErrors({ photo: `${up.error} Your extra hasn't been saved yet — try again or remove the photo.` });
      fileId = up.file.id;
      await refresh();
    }
    const r = await actions.run("saveVariation", {
      input: { jobId: job.id, description: v.description, amount: v.amount, amountsAre: v.amountsAre, note: v.note, fileId, status: v.status, approvalVia: v.status === "proposed" ? undefined : v.approvalVia, decisionNote: v.status === "proposed" ? undefined : v.decisionNote },
    });
    if (!r.ok) return setErrors(r.errors as Record<string, string>);
    toast(v.status === "approved" ? "Extra added and approval recorded" : v.status === "declined" ? "Extra added as declined" : "Extra added as proposed");
    onDone();
  };
  return (
    <form
      className="grid gap-3 border-b border-line bg-surface-2/50 px-5 py-4 sm:grid-cols-2 sm:px-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Extra work" htmlFor="ex-desc" error={errors.description} className="sm:col-span-2">
        <Input id="ex-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="e.g. Additional oak shelving" />
      </Field>
      <Field label="Amount (£)" htmlFor="ex-amt" error={errors.amount}>
        <Input id="ex-amt" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="450" />
      </Field>
      <Field label="VAT" htmlFor="ex-vat">
        <NativeSelect id="ex-vat" value={v.amountsAre} onChange={(e) => setV({ ...v, amountsAre: e.target.value as Variation["amountsAre"] })}>
          <option value="no_vat">No VAT</option>
          <option value="inclusive">Including VAT</option>
          <option value="exclusive">Plus VAT</option>
        </NativeSelect>
      </Field>
      <Field label="Short description (optional)" htmlFor="ex-note" className="sm:col-span-2">
        <Textarea id="ex-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} className="min-h-16" placeholder="Three extra shelves in the left alcove, oiled to match" />
      </Field>
      <div className="sm:col-span-2">
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-card px-4 text-[15px] font-semibold ring-1 ring-line-strong">
          <Camera className="size-[18px] text-subtle" aria-hidden /> {photo ? photo.name : "Add a photo (optional)"}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        {photo ? (
          <button type="button" className="ml-2 text-[14.5px] font-medium text-muted-foreground" onClick={() => setPhoto(null)}>
            Remove
          </button>
        ) : null}
        {progress !== null ? <p className="mt-1 text-[14px] text-muted-foreground">Uploading… {Math.round(progress * 100)}%</p> : null}
        {errors.photo ? <p role="alert" className="mt-1 text-[14px] text-danger-fg">{errors.photo}</p> : null}
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="text-[15px] font-semibold">Customer&apos;s answer</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {(["proposed", "approved", "declined"] as const).map((s) => (
            <label key={s} className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl text-[15px] font-medium ring-1 ${v.status === s ? "bg-selected ring-accent/40" : "bg-card ring-line"}`}>
              <input type="radio" name="ex-status" className="sr-only" checked={v.status === s} onChange={() => setV({ ...v, status: s })} />
              {s === "proposed" ? "Not yet" : s === "approved" ? "Approved" : "Declined"}
            </label>
          ))}
        </div>
      </fieldset>
      {v.status !== "proposed" ? <Decision v={v} setV={(p) => setV({ ...v, ...p })} /> : null}
      {errors._ ? <p role="alert" className="text-[15px] text-danger-fg sm:col-span-2">{errors._}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={progress !== null}>
          Save extra
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Decision({ v, setV }: { v: { status: Variation["status"]; approvalVia: ApprovalVia; decisionNote: string }; setV: (p: Partial<{ approvalVia: ApprovalVia; decisionNote: string }>) => void }) {
  return (
    <>
      <Field label={`How did the customer ${v.status === "approved" ? "agree" : "say no"}?`} htmlFor="ex-via">
        <NativeSelect id="ex-via" value={v.approvalVia} onChange={(e) => setV({ approvalVia: e.target.value as ApprovalVia })}>
          <option value="phone">By phone</option>
          <option value="email">By email</option>
          <option value="text">By text or WhatsApp</option>
          <option value="in_person">In person</option>
          <option value="written">In writing</option>
          <option value="other">Other</option>
        </NativeSelect>
      </Field>
      <Field label="Note (optional)" htmlFor="ex-dnote">
        <Input id="ex-dnote" value={v.decisionNote} onChange={(e) => setV({ decisionNote: e.target.value })} placeholder="e.g. Agreed with Sophie on site" />
      </Field>
      <p className="-mt-1 text-[13.5px] text-subtle sm:col-span-2">Bob records that you logged this — not that the customer approved it in Bob.</p>
    </>
  );
}

function ExtraRow({ extra: x, write }: { extra: Variation; write: boolean }) {
  const { data, actions } = useStore();
  const [deciding, setDeciding] = React.useState<"approved" | "declined" | null>(null);
  const [d, setD] = React.useState({ approvalVia: "phone" as ApprovalVia, decisionNote: "" });
  const photo = x.fileId ? data.files.find((f) => f.id === x.fileId && !f.deletedAt) : undefined;
  const invoice = x.invoiceId ? data.invoices.find((i) => i.id === x.invoiceId) : undefined;
  const decide = async (status: Variation["status"]) => {
    const r = await actions.run("decideVariation", { id: x.id, status, approvalVia: status === "proposed" ? undefined : d.approvalVia, decisionNote: status === "proposed" ? undefined : d.decisionNote });
    setDeciding(null);
    toast(r.ok ? (status === "approved" ? "Approval recorded" : status === "declined" ? "Decline recorded" : "Back to proposed") : r.errors._ ?? "Couldn't save", r.ok ? "success" : "error");
  };
  return (
    <li className="px-5 py-4 sm:px-6">
      <div className="flex items-start gap-3">
        {photo ? <Thumb file={photo} className="size-14 shrink-0 rounded-lg ring-1 ring-line" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[16px] font-semibold text-heading">{x.description}</span>
            <span className={`tabular text-[17px] font-bold ${x.status === "declined" ? "text-muted-foreground line-through" : ""}`}>{gbp(x.amount)}</span>
          </div>
          {x.note ? <p className="mt-0.5 text-[15px] text-foreground/90">{x.note}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-muted-foreground">
            <StatusText tone={x.status === "approved" ? "green" : x.status === "proposed" ? "amber" : "neutral"}>{x.status === "approved" ? "Approved" : x.status === "proposed" ? "Proposed" : "Declined"}</StatusText>
            <span>{VAT[x.amountsAre]}</span>
            {invoice ? <span>Billed on {invoice.number ?? invoice.draftRef}</span> : null}
          </div>
          <p className="mt-1 text-[14px] text-subtle" data-testid="extra-record">
            {x.status === "proposed"
              ? `Added by ${x.createdBy}, ${day(x.createdAt)}. Waiting for the customer.`
              : `${x.status === "approved" ? "Approval" : "Decline"} recorded by ${x.decidedBy ?? x.createdBy}${x.decidedAt ? `, ${day(x.decidedAt)}` : ""}${x.approvalVia && VIA[x.approvalVia] ? ` · customer said so ${VIA[x.approvalVia]}` : ""}${x.decisionNote ? ` · “${x.decisionNote}”` : ""}`}
          </p>
        </div>
      </div>
      {write ? (
        deciding ? (
          <div className="mt-3 grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-2">
            <Decision v={{ status: deciding, ...d }} setV={(p) => setD({ ...d, ...p })} />
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" onClick={() => void decide(deciding)}>
                {deciding === "approved" ? "Record approval" : "Record decline"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {x.status !== "approved" ? (
              <Button size="sm" variant="secondary" onClick={() => setDeciding("approved")}>
                <Check /> Record approval
              </Button>
            ) : null}
            {x.status !== "declined" ? (
              <Button size="sm" variant="ghost" onClick={() => setDeciding("declined")}>
                <X /> Record decline
              </Button>
            ) : null}
            {x.status !== "proposed" ? (
              <Button size="sm" variant="ghost" onClick={() => void decide("proposed")}>
                Back to proposed
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${x.description}`}
              onClick={async () => {
                const r = await actions.run("deleteVariation", { id: x.id });
                toast(r.ok ? "Extra removed" : r.errors._ || "Couldn't remove", r.ok ? "success" : "error");
              }}
            >
              <Trash2 />
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

/** Back-compat: older imports. */
export const VariationsPanel = ExtrasPanel;
