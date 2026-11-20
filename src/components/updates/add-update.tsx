"use client";

/* eslint-disable @next/next/no-img-element -- local previews and private thumbnails from our own API */

/**
 * "Add update": a short note and/or photos, an optional stage, saved as one
 * dated update. Built for a phone on site: big targets, camera first, and
 * each photo uploads on its own so a weak signal only means retrying that
 * photo. The update itself has a client reference, so pressing Save twice (or
 * retrying) never makes two updates. Works without the dashboard store, so
 * crew use the same dialog from My work.
 */
import * as React from "react";
import { AlertCircle, Camera, CheckCircle2, ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import type { JobFile, JobUpdate, UpdateStage } from "@/lib/types";
import { fileUrl, newClientRef, precheck, uploadFile } from "@/lib/files/upload";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/sheet";

export const STAGES: { value: UpdateStage; label: string }[] = [
  { value: "before", label: "Before" },
  { value: "in_progress", label: "In progress" },
  { value: "finished", label: "Finished" },
];
export const STAGE_LABEL: Record<UpdateStage, string> = { before: "Before", in_progress: "In progress", finished: "Finished" };

type Pick = { key: string; file: File; preview: string; caption: string; clientRef: string; status: "ready" | "uploading" | "saved" | "failed"; progress: number; error?: string };

async function call<T>(path: string, method: string, body: unknown): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; value?: T; error?: string };
    if (r.status === 401) window.location.href = "/login";
    return r.ok && j.value !== undefined ? { ok: true, value: j.value } : { ok: false, error: j.error ?? "Couldn't save the update." };
  } catch {
    return { ok: false, error: "No connection — your update is still here. Try again when you have signal." };
  }
}

