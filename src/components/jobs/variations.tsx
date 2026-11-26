"use client";

/** Variations on a job: changes to the agreed work and price, with their VAT treatment and whether they've been billed. */
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Job, Variation } from "@/lib/types";
import { useStore } from "@/lib/store/store";
import { gbp } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { StatusText } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";

const VAT: Record<Variation["amountsAre"], string> = { inclusive: "incl. VAT", exclusive: "+ VAT", no_vat: "no VAT" };

export function VariationsPanel({ job }: { job: Job }) {
  const { data, actions, can } = useStore();
  const list = data.variations.filter((v) => v.jobId === job.id);
  const invoices = data.invoices.filter((i) => i.jobId === job.id && i.status !== "void");
  const [adding, setAdding] = React.useState(false);
  const [v, setV] = React.useState({ description: "", amount: "", amountsAre: "no_vat" as Variation["amountsAre"], status: "approved" as Variation["status"], invoiceId: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const write = can("quotes.write");
  return (
    <section className="border-b border-line px-5 py-4 sm:px-6" aria-labelledby={`var-${job.id}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`var-${job.id}`} className="t-eyebrow">Variations</h3>
        {write && !adding ? <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus /> Add variation</Button> : null}
      </div>
      {list.length ? (
        <ul className="mt-1 divide-y divide-line">
          {list.map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{x.description}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-[14.5px] text-muted-foreground">
                  <StatusText tone={x.status === "approved" ? "green" : x.status === "proposed" ? "amber" : "neutral"}>{x.status === "approved" ? "Approved" : x.status === "proposed" ? "Proposed" : "Declined"}</StatusText>
                  <span>{VAT[x.amountsAre]}</span>
                  <span>{x.invoiceId ? `Billed on ${invoices.find((i) => i.id === x.invoiceId)?.number ?? invoices.find((i) => i.id === x.invoiceId)?.draftRef ?? "an invoice"}` : "Not billed yet"}</span>
                </span>
              </span>
              <span className="tabular text-[15.5px] font-semibold">{gbp(x.amount)}</span>
              {write ? <button type="button" aria-label={`Remove ${x.description}`} onClick={async () => { const r = await actions.run("deleteVariation", { id: x.id }); toast(r.ok ? "Variation removed" : r.errors._ || "Couldn't remove", r.ok ? "success" : "error"); }} className="grid size-9 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-danger-fg"><Trash2 className="size-4" /></button> : null}
            </li>
          ))}
        </ul>
      ) : !adding ? <p className="mt-1 text-[15px] text-muted-foreground">No variations. Add one when the customer agrees a change to the work or price.</p> : null}
      {adding ? (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await actions.run("saveVariation", { input: { jobId: job.id, ...v } });
            if (!r.ok) return setErrors(r.errors as Record<string, string>);
            toast("Variation saved");
            setAdding(false);
            setErrors({});
            setV({ description: "", amount: "", amountsAre: "no_vat", status: "approved", invoiceId: "" });
          }}
        >
          <Field label="What changed" htmlFor="var-desc" error={errors.description} className="sm:col-span-2"><Input id="var-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="e.g. Extra cupboard above the fridge" /></Field>
          <Field label="Amount (£)" htmlFor="var-amt" error={errors.amount}><Input id="var-amt" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
          <Field label="VAT" htmlFor="var-vat"><NativeSelect id="var-vat" value={v.amountsAre} onChange={(e) => setV({ ...v, amountsAre: e.target.value as Variation["amountsAre"] })}><option value="no_vat">No VAT</option><option value="inclusive">Including VAT</option><option value="exclusive">Plus VAT</option></NativeSelect></Field>
          <Field label="Status" htmlFor="var-status"><NativeSelect id="var-status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Variation["status"] })}><option value="approved">Approved by the customer</option><option value="proposed">Proposed</option><option value="declined">Declined</option></NativeSelect></Field>
          <Field label="Billed on invoice (optional)" htmlFor="var-inv" error={errors.invoiceId}><NativeSelect id="var-inv" value={v.invoiceId} onChange={(e) => setV({ ...v, invoiceId: e.target.value })}><option value="">Not billed yet</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.number ?? i.draftRef} · {gbp(i.total)}</option>)}</NativeSelect></Field>
          {errors._ ? <p role="alert" className="text-[15px] text-danger-fg sm:col-span-2">{errors._}</p> : null}
          <div className="flex gap-2 sm:col-span-2"><Button type="submit" size="sm">Save variation</Button><Button size="sm" variant="ghost" onClick={() => { setAdding(false); setErrors({}); }}>Cancel</Button></div>
        </form>
      ) : null}
    </section>
  );
}
