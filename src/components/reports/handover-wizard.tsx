"use client";

/* eslint-disable @next/next/no-img-element -- private thumbnails from our own API */

/**
 * The customer handover, as five short steps on its own page:
 *   1 Job details · 2 Photos & documents · 3 Your report · 4 Costs · 5 Review & finish
 *
 * One step on screen at a time, one main action per step. Every change saves
 * itself (the same conflict-safe save as before: if Luke and Ryan both edit,
 * neither overwrites the other), and the step you were on is remembered, so
 * "Save & exit" and coming back later carries on exactly where you were.
 * The PDF, its numbered versions and the ZIP handover pack all live in step 5.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Camera, Check, ChevronDown, Copy, Download, ExternalLink, FileArchive, FileText, Loader2, Mail, Mic, Pencil, Plus, Sparkles, Square, Star, Wand2, X,
} from "lucide-react";
import type { Handover, HandoverReport, Job, JobFile, ReportContent, ReportSection, ReportSelection, ReportVersion } from "@/lib/types";
import { api, useStore } from "@/lib/store/store";
import { fileUrl } from "@/lib/files/upload";
import { MANUAL_COST_NOTE, manualCostLines, reportCostSummary } from "@/lib/report-costs";
import { cn, copyToClipboard, formatDateKey, gbp, timeAgo } from "@/lib/utils";
import { useSpeechRecognition } from "@/lib/voice/use-speech";
import { UploadButtons, UploadQueue } from "@/components/files/upload-queue";
import { toast } from "@/components/ui/toaster";

export const STEPS = ["Job details", "Photos & documents", "Your report", "Costs", "Review & finish"] as const;
type StepNo = 1 | 2 | 3 | 4 | 5;

export type HandoverStatus = "not_started" | "in_progress" | "ready";

/** Not started (no report) · In progress (being written, or edited since the last PDF) · Ready (a PDF matches the report). */
export function handoverStatus(report: HandoverReport | undefined, versions: ReportVersion[]): HandoverStatus {
  if (!report) return "not_started";
  const latest = [...versions].sort((a, b) => b.version - a.version)[0];
  return latest && latest.createdAt >= report.updatedAt ? "ready" : "in_progress";
}
export const HANDOVER_STATUS_LABEL: Record<HandoverStatus, string> = { not_started: "Not started", in_progress: "In progress", ready: "Ready" };

/* ------------------------------ Shared bits ------------------------------ */

const field = "block h-12 w-full rounded-xl border border-line-strong bg-field px-4 text-[16px] text-foreground outline-none transition placeholder:text-subtle focus:border-copper-500 focus:ring-[3px] focus:ring-copper-500/15";
const area = "block w-full rounded-xl border border-line-strong bg-field px-4 py-3 text-[16px] leading-relaxed text-foreground outline-none transition placeholder:text-subtle focus:border-copper-500 focus:ring-[3px] focus:ring-copper-500/15";

function BigButton({ children, onClick, disabled, variant = "primary", className, type = "button" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "ghost"; className?: string; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-5 text-[16px] font-semibold transition focus-visible:outline-none focus-visible:ring-[3px] disabled:cursor-default disabled:opacity-55 [&_svg]:size-5",
        variant === "primary" && "bg-copper-500 text-white shadow-[0_1px_2px_rgb(0_0_0/0.12)] hover:bg-copper-600 focus-visible:ring-copper-500/35",
        variant === "secondary" && "bg-card text-foreground ring-1 ring-line-strong hover:bg-surface-2 focus-visible:ring-copper-500/30",
        variant === "ghost" && "text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-copper-500/30",
        className,
      )}
    >
      {children}
    </button>
  );
}

function StepTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-heading sm:text-[28px]">{title}</h1>
      <p className="mt-1.5 text-[15.5px] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  );
}

function Fold({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-2xl bg-card ring-1 ring-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold text-heading">{title}</span>
          {hint && !open ? <span className="block truncate text-[13.5px] text-muted-foreground">{hint}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cn("size-5 shrink-0 text-subtle transition", open && "rotate-180")} />
      </button>
      {open ? <div className="border-t border-line px-4 pb-4 pt-3">{children}</div> : null}
    </div>
  );
}

async function downloadFile(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The download didn't work. Nothing was changed — try again.");
  }
  const blob = await res.blob();
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name ? decodeURIComponent(name) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

/* ------------------------------ Entry ------------------------------ */

export function HandoverWorkspace({ job }: { job: Job }) {
  const { data, actions, user, org } = useStore();
  const report = data.reports.find((r) => r.jobId === job.id);
  const [busy, setBusy] = React.useState(false);
  const manager = user.role === "owner" || user.role === "office";
  if (!manager) return <p className="py-16 text-center text-[15.5px] text-muted-foreground">Only an owner or admin can prepare a customer handover.</p>;
  if (!report)
    return (
      <div className="mx-auto max-w-xl py-6">
        <JobStrip job={job} />
        <div className="mt-8 rounded-3xl bg-card p-6 ring-1 ring-line sm:p-8">
          <div className="grid size-12 place-items-center rounded-2xl bg-selected text-accent-icon">
            <FileText className="size-6" aria-hidden />
          </div>
          <h1 className="mt-5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-heading">Customer handover pack</h1>
          <p className="mt-2 text-[16px] leading-relaxed text-muted-foreground">
            A professional, {org.shortName || org.name}-branded report for {job.customerName}: what was done, your best photos and, if you like, the costs — plus the drawings and certificates in one download. Bob fills in what it already knows; it takes about five minutes.
          </p>
          <BigButton
            className="mt-6 w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await actions.run("createReport", { jobId: job.id });
              setBusy(false);
              if (!r.ok) toast(r.errors._ || "Couldn't start the handover", "error");
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : null} Start the handover
          </BigButton>
          <p className="mt-3 text-center text-[13.5px] text-subtle">Nothing is sent to the customer until you choose to.</p>
        </div>
      </div>
    );
  return <Wizard key={report.id} job={job} report={report} />;
}