export function AddUpdateDialog({
  jobId,
  jobTitle,
  existing,
  existingPhotos = [],
  onClose,
  onSaved,
}: {
  jobId: string;
  jobTitle?: string;
  existing?: JobUpdate;
  existingPhotos?: JobFile[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [note, setNote] = React.useState(existing?.note ?? "");
  const [stage, setStage] = React.useState<UpdateStage | undefined>(existing?.stage);
  const [picks, setPicks] = React.useState<Pick[]>([]);
  const [captions, setCaptions] = React.useState<Record<string, string>>(() => Object.fromEntries(existingPhotos.map((f) => [f.id, f.description ?? ""])));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [updateId, setUpdateId] = React.useState<string | undefined>(existing?.id);
  const updateRef = React.useRef(newClientRef());
  const id = React.useId();

  React.useEffect(() => () => picks.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (files: FileList | null) => {
    const list = [...(files ?? [])];
    const next: Pick[] = list.map((file, i) => {
      const problem = precheck(file);
      return { key: `${Date.now()}-${i}-${file.name}`, file, preview: URL.createObjectURL(file), caption: "", clientRef: newClientRef(), status: problem ? "failed" : "ready", progress: 0, error: problem ?? undefined };
    });
    setPicks((p) => [...p, ...next]);
  };
  const patch = (key: string, p: Partial<Pick>) => setPicks((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const uploadOne = async (p: Pick, uid: string) => {
    patch(p.key, { status: "uploading", progress: 0, error: undefined });
    const r = await uploadFile(p.file, { jobId, category: stage === "finished" ? "completion" : "progress", clientRef: p.clientRef, description: p.caption.trim() || undefined, updateId: uid }, (f) => patch(p.key, { progress: f }));
    patch(p.key, r.ok ? { status: "saved", progress: 1 } : { status: "failed", error: r.error });
    return r.ok;
  };

  const save = async () => {
    const pending = picks.filter((p) => p.status === "ready" || (p.status === "failed" && !precheck(p.file)));
    if (!note.trim() && !pending.length && !existing && !picks.some((p) => p.status === "saved")) return setError("Add a note or at least one photo.");
    setBusy(true);
    setError("");
    let uid = updateId;
    if (!uid) {
      const r = await call<JobUpdate>("/api/job-updates", "POST", { jobId, note, stage, clientRef: updateRef.current });
      if (!r.ok) {
        setBusy(false);
        return setError(r.error);
      }
      uid = r.value.id;
      setUpdateId(uid);
    } else if (existing) {
      const r = await call<JobUpdate>(`/api/job-updates/${uid}`, "PATCH", { note, stage: stage ?? "" });
      if (!r.ok) {
        setBusy(false);
        return setError(r.error);
      }
      for (const f of existingPhotos) {
        if ((captions[f.id] ?? "") !== (f.description ?? "")) {
          const c = await call<unknown>(`/api/files/${f.id}`, "PATCH", { description: captions[f.id] ?? "" });
          if (!c.ok) {
            setBusy(false);
            return setError(c.error);
          }
        }
      }
    }
    const results = [];
    for (const p of pending) results.push(await uploadOne(p, uid));
    setBusy(false);
    await onSaved();
    if (results.every(Boolean)) onClose();
    else setError("The update is saved. Some photos didn't upload — tap Retry on each one.");
  };

  const failed = picks.filter((p) => p.status === "failed");
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={existing ? "Edit update" : "Add update"} description={jobTitle ? `On ${jobTitle}. It's dated and shows who added it.` : "Dated, with your name on it."} className="sm:w-[min(600px,calc(100vw-2rem))]">
        <div className="space-y-4">
          <div>
            <Label htmlFor={`${id}-note`}>What&apos;s happened? (optional)</Label>
            <Textarea id={`${id}-note`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Worktops fitted and sealed. Sink goes in tomorrow." className="text-[16px]" />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[14px] font-medium text-foreground/90">Stage (optional)</legend>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <button key={s.value} type="button" aria-pressed={stage === s.value} onClick={() => setStage(stage === s.value ? undefined : s.value)} className={cn("h-11 rounded-xl px-4 text-[15px] font-semibold ring-1 transition", stage === s.value ? "bg-selected text-accent-fg ring-copper-500/50" : "bg-card text-foreground ring-line-strong hover:bg-surface-2")}>
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="mb-1.5 text-[14px] font-medium text-foreground/90">Photos</div>
            <div className="grid grid-cols-2 gap-2">
              <label htmlFor={`${id}-cam`} className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-semibold text-white focus-within:ring-2 focus-within:ring-ring">
                <Camera className="size-5" aria-hidden /> Take photo
                <input id={`${id}-cam`} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
              </label>
              <label htmlFor={`${id}-lib`} className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl bg-card text-[16px] font-semibold text-foreground ring-1 ring-line-strong focus-within:ring-2 focus-within:ring-ring">
                <ImagePlus className="size-5" aria-hidden /> Choose photos
                <input id={`${id}-lib`} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            {existingPhotos.length ? (
              <ul className="mt-3 space-y-2" aria-label="Photos on this update">
                {existingPhotos.map((f) => (
                  <li key={f.id} className="flex items-center gap-3">
                    <img src={fileUrl(f.id, { thumb: f.hasThumb })} alt="" className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-line" />
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Caption</span>
                      <input value={captions[f.id] ?? ""} maxLength={200} onChange={(e) => setCaptions({ ...captions, [f.id]: e.target.value })} placeholder="Caption (optional)" className="h-11 w-full rounded-xl bg-field px-3 text-[16px] ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-copper-400/80" />
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {picks.length ? (
              <ul className="mt-3 space-y-2" aria-label="New photos">
                {picks.map((p) => (
                  <li key={p.key} className="flex items-start gap-3">
                    <span className="relative shrink-0">
                      <img src={p.preview} alt="" className="size-14 rounded-lg object-cover ring-1 ring-line" />
                      {p.status === "saved" ? <CheckCircle2 className="absolute -right-1.5 -top-1.5 size-5 rounded-full bg-card text-good-fg" aria-label="Saved" /> : null}
                      {p.status === "uploading" ? <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-white drop-shadow" aria-label="Uploading" /> : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <label>
                        <span className="sr-only">Caption for {p.file.name}</span>
                        <input value={p.caption} maxLength={200} disabled={p.status === "saved" || p.status === "uploading"} onChange={(e) => patch(p.key, { caption: e.target.value })} placeholder="Caption (optional)" className="h-11 w-full rounded-xl bg-field px-3 text-[16px] ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-copper-400/80 disabled:opacity-60" />
                      </label>
                      {p.status === "uploading" ? (
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(p.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${p.file.name}`}>
                          <div className="h-full bg-copper-500 transition-[width]" style={{ width: `${Math.max(4, p.progress * 100)}%` }} />
                        </div>
                      ) : null}
                      {p.error ? (
                        <p role="alert" className="mt-1 flex items-start gap-1.5 text-[13.5px] text-danger-fg">
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {p.error}
                        </p>
                      ) : null}
                    </div>
                    {p.status === "failed" && !precheck(p.file) && updateId ? (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={async () => { setBusy(true); const ok = await uploadOne(p, updateId); setBusy(false); if (!ok) return; await onSaved(); if (picks.every((x) => x.key === p.key || x.status === "saved")) onClose(); }} className="h-11">
                        <RotateCw /> Retry
                      </Button>
                    ) : p.status !== "saved" && p.status !== "uploading" ? (
                      <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => setPicks((l) => l.filter((x) => x.key !== p.key))} className="grid size-11 place-items-center rounded-lg text-subtle hover:bg-surface-3">
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="rounded-xl bg-red-500/[0.06] px-3 py-2 text-[14.5px] text-danger-fg ring-1 ring-red-500/25">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              {updateId && !existing ? "Close" : "Cancel"}
            </Button>
            <Button disabled={busy} onClick={() => void save()} className="sm:min-w-40">
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Saving…" : failed.length && updateId ? "Retry failed photos" : existing ? "Save changes" : "Save update"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
