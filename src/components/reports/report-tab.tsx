"use client";

/* eslint-disable @next/next/no-img-element -- private thumbnails from our own API */

/**
 * Handover report on the job: create → choose what goes in → draft (AI, or
 * from known details) → edit → preview the exact PDF → save a version and
 * download. Owners and admins only. Drafts are shared: Luke can start one on
 * site and Ryan can finish it; a save based on an older copy is refused so
 * neither overwrites the other.
 */
import * as React from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Download, Eye, EyeOff, FileText, Loader2, PoundSterling, Sparkles, Star, Wand2, X } from "lucide-react";
import type { HandoverReport, Job, ReportContent, ReportSection, ReportSelection } from "@/lib/types";
import { useStore } from "@/lib/store/store";
import { fileUrl } from "@/lib/files/upload";
import { MANUAL_COST_NOTE, manualCostLines, reportCostSummary } from "@/lib/report-costs";
import { cn, gbp, timeAgo } from "@/lib/utils";
import { formatDayShort } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { STAGE_LABEL } from "@/components/updates/add-update";

type Step = "review" | "edit" | "preview";

export function ReportTab({ job }: { job: Job }) {
  const { data, actions } = useStore();
  const report = data.reports.find((r) => r.jobId === job.id);
  const versions = data.reportVersions.filter((v) => v.jobId === job.id).sort((a, b) => b.version - a.version);
  const [busy, setBusy] = React.useState(false);
  if (!report)
    return (
      <div className="max-w-2xl">
        <h2 className="text-[18px] font-semibold text-heading">Customer handover report</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">A short branded PDF for {job.customerName}: what was done, the best photos and, if you choose, a cost summary from Bob&apos;s records. You choose what goes in; internal notes and site access details never do.</p>
        <Button
          className="mt-4"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await actions.run("createReport", { jobId: job.id });
            setBusy(false);
            if (!r.ok) toast(r.errors._ || "Couldn't start the report", "error");
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <FileText />} Create handover report
        </Button>
      </div>
    );
  return <ReportWorkspace key={report.id} job={job} report={report} versions={versions} />;
}