function JobStrip({ job, right }: { job: Job; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Link href={`/jobs/${encodeURIComponent(job.id)}`} aria-label={`Back to ${job.title}`} className="grid size-11 shrink-0 place-items-center rounded-full text-foreground/80 hover:bg-surface-3">
        <ArrowLeft className="size-5" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15.5px] font-semibold text-heading">{job.title}</div>
        <div className="truncate text-[13.5px] text-muted-foreground">
          {job.customerName} · {job.siteAddress || job.location}
        </div>
      </div>
      {right}
    </div>
  );
}

/* ------------------------------ Wizard ------------------------------ */

function Wizard({ job, report }: { job: Job; report: HandoverReport }) {
  const { data, actions } = useStore();
  const router = useRouter();
  const initialStep = (report.step && report.step >= 1 && report.step <= 5 ? report.step : 1) as StepNo;
  const [step, setStep] = React.useState<StepNo>(initialStep);
  const [sel, setSel] = React.useState<ReportSelection>(report.selection);
  const [content, setContent] = React.useState<ReportContent>(report.content);
  const [base, setBase] = React.useState(report.revision);
  const [dirty, setDirty] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"saved" | "saving" | "error">("saved");
  const [conflict, setConflict] = React.useState<HandoverReport | null>(null);
  const top = React.useRef<HTMLDivElement>(null);
  const inflight = React.useRef<Promise<boolean> | null>(null);
  const latest = React.useRef({ sel, content, base, dirty });
  latest.current = { sel, content, base, dirty };

  // Someone else's save arrives with the snapshot: take it only if nothing is being edited here.
  React.useEffect(() => {
    if (report.revision !== base && !dirty) {
      setSel(report.selection);
      setContent(report.content);
      setBase(report.revision);
    }
  }, [report.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = React.useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    const cur = latest.current;
    if (!cur.dirty) return true;
    setSaveState("saving");
    const p = (async () => {
      const r = await actions.run<HandoverReport>("saveReport", { id: report.id, baseRevision: cur.base, content: cur.content, selection: cur.sel, step });
      if (!r.ok) {
        if (r.code === "conflict" && r.current) setConflict(r.current as HandoverReport);
        setSaveState("error");
        return false;
      }
      // Keep anything typed while the save was on its way.
      const typedSince = latest.current.content !== cur.content || latest.current.sel !== cur.sel;
      setBase(r.value.revision);
      if (!typedSince) {
        setContent(r.value.content);
        setSel(r.value.selection);
        setDirty(false);
      }
      setSaveState("saved");
      return true;
    })();
    inflight.current = p;
    const ok = await p;
    inflight.current = null;
    return ok;
  }, [actions, report.id, step]);

  // Save a moment after each change.
  React.useEffect(() => {
    if (!dirty || conflict) return;
    const t = setTimeout(() => void save(), 900);
    return () => clearTimeout(t);
  }, [content, sel, dirty, conflict, save]);

  // Don't lose a pending change when the tab closes.
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const edit = (fn: (c: ReportContent) => ReportContent) => {
    setContent((c) => fn(c));
    setDirty(true);
  };
  const editSel = (fn: (s: ReportSelection) => ReportSelection) => {
    setSel((s) => fn(s));
    setDirty(true);
  };

  const go = async (to: StepNo) => {
    if (!(await save())) return toast("Couldn't save your changes. Check your connection and try again.", "error");
    setStep(to);
    void actions.run("saveReport", { id: report.id, step: to });
    top.current?.scrollIntoView({ block: "start" });
    document.querySelector("main")?.scrollTo({ top: 0 });
  };
  const exit = async () => {
    if (!(await save())) return toast("Couldn't save your changes. Check your connection and try again.", "error");
    await actions.run("saveReport", { id: report.id, step });
    router.push(`/jobs/${encodeURIComponent(job.id)}?tab=handover`);
  };

  const files = data.files.filter((f) => f.jobId === job.id && !f.deletedAt && !f.reportId);
  const versions = data.reportVersions.filter((v) => v.reportId === report.id).sort((a, b) => b.version - a.version);

  return (
    <div ref={top} className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-20 -mx-4 bg-background/95 px-4 pb-3 pt-1 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        <JobStrip
          job={job}
          right={
            <button type="button" onClick={() => void exit()} className="h-11 shrink-0 rounded-xl px-3 text-[14.5px] font-semibold text-foreground ring-1 ring-line-strong hover:bg-surface-2">
              Save &amp; exit
            </button>
          }
        />
        <Progress step={step} onGo={(s) => void go(s)} saveState={dirty && saveState === "saved" ? "pending" : saveState} />
      </header>

      {conflict ? (
        <div role="alert" className="mt-3 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-warn-fg">
            <AlertTriangle className="size-4" aria-hidden /> {conflict.updatedBy} changed this handover {timeAgo(conflict.updatedAt)}
          </p>
          <p className="mt-1 text-[14.5px]">Your latest changes are still on screen but weren&apos;t saved. Load their version to carry on from it.</p>
          <div className="mt-3 flex gap-2">
            <BigButton
              onClick={() => {
                setSel(conflict.selection);
                setContent(conflict.content);
                setBase(conflict.revision);
                setDirty(false);
                setConflict(null);
                setSaveState("saved");
              }}
            >
              Load their version
            </BigButton>
            <BigButton variant="ghost" onClick={() => setConflict(null)}>
              Keep my screen
            </BigButton>
          </div>
        </div>
      ) : null}

      <div className="flex-1 pb-6 pt-4">
        {step === 1 ? <StepDetails job={job} content={content} edit={edit} /> : null}
        {step === 2 ? <StepPhotos job={job} files={files} sel={sel} content={content} editSel={editSel} edit={edit} /> : null}
        {step === 3 ? <StepReport report={report} job={job} files={files} sel={sel} content={content} edit={edit} editSel={editSel} save={save} base={base} onDrafted={(r) => { setContent(r.content); setBase(r.revision); setDirty(false); }} /> : null}
        {step === 4 ? <StepCosts job={job} sel={sel} content={content} editSel={editSel} edit={edit} /> : null}
        {step === 5 ? <StepFinish job={job} report={report} sel={sel} content={content} versions={versions} base={base} dirty={dirty} save={save} onEdit={() => void go(3)} /> : null}
      </div>

      <footer className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        <div className="flex gap-3">
          {step > 1 ? (
            <BigButton variant="secondary" className="flex-1 sm:flex-none sm:px-8" onClick={() => void go((step - 1) as StepNo)}>
              Back
            </BigButton>
          ) : null}
          {step < 5 ? (
            <BigButton className="flex-[2] sm:ml-auto sm:flex-none sm:px-10" onClick={() => void go((step + 1) as StepNo)}>
              Continue
            </BigButton>
          ) : (
            <BigButton className="flex-[2] sm:ml-auto sm:flex-none sm:px-10" onClick={() => void exit()}>
              Done
            </BigButton>
          )}
        </div>
      </footer>
    </div>
  );
}

