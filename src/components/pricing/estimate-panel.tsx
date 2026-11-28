"use client";

/**
 * Rough estimate (pilot): describe the work, enter the measurements Luke took,
 * get suggested lines from the workspace's own prices, then change any
 * quantity, rate or allowance and watch the total update. Lines with no price
 * stay unpriced and are listed. Turning it into a quote makes a draft only.
 */
import * as React from "react";
import { AlertTriangle, Calculator, FileText, Plus, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useStore } from "@/lib/store/store";
import type { Enquiry, EstimateLine, RoughEstimate } from "@/lib/types";
import { estimateTotals, lineTotal, savedEstimate, suggestFittedFurniture, type FittedFurnitureInput } from "@/lib/estimate";
import { cn, gbp } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

const SOURCE_LABEL: Record<EstimateLine["source"], string> = { rate_card: "Your price list", entered: "Typed in", allowance: "Allowance", missing: "No price yet" };
const SOURCE_TONE: Record<EstimateLine["source"], string> = { rate_card: "text-good-fg", entered: "text-foreground/70", allowance: "text-sky-800", missing: "font-semibold text-danger-fg" };

let k = 0;
const newId = () => `new_${Date.now().toString(36)}_${(k++).toString(36)}`;

export function EstimatePanel({ enquiry }: { enquiry: Enquiry }) {
  const { data, actions, org } = useStore();
  const saved = savedEstimate(enquiry);
  const [desc, setDesc] = React.useState(saved?.description ?? enquiry.description ?? "");
  const [lines, setLines] = React.useState<EstimateLine[]>(saved?.lines ?? []);
  const [range, setRange] = React.useState<string>(saved?.rangePercent ? String(saved.rangePercent) : "");
  const [questions, setQuestions] = React.useState<string[]>(saved?.questions ?? []);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Resume what was measured last time (older drafts didn't keep it).
  const [ff, setFf] = React.useState<FittedFurnitureInput>({ units: 2, widthMm: 0, heightMm: 0, depthMm: 0, shelvesPerUnit: 3, doorsPerUnit: 2, days: 0, people: 1, finish: "", ...(saved?.inputs as Partial<FittedFurnitureInput> | undefined) });
  const card = org.pricing;
  const totals = estimateTotals({ lines, rangePercent: range ? Number(range) : null }, org.finance);
  const quote = saved?.quoteId ? data.quotes.find((q) => q.id === saved.quoteId) : undefined;

  const edit = (id: string, patch: Partial<EstimateLine>) => {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const suggest = () => {
    const s = suggestFittedFurniture(ff, card);
    setLines((ls) => [...ls.filter((l) => l.source === "allowance" || l.source === "entered"), ...s.lines]);
    setQuestions(s.questions);
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    const est: Omit<RoughEstimate, "updatedAt" | "updatedBy" | "kind"> = { description: desc, lines: lines.map((l) => ({ ...l, id: l.id.startsWith("new_") ? (undefined as unknown as string) : l.id })), rangePercent: range ? Number(range) : null, questions, inputs: { ...ff } as unknown as Record<string, number | string> };
    const r = await actions.run("saveEstimate", { id: enquiry.id, estimate: est });
    setBusy(false);
    if (!r.ok) return toast(Object.values(r.errors)[0] ?? "Couldn't save the estimate", "error");
    setDirty(false);
    toast("Rough estimate saved");
  };
  const toQuote = async () => {
    if (dirty) await save();
    setBusy(true);
    const r = await actions.run("estimateToQuote", { id: enquiry.id });
    setBusy(false);
    toast(r.ok ? "Quote draft made — nothing has been sent" : r.errors._ ?? "Couldn't make the quote", r.ok ? "success" : "error");
  };
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  return (
    <section aria-labelledby="est-h" className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4 sm:px-6">
        <h2 id="est-h" className="t-section flex items-center gap-2">
          <Calculator className="size-5 text-copper-600" aria-hidden /> Rough estimate
        </h2>
        <span className="rounded-full bg-surface-3 px-2.5 py-0.5 text-[13px] font-semibold text-muted-foreground">Pilot · fitted furniture</span>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4 sm:px-6">
        <label className="block">
          <span className="text-[15px] font-semibold">The work</span>
          <Textarea value={desc} onChange={(e) => (setDesc(e.target.value), setDirty(true))} placeholder="e.g. Built-in oak alcove units either side of the chimney, three open shelves each side, shaker doors below" className="mt-1 min-h-20" />
        </label>

        <fieldset className="rounded-xl bg-surface-2 p-3.5">
          <legend className="px-1 text-[15px] font-semibold">What you measured</legend>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {([
              ["units", "Units"],
              ["widthMm", "Width (mm)"],
              ["heightMm", "Height (mm)"],
              ["depthMm", "Depth (mm)"],
              ["shelvesPerUnit", "Shelves each"],
              ["doorsPerUnit", "Doors each"],
              ["days", "Days to make & fit"],
              ["people", "People"],
            ] as const).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-[13.5px] font-medium text-muted-foreground">{label}</span>
                <Input inputMode="decimal" value={ff[key] ? String(ff[key]) : ""} onChange={(e) => (setFf((x) => ({ ...x, [key]: num(e.target.value) })), setDirty(true))} className="mt-0.5 h-11" aria-label={label} />
              </label>
            ))}
            <label className="col-span-2 block">
              <span className="text-[13.5px] font-medium text-muted-foreground">Finish</span>
              <Input value={ff.finish ?? ""} onChange={(e) => (setFf((x) => ({ ...x, finish: e.target.value })), setDirty(true))} placeholder="e.g. painted, oiled oak" className="mt-0.5 h-11" aria-label="Finish" />
            </label>
          </div>
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={suggest}>
            <Wand2 /> Suggest lines from my prices
          </Button>
          <p className="mt-2 text-[13.5px] text-subtle">
            Uses {card?.items.length || card?.labourDayRate ? "your price list" : "your price list (empty so far)"} and these measurements. A photo can&apos;t give exact sizes or costs — measure on site.{" "}
            <Link href="/settings?open=prices" className="font-semibold text-accent-fg">
              Prices
            </Link>
          </p>
        </fieldset>

        {questions.length ? (
          <div className="rounded-xl bg-[#fff7ed] p-3.5 text-[15px]" role="note">
            <p className="flex items-center gap-2 font-semibold text-warn-fg">
              <AlertTriangle className="size-4" aria-hidden /> Still needed
            </p>
            <ul className="mt-1 list-disc pl-6 text-foreground/90">
              {questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {lines.length ? (
          <div className="overflow-hidden rounded-xl ring-1 ring-line">
            <ul className="divide-y divide-line" aria-label="Estimate lines">
              {lines.map((l) => {
                const t = lineTotal(l);
                return (
                  <li key={l.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 px-3.5 py-3">
                    <Input value={l.label} onChange={(e) => edit(l.id, { label: e.target.value })} className="h-10 text-[15px] font-medium" aria-label="Line" />
                    <button type="button" aria-label={`Remove ${l.label}`} onClick={() => (setLines((ls) => ls.filter((x) => x.id !== l.id)), setDirty(true))} className="grid size-10 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-danger-fg">
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                    <div className="col-span-2 flex flex-wrap items-center gap-2 text-[15px]">
                      <Input
                        inputMode="decimal"
                        value={String(l.qty)}
                        onChange={(e) => edit(l.id, { qty: num(e.target.value), note: l.note && !l.note.startsWith("You changed") ? `You changed the quantity (suggested: ${l.note})` : l.note })}
                        className="h-10 w-20 tabular"
                        aria-label={`Quantity for ${l.label}`}
                      />
                      <span className="text-muted-foreground">{l.unit} ×</span>
                      <span className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
                        <Input
                          inputMode="decimal"
                          value={l.rate === null ? "" : String(l.rate)}
                          placeholder="price"
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            edit(l.id, v === "" ? { rate: null, source: "missing" } : { rate: Number(v), source: l.source === "allowance" ? "allowance" : l.source === "rate_card" && Number(v) === l.rate ? "rate_card" : "entered" });
                          }}
                          className={cn("h-10 w-28 pl-6 tabular", l.rate === null && "ring-2 ring-destructive/40")}
                          aria-label={`Price for ${l.label}`}
                        />
                      </span>
                      <span className="ml-auto text-right font-semibold tabular">{t === null ? <span className="text-danger-fg">—</span> : gbp(t)}</span>
                    </div>
                    <p className="col-span-2 text-[13.5px]">
                      <span className={SOURCE_TONE[l.source]}>{SOURCE_LABEL[l.source]}</span>
                      {l.note ? <span className="text-subtle"> · {l.note}</span> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="text-[15px] text-muted-foreground">No lines yet. Enter what you measured and tap Suggest lines, or add your own.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => (setLines((ls) => [...ls, { id: newId(), label: "", qty: 1, unit: "each", rate: null, source: "missing" }]), setDirty(true))}>
            <Plus /> Add a line
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => (setLines((ls) => [...ls, { id: newId(), label: "Contingency allowance", qty: 1, unit: "item", rate: 0, source: "allowance", note: "Your allowance" }]), setDirty(true))}>
            <Plus /> Add an allowance
          </Button>
        </div>

        <dl className="rounded-xl bg-surface-2 p-3.5 text-[15px]" aria-label="Estimate total">
          <div className="flex justify-between"><dt className="text-muted-foreground">From your price list</dt><dd className="tabular">{gbp(totals.bySource.rate_card)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Typed in</dt><dd className="tabular">{gbp(totals.bySource.entered)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Allowances</dt><dd className="tabular">{gbp(totals.bySource.allowance)}</dd></div>
          {totals.vat ? (
            <div className="flex justify-between"><dt className="text-muted-foreground">VAT</dt><dd className="tabular">{gbp(totals.vat)}</dd></div>
          ) : null}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
            <dt className="font-semibold">Rough estimate</dt>
            <dd className="text-[22px] font-bold tabular" data-testid="estimate-total">{gbp(totals.gross)}</dd>
          </div>
          <p className="text-[13.5px] text-subtle">{totals.vatNote}.</p>
          {totals.missing.length ? (
            <p className="mt-1 text-[14.5px] font-medium text-danger-fg" data-testid="estimate-missing">
              {totals.missing.length} {totals.missing.length === 1 ? "line has" : "lines have"} no price and {totals.missing.length === 1 ? "isn't" : "aren't"} in the total: {totals.missing.map((l) => l.label || "Untitled").join(", ")}.
            </p>
          ) : null}
          <label className="mt-2 flex flex-wrap items-center gap-2 text-[14.5px]">
            Show a range of ±
            <Input inputMode="numeric" value={range} onChange={(e) => (setRange(e.target.value.replace(/[^\d.]/g, "")), setDirty(true))} className="h-9 w-16 tabular" aria-label="Range percent" />%
          </label>
          {totals.range ? (
            <p className="mt-1 font-semibold">
              Range: {gbp(totals.range.low)} – {gbp(totals.range.high)}
            </p>
          ) : totals.rangeNote ? (
            <p className="mt-1 text-[14px] text-subtle">{totals.rangeNote}</p>
          ) : null}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save estimate"}
          </Button>
          {!dirty && saved ? <span className="text-[14px] text-subtle" role="status">All changes saved</span> : null}
          {quote ? (
            <span className="text-[15px] text-muted-foreground">
              <FileText className="mr-1 inline size-4" aria-hidden />
              Quote {quote.status === "draft" ? "draft" : quote.status} for {gbp(quote.amount)}
            </span>
          ) : (
            <Button type="button" variant="secondary" onClick={() => void toQuote()} disabled={busy || !totals.complete}>
              <FileText /> Turn into a quote draft
            </Button>
          )}
        </div>
        <p className="text-[13.5px] text-subtle">
          A rough estimate is a working figure for you, not a quote. Nothing is sent to the customer from here.
          {saved ? ` Last saved by ${saved.updatedBy}.` : ""}
        </p>
      </div>
    </section>
  );
}
