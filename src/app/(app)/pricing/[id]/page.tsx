"use client";

/**
 * One job to price, built for a phone at the end of a site visit: the site,
 * photos and short videos, measurements, private notes (dictation where the
 * phone supports it), optionally a rough estimate, then the quote — prepared
 * and sent as separate steps — and finally "Customer accepted", which creates
 * one live job. Every section saves on its own, so leaving halfway is safe.
 */
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, CheckCircle2, FileText, Lock, MapPin, Navigation, Plus, Ruler, Trash2, XCircle } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { Job, Measurement, Quote } from "@/lib/types";
import { cn, gbp, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { FilesPanel } from "@/components/files/files-panel";
import { NotesPanel } from "@/components/common/notes";
import { EstimatePanel } from "@/components/pricing/estimate-panel";
import { pricingStageOf, STAGE_LABEL, STAGE_TONE } from "@/components/pricing/stage";

export default function PricingRecordPage() {
  const { id } = useParams<{ id: string }>();
  const { data, actions, can, org } = useStore();
  const ui = useUI();
  const router = useRouter();
  const e = data.enquiries.find((x) => x.id === id);
  if (!e)
    return (
      <div className="max-w-[860px]">
        <Link href="/pricing" className="inline-flex h-10 items-center gap-1.5 text-[15px] font-medium text-muted-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Jobs to price
        </Link>
        <p className="mt-6 text-[16px]">This pricing record wasn&apos;t found.</p>
      </div>
    );
  const stage = pricingStageOf(e, data.quotes);
  const quotes = data.quotes.filter((q) => q.enquiryId === e.id);
  const job = e.jobId ? data.jobs.find((j) => j.id === e.jobId) : undefined;
  const write = can("enquiries.write");

  const setStage = async (s: "to_visit" | "to_price") => {
    const r = await actions.run("updatePricing", { id: e.id, patch: { stage: s } });
    if (!r.ok) toast(r.errors._ ?? "Couldn't change the stage", "error");
  };

  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <Link href="/pricing" className="inline-flex h-10 items-center gap-1.5 self-start text-[15px] font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Jobs to price
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2.5 py-0.5 text-[13.5px] font-semibold", job ? "bg-emerald-50 text-emerald-800" : e.status === "lost" ? "bg-surface-3 text-muted-foreground" : STAGE_TONE[stage])}>
            {job ? "Now a job" : e.status === "lost" ? "Not going ahead" : STAGE_LABEL[stage]}
          </span>
          <span className="text-[14px] text-subtle">Added {timeAgo(e.pricingAt ?? e.receivedAt)}</span>
        </div>
        <h1 className="t-page">{e.title}</h1>
        <button type="button" onClick={() => (e.customerId ? ui.openCustomer(e.customerId) : ui.openEnquiry(e.id))} className="self-start text-[16px] font-semibold text-foreground hover:text-accent-fg">
          {e.customerName}
          {e.phone ? <span className="font-normal text-muted-foreground"> · {e.phone}</span> : null}
        </button>
      </header>

      {job ? (
        <div className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="flex items-center gap-2 text-[16px] font-semibold text-good-fg">
            <CheckCircle2 className="size-5" aria-hidden /> Accepted — this is now a live job.
          </p>
          <Button onClick={() => ui.openJob(job.id)}>Open the job</Button>
        </div>
      ) : write && stage !== "quote_sent" && e.status !== "lost" ? (
        <div className="grid grid-cols-2 rounded-xl bg-surface-3 p-1" role="radiogroup" aria-label="Stage">
          {(["to_visit", "to_price"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={stage === s} onClick={() => void setStage(s)} className={cn("h-11 rounded-lg text-[15.5px] font-semibold transition", stage === s ? "bg-card text-heading shadow-[var(--shadow-xs)]" : "text-subtle")}>
              {STAGE_LABEL[s]}
            </button>
          ))}
        </div>
      ) : null}

      <SiteAddress enquiryId={e.id} value={e.siteAddress ?? ""} disabled={!write || !!job} />

      <section aria-labelledby="media-h" className="panel overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <h2 id="media-h" className="t-section">Photos and videos</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-subtle">
            <Lock className="size-3.5" aria-hidden /> Office only. Photos up to 25 MB, videos up to 60 MB (about a minute). A failed upload can be retried — nothing else is lost.
          </p>
        </div>
        <div className="p-3 sm:p-4">
          <FilesPanel enquiryId={e.id} compact allowVideo />
        </div>
      </section>

      <Measurements enquiryId={e.id} saved={e.measurements ?? []} disabled={!write || !!job} />

      <section aria-labelledby="notes-h" className="panel overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <h2 id="notes-h" className="t-section">Private notes</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-subtle">
            <Lock className="size-3.5" aria-hidden /> Only you and the office see these — never the customer or subcontractors.
          </p>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <NotesPanel notes={e.notes} dictate placeholder="Thoughts on price, access, materials…" onAdd={(text) => actions.run("addEnquiryNote", { id: e.id, text })} />
        </div>
      </section>

      {org.features?.roughEstimates && can("quotes.write") && !job ? <EstimatePanel enquiry={e} /> : null}

      {can("quotes.write") ? <QuoteSection enquiryId={e.id} quotes={quotes} done={!!job || e.status === "lost"} /> : null}

      {!job && e.status !== "lost" && can("jobs.write") ? (
        <Decision
          onAccept={async () => {
            const r = await actions.run<Job & { existed: boolean }>("acceptPricing", { id: e.id });
            if (!r.ok) return toast(r.errors._ ?? "Couldn't create the job", "error");
            toast(r.value.existed ? "That job already exists — opening it" : `Job created: ${r.value.title}`);
            router.push(`/jobs/${r.value.id}`);
          }}
          onDecline={async () => {
            const r = await actions.run("declinePricing", { id: e.id });
            toast(r.ok ? "Marked as not going ahead" : r.errors._ ?? "Couldn't update", r.ok ? "success" : "error");
          }}
        />
      ) : null}
    </div>
  );
}

