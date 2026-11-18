"use client";

/**
 * Customer handover for a job: pick specific files → preview exactly what's
 * going in → save → download the ZIP. Owners and admins only.
 */
import * as React from "react";
import { ArrowLeft, Check, Download, FileArchive, Loader2, PackageCheck, ShieldCheck } from "lucide-react";
import type { FileCategory, Handover, Job, JobFile } from "@/lib/types";
import { api, useStore } from "@/lib/store/store";
import { CATEGORY_LABEL, formatBytes } from "@/lib/files/upload";
import { cn, formatDateKey, timeAgo, todayKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { groupRevisions, Thumb } from "./files-panel";

const ORDER: FileCategory[] = ["drawing", "completion", "progress", "other"];

export function HandoverPanel({ job }: { job: Job }) {
  const { data, refresh, user } = useStore();
  const manager = user.role === "owner" || user.role === "office";
  const handovers = data.handovers.filter((h) => h.jobId === job.id);
  const files = data.files.filter((f) => f.jobId === job.id && !f.deletedAt);
  // Offer current versions first; older drawing revisions can be ticked too.
  const groups = groupRevisions(files);
  const [step, setStep] = React.useState<"list" | "select" | "preview">("list");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [completionDate, setCompletionDate] = React.useState(job.status === "completed" ? todayKey() : "");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [downloading, setDownloading] = React.useState<string | null>(null);

  if (!manager) return <p className="text-[15px] text-muted-foreground">Only an owner or admin can prepare a customer handover.</p>;

  const byId = new Map(files.map((f) => [f.id, f]));
  const chosen = selected.map((id) => byId.get(id)).filter(Boolean) as JobFile[];
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const download = async (h: Handover) => {
    setDownloading(h.id);
    try {
      const res = await fetch(`/api/handovers/${h.id}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't build the handover. Nothing was changed — try again.");
      }
      const blob = await res.blob();
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name ? decodeURIComponent(name) : `${job.title} handover.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      toast("Handover downloaded", "success");
      void refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't download the handover", "error");
    } finally {
      setDownloading(null);
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    const r = await api<{ ok?: boolean; value?: Handover; error?: string }>("/api/handovers", { json: { jobId: job.id, fileIds: selected, completionDate: completionDate || undefined, message } }).catch(() => ({ status: 0, body: { error: "Couldn't reach the server. Nothing was saved." } as { error: string; value?: Handover } }));
    setBusy(false);
    if (r.status !== 200 || !r.body.value) return setError(r.body.error ?? "Couldn't save the handover. Nothing was changed.");
    await refresh();
    setStep("list");
    setSelected([]);
    setMessage("");
    toast("Handover saved — downloading", "success");
    await download(r.body.value);
  };

  if (step === "select")
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[16px] font-semibold text-heading">Choose what the customer gets</h3>
            <p className="text-[14px] text-muted-foreground">Nothing is included until you tick it.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep("list")}>
              Cancel
            </Button>
            <Button size="sm" disabled={!selected.length} onClick={() => setStep("preview")}>
              Preview ({selected.length})
            </Button>
          </div>
        </div>
        {!files.length ? <p className="mt-4 text-[15px] text-muted-foreground">This job has no files yet. Add drawings and completion photos in Files &amp; photos first.</p> : null}
        <div className="mt-4 space-y-5">
          {ORDER.map((c) => {
            const gs = groups.filter((g) => g.current.category === c);
            if (!gs.length) return null;
            return (
              <fieldset key={c}>
                <legend className="mb-2 text-[14px] font-semibold text-heading">{CATEGORY_LABEL[c]}</legend>
                <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card ring-1 ring-line-strong">
                  {gs.flatMap((g) => [g.current, ...g.history]).map((f) => {
                    const isCurrent = groups.some((g) => g.current.id === f.id);
                    const on = selected.includes(f.id);
                    return (
                      <li key={f.id}>
                        <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 transition hover:bg-surface-2", on && "bg-selected/60")}>
                          <input type="checkbox" checked={on} onChange={() => toggle(f.id)} className="size-5 shrink-0 accent-[var(--color-copper-500)]" />
                          <Thumb file={f} className="size-11 shrink-0 rounded-md" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-heading">
                              {f.title ?? f.filename}
                              {f.revision ? <span className="ml-2 rounded bg-surface-3 px-1.5 text-[12.5px] font-semibold">{f.revision}</span> : null}
                              {c === "drawing" && !isCurrent ? <span className="ml-2 text-[12.5px] font-medium text-muted-foreground">Superseded</span> : null}
                            </span>
                            <span className="block truncate text-[13px] text-muted-foreground">
                              {f.description ?? f.filename} · {formatBytes(f.bytes)}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>
      </div>
    );

  if (step === "preview")
    return (
      <div>
        <button type="button" onClick={() => setStep("select")} className="mb-3 inline-flex h-10 items-center gap-1.5 rounded-lg px-1 text-[14.5px] font-semibold text-accent-fg">
          <ArrowLeft className="size-4" aria-hidden /> Change selection
        </button>
        <h3 className="text-[16px] font-semibold text-heading">Preview: exactly what goes in the ZIP</h3>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-card ring-1 ring-line-strong" aria-label="Files included">
          <li className="flex items-center gap-3 px-3 py-2.5 text-[14.5px]">
            <FileArchive className="size-5 shrink-0 text-accent-icon" aria-hidden />
            <span className="flex-1">
              <strong>Start here - index.html</strong> — {data.org.name} branded index with job title, site{completionDate ? ", completion date" : ""} and the file list
            </span>
          </li>
          {chosen.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 text-[14.5px]">
              <Check className="size-5 shrink-0 text-good-fg" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {f.title ?? f.filename}
                  {f.revision ? ` (${f.revision})` : ""}
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {CATEGORY_LABEL[f.category]} · original file, {formatBytes(f.bytes)}
                  {f.description ? ` · ${f.description}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[14px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good-fg" aria-hidden />
          Not included: internal notes, prices, payments, invoices, customer contact details, and the {files.length - chosen.length} file{files.length - chosen.length === 1 ? "" : "s"} you didn&apos;t tick.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[200px_1fr]">
          <div>
            <Label htmlFor="ho-date">Completion date (optional)</Label>
            <Input id="ho-date" type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ho-msg">Note for the customer (optional, appears in the index)</Label>
            <Textarea id="ho-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="e.g. Oil the worktops monthly for the first three months." />
          </div>
        </div>
        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-red-500/[0.06] px-3 py-2 text-[14.5px] text-danger-fg ring-1 ring-red-500/25">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setStep("select")}>
            Back
          </Button>
          <Button disabled={busy || !chosen.length} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : <PackageCheck />} Save &amp; download ZIP
          </Button>
        </div>
        <p className="mt-2 text-right text-[13px] text-subtle">Bob saves this version and downloads it. Send it to the customer yourself — nothing is emailed or shared from Bob.</p>
      </div>
    );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="text-[15px] text-foreground/90">Give the customer a ZIP with the drawings, completion photos and documents you choose, plus a branded index.</p>
          {job.status !== "completed" ? <p className="mt-1 text-[14px] text-muted-foreground">This job isn&apos;t marked complete yet — you can still prepare a handover.</p> : null}
        </div>
        <Button onClick={() => setStep("select")} disabled={!files.length}>
          <PackageCheck /> Create handover
        </Button>
      </div>
      {handovers.length ? (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl bg-card ring-1 ring-line-strong" aria-label="Saved handovers">
          {handovers.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FileArchive className="size-6 shrink-0 text-accent-icon" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-heading">{h.title}</div>
                <div className="text-[13.5px] text-muted-foreground">
                  {h.items.length} file{h.items.length === 1 ? "" : "s"} · saved by {h.createdBy} {timeAgo(h.createdAt)}
                  {h.completionDate ? ` · completed ${formatDateKey(h.completionDate)}` : ""}
                  {h.downloads ? ` · downloaded ${h.downloads}×` : ""}
                </div>
                <details className="mt-1 text-[13.5px]">
                  <summary className="cursor-pointer font-medium text-accent-fg">What&apos;s in it</summary>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {h.items.map((i) => (
                      <li key={i.fileId}>
                        {i.zipPath}
                        {i.revision ? ` (${i.revision})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              <Button variant="secondary" size="sm" disabled={downloading === h.id} onClick={() => void download(h)}>
                {downloading === h.id ? <Loader2 className="animate-spin" /> : <Download />} Download ZIP
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[14.5px] text-muted-foreground">{files.length ? "No handovers yet." : "Add files in Files & photos first."}</p>
      )}
    </div>
  );
}