function ReportWorkspace({ job, report, versions }: { job: Job; report: HandoverReport; versions: ReturnType<typeof useStore>["data"]["reportVersions"] }) {
  const { data, actions } = useStore();
  const [step, setStep] = React.useState<Step>(report.aiStatus === "none" ? "review" : "edit");
  const [sel, setSel] = React.useState<ReportSelection>(report.selection);
  const [content, setContent] = React.useState<ReportContent>(report.content);
  const [base, setBase] = React.useState(report.revision);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<HandoverReport | null>(null);
  const [aiNote, setAiNote] = React.useState(report.aiNote);
  const [previewKey, setPreviewKey] = React.useState(0);

  // Another person's save arrives with the snapshot: adopt it only if nothing is being edited here.
  React.useEffect(() => {
    if (report.revision !== base && !dirty) {
      setSel(report.selection);
      setContent(report.content);
      setBase(report.revision);
    }
  }, [report.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const files = data.files.filter((f) => f.jobId === job.id && !f.deletedAt && !f.reportId);
  const fileById = new Map(files.map((f) => [f.id, f]));
  const updates = data.updates.filter((u) => u.jobId === job.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const photos = files.filter((f) => f.mimeType.startsWith("image/"));
  const docs = files.filter((f) => !f.mimeType.startsWith("image/") || f.category === "drawing");
  const costs = reportCostSummary(job, data);
  const manual = manualCostLines(content.manualFigures);

  const edit = (fn: (c: ReportContent) => ReportContent) => {
    setContent((c) => fn(c));
    setDirty(true);
  };
  const editSection = (id: string, patch: Partial<ReportSection>) => edit((c) => ({ ...c, sections: c.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const handle = (r: Awaited<ReturnType<typeof actions.run>>) => {
    if (r.ok) return true;
    if (r.code === "conflict") {
      const cur = r.current as HandoverReport | undefined;
      if (cur) setConflict(cur);
    }
    toast(r.errors._ || "Couldn't save", "error");
    return false;
  };

  const save = async (opts: { selection?: boolean; quiet?: boolean } = {}) => {
    setBusy("save");
    const r = await actions.run<HandoverReport>("saveReport", { id: report.id, baseRevision: base, content, ...(opts.selection ? { selection: sel } : {}) });
    setBusy(null);
    if (!handle(r) || !r.ok) return null;
    setContent(r.value.content);
    setSel(r.value.selection);
    setBase(r.value.revision);
    setDirty(false);
    if (!opts.quiet) toast("Draft saved");
    return r.value;
  };

  const draft = async () => {
    const saved = await save({ selection: true, quiet: true });
    if (!saved) return;
    setBusy("draft");
    const r = await actions.run<HandoverReport & { usedAi: boolean; aiError?: string }>("generateReport", { id: report.id, baseRevision: saved.revision });
    setBusy(null);
    if (!handle(r) || !r.ok) return;
    setContent(r.value.content);
    setBase(r.value.revision);
    setDirty(false);
    setAiNote(r.value.aiError);
    toast(r.value.usedAi ? "Draft written — check it before you send it" : "AI wasn't available, so Bob filled in what it knows. Your choices are kept.", r.value.usedAi ? "success" : "error");
    setStep("edit");
  };

  const exportPdf = async () => {
    if (dirty && !(await save({ quiet: true }))) return;
    setBusy("export");
    const r = await actions.run<{ fileId: string; filename: string; version: number }>("exportReport", { id: report.id });
    setBusy(null);
    if (!handle(r) || !r.ok) return;
    toast(`Version ${r.value.version} saved — downloading`, "success");
    const a = document.createElement("a");
    a.href = fileUrl(r.value.fileId, { download: true });
    a.download = r.value.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const steps: { value: Step; label: string }[] = [
    { value: "review", label: "1. Choose content" },
    { value: "edit", label: "2. Edit" },
    { value: "preview", label: "3. Preview & export" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Report steps" className="inline-flex gap-0.5 rounded-xl bg-surface-3 p-1">
          {steps.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-current={step === s.value ? "step" : undefined}
              onClick={async () => {
                if (s.value === "preview" && dirty && !(await save({ quiet: true }))) return;
                if (s.value === "preview") setPreviewKey((k) => k + 1);
                setStep(s.value);
              }}
              className={cn("h-9 rounded-lg px-3 text-[14.5px] font-semibold", step === s.value ? "bg-card text-heading ring-1 ring-line" : "text-muted-foreground hover:text-foreground")}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <p className="text-[13.5px] text-muted-foreground" aria-live="polite">
          {dirty ? "Unsaved changes" : `Saved · ${report.updatedBy}, ${timeAgo(report.updatedAt)}`}
        </p>
      </div>

      {conflict ? (
        <div role="alert" className="mt-4 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-warn-fg">
            <AlertTriangle className="size-4" aria-hidden /> {conflict.updatedBy} saved this report {timeAgo(conflict.updatedAt)}
          </p>
          <p className="mt-1 text-[14.5px]">Your edits are still on screen and haven&apos;t been saved. Load their version to continue from it (copy anything you want to keep first), or keep editing here.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => { setSel(conflict.selection); setContent(conflict.content); setBase(conflict.revision); setDirty(false); setConflict(null); }}>Load their version</Button>
            <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>Keep my screen</Button>
          </div>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section aria-labelledby="rv-updates">
            <h3 id="rv-updates" className="text-[16px] font-semibold text-heading">Updates</h3>
            <p className="text-[14px] text-muted-foreground">Only ticked updates are used for the summary.</p>
            {updates.length ? (
              <ul className="mt-2 divide-y divide-line rounded-xl bg-card ring-1 ring-line-strong">
                {updates.map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-surface-2">
                      <input type="checkbox" className="mt-1 size-5 accent-[var(--color-copper-500)]" checked={sel.updateIds.includes(u.id)} onChange={(e) => { setSel({ ...sel, updateIds: e.target.checked ? [...sel.updateIds, u.id] : sel.updateIds.filter((x) => x !== u.id) }); setDirty(true); }} />
                      <span className="min-w-0 text-[14.5px]">
                        <span className="font-semibold">{formatDayShort(u.createdAt.slice(0, 10))}</span>
                        {u.stage ? <span className="text-muted-foreground"> · {STAGE_LABEL[u.stage]}</span> : null}
                        <span className="text-muted-foreground"> · {u.authorName}</span>
                        {u.note ? <span className="block text-foreground/90">{u.note}</span> : <span className="block text-muted-foreground">Photos only</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-[14.5px] text-muted-foreground">No updates on this job yet — you can still make a report from the photos.</p>}
          </section>
          <section aria-labelledby="rv-photos">
            <h3 id="rv-photos" className="text-[16px] font-semibold text-heading">Photos <span className="font-normal text-muted-foreground">{sel.photoIds.length} chosen</span></h3>
            <p className="text-[14px] text-muted-foreground">Unticked photos stay private.</p>
            <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((f) => {
                const on = sel.photoIds.includes(f.id);
                return (
                  <li key={f.id}>
                    <label className={cn("relative block cursor-pointer overflow-hidden rounded-lg ring-2", on ? "ring-copper-500" : "ring-transparent")}>
                      <input type="checkbox" className="absolute left-1.5 top-1.5 z-10 size-5 accent-[var(--color-copper-500)]" checked={on} aria-label={f.description || f.title || f.filename} onChange={(e) => { setSel({ ...sel, photoIds: e.target.checked ? [...sel.photoIds, f.id] : sel.photoIds.filter((x) => x !== f.id) }); setDirty(true); }} />
                      <img src={fileUrl(f.id, { thumb: f.hasThumb })} alt="" className={cn("aspect-square w-full bg-surface-2 object-cover", !on && "opacity-60")} />
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-labelledby="rv-docs">
            <h3 id="rv-docs" className="text-[16px] font-semibold text-heading">Drawings &amp; documents</h3>
            <p className="text-[14px] text-muted-foreground">Mentioned in the summary only if ticked. Originals go in the handover pack.</p>
            {docs.length ? (
              <ul className="mt-2 divide-y divide-line rounded-xl bg-card ring-1 ring-line-strong">
                {docs.map((f) => (
                  <li key={f.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                      <input type="checkbox" className="size-5 accent-[var(--color-copper-500)]" checked={sel.fileIds.includes(f.id)} onChange={(e) => { setSel({ ...sel, fileIds: e.target.checked ? [...sel.fileIds, f.id] : sel.fileIds.filter((x) => x !== f.id) }); setDirty(true); }} />
                      <span className="min-w-0 truncate text-[14.5px]">{f.title ?? f.filename}{f.revision ? ` (${f.revision})` : ""}{f.category === "drawing" ? " · drawing" : ""}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-[14.5px] text-muted-foreground">None on this job.</p>}
          </section>
          <section aria-labelledby="rv-costs">
            <h3 id="rv-costs" className="text-[16px] font-semibold text-heading">Costs</h3>
            <label className="mt-2 flex items-start gap-3 rounded-xl bg-card px-3 py-3 ring-1 ring-line-strong">
              <input type="checkbox" className="mt-0.5 size-5 accent-[var(--color-copper-500)]" checked={sel.includeCosts} onChange={(e) => { setSel({ ...sel, includeCosts: e.target.checked }); setDirty(true); }} />
              <span>
                <span className="block text-[15px] font-semibold">Include cost summary</span>
                <span className="block text-[13.5px] text-muted-foreground">From this job&apos;s price, approved variations, invoices and payments. You&apos;ll see every figure before export.</span>
              </span>
            </label>
          </section>
          <div className="flex flex-wrap gap-2 lg:col-span-2">
            <Button disabled={!!busy} onClick={() => void draft()}>
              {busy === "draft" ? <Loader2 className="animate-spin" /> : <Sparkles />} {report.aiStatus === "none" ? "Draft the report" : "Redraft the text"}
            </Button>
            <Button variant="secondary" disabled={!!busy} onClick={async () => { if (await save({ selection: true, quiet: true })) setStep("edit"); }}>
              Write it myself
            </Button>
            {report.aiStatus !== "none" ? <p className="w-full text-[13.5px] text-muted-foreground">Redrafting replaces the overview, work and aftercare text. Captions you&apos;ve written are kept.</p> : null}
          </div>
        </div>
      ) : null}

      {step === "edit" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {aiNote ? (
              <p role="status" className="rounded-xl bg-amber-500/10 px-3 py-2 text-[14.5px] text-warn-fg ring-1 ring-amber-500/30">{aiNote} Bob filled in what it knows — edit the text below.</p>
            ) : null}
            <section className="panel px-4 py-4 sm:px-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><Label htmlFor="rp-title">Report title</Label><Input id="rp-title" value={content.title} onChange={(e) => edit((c) => ({ ...c, title: e.target.value }))} /></div>
                <div><Label htmlFor="rp-cust">Customer</Label><Input id="rp-cust" value={content.customerName} onChange={(e) => edit((c) => ({ ...c, customerName: e.target.value }))} /></div>
                <div><Label htmlFor="rp-date">Completion date</Label><Input id="rp-date" type="date" value={content.completionDate ?? ""} onChange={(e) => edit((c) => ({ ...c, completionDate: e.target.value || undefined }))} /></div>
                <div className="sm:col-span-2"><Label htmlFor="rp-site">Site</Label><Input id="rp-site" value={content.siteAddress ?? ""} onChange={(e) => edit((c) => ({ ...c, siteAddress: e.target.value }))} /></div>
              </div>
            </section>
            {content.sections.map((s, i) => (
              <SectionEditor key={s.id} reportId={report.id} section={s} first={i === 0} last={i === content.sections.length - 1} onChange={(p) => editSection(s.id, p)} onMove={(d) => edit((c) => { const arr = [...c.sections]; const j = i + d; [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...c, sections: arr }; })}>
                {s.kind === "photos" ? (
                  <ul className="space-y-2">
                    {content.photos.map((p, pi) => {
                      const f = fileById.get(p.fileId);
                      if (!f) return null;
                      const cover = content.coverFileId === p.fileId;
                      return (
                        <li key={p.fileId} className={cn("flex items-start gap-3 rounded-xl p-2 ring-1", p.include ? "ring-line" : "opacity-60 ring-line")}>
                          <img src={fileUrl(f.id, { thumb: f.hasThumb })} alt="" className="size-20 shrink-0 rounded-lg bg-surface-2 object-cover" />
                          <div className="min-w-0 flex-1">
                            <label className="block">
                              <span className="sr-only">Caption</span>
                              <Input value={p.caption} maxLength={200} placeholder="Caption (optional)" onChange={(e) => edit((c) => ({ ...c, photos: c.photos.map((x) => (x.fileId === p.fileId ? { ...x, caption: e.target.value } : x)) }))} className="h-11" />
                            </label>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <button type="button" aria-pressed={cover} onClick={() => edit((c) => ({ ...c, coverFileId: p.fileId }))} className={cn("inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13.5px] font-semibold", cover ? "bg-selected text-accent-fg" : "text-muted-foreground hover:bg-surface-3")}><Star className="size-3.5" aria-hidden /> {cover ? "Cover photo" : "Make cover"}</button>
                              <button type="button" onClick={() => edit((c) => ({ ...c, photos: c.photos.map((x) => (x.fileId === p.fileId ? { ...x, include: !x.include } : x)) }))} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13.5px] font-semibold text-muted-foreground hover:bg-surface-3">{p.include ? <><EyeOff className="size-3.5" aria-hidden /> Hide</> : <><Eye className="size-3.5" aria-hidden /> Show</>}</button>
                              <button type="button" disabled={pi === 0} aria-label="Move photo up" onClick={() => edit((c) => { const a = [...c.photos]; [a[pi - 1], a[pi]] = [a[pi], a[pi - 1]]; return { ...c, photos: a }; })} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-surface-3 disabled:opacity-30"><ArrowUp className="size-4" /></button>
                              <button type="button" disabled={pi === content.photos.length - 1} aria-label="Move photo down" onClick={() => edit((c) => { const a = [...c.photos]; [a[pi + 1], a[pi]] = [a[pi], a[pi + 1]]; return { ...c, photos: a }; })} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-surface-3 disabled:opacity-30"><ArrowDown className="size-4" /></button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {!content.photos.length ? <li className="text-[14.5px] text-muted-foreground">No photos chosen — go back to step 1 to pick some.</li> : null}
                  </ul>
                ) : s.kind === "costs" ? (
                  <CostEditor content={content} edit={edit} includeCosts={sel.includeCosts} costs={costs} manual={manual} />
                ) : null}
              </SectionEditor>
            ))}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">
            <section className="panel px-4 py-4">
              <h3 className="text-[15px] font-semibold text-heading">Before you send</h3>
              <p className="text-[13px] text-muted-foreground">Only you see these — they never appear in the PDF.</p>
              {content.prompts.length ? (
                <ul className="mt-2 space-y-1.5 text-[14px]">
                  {content.prompts.map((p, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn-fg" aria-hidden /> {p.text}</li>)}
                </ul>
              ) : <p className="mt-2 flex items-center gap-2 text-[14px] text-good-fg"><Check className="size-4" aria-hidden /> Nothing missing</p>}
            </section>
            <div className="flex flex-col gap-2">
              <Button disabled={!!busy || !dirty} onClick={() => void save()}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Check />} Save draft</Button>
              <Button variant="secondary" disabled={!!busy} onClick={async () => { if (dirty && !(await save({ quiet: true }))) return; setPreviewKey((k) => k + 1); setStep("preview"); }}><Eye /> Preview PDF</Button>
            </div>
          </aside>
        </div>
      ) : null}

      {step === "preview" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <iframe key={previewKey} src={`/api/handover-reports/${report.id}/preview?v=${base}`} title="Customer preview of the handover report PDF" className="h-[78dvh] w-full rounded-xl bg-surface-2 ring-1 ring-line" />
          <aside className="space-y-4">
            <p className="text-[14.5px] text-muted-foreground">This is exactly what the customer gets. Saving creates a numbered version you can always download again; later edits make a new version.</p>
            <Button className="w-full" disabled={!!busy} onClick={() => void exportPdf()}>{busy === "export" ? <Loader2 className="animate-spin" /> : <Download />} Save version &amp; download PDF</Button>
            <p className="text-[13px] text-subtle">Send it from your own email or messaging app. Bob doesn&apos;t email it (no email account is connected for this workspace).</p>
            <section>
              <h3 className="text-[15px] font-semibold text-heading">Versions</h3>
              {versions.length ? (
                <ul className="mt-2 divide-y divide-line rounded-xl bg-card ring-1 ring-line-strong">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center gap-2 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium">v{v.version} · {v.pages} page{v.pages === 1 ? "" : "s"}</span>
                        <span className="block text-[13px] text-muted-foreground">{v.createdBy}, {timeAgo(v.createdAt)}</span>
                      </span>
                      <a href={fileUrl(v.fileId, { download: true })} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[14px] font-semibold text-accent-fg hover:bg-copper-500/10" aria-label={`Download ${v.filename}`}><Download className="size-4" aria-hidden /> PDF</a>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-[14px] text-muted-foreground">No versions saved yet.</p>}
              {versions.length ? <p className="mt-2 text-[13px] text-muted-foreground">To give the customer the full-resolution drawings too, add the report to a handover pack (Handover pack tab) — it goes in as the overview.</p> : null}
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function SectionEditor({ reportId, section: s, first, last, onChange, onMove, children }: { reportId: string; section: ReportSection; first: boolean; last: boolean; onChange: (p: Partial<ReportSection>) => void; onMove: (d: -1 | 1) => void; children?: React.ReactNode }) {
  const { actions } = useStore();
  const [proposal, setProposal] = React.useState<{ body?: string; items?: string[] } | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const narrative = s.kind === "text" || s.kind === "bullets";
  const rewrite = async () => {
    setAsking(true);
    const r = await actions.run<{ body?: string; items?: string[] }>("proposeRewrite", { id: reportId, sectionId: s.id, instruction, current: { heading: s.heading, body: s.body, items: s.items } });
    setAsking(false);
    if (!r.ok) return toast(r.errors._ || "Couldn't rewrite it", "error");
    setProposal(r.value);
  };
  return (
    <section className={cn("panel px-4 py-4 sm:px-5", s.hidden && "opacity-70")} aria-label={`Section: ${s.heading}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Heading</span>
          <input value={s.heading} onChange={(e) => onChange({ heading: e.target.value })} className="h-10 w-full rounded-lg bg-transparent px-1 text-[17px] font-semibold text-heading hover:bg-surface-2 focus:bg-field focus:outline-none focus:ring-2 focus:ring-copper-400/70" />
        </label>
        <button type="button" onClick={() => onChange({ hidden: !s.hidden })} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13.5px] font-semibold text-muted-foreground hover:bg-surface-3" aria-pressed={!s.hidden}>
          {s.hidden ? <><EyeOff className="size-4" aria-hidden /> Hidden</> : <><Eye className="size-4" aria-hidden /> Shown</>}
        </button>
        <button type="button" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${s.heading} up`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-surface-3 disabled:opacity-30"><ArrowUp className="size-4" /></button>
        <button type="button" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${s.heading} down`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-surface-3 disabled:opacity-30"><ArrowDown className="size-4" /></button>
      </div>
      <div className="mt-2">
        {s.kind === "text" ? (
          <Textarea rows={4} value={s.body ?? ""} onChange={(e) => onChange({ body: e.target.value })} aria-label={`${s.heading} text`} className="text-[15.5px] leading-relaxed" />
        ) : s.kind === "bullets" ? (
          <BulletEditor items={s.items ?? []} onChange={(items) => onChange({ items })} label={s.heading} />
        ) : (
          children
        )}
      </div>
      {narrative ? (
        <div className="mt-2">
          {proposal ? (
            <div className="rounded-xl bg-selected/70 p-3 ring-1 ring-copper-500/30" role="region" aria-label="Proposed rewrite">
              <p className="text-[13px] font-semibold text-accent-fg">Proposed replacement</p>
              {proposal.body ? <p className="mt-1 whitespace-pre-wrap text-[15px]">{proposal.body}</p> : <ul className="mt-1 list-disc pl-5 text-[15px]">{proposal.items?.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => { onChange(proposal.body !== undefined ? { body: proposal.body } : { items: proposal.items }); setProposal(null); }}><Check /> Use this</Button>
                <Button size="sm" variant="ghost" onClick={() => setProposal(null)}><X /> Discard</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Optional: how to change it (e.g. shorter)" aria-label={`How to rewrite ${s.heading}`} className="h-10 min-w-[200px] flex-1 rounded-lg bg-field px-3 text-[14.5px] ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-copper-400/70" />
              <Button size="sm" variant="ghost" disabled={asking} onClick={() => void rewrite()}>{asking ? <Loader2 className="animate-spin" /> : <Wand2 />} Rewrite this section</Button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function BulletEditor({ items, onChange, label }: { items: string[]; onChange: (i: string[]) => void; label: string }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <span aria-hidden className="mt-3 size-1.5 shrink-0 rounded-full bg-copper-500" />
          <Textarea rows={1} value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${label} point ${i + 1}`} className="min-h-11 text-[15px]" />
          <button type="button" aria-label={`Remove point ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))} className="mt-1 grid size-9 shrink-0 place-items-center rounded-lg text-subtle hover:bg-surface-3"><X className="size-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])} className="h-9 text-[14px] font-semibold text-accent-fg">+ Add a point</button>
    </div>
  );
}

function CostEditor({ content, edit, includeCosts, costs, manual }: { content: ReportContent; edit: (fn: (c: ReportContent) => ReportContent) => void; includeCosts: boolean; costs: ReturnType<typeof reportCostSummary>; manual: ReturnType<typeof manualCostLines> }) {
  if (!includeCosts) return <p className="text-[14.5px] text-muted-foreground">Costs are off. Turn on <strong>Include cost summary</strong> in step 1 to add them.</p>;
  const lines = content.costMode === "manual" ? manual : costs.lines;
  return (
    <div>
      <div className="inline-flex gap-0.5 rounded-xl bg-surface-3 p-1" role="radiogroup" aria-label="Where the figures come from">
        {(["records", "manual"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={content.costMode === m} onClick={() => edit((c) => ({ ...c, costMode: m }))} className={cn("h-9 rounded-lg px-3 text-[14px] font-semibold", content.costMode === m ? "bg-card text-heading ring-1 ring-line" : "text-muted-foreground")}>
            {m === "records" ? "From Bob's records" : "Enter figures for this report"}
          </button>
        ))}
      </div>
      {content.costMode === "manual" ? (
        <div className="mt-3 space-y-2">
          <p className="text-[13.5px] text-muted-foreground">These figures appear only in this report, labelled &quot;{MANUAL_COST_NOTE}&quot;. Invoices, payments and bookkeeping aren&apos;t changed.</p>
          {content.manualFigures.map((f, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Figure ${i + 1} label`} value={f.label} placeholder="e.g. Agreed price" onChange={(e) => edit((c) => ({ ...c, manualFigures: c.manualFigures.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />
              <Input aria-label={`Figure ${i + 1} amount in pounds`} inputMode="decimal" value={Number.isFinite(f.amount) ? String(f.amount) : ""} onChange={(e) => edit((c) => ({ ...c, manualFigures: c.manualFigures.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/[£,\s]/g, "")) } : x)) }))} className="w-32" />
              <button type="button" aria-label={`Remove figure ${i + 1}`} onClick={() => edit((c) => ({ ...c, manualFigures: c.manualFigures.filter((_, j) => j !== i) }))} className="grid size-12 shrink-0 place-items-center rounded-lg text-subtle hover:bg-surface-3"><X className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => edit((c) => ({ ...c, manualFigures: [...c.manualFigures, { label: "", amount: 0 }] }))} className="h-9 text-[14px] font-semibold text-accent-fg">+ Add a figure</button>
        </div>
      ) : !costs.reliable ? (
        <p className="mt-3 text-[14.5px] text-warn-fg">{costs.notes[0]}</p>
      ) : null}
      <div className="mt-3 rounded-xl bg-surface-2 p-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground"><PoundSterling className="size-3.5" aria-hidden /> These figures will appear in the PDF</p>
        {lines.length ? (
          <table className="mt-1.5 w-full text-[14.5px]">
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className={cn(l.strong && "font-semibold")}>
                  <td className="py-1 pr-3">{l.label}{l.note ? <span className="block text-[12.5px] font-normal text-muted-foreground">{l.note}</span> : null}</td>
                  <td className="py-1 text-right tabular align-top">{gbp(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mt-1 text-[14px] text-muted-foreground">No figures — the cost section will be left out.</p>}
        {content.costMode === "records" && costs.notes.length && costs.reliable ? <p className="mt-1 text-[12.5px] text-muted-foreground">{costs.notes.join(" ")}</p> : null}
      </div>
    </div>
  );
}