function SiteAddress({ enquiryId, value, disabled }: { enquiryId: string; value: string; disabled: boolean }) {
  const { actions } = useStore();
  const [v, setV] = React.useState(value);
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  React.useEffect(() => setV(value), [value]);
  const save = async () => {
    if (v.trim() === value.trim()) return;
    setState("saving");
    const r = await actions.run("updatePricing", { id: enquiryId, patch: { siteAddress: v } });
    setState(r.ok ? "saved" : "error");
  };
  return (
    <section aria-labelledby="site-h" className="panel px-5 py-4 sm:px-6">
      <h2 id="site-h" className="t-section flex items-center gap-2">
        <MapPin className="size-5 text-copper-600" aria-hidden /> Site
      </h2>
      <div className="mt-2 flex gap-2">
        <Input value={v} onChange={(e) => (setV(e.target.value), setState("idle"))} onBlur={() => void save()} disabled={disabled} placeholder="House, street, town, postcode" aria-label="Site address" className="h-12 text-[16px]" />
        {value ? (
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(value)}`} target="_blank" rel="noreferrer" className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-card px-3.5 text-[15px] font-semibold ring-1 ring-line-strong">
            <Navigation className="size-4 text-copper-600" aria-hidden /> <span className="hidden sm:inline">Directions</span>
          </a>
        ) : null}
      </div>
      <p className="mt-1 text-[13.5px] text-subtle">{state === "saving" ? "Saving…" : state === "saved" ? "Saved. It carries to the job — no retyping." : state === "error" ? "Couldn't save — check your signal and tap out of the box again." : "Saved when you leave the box. Carried to the job when it's accepted."}</p>
    </section>
  );
}

function Measurements({ enquiryId, saved, disabled }: { enquiryId: string; saved: Measurement[]; disabled: boolean }) {
  const { actions } = useStore();
  const [rows, setRows] = React.useState<{ id?: string; label: string; value: string }[]>(saved.length ? saved : []);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const savedKey = JSON.stringify(saved.map((m) => [m.label, m.value]));
  const dirty = JSON.stringify(rows.filter((r) => r.label || r.value).map((m) => [m.label, m.value])) !== savedKey;
  React.useEffect(() => {
    if (!dirty) setRows(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh from the server only when nothing is being edited
  }, [savedKey]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    const r = await actions.run("updatePricing", { id: enquiryId, patch: { measurements: rows.filter((m) => m.label.trim() || m.value.trim()) } });
    setBusy(false);
    if (!r.ok) setErr(Object.values(r.errors)[0] ?? "Couldn't save — your measurements are still here. Try again.");
    else toast("Measurements saved");
  };
  return (
    <section aria-labelledby="meas-h" className="panel overflow-hidden">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 id="meas-h" className="t-section flex items-center gap-2">
          <Ruler className="size-5 text-copper-600" aria-hidden /> Measurements
        </h2>
      </div>
      <div className="flex flex-col gap-2 px-5 py-4 sm:px-6">
        {rows.map((r, i) => (
          <div key={r.id ?? `row-${i}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input value={r.label} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} placeholder="e.g. Left alcove width" aria-label={`Measurement ${i + 1} name`} disabled={disabled} className="h-11" />
            <Input value={r.value} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} placeholder="e.g. 1020 mm" aria-label={`Measurement ${i + 1} value`} disabled={disabled} className="h-11" />
            <button type="button" aria-label={`Remove measurement ${i + 1}`} disabled={disabled} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="grid size-11 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-danger-fg">
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        {!rows.length ? <p className="text-[15px] text-muted-foreground">No measurements yet.</p> : null}
        {err ? <p role="alert" className="text-[15px] text-danger-fg">{err}</p> : null}
        {!disabled ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((x) => [...x, { label: "", value: "" }])}>
              <Plus /> Add measurement
            </Button>
            <Button type="button" size="sm" onClick={() => void save()} disabled={!dirty || busy}>
              {busy ? "Saving…" : dirty ? "Save measurements" : <><Check /> Saved</>}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function QuoteSection({ enquiryId, quotes, done }: { enquiryId: string; quotes: Quote[]; done: boolean }) {
  const { actions } = useStore();
  const [amount, setAmount] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [ticked, setTicked] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const prepare = async () => {
    const r = await actions.run("preparePricingQuote", { id: enquiryId, amount, description: desc });
    if (!r.ok) return setErrors(r.errors);
    setAmount("");
    setDesc("");
    setErrors({});
    toast("Quote draft saved — it hasn't been sent");
  };
  const markSent = async (quoteId: string) => {
    const r = await actions.run("markPricingQuoteSent", { id: enquiryId, quoteId, confirmed: ticked });
    if (!r.ok) return setErrors(r.errors);
    setConfirm(null);
    setTicked(false);
    toast("Recorded as sent");
  };
  return (
    <section aria-labelledby="quote-h" className="panel overflow-hidden">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 id="quote-h" className="t-section flex items-center gap-2">
          <FileText className="size-5 text-copper-600" aria-hidden /> Quote
        </h2>
        <p className="mt-0.5 text-[14px] text-subtle">Preparing a quote doesn&apos;t send it. It&apos;s only &ldquo;Quote sent&rdquo; once you&apos;ve sent it and say so here.</p>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4 sm:px-6">
        {quotes.length ? (
          <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
            {quotes.map((q) => (
              <li key={q.id} className="px-3.5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15.5px] font-semibold">{q.description}</span>
                  <span className="text-[16px] font-bold tabular">{gbp(q.amount)}</span>
                </div>
                <p className="text-[14px] text-muted-foreground">{q.status === "draft" ? "Draft — not sent" : q.status === "sent" ? `Sent${q.sentAt ? ` ${timeAgo(q.sentAt)}` : ""}` : q.status === "accepted" ? "Accepted" : "Declined"}</p>
                {q.status === "draft" && !done ? (
                  confirm === q.id ? (
                    <div className="mt-2 rounded-lg bg-surface-2 p-3">
                      <label className="flex items-start gap-2.5 text-[15px]">
                        <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} className="mt-1 size-4 accent-[var(--color-accent)]" />
                        I&apos;ve sent this quote to the customer (by email, text, post or by hand).
                      </label>
                      {errors.confirmed ? <p className="mt-1 text-[14px] text-danger-fg">{errors.confirmed}</p> : null}
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => void markSent(q.id)} disabled={!ticked}>
                          Record as sent
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => (setConfirm(null), setTicked(false))}>
                          Not yet
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" className="mt-2" onClick={() => setConfirm(q.id)}>
                      I&apos;ve sent it
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!done ? (
          <form
            className="grid gap-2 sm:grid-cols-[1fr_160px_auto]"
            onSubmit={(ev) => {
              ev.preventDefault();
              void prepare();
            }}
          >
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What's included (optional)" aria-label="Quote description" className="h-11" />
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount £" aria-label="Quote amount" aria-invalid={!!errors.amount} className="h-11" />
            <Button type="submit" variant="secondary" className="h-11">
              Prepare quote
            </Button>
            {errors.amount || errors._ ? <p className="text-[14px] text-danger-fg sm:col-span-3">{errors.amount ?? errors._}</p> : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}

function Decision({ onAccept, onDecline }: { onAccept: () => Promise<void>; onDecline: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [sure, setSure] = React.useState<"yes" | "no" | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn();
    setBusy(false);
    setSure(null);
  };
  return (
    <section aria-label="Customer's answer" className="panel flex flex-col gap-3 px-5 py-4 sm:px-6">
      <h2 className="t-section">Customer&apos;s answer</h2>
      {sure === "yes" ? (
        <div className="rounded-xl bg-selected p-3 text-[15px]">
          <p>This creates one live job with the customer, site address, measurements, notes and photos. Prices and the rough estimate stay here.</p>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => void run(onAccept)} disabled={busy}>
              {busy ? "Creating…" : "Create the job"}
            </Button>
            <Button variant="ghost" onClick={() => setSure(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : sure === "no" ? (
        <div className="rounded-xl bg-surface-2 p-3 text-[15px]">
          <p>Take it off Jobs to price? Nothing is deleted.</p>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={() => void run(onDecline)} disabled={busy}>
              Not going ahead
            </Button>
            <Button variant="ghost" onClick={() => setSure(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSure("yes")}>
            <CheckCircle2 /> Customer accepted
          </Button>
          <Button variant="ghost" onClick={() => setSure("no")}>
            <XCircle /> Not going ahead
          </Button>
        </div>
      )}
    </section>
  );
}