function Progress({ step, onGo, saveState }: { step: StepNo; onGo: (s: StepNo) => void; saveState: "saved" | "saving" | "error" | "pending" }) {
  return (
    <nav aria-label="Handover steps" className="mt-3">
      <div className="flex items-center justify-between gap-3 text-[13.5px]">
        <span className="font-semibold text-heading">
          Step {step} of 5 <span className="font-normal text-muted-foreground">· {STEPS[step - 1]}</span>
        </span>
        <span aria-live="polite" className={cn("shrink-0", saveState === "error" ? "font-medium text-danger-fg" : "text-subtle")}>
          {saveState === "saving" || saveState === "pending" ? "Saving…" : saveState === "error" ? "Not saved — retrying" : (
            <span className="inline-flex items-center gap-1">
              <Check className="size-3.5" aria-hidden /> Saved
            </span>
          )}
        </span>
      </div>
      <ol className="mt-2 grid grid-cols-5 gap-1.5">
        {STEPS.map((label, i) => {
          const n = (i + 1) as StepNo;
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => onGo(n)}
                aria-current={n === step ? "step" : undefined}
                aria-label={`Step ${n}: ${label}`}
                className="group block w-full py-1.5 text-left focus-visible:outline-none"
              >
                <span className={cn("block h-1.5 rounded-full transition", n < step ? "bg-copper-500" : n === step ? "bg-copper-500" : "bg-surface-3 group-hover:bg-line-strong", n === step && "ring-2 ring-copper-500/25")} />
                <span className={cn("mt-1.5 hidden truncate text-[12.5px] sm:block", n === step ? "font-semibold text-heading" : "text-subtle")}>{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------ 1. Job details ------------------------------ */

function StepDetails({ job, content, edit }: { job: Job; content: ReportContent; edit: (fn: (c: ReportContent) => ReportContent) => void }) {
  const { data } = useStore();
  const customer = data.customers.find((c) => c.id === job.customerId);
  return (
    <section>
      <StepTitle title="Job details" sub="Filled in from the job. Change anything that should read differently on the report." />
      <div className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-[14.5px] font-medium text-foreground">Report title</span>
          <input className={field} value={content.title} onChange={(e) => edit((c) => ({ ...c, title: e.target.value }))} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[14.5px] font-medium text-foreground">Customer</span>
          <input className={field} value={content.customerName} onChange={(e) => edit((c) => ({ ...c, customerName: e.target.value }))} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[14.5px] font-medium text-foreground">Address</span>
          <input className={field} value={content.siteAddress ?? ""} onChange={(e) => edit((c) => ({ ...c, siteAddress: e.target.value }))} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[14.5px] font-medium text-foreground">Completion date</span>
          <input type="date" className={cn(field, "sm:w-60")} value={content.completionDate ?? ""} onChange={(e) => edit((c) => ({ ...c, completionDate: e.target.value || undefined }))} />
        </label>
        {customer?.email || customer?.phone ? (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-[14px] text-muted-foreground">
            Customer contact from their record: {[customer.email, customer.phone].filter(Boolean).join(" · ")}. This isn&apos;t printed on the report.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------ 2. Photos & documents ------------------------------ */

function photoGroup(f: JobFile, data: ReturnType<typeof useStore>["data"]): "before" | "progress" | "completed" {
  const u = f.updateId ? data.updates.find((x) => x.id === f.updateId) : undefined;
  if (u?.stage === "before") return "before";
  if (f.category === "completion" || u?.stage === "finished") return "completed";
  return "progress";
}

function StepPhotos({ job, files, sel, content, editSel, edit }: { job: Job; files: JobFile[]; sel: ReportSelection; content: ReportContent; editSel: (fn: (s: ReportSelection) => ReportSelection) => void; edit: (fn: (c: ReportContent) => ReportContent) => void }) {
  const { data, refresh } = useStore();
  const [picked, setPicked] = React.useState<File[] | null>(null);
  const photos = files.filter((f) => f.mimeType.startsWith("image/"));
  const docs = files.filter((f) => !f.mimeType.startsWith("image/"));
  const groups: { key: "before" | "progress" | "completed"; label: string }[] = [
    { key: "completed", label: "Completed" },
    { key: "progress", label: "Progress" },
    { key: "before", label: "Before" },
  ];
  const togglePhoto = (id: string) => editSel((s) => ({ ...s, photoIds: s.photoIds.includes(id) ? s.photoIds.filter((x) => x !== id) : [...s.photoIds, id] }));
  const cover = content.coverFileId && sel.photoIds.includes(content.coverFileId) ? content.coverFileId : sel.photoIds[0];

  return (
    <section>
      <StepTitle title="Photos & documents" sub="Tick the photos the customer should see. Unticked photos stay private." />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <UploadButtons onPick={setPicked} primaryLabel="Add photos" />
        <span className="text-[14px] text-muted-foreground">{sel.photoIds.length} chosen</span>
      </div>
      {!photos.length ? (
        <div className="rounded-2xl bg-surface-2 px-5 py-8 text-center">
          <Camera className="mx-auto size-7 text-subtle" aria-hidden />
          <p className="mt-2 text-[15.5px] text-muted-foreground">No photos on this job yet. Add some from your phone — finished-work photos make the report.</p>
        </div>
      ) : null}
      <div className="space-y-7">
        {groups.map((g) => {
          const list = photos.filter((f) => photoGroup(f, data) === g.key);
          if (!list.length) return null;
          return (
            <div key={g.key}>
              <h2 className="mb-2.5 text-[15px] font-semibold text-heading">
                {g.label} <span className="font-normal text-subtle">{list.length}</span>
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {list.map((f) => {
                  const on = sel.photoIds.includes(f.id);
                  const isCover = on && cover === f.id;
                  return (
                    <li key={f.id} className="relative">
                      <button
                        type="button"
                        onClick={() => togglePhoto(f.id)}
                        aria-pressed={on}
                        aria-label={`${on ? "Remove" : "Include"} photo: ${f.title || f.description || f.filename}`}
                        className={cn("relative block w-full overflow-hidden rounded-2xl ring-[3px] transition focus-visible:outline-none focus-visible:ring-copper-400", on ? "ring-copper-500" : "ring-transparent")}
                      >
                        <img src={fileUrl(f.id, { thumb: f.hasThumb })} alt="" loading="lazy" className={cn("aspect-[4/3] w-full bg-surface-2 object-cover transition", !on && "opacity-70")} />
                        <span className={cn("absolute left-2.5 top-2.5 grid size-8 place-items-center rounded-full ring-2 transition", on ? "bg-copper-500 text-white ring-white" : "bg-black/35 text-transparent ring-white/80")}>
                          <Check className="size-5" strokeWidth={3} aria-hidden />
                        </span>
                        {isCover ? <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/60 px-2.5 py-1 text-[12.5px] font-semibold text-white">Cover photo</span> : null}
                      </button>
                      {on && !isCover ? (
                        <button type="button" onClick={() => edit((c) => ({ ...c, coverFileId: f.id }))} className="absolute bottom-2.5 left-2.5 inline-flex h-9 items-center gap-1 rounded-full bg-white/90 px-3 text-[13px] font-semibold text-[#18181b] shadow-sm">
                          <Star className="size-3.5" aria-hidden /> Make cover
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-9">
        <h2 className="text-[15px] font-semibold text-heading">Drawings, certificates &amp; documents</h2>
        <p className="mb-3 text-[14px] text-muted-foreground">Ticked documents go in the handover pack, and Bob can mention them in the report.</p>
        {docs.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card ring-1 ring-line">
            {docs.map((f) => {
              const on = sel.fileIds.includes(f.id);
              return (
                <li key={f.id}>
                  <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <input type="checkbox" className="size-6 shrink-0 accent-[var(--color-copper-500)]" checked={on} onChange={() => editSel((s) => ({ ...s, fileIds: on ? s.fileIds.filter((x) => x !== f.id) : [...s.fileIds, f.id] }))} />
                    <FileText className="size-5 shrink-0 text-subtle" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-heading">
                        {f.title ?? f.filename}
                        {f.revision ? <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">{f.revision}</span> : null}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">{f.category === "drawing" ? "Drawing" : "Document"}{f.visibility === "office" ? " · office only until you include it" : ""}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-2xl bg-surface-2 px-4 py-4 text-[14.5px] text-muted-foreground">No drawings or documents on this job. You can add them with Add photos (it takes PDFs too).</p>
        )}
      </div>

      {picked ? (
        <UploadQueue
          target={{ jobId: job.id }}
          files={picked}
          defaultCategory="completion"
          onClose={() => setPicked(null)}
          onSaved={async (saved) => {
            await refresh();
            const imgs = saved.filter((f) => f.mimeType.startsWith("image/")).map((f) => f.id);
            const others = saved.filter((f) => !f.mimeType.startsWith("image/")).map((f) => f.id);
            editSel((s) => ({ ...s, photoIds: [...new Set([...s.photoIds, ...imgs])], fileIds: [...new Set([...s.fileIds, ...others])] }));
            toast(`${saved.length} added and ticked`, "success");
            if (picked && saved.length >= picked.length) setPicked(null); // all saved: back to the gallery (failures stay on screen to retry)
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------ 3. Your report ------------------------------ */

function StepReport({
  report, job, files, sel, content, edit, editSel, save, base, onDrafted,
}: {
  report: HandoverReport; job: Job; files: JobFile[]; sel: ReportSelection; content: ReportContent;
  edit: (fn: (c: ReportContent) => ReportContent) => void; editSel: (fn: (s: ReportSelection) => ReportSelection) => void;
  save: () => Promise<boolean>; base: number; onDrafted: (r: HandoverReport) => void;
}) {
  const { data, actions } = useStore();
  const [drafting, setDrafting] = React.useState(false);
  const [note, setNote] = React.useState<string | undefined>(report.aiNote);
  const updates = data.updates.filter((u) => u.jobId === job.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const section = (id: string) => content.sections.find((s) => s.id === id);
  const editSection = (id: string, patch: Partial<ReportSection>) => edit((c) => ({ ...c, sections: c.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const hasText = !!(section("overview")?.body?.trim() || section("work")?.items?.some((i) => i.trim()));
  const fileById = new Map(files.map((f) => [f.id, f]));

  const draft = async () => {
    if (!(await save())) return toast("Couldn't save first. Check your connection and try again.", "error");
    setDrafting(true);
    const r = await actions.run<HandoverReport & { usedAi: boolean; aiError?: string }>("generateReport", { id: report.id, baseRevision: base });
    setDrafting(false);
    if (!r.ok) return toast(r.errors._ || "Bob couldn't write it just now. Try again.", "error");
    onDrafted(r.value);
    setNote(r.value.aiError);
    toast(r.value.usedAi ? "Bob has written your report — have a read and change anything" : "Bob's AI wasn't available, so it filled in what it knows. Add to it below.", r.value.usedAi ? "success" : "error");
  };

  return (
    <section>
      <StepTitle title="Your report" sub="Bob writes it from the job's updates, photos, agreed extras and documents. You check it and make it yours." />
      {!hasText || report.aiStatus === "none" ? (
        <div className="mb-6 rounded-3xl bg-[#141416] p-6 text-white sm:p-7">
          <Sparkles className="size-7 text-[#F8A15C]" aria-hidden />
          <p className="mt-3 text-[19px] font-semibold leading-snug">Let Bob do the writing</p>
          <p className="mt-1 text-[15px] leading-relaxed text-white/70">A clear summary for {job.customerName} of what was done. Bob only uses what&apos;s recorded — it never makes up work, certificates or guarantees.</p>
          <BigButton className="mt-5 w-full" disabled={drafting} onClick={() => void draft()}>
            {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />} {drafting ? "Bob is writing your report…" : "Let Bob write my report"}
          </BigButton>
        </div>
      ) : null}
      {note ? <p role="status" className="mb-5 rounded-xl bg-amber-500/10 px-4 py-3 text-[14.5px] text-warn-fg ring-1 ring-amber-500/30">{note} Bob filled in what it knows — add to it below.</p> : null}

      <div className="space-y-5">
        {section("overview") ? <TextSection reportId={report.id} section={section("overview")!} onChange={(p) => editSection("overview", p)} /> : null}
        {section("work") ? <TextSection reportId={report.id} section={section("work")!} onChange={(p) => editSection("work", p)} /> : null}

        {(["aftercare", "outstanding"] as const).map((id) => {
          const s = section(id);
          if (!s) return null;
          return s.hidden ? (
            <button key={id} type="button" onClick={() => editSection(id, { hidden: false })} className="flex min-h-14 w-full items-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 text-left text-[15px] font-medium text-muted-foreground hover:bg-surface-2">
              <Plus className="size-5" aria-hidden /> {id === "aftercare" ? "Add aftercare advice" : "Add work still to do"}
            </button>
          ) : (
            <TextSection key={id} reportId={report.id} section={s} onChange={(p) => editSection(id, p)} onRemove={() => editSection(id, { hidden: true })} />
          );
        })}

        {hasText ? (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <BigButton variant="secondary" disabled={drafting} onClick={() => void draft()}>
              {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />} Ask Bob to write it again
            </BigButton>
            <span className="text-[13.5px] text-subtle">Replaces the text above; photo captions you wrote are kept.</span>
          </div>
        ) : null}

        <Fold title="Photo captions" hint={`${content.photos.filter((p) => p.include).length} photos in the report`}>
          <ul className="space-y-3">
            {content.photos.filter((p) => p.include).map((p) => {
              const f = fileById.get(p.fileId);
              if (!f) return null;
              return (
                <li key={p.fileId} className="flex items-center gap-3">
                  <img src={fileUrl(f.id, { thumb: f.hasThumb })} alt="" className="size-16 shrink-0 rounded-xl bg-surface-2 object-cover" />
                  <input className={field} value={p.caption} maxLength={200} placeholder="Caption (optional)" aria-label="Photo caption" onChange={(e) => edit((c) => ({ ...c, photos: c.photos.map((x) => (x.fileId === p.fileId ? { ...x, caption: e.target.value } : x)) }))} />
                </li>
              );
            })}
            {!content.photos.some((p) => p.include) ? <li className="text-[14.5px] text-muted-foreground">No photos chosen yet — go back a step to pick some.</li> : null}
          </ul>
        </Fold>

        <Fold title="What Bob writes from" hint={`${sel.updateIds.length} of ${updates.length} site updates`}>
          <p className="mb-2 text-[14px] text-muted-foreground">Untick anything that shouldn&apos;t go into the customer&apos;s summary.</p>
          <ul className="space-y-1">
            {updates.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
                  <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--color-copper-500)]" checked={sel.updateIds.includes(u.id)} onChange={(e) => editSel((s) => ({ ...s, updateIds: e.target.checked ? [...s.updateIds, u.id] : s.updateIds.filter((x) => x !== u.id) }))} />
                  <span className="text-[14.5px]">
                    <span className="font-medium">{formatDateKey(u.createdAt.slice(0, 10))}</span> · <span className="text-muted-foreground">{u.authorName}</span>
                    <span className="block text-foreground/90">{u.note || "Photos only"}</span>
                  </span>
                </label>
              </li>
            ))}
            {!updates.length ? <li className="text-[14.5px] text-muted-foreground">No site updates on this job — Bob will use the job description and photos.</li> : null}
          </ul>
        </Fold>
      </div>
    </section>
  );
}

function TextSection({ reportId, section: s, onChange, onRemove }: { reportId: string; section: ReportSection; onChange: (p: Partial<ReportSection>) => void; onRemove?: () => void }) {
  const { actions } = useStore();
  const [asking, setAsking] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const [proposal, setProposal] = React.useState<{ body?: string; items?: string[] } | null>(null);
  const speech = useSpeechRecognition({ onAutoSend: (t) => setInstruction(t), onManualStop: (t) => setInstruction(t) });
  const rewrite = async () => {
    setAsking(true);
    const r = await actions.run<{ body?: string; items?: string[] }>("proposeRewrite", { id: reportId, sectionId: s.id, instruction, current: { heading: s.heading, body: s.body, items: s.items } });
    setAsking(false);
    if (!r.ok) return toast(r.errors._ || "Bob couldn't change it just now. Your text is unchanged.", "error");
    setProposal(r.value);
  };
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-line sm:p-5">
      <div className="mb-2 flex items-center gap-2">
        <input aria-label="Section heading" value={s.heading} onChange={(e) => onChange({ heading: e.target.value })} className="h-10 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-[17px] font-semibold text-heading hover:bg-surface-2 focus:bg-field focus:outline-none focus:ring-2 focus:ring-copper-400/60" />
        {onRemove ? (
          <button type="button" onClick={onRemove} className="h-10 shrink-0 rounded-lg px-2.5 text-[13.5px] font-semibold text-muted-foreground hover:bg-surface-2">
            Remove
          </button>
        ) : null}
      </div>
      {s.kind === "text" ? (
        <textarea rows={6} aria-label={`${s.heading} text`} className={area} value={s.body ?? ""} onChange={(e) => onChange({ body: e.target.value })} />
      ) : (
        <div className="space-y-2">
          {(s.items ?? []).map((it, i) => (
            <div key={i} className="flex items-start gap-2">
              <span aria-hidden className="mt-[22px] size-1.5 shrink-0 rounded-full bg-copper-500" />
              <textarea rows={2} aria-label={`${s.heading} point ${i + 1}`} className={area} value={it} onChange={(e) => onChange({ items: (s.items ?? []).map((x, j) => (j === i ? e.target.value : x)) })} />
              <button type="button" aria-label={`Remove point ${i + 1}`} onClick={() => onChange({ items: (s.items ?? []).filter((_, j) => j !== i) })} className="mt-1.5 grid size-11 shrink-0 place-items-center rounded-xl text-subtle hover:bg-surface-3">
                <X className="size-5" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ items: [...(s.items ?? []), ""] })} className="inline-flex h-11 items-center gap-1.5 text-[15px] font-semibold text-accent-fg">
            <Plus className="size-4" aria-hidden /> Add a point
          </button>
        </div>
      )}
      {proposal ? (
        <div className="mt-3 rounded-xl bg-selected/70 p-4 ring-1 ring-copper-500/30" role="region" aria-label="Bob's suggested version">
          <p className="text-[13.5px] font-semibold text-accent-fg">Bob&apos;s suggestion</p>
          {proposal.body !== undefined ? <p className="mt-1 whitespace-pre-wrap text-[15.5px] leading-relaxed">{proposal.body}</p> : <ul className="mt-1 list-disc pl-5 text-[15.5px]">{proposal.items?.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          <div className="mt-3 flex gap-2">
            <BigButton onClick={() => { onChange(proposal.body !== undefined ? { body: proposal.body } : { items: proposal.items }); setProposal(null); setOpen(false); setInstruction(""); }}>
              <Check /> Use this
            </BigButton>
            <BigButton variant="ghost" onClick={() => setProposal(null)}>
              Keep mine
            </BigButton>
          </div>
        </div>
      ) : open ? (
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <label className="block text-[14px] font-medium text-foreground" htmlFor={`ins-${s.id}`}>
            How should Bob change it?
          </label>
          <div className="mt-1.5 flex gap-2">
            <input id={`ins-${s.id}`} className={field} value={speech.listening ? speech.interim || instruction : instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. shorter and friendlier" />
            {speech.supported ? (
              <button type="button" onClick={() => (speech.listening ? speech.stop() : speech.start())} aria-label={speech.listening ? "Stop listening" : "Say it instead"} className={cn("grid size-12 shrink-0 place-items-center rounded-xl ring-1", speech.listening ? "bg-red-500 text-white ring-red-500" : "bg-card text-foreground ring-line-strong")}>
                {speech.listening ? <Square className="size-4" /> : <Mic className="size-5" />}
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex gap-2">
            <BigButton disabled={asking} onClick={() => void rewrite()}>
              {asking ? <Loader2 className="animate-spin" /> : <Wand2 />} Change it
            </BigButton>
            <BigButton variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </BigButton>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-xl px-1 text-[15px] font-semibold text-accent-fg hover:underline">
          <Wand2 className="size-4" aria-hidden /> Ask Bob to change this
        </button>
      )}
    </div>
  );
}

/* ------------------------------ 4. Costs ------------------------------ */

function StepCosts({ job, sel, content, editSel, edit }: { job: Job; sel: ReportSelection; content: ReportContent; editSel: (fn: (s: ReportSelection) => ReportSelection) => void; edit: (fn: (c: ReportContent) => ReportContent) => void }) {
  const { data } = useStore();
  const costs = reportCostSummary(job, data);
  const manual = content.costMode === "manual";
  const lines = manual ? manualCostLines(content.manualFigures) : costs.lines;
  return (
    <section>
      <StepTitle title="Costs" sub="From the job's agreed price, approved extras and payments. Your own costs and margins never appear." />
      <label className="flex min-h-[72px] cursor-pointer items-center gap-4 rounded-2xl bg-card px-5 py-4 ring-1 ring-line">
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-heading">Include financial summary in customer report</span>
          <span className="block text-[14px] text-muted-foreground">{sel.includeCosts ? "The figures below will be printed." : "Off — the report won't mention money."}</span>
        </span>
        <span className="relative inline-flex shrink-0">
          <input type="checkbox" role="switch" className="peer sr-only" checked={sel.includeCosts} onChange={(e) => editSel((s) => ({ ...s, includeCosts: e.target.checked }))} />
          <span aria-hidden className="h-8 w-14 rounded-full bg-surface-3 ring-1 ring-line-strong transition peer-checked:bg-copper-500 peer-focus-visible:ring-[3px] peer-focus-visible:ring-copper-500/35" />
          <span aria-hidden className="absolute left-1 top-1 size-6 rounded-full bg-white shadow transition peer-checked:translate-x-6" />
        </span>
      </label>

      <div className={cn("mt-5 rounded-2xl bg-card p-5 ring-1 ring-line transition", !sel.includeCosts && "opacity-60")}>
        {!costs.reliable && !manual ? (
          <>
            <p className="text-[15px] text-warn-fg">{costs.notes[0]}</p>
            <BigButton variant="secondary" className="mt-3" onClick={() => edit((c) => ({ ...c, costMode: "manual", manualFigures: c.manualFigures.length ? c.manualFigures : [{ label: "Agreed price", amount: 0 }] }))}>
              Enter figures for this report
            </BigButton>
          </>
        ) : (
          <table className="w-full text-[15.5px]">
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className={cn("border-b border-line last:border-0", l.strong && "font-semibold text-heading")}>
                  <td className="py-2.5 pr-3">
                    {l.label}
                    {l.note ? <span className="block text-[13px] font-normal text-muted-foreground">{l.note}</span> : null}
                  </td>
                  <td className="py-2.5 text-right align-top tabular">{gbp(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {manual ? (
          <div className="mt-4 space-y-2">
            <p className="text-[13.5px] text-muted-foreground">Printed as &quot;{MANUAL_COST_NOTE}&quot;. Your invoices and payments aren&apos;t changed.</p>
            {content.manualFigures.map((f, i) => (
              <div key={i} className="flex gap-2">
                <input className={field} aria-label={`Figure ${i + 1} label`} value={f.label} onChange={(e) => edit((c) => ({ ...c, manualFigures: c.manualFigures.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />
                <input className={cn(field, "w-32")} inputMode="decimal" aria-label={`Figure ${i + 1} amount`} value={Number.isFinite(f.amount) ? String(f.amount) : ""} onChange={(e) => edit((c) => ({ ...c, manualFigures: c.manualFigures.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/[£,\s]/g, "")) } : x)) }))} />
              </div>
            ))}
            <div className="flex gap-3">
              <button type="button" onClick={() => edit((c) => ({ ...c, manualFigures: [...c.manualFigures, { label: "", amount: 0 }] }))} className="h-11 text-[15px] font-semibold text-accent-fg">+ Add a figure</button>
              {costs.reliable ? <button type="button" onClick={() => edit((c) => ({ ...c, costMode: "records" }))} className="h-11 text-[15px] font-semibold text-muted-foreground">Use Bob&apos;s figures</button> : null}
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-4 text-[13.5px] leading-relaxed text-subtle">Only the agreed price, approved extras, invoices, payments received and the balance can appear. Supplier bills, labour costs and profit are never included.</p>
    </section>
  );
}

/* ------------------------------ 5. Review & finish ------------------------------ */

function StepFinish({ job, report, sel, content, versions, base, dirty, save, onEdit }: { job: Job; report: HandoverReport; sel: ReportSelection; content: ReportContent; versions: ReportVersion[]; base: number; dirty: boolean; save: () => Promise<boolean>; onEdit: () => void }) {
  const { data, actions, refresh } = useStore();
  const [busy, setBusy] = React.useState<null | "pdf" | "pack">(null);
  const [emailOpen, setEmailOpen] = React.useState(false);
  const latest = versions[0];
  const upToDate = !!latest && !dirty && latest.createdAt >= report.updatedAt;
  const packs = data.handovers.filter((h) => h.jobId === job.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  /** A PDF version that matches the report as it is now (made if needed). */
  const currentVersion = async (): Promise<ReportVersion | null> => {
    if (!(await save())) {
      toast("Couldn't save your changes. Check your connection and try again.", "error");
      return null;
    }
    if (upToDate && latest) return latest;
    const r = await actions.run<ReportVersion>("exportReport", { id: report.id });
    if (!r.ok) {
      toast(r.errors._ || "Couldn't make the PDF. Try again.", "error");
      return null;
    }
    return r.value;
  };

  const downloadPdf = async () => {
    setBusy("pdf");
    const v = await currentVersion();
    if (v) {
      try {
        await downloadFile(fileUrl(v.fileId, { download: true }), v.filename);
        toast(`Report downloaded (version ${v.version})`, "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "The download didn't work", "error");
      }
    }
    setBusy(null);
  };

  const downloadPack = async () => {
    setBusy("pack");
    const v = await currentVersion();
    if (!v) return setBusy(null);
    const fileIds = [v.fileId, ...sel.photoIds, ...sel.fileIds];
    const r = await api<{ value?: Handover; error?: string }>("/api/handovers", { json: { jobId: job.id, fileIds, completionDate: content.completionDate, title: `${content.title} — handover` } }).catch(() => ({ status: 0, body: { error: "Couldn't reach Bob. Nothing was saved." } as { value?: Handover; error?: string } }));
    if (r.status !== 200 || !r.body.value) {
      toast(r.body.error ?? "Couldn't make the handover pack. Nothing was changed.", "error");
      return setBusy(null);
    }
    try {
      await downloadFile(`/api/handovers/${r.body.value.id}`, `${job.title} handover.zip`);
      toast("Handover pack downloaded", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "The download didn't work", "error");
    }
    await refresh();
    setBusy(null);
  };

  return (
    <section>
      <StepTitle title="Review & finish" sub="This is exactly what the customer will get. Change anything, then download or share it." />

      {content.prompts.length ? (
        <div className="mb-5 rounded-2xl bg-amber-500/10 px-4 py-3 ring-1 ring-amber-500/25">
          <p className="text-[14.5px] font-semibold text-warn-fg">Worth a quick check</p>
          <ul className="mt-1 space-y-1 text-[14px]">
            {content.prompts.slice(0, 4).map((p, i) => (
              <li key={i} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn-fg" aria-hidden /> {p.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-line">
        <iframe key={base} src={`/api/handover-reports/${report.id}/preview?v=${base}`} title="Preview of the customer's handover report" className="h-[62dvh] w-full sm:h-[72dvh]" />
      </div>
      <a href={`/api/handover-reports/${report.id}/preview?v=${base}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-11 items-center gap-1.5 text-[14.5px] font-semibold text-accent-fg">
        <ExternalLink className="size-4" aria-hidden /> Open the preview full screen
      </a>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <BigButton disabled={!!busy} onClick={() => void downloadPdf()}>
          {busy === "pdf" ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
        </BigButton>
        <BigButton variant="secondary" disabled={!!busy} onClick={() => void downloadPack()}>
          {busy === "pack" ? <Loader2 className="animate-spin" /> : <FileArchive />} Download full handover pack
        </BigButton>
        <BigButton variant="secondary" disabled={!!busy} onClick={() => setEmailOpen(true)}>
          <Mail /> Prepare email to customer
        </BigButton>
        <BigButton variant="secondary" disabled={!!busy} onClick={onEdit}>
          <Pencil /> Edit report
        </BigButton>
      </div>
      <p className="mt-3 text-[13.5px] text-subtle">
        The pack is one ZIP: this report, the {sel.photoIds.length} photo{sel.photoIds.length === 1 ? "" : "s"} you chose at full size{sel.fileIds.length ? ` and ${sel.fileIds.length} document${sel.fileIds.length === 1 ? "" : "s"}` : ""}. Not included: internal notes, site access details, anything you didn&apos;t tick, and your own costs.
      </p>

      {emailOpen ? <EmailDraft job={job} content={content} onClose={() => setEmailOpen(false)} /> : null}

      <div className="mt-7 space-y-3">
        <Fold title="Previous versions" hint={versions.length ? `${versions.length} saved · latest v${latest!.version}${upToDate ? " (matches the report)" : " (report changed since)"}` : "None yet — downloading the PDF saves version 1"}>
          {versions.length ? (
            <ul className="divide-y divide-line">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 text-[14.5px]">
                    <span className="font-medium">Version {v.version}</span> · {v.pages} page{v.pages === 1 ? "" : "s"}
                    <span className="block text-[13px] text-muted-foreground">{v.createdBy}, {timeAgo(v.createdAt)}</span>
                  </span>
                  <a href={fileUrl(v.fileId, { download: true })} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-[14.5px] font-semibold text-accent-fg hover:bg-copper-500/10" aria-label={`Download ${v.filename}`}>
                    <Download className="size-4" aria-hidden /> PDF
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14.5px] text-muted-foreground">Each download after a change saves a new numbered version; earlier ones are kept.</p>
          )}
        </Fold>
        {packs.length ? (
          <Fold title="Handover packs" hint={`${packs.length} made · last ${timeAgo(packs[0].createdAt)}`}>
            <ul className="divide-y divide-line">
              {packs.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 text-[14.5px]">
                    <span className="font-medium">{h.items.length} files</span> · {h.createdBy}, {timeAgo(h.createdAt)}
                    <span className="block text-[13px] text-muted-foreground">Downloaded {h.downloads} time{h.downloads === 1 ? "" : "s"}</span>
                  </span>
                  <button type="button" onClick={() => void downloadFile(`/api/handovers/${h.id}`, `${job.title} handover.zip`).then(() => refresh()).catch((e) => toast(e.message, "error"))} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-[14.5px] font-semibold text-accent-fg hover:bg-copper-500/10">
                    <Download className="size-4" aria-hidden /> ZIP
                  </button>
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A ready-to-send email. Bob doesn't send it or attach anything: it's copied
 * or opened in the person's own email app, with the PDF/pack they downloaded.
 */
function EmailDraft({ job, content, onClose }: { job: Job; content: ReportContent; onClose: () => void }) {
  const { data, org } = useStore();
  const customer = data.customers.find((c) => c.id === job.customerId);
  const first = content.customerName.split(/\s+/)[0] || "there";
  const [to, setTo] = React.useState(customer?.email ?? "");
  const [subject, setSubject] = React.useState(`Your ${content.title.toLowerCase()} — handover pack`);
  const [body, setBody] = React.useState(
    `Hi ${first},\n\nThank you for choosing us for your ${content.title.toLowerCase()}. I've attached your handover pack: a short report of the work with photos${content.sections.some((s) => s.id === "aftercare" && !s.hidden) ? ", care advice" : ""} and the relevant documents.\n\nIf you have any questions, just reply to this email.\n\n${org.assistant.signOff}`,
  );
  const emailConnected = data.connections.some((c) => c.kind === "email" && c.status === "connected");
  return (
    <div className="mt-5 rounded-2xl bg-card p-5 ring-1 ring-copper-500/30" role="region" aria-label="Email to the customer">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[16px] font-semibold text-heading">Email to {content.customerName}</p>
          <p className="text-[14px] text-muted-foreground">Download the PDF or pack first, then attach it in your email app.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close email" className="grid size-11 shrink-0 place-items-center rounded-xl text-subtle hover:bg-surface-2">
          <X className="size-5" />
        </button>
      </div>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">To</span>
          <input className={field} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">Subject</span>
          <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">Message</span>
          <textarea rows={8} className={area} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-copper-500 px-5 text-[16px] font-semibold text-white hover:bg-copper-600 [&_svg]:size-5">
          <Mail /> Open in my email app
        </a>
        <BigButton
          variant="secondary"
          onClick={async () => {
            const ok = await copyToClipboard(`To: ${to}\nSubject: ${subject}\n\n${body}`);
            toast(ok ? "Email copied" : "Couldn't copy — select the text instead", ok ? "success" : "error");
          }}
        >
          <Copy /> Copy email
        </BigButton>
      </div>
      <p className="mt-3 text-[13px] text-subtle">
        {emailConnected
          ? "Bob doesn't send handover packs itself yet, so nothing goes out until you send it from your email."
          : "No email account is connected to Bob, so nothing is sent from here — you send it yourself."}
      </p>
    </div>
  );
}
