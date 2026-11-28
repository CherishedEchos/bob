"use client";

/**
 * One job to price, designed around two moments:
 *  - Luke on site: open the record, tap Add note / Take photo / Add measurement,
 *    and see it straight away. Notes are the main thing (dictation where the
 *    phone supports it). Everything is office-only.
 *  - Ryan later: the estimate (or quote draft) is in a fixed place near the top
 *    — beside the notes on a desktop, right under the three actions on a phone —
 *    however many photos have been added.
 * Status is one labelled control; starting an estimate is a separate action.
 * Nothing here marks a quote as sent or contacts the customer.
 */
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Calculator, Camera, CheckCircle2, FileText, Lock, MapPin, Mic, Navigation, NotebookPen, Phone, Ruler, Square, Upload, X, XCircle } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { Enquiry, Job, JobFile, Measurement, Quote } from "@/lib/types";
import { estimateTotals, savedEstimate } from "@/lib/estimate";
import { ACCEPT, MAX_UPLOAD_MB, MAX_VIDEO_MB } from "@/lib/files/upload";
import { useSpeechRecognition } from "@/lib/voice/use-speech";
import { cn, gbp, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { FileViewer, Thumb } from "@/components/files/files-panel";
import { UploadQueue } from "@/components/files/upload-queue";
import { pricingStageOf, STAGE_LABEL } from "@/components/pricing/stage";

type Panel = "note" | "measurement" | null;

export default function PricingRecordPage() {
  const { id } = useParams<{ id: string }>();
  const { data, can, refresh } = useStore();
  const [panel, setPanel] = React.useState<Panel>(null);
  const [picked, setPicked] = React.useState<File[] | null>(null);
  const e = data.enquiries.find((x) => x.id === id);
  if (!e)
    return (
      <div className="max-w-[1100px]">
        <BackLink />
        <p className="mt-6 text-[16px]">This pricing record wasn&apos;t found.</p>
      </div>
    );
  const job = e.jobId ? data.jobs.find((j) => j.id === e.jobId) : undefined;
  const write = can("enquiries.write") && !job && e.status !== "lost";
  const files = data.files.filter((f) => f.enquiryId === e.id && !f.deletedAt);

  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <BackLink />
      <Header e={e} job={job} write={write} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
        {/* Site visit: the main working area */}
        <div className="flex min-w-0 flex-col gap-4">
          {write ? (
            <section aria-label="Site visit" className="grid grid-cols-3 gap-2">
              <ActionButton icon={NotebookPen} label="Add note" primary active={panel === "note"} onClick={() => setPanel(panel === "note" ? null : "note")} />
              <PhotoButton onPick={setPicked} />
              <ActionButton icon={Ruler} label="Add measurement" active={panel === "measurement"} onClick={() => setPanel(panel === "measurement" ? null : "measurement")} />
            </section>
          ) : null}
          {panel === "note" && write ? <NoteComposer enquiryId={e.id} onDone={() => setPanel(null)} /> : null}
          {panel === "measurement" && write ? <MeasurementComposer e={e} onDone={() => setPanel(null)} /> : null}

          {/* Phone: pricing comes straight after the three actions, before the history. */}
          <div className="lg:hidden">
            <PricePanel e={e} job={job} />
          </div>

          <History e={e} files={files} write={write} onUpload={setPicked} />
        </div>

        {/* Desktop: pricing beside the site notes, always in the same place. */}
        <aside className="sticky top-4 hidden lg:block">
          <PricePanel e={e} job={job} />
        </aside>
      </div>

      {picked ? (
        <UploadQueue
          target={{ enquiryId: e.id }}
          files={picked}
          onClose={() => setPicked(null)}
          onSaved={async () => {
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/pricing" className="inline-flex h-10 items-center gap-1.5 self-start text-[15px] font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> Jobs to price
    </Link>
  );
}

/* ------------------------------ Header ------------------------------ */

function Header({ e, job, write }: { e: Enquiry; job?: Job; write: boolean }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const stage = pricingStageOf(e, data.quotes);
  const [editingAddress, setEditingAddress] = React.useState(false);
  const status = job ? "Now a job" : e.status === "lost" ? "Not going ahead" : STAGE_LABEL[stage];
  const setStage = async (s: string) => {
    const r = await actions.run("updatePricing", { id: e.id, patch: { stage: s } });
    toast(r.ok ? `Status: ${STAGE_LABEL[s as "to_visit" | "to_price"]}` : r.errors._ ?? "Couldn't change the status", r.ok ? "success" : "error");
  };
  return (
    <header className="panel flex flex-col gap-3 px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">{e.title}</h1>
          <button type="button" onClick={() => (e.customerId ? ui.openCustomer(e.customerId) : ui.openEnquiry(e.id))} className="mt-0.5 text-left text-[16.5px] font-semibold text-foreground hover:text-accent-fg">
            {e.customerName}
          </button>
        </div>
        <label className="flex shrink-0 items-center gap-2">
          <span className="text-[14.5px] font-medium text-muted-foreground">Status</span>
          {write && stage !== "quote_sent" ? (
            <NativeSelect value={stage} onChange={(ev) => void setStage(ev.target.value)} className="h-11 w-auto min-w-[140px] text-[15.5px] font-semibold" aria-label="Status">
              <option value="to_visit">To visit</option>
              <option value="to_price">To price</option>
            </NativeSelect>
          ) : (
            <span className={cn("rounded-lg px-3 py-2 text-[15px] font-semibold", job ? "bg-emerald-50 text-emerald-800" : "bg-surface-3 text-foreground")} data-testid="status">
              {status}
            </span>
          )}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {e.phone ? (
          <Button asChild size="sm" variant="secondary">
            <a href={`tel:${e.phone.replace(/\s/g, "")}`}>
              <Phone /> Call {e.customerName.split(/\s+/)[0]}
            </a>
          </Button>
        ) : null}
        {e.siteAddress && !editingAddress ? (
          <span className="flex min-w-0 max-w-full items-center gap-1">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.siteAddress)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-lg px-1 text-[15px] font-medium text-foreground hover:text-accent-fg">
              <Navigation className="size-4 shrink-0 text-copper-600" aria-hidden /> <span className="min-w-0 break-words">{e.siteAddress}</span>
            </a>
            {write ? (
              <button type="button" onClick={() => setEditingAddress(true)} className="h-10 shrink-0 rounded-lg px-2 text-[14.5px] font-medium text-muted-foreground hover:text-foreground">
                Change
              </button>
            ) : null}
          </span>
        ) : write && !editingAddress ? (
          <button type="button" onClick={() => setEditingAddress(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-accent-fg hover:bg-copper-500/[0.08]">
            <MapPin className="size-4" aria-hidden /> Add address
          </button>
        ) : null}
      </div>
      {editingAddress ? <AddressEditor e={e} onDone={() => setEditingAddress(false)} /> : null}
      {job ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-emerald-800">
            <CheckCircle2 className="size-4" aria-hidden /> Accepted — this is a live job now.
          </p>
          <Button size="sm" onClick={() => ui.openJob(job.id)}>
            Open the job
          </Button>
        </div>
      ) : null}
    </header>
  );
}

function AddressEditor({ e, onDone }: { e: Enquiry; onDone: () => void }) {
  const { actions } = useStore();
  const [v, setV] = React.useState(e.siteAddress ?? "");
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    setBusy(true);
    const r = await actions.run("updatePricing", { id: e.id, patch: { siteAddress: v } });
    setBusy(false);
    if (!r.ok) return toast(r.errors._ ?? "Couldn't save the address", "error");
    toast("Address saved");
    onDone();
  };
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <Input autoFocus value={v} onChange={(ev) => setV(ev.target.value)} placeholder="House, street, town, postcode" aria-label="Site address" className="h-11 flex-1" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy} className="h-11">
          Save address
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} className="h-11">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------ Site-visit actions ------------------------------ */

function ActionButton({ icon: Icon, label, onClick, primary, active }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; primary?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl px-2 text-[15px] font-semibold leading-tight transition-colors",
        primary ? "bg-primary text-white shadow-[0_1px_2px_rgb(180_82_15/0.25)] hover:bg-copper-600" : "bg-card text-foreground ring-1 ring-line-strong hover:bg-raised-hover",
        active && !primary && "ring-2 ring-accent/50",
      )}
    >
      <Icon className={cn("size-[22px]", primary ? "text-white" : "text-copper-600")} aria-hidden />
      {label}
    </button>
  );
}

