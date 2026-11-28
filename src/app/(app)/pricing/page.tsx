"use client";

/**
 * Jobs to price: site visits and quotes in progress. Compact list (customer,
 * short job name, location, stage), filtered by stage. Add one straight from a
 * phone call or referral; enquiries come in with "Add to jobs to price".
 * Separate from Jobs, so Active/Completed stays clean.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ClipboardList, Plus } from "lucide-react";
import { useStore } from "@/lib/store/store";
import type { Enquiry } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { EmptyState, PageHeader, Tabs, pageActionClass } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { onPricingStage, pricingStageOf, STAGE_LABEL, STAGE_TONE, type Stage } from "@/components/pricing/stage";

export default function PricingPage() {
  const { data, can } = useStore();
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage | "all">("all");
  const [adding, setAdding] = React.useState(false);
  const list = data.enquiries.filter(onPricingStage).map((e) => ({ e, stage: pricingStageOf(e, data.quotes) }));
  const shown = list.filter((x) => stage === "all" || x.stage === stage).sort((a, b) => (b.e.pricingAt ?? b.e.receivedAt).localeCompare(a.e.pricingAt ?? a.e.receivedAt));
  const count = (s: Stage) => list.filter((x) => x.stage === s).length;

  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <PageHeader
        title="Jobs to price"
        subtitle={list.length ? `${count("to_visit")} to visit · ${count("to_price")} to price · ${count("quote_sent")} quote sent` : "Site visits and quotes in progress"}
        actions={
          can("enquiries.write") ? (
            <button type="button" className={pageActionClass} onClick={() => setAdding(true)}>
              <Plus className="size-[18px]" aria-hidden /> Add job to price
            </button>
          ) : null
        }
      />
      <Tabs
        label="Stage"
        className="self-start"
        value={stage}
        onChange={setStage}
        options={[
          { value: "all", label: "All", count: list.length || undefined },
          { value: "to_visit", label: "To visit", count: count("to_visit") || undefined },
          { value: "to_price", label: "To price", count: count("to_price") || undefined },
          { value: "quote_sent", label: "Quote sent", count: count("quote_sent") || undefined },
        ]}
      />
      {shown.length ? (
        <ul className="panel divide-y divide-line overflow-hidden" aria-label="Jobs to price">
          {shown.map(({ e, stage: st }) => (
            <li key={e.id}>
              <Link href={`/pricing/${e.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 sm:px-5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[16.5px] font-bold leading-snug text-heading">{e.title}</span>
                  <span className="block text-[15px] text-muted-foreground">
                    {e.customerName}
                    {e.siteAddress || e.location ? ` · ${e.siteAddress || e.location}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[13.5px] font-semibold", STAGE_TONE[st])}>{STAGE_LABEL[st]}</span>
                  <span className="hidden text-[13px] text-subtle sm:block">{timeAgo(e.pricingAt ?? e.receivedAt)}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={stage === "all" ? "Nothing to price yet" : `Nothing in ${STAGE_LABEL[stage]}`}
          body="Add a job from a phone call or referral, or open an enquiry and tap Add to jobs to price."
        />
      )}
      <AddPricing open={adding} onClose={() => setAdding(false)} onCreated={(id) => router.push(`/pricing/${id}`)} />
    </div>
  );
}

/** Straight in from a phone call or referral. Pick an existing customer so nobody is created twice. */
function AddPricing({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { data, actions } = useStore();
  const [v, setV] = React.useState({ customerId: "", customerName: "", phone: "", email: "", title: "", siteAddress: "", how: "phone", note: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setV({ customerId: "", customerName: "", phone: "", email: "", title: "", siteAddress: "", how: "phone", note: "" });
      setErrors({});
    }
  }, [open]);
  const q = v.customerName.trim().toLowerCase();
  const matches = !v.customerId && q.length >= 2 ? data.customers.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3) : [];
  const chosen = data.customers.find((c) => c.id === v.customerId);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    const r = await actions.run<Enquiry>("createPricing", { input: { ...v, customerId: v.customerId || undefined } });
    setBusy(false);
    if (!r.ok) return setErrors(r.errors);
    onClose();
    onCreated(r.value.id);
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Add job to price">
        <form
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-8 pt-6 sm:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 className="pr-12 text-[22px] font-bold tracking-tight">Add job to price</h2>
          {chosen ? (
            <p className="rounded-xl bg-selected px-3 py-2 text-[15px]">
              For <strong>{chosen.name}</strong>
              {chosen.address ? ` · ${chosen.address}` : ""}.{" "}
              <button type="button" className="font-semibold text-accent-fg" onClick={() => setV((x) => ({ ...x, customerId: "" }))}>
                Change
              </button>
            </p>
          ) : (
            <>
              <Field label="Customer" htmlFor="pr-name" error={errors.customerName}>
                <Input id="pr-name" value={v.customerName} onChange={set("customerName")} autoComplete="off" placeholder="Their name" />
              </Field>
              {matches.length ? (
                <div className="-mt-2 flex flex-col gap-1.5" role="group" aria-label="Existing customers">
                  {matches.map((c) => (
                    <button key={c.id} type="button" onClick={() => setV((x) => ({ ...x, customerId: c.id, siteAddress: x.siteAddress || c.address || "" }))} className="rounded-lg bg-surface-2 px-3 py-2 text-left text-[15px] hover:bg-surface-3">
                      Use existing customer: <strong>{c.name}</strong>
                      {c.town ? ` · ${c.town}` : ""}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone" htmlFor="pr-phone" error={errors.phone}>
                  <Input id="pr-phone" type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} />
                </Field>
                <Field label="Email (optional)" htmlFor="pr-email" error={errors.email}>
                  <Input id="pr-email" type="email" inputMode="email" autoCapitalize="none" value={v.email} onChange={set("email")} />
                </Field>
              </div>
            </>
          )}
          <Field label="Job" htmlFor="pr-title" error={errors.title} hint="A short name, e.g. Alcove units or Fitted wardrobes">
            <Input id="pr-title" value={v.title} onChange={set("title")} />
          </Field>
          <Field label="Site address" htmlFor="pr-site" error={errors.siteAddress}>
            <Input id="pr-site" value={v.siteAddress} onChange={set("siteAddress")} placeholder="House, street, town, postcode" />
          </Field>
          <Field label="How it came in" htmlFor="pr-how">
            <NativeSelect id="pr-how" value={v.how} onChange={set("how")}>
              <option value="phone">Phone call</option>
              <option value="referral">Referral</option>
              <option value="site">Seen on site</option>
              <option value="other">Other</option>
            </NativeSelect>
          </Field>
          <Field label="What they want (optional)" htmlFor="pr-note">
            <Textarea id="pr-note" value={v.note} onChange={set("note")} className="min-h-20" />
          </Field>
          {errors._ ? <p role="alert" className="text-[15px] text-danger-fg">{errors._}</p> : null}
          <Button type="submit" disabled={busy} className="h-12">
            {busy ? "Saving…" : "Add to jobs to price"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