function PhotoButton({ onPick }: { onPick: (files: File[]) => void }) {
  return (
    <label className="flex min-h-[76px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl bg-card px-2 text-[15px] font-semibold leading-tight text-foreground ring-1 ring-line-strong transition-colors hover:bg-raised-hover focus-within:ring-2 focus-within:ring-ring">
      <Camera className="size-[22px] text-copper-600" aria-hidden />
      Take photo
      <input
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        aria-label="Take photo"
        onChange={(ev) => {
          const list = [...(ev.target.files ?? [])];
          ev.target.value = "";
          if (list.length) onPick(list);
        }}
      />
    </label>
  );
}

/** Notes first: type or dictate, save, and it appears straight away. Nothing is saved until "Save note". */
function NoteComposer({ enquiryId, onDone }: { enquiryId: string; onDone: () => void }) {
  const { actions } = useStore();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const append = (heard: string) => heard && setText((t) => (t.trim() ? `${t.trim()} ${heard}` : heard));
  const speech = useSpeechRecognition({ onAutoSend: append, onManualStop: append });
  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await actions.run("addEnquiryNote", { id: enquiryId, text });
    setBusy(false);
    if (!r.ok) return setError(Object.values(r.errors)[0] ?? "Couldn't save the note — it's still here. Try again.");
    toast("Note saved");
    setText("");
    onDone();
  };
  return (
    <section aria-label="New note" className="panel flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold">New note</span>
        <OfficeOnly />
      </div>
      <Textarea
        autoFocus
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        placeholder={speech.listening ? "Listening…" : "What did they ask for? e.g. Keep the bath, replace the shower, price the tiling separately"}
        aria-label="Note"
        className="min-h-28 text-[16px]"
      />
      {speech.interim ? <p className="text-[15px] italic text-muted-foreground">{speech.interim}</p> : null}
      {error || speech.error ? <p role="alert" className="text-[15px] text-danger-fg">{error ?? speech.error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void save()} disabled={!text.trim() || busy} className="h-11">
          {busy ? "Saving…" : "Save note"}
        </Button>
        {speech.supported ? (
          <Button type="button" variant={speech.listening ? "default" : "secondary"} onClick={() => (speech.listening ? speech.stop() : speech.start())} className="h-11">
            {speech.listening ? <Square /> : <Mic />} {speech.listening ? "Stop" : "Speak"}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onDone} className="h-11">
          Cancel
        </Button>
      </div>
    </section>
  );
}

const UNITS = ["mm", "cm", "m", "m²", "m³", "each", ""] as const;

/** One measurement at a time, with its unit. Saves straight away; a quiet confirmation, no permanent "Saved" button. */
function MeasurementComposer({ e, onDone }: { e: Enquiry; onDone: () => void }) {
  const { actions } = useStore();
  const [label, setLabel] = React.useState("");
  const [value, setValue] = React.useState("");
  const [unit, setUnit] = React.useState<(typeof UNITS)[number]>("mm");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    if (!label.trim() || !value.trim()) return setError("Say what you measured and the size.");
    setBusy(true);
    setError(null);
    const next: Pick<Measurement, "id" | "label" | "value">[] = [...(e.measurements ?? []), { id: undefined as unknown as string, label: label.trim(), value: unit ? `${value.trim()} ${unit}` : value.trim() }];
    const r = await actions.run("updatePricing", { id: e.id, patch: { measurements: next.map((m) => ({ id: m.id || undefined, label: m.label, value: m.value })) } });
    setBusy(false);
    if (!r.ok) return setError(Object.values(r.errors)[0] ?? "Couldn't save — your measurement is still here. Try again.");
    toast(`Saved: ${label.trim()} ${value.trim()}${unit ? ` ${unit}` : ""}`);
    setLabel("");
    setValue("");
    onDone();
  };
  return (
    <form
      aria-label="New measurement"
      className="panel flex flex-col gap-2 px-4 py-3.5"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <span className="text-[15px] font-semibold">New measurement</span>
      <Input autoFocus value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder="What, e.g. Bathroom width" aria-label="What you measured" className="h-12 text-[16px]" />
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <Input value={value} onChange={(ev) => setValue(ev.target.value)} inputMode="decimal" placeholder="Size, e.g. 2150" aria-label="Size" className="h-12 text-[16px]" />
        <NativeSelect value={unit} onChange={(ev) => setUnit(ev.target.value as (typeof UNITS)[number])} aria-label="Unit" className="h-12 text-[16px]">
          {UNITS.map((u) => (
            <option key={u || "none"} value={u}>
              {u || "no unit"}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error ? <p role="alert" className="text-[15px] text-danger-fg">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="h-11">
          {busy ? "Saving…" : "Save measurement"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} className="h-11">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OfficeOnly() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[12.5px] font-semibold text-muted-foreground" title="Only you and the office see this — never the customer or subcontractors">
      <Lock className="size-3" aria-hidden /> Office only
    </span>
  );
}

/* ------------------------------ What's been recorded ------------------------------ */

function History({ e, files, write, onUpload }: { e: Enquiry; files: JobFile[]; write: boolean; onUpload: (files: File[]) => void }) {
  const { actions } = useStore();
  const [allNotes, setAllNotes] = React.useState(false);
  const [allPhotos, setAllPhotos] = React.useState(false);
  const [viewing, setViewing] = React.useState<{ list: JobFile[]; index: number } | null>(null);
  const notes = [...e.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const photos = files.filter((f) => f.mimeType.startsWith("image/")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const others = files.filter((f) => !f.mimeType.startsWith("image/")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const measurements = e.measurements ?? [];
  const empty = !notes.length && !photos.length && !others.length && !measurements.length;
  const removeMeasurement = async (m: Measurement) => {
    const r = await actions.run("updatePricing", { id: e.id, patch: { measurements: measurements.filter((x) => x.id !== m.id) } });
    toast(r.ok ? `Removed: ${m.label}` : "Couldn't remove it", r.ok ? "success" : "error");
  };
  const NOTES = 3;
  const PHOTOS = 6;

  return (
    <section aria-label="Site visit notes" className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5 sm:px-6">
        <h2 className="t-section">Site visit</h2>
        <OfficeOnly />
      </div>
      {empty ? (
        <p className="px-5 py-4 text-[15px] text-muted-foreground sm:px-6">Nothing recorded yet.</p>
      ) : null}

      {notes.length ? (
        <div className="px-5 py-3.5 sm:px-6">
          <h3 className="t-eyebrow">Notes</h3>
          <ul className="mt-1.5 flex flex-col gap-3" aria-label="Notes">
            {(allNotes ? notes : notes.slice(0, NOTES)).map((n) => (
              <li key={n.id}>
                <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-foreground">{n.text}</p>
                <p className="mt-0.5 text-[13.5px] text-subtle">
                  {n.author} · {timeAgo(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
          {notes.length > NOTES ? (
            <button type="button" onClick={() => setAllNotes((v) => !v)} className="mt-2 h-10 text-[15px] font-semibold text-accent-fg">
              {allNotes ? "Show fewer" : `View all ${notes.length} notes`}
            </button>
          ) : null}
        </div>
      ) : null}

      {photos.length ? (
        <div className="border-t border-line px-5 py-3.5 sm:px-6">
          <h3 className="t-eyebrow">Photos</h3>
          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Photos">
            {(allPhotos ? photos : photos.slice(0, PHOTOS)).map((f, i) => (
              <li key={f.id}>
                <button type="button" onClick={() => setViewing({ list: photos, index: i })} aria-label={`View ${f.title ?? f.filename}`} className="block aspect-square w-full overflow-hidden rounded-lg ring-1 ring-line">
                  <Thumb file={f} className="size-full" />
                </button>
              </li>
            ))}
          </ul>
          {photos.length > PHOTOS ? (
            <button type="button" onClick={() => setAllPhotos((v) => !v)} className="mt-2 h-10 text-[15px] font-semibold text-accent-fg">
              {allPhotos ? "Show fewer" : `View all ${photos.length} photos`}
            </button>
          ) : null}
        </div>
      ) : null}

      {measurements.length ? (
        <div className="border-t border-line px-5 py-3.5 sm:px-6">
          <h3 className="t-eyebrow">Measurements</h3>
          <ul className="mt-1.5 divide-y divide-line" aria-label="Measurements">
            {measurements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 text-[15.5px] text-foreground">{m.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="tabular text-[16px] font-semibold text-heading">{m.value}</span>
                  {write ? (
                    <button type="button" onClick={() => void removeMeasurement(m)} aria-label={`Remove ${m.label}`} className="grid size-10 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-danger-fg">
                      <X className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {others.length ? (
        <div className="border-t border-line px-5 py-3.5 sm:px-6">
          <h3 className="t-eyebrow">Videos and documents</h3>
          <ul className="mt-1.5 divide-y divide-line" aria-label="Videos and documents">
            {others.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => (f.previewable ? setViewing({ list: [f], index: 0 }) : window.open(`/api/files/${f.id}?download=1`, "_blank"))} className="flex w-full items-center gap-3 py-2 text-left">
                  <Thumb file={f} className="size-11 shrink-0 rounded-lg" />
                  <span className="min-w-0 truncate text-[15px] font-medium">{f.title ?? f.filename}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {write ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-3 sm:px-6">
          <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-1 text-[15px] font-semibold text-foreground hover:text-accent-fg focus-within:ring-2 focus-within:ring-ring">
            <Upload className="size-4 text-subtle" aria-hidden /> Upload files
            <input
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              aria-label="Upload files"
              onChange={(ev) => {
                const list = [...(ev.target.files ?? [])];
                ev.target.value = "";
                if (list.length) onUpload(list);
              }}
            />
          </label>
          <span className="text-[13.5px] text-subtle">
            Videos up to {MAX_VIDEO_MB} MB (about a minute), photos, drawings and documents up to {MAX_UPLOAD_MB} MB
          </span>
        </div>
      ) : null}
      {viewing ? <FileViewer list={viewing.list} index={viewing.index} onIndex={(i) => setViewing({ ...viewing, index: i })} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}

/* ------------------------------ Pricing (fixed place) ------------------------------ */

function PricePanel({ e, job }: { e: Enquiry; job?: Job }) {
  const { data, can, org, actions } = useStore();
  const router = useRouter();
  const quotes = data.quotes.filter((q) => q.enquiryId === e.id);
  const estimatesOn = !!org.features?.roughEstimates && can("quotes.write");
  const est = savedEstimate(e);
  const totals = est ? estimateTotals(est, org.finance) : null;
  const done = !!job || e.status === "lost";
  const [quoting, setQuoting] = React.useState(false);
  if (!can("quotes.write") && !can("jobs.write")) return null;

  return (
    <section aria-label="Price" className="panel flex flex-col gap-3 px-5 py-4" data-testid="price-panel">
      <h2 className="t-section">Price</h2>
      {estimatesOn && !done ? (
        <Link
          href={`/pricing/${e.id}/estimate`}
          className="flex items-center gap-3 rounded-xl bg-primary px-4 py-3 text-white shadow-[0_1px_2px_rgb(180_82_15/0.25)] transition-colors hover:bg-copper-600"
          data-testid="estimate-action"
        >
          <Calculator className="size-[22px] shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[16px] font-semibold">{est ? "Continue estimate" : "Start rough estimate"}</span>
            {est && totals ? (
              <span className="block text-[14px] text-white/85">
                {totals.range ? `${gbp(totals.range.low)} – ${gbp(totals.range.high)}` : gbp(totals.gross)}
                {totals.missing.length ? ` · ${totals.missing.length} price${totals.missing.length === 1 ? "" : "s"} missing` : ""}
              </span>
            ) : (
              <span className="block text-[14px] text-white/85">From your prices and measurements</span>
            )}
          </span>
        </Link>
      ) : null}

      {quotes.length ? <QuoteList enquiryId={e.id} quotes={quotes} done={done} /> : null}
      {!done && can("quotes.write") ? (
        quoting ? (
          <QuoteForm enquiryId={e.id} onDone={() => setQuoting(false)} />
        ) : (
          <Button type="button" variant={estimatesOn ? "ghost" : "secondary"} onClick={() => setQuoting(true)} className={estimatesOn ? "self-start" : "h-12"}>
            <FileText /> {estimatesOn ? "Or create a quote draft by hand" : "Create quote draft"}
          </Button>
        )
      ) : null}

      {!done && can("jobs.write") ? (
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
      <p className="text-[13px] text-subtle">Nothing here sends anything to the customer.</p>
    </section>
  );
}

function QuoteForm({ enquiryId, onDone }: { enquiryId: string; onDone: () => void }) {
  const { actions } = useStore();
  const [amount, setAmount] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <form
      className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const r = await actions.run("preparePricingQuote", { id: enquiryId, amount, description: desc });
        if (!r.ok) return setErrors(r.errors);
        toast("Quote draft saved — it hasn't been sent");
        onDone();
      }}
    >
      <Input value={desc} onChange={(ev) => setDesc(ev.target.value)} placeholder="What's included (optional)" aria-label="Quote description" className="h-11" />
      <Input value={amount} onChange={(ev) => setAmount(ev.target.value)} inputMode="decimal" placeholder="Amount £" aria-label="Quote amount" aria-invalid={!!errors.amount} className="h-11" />
      {errors.amount || errors._ ? <p className="text-[14px] text-danger-fg">{errors.amount ?? errors._}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save quote draft
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function QuoteList({ enquiryId, quotes, done }: { enquiryId: string; quotes: Quote[]; done: boolean }) {
  const { actions } = useStore();
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [ticked, setTicked] = React.useState(false);
  return (
    <ul className="divide-y divide-line rounded-xl ring-1 ring-line" aria-label="Quotes">
      {quotes.map((q) => (
        <li key={q.id} className="px-3.5 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[15px] font-medium">{q.description}</span>
            <span className="text-[16px] font-bold tabular">{gbp(q.amount)}</span>
          </div>
          <p className="text-[13.5px] text-muted-foreground">{q.status === "draft" ? "Quote draft — not sent" : q.status === "sent" ? `Sent${q.sentAt ? ` ${timeAgo(q.sentAt)}` : ""}` : q.status === "accepted" ? "Accepted" : "Declined"}</p>
          {q.status === "draft" && !done ? (
            confirm === q.id ? (
              <div className="mt-2 rounded-lg bg-surface-2 p-2.5">
                <label className="flex items-start gap-2 text-[14.5px]">
                  <input type="checkbox" checked={ticked} onChange={(ev) => setTicked(ev.target.checked)} className="mt-1 size-4 accent-[var(--color-accent)]" />
                  I&apos;ve sent this quote to the customer (email, text, post or by hand).
                </label>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={!ticked}
                    onClick={async () => {
                      const r = await actions.run("markPricingQuoteSent", { id: enquiryId, quoteId: q.id, confirmed: ticked });
                      setConfirm(null);
                      setTicked(false);
                      toast(r.ok ? "Recorded as sent" : r.errors._ ?? "Couldn't record it", r.ok ? "success" : "error");
                    }}
                  >
                    Record as sent
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => (setConfirm(null), setTicked(false))}>
                    Not yet
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirm(q.id)} className="mt-1 h-9 text-[14.5px] font-semibold text-accent-fg">
                I&apos;ve sent it
              </button>
            )
          ) : null}
        </li>
      ))}
    </ul>
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
    <div className="border-t border-line pt-3">
      {sure === "yes" ? (
        <div className="rounded-xl bg-selected p-3 text-[14.5px]">
          <p>Creates one live job with the customer, address, measurements, notes and photos. Prices and the estimate stay here.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void run(onAccept)} disabled={busy}>
              {busy ? "Creating…" : "Create the job"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSure(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : sure === "no" ? (
        <div className="rounded-xl bg-surface-2 p-3 text-[14.5px]">
          <p>Take it off Jobs to price? Nothing is deleted.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void run(onDecline)} disabled={busy}>
              Not going ahead
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSure(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setSure("yes")}>
            <CheckCircle2 /> Customer accepted
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSure("no")}>
            <XCircle /> Not going ahead
          </Button>
        </div>
      )}
    </div>
  );
}
