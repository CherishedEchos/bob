"use client";

/* eslint-disable @next/next/no-img-element -- private, auth-protected images served by our own API */

import * as React from "react";
import { Camera, ImagePlus, Loader2, MapPin, Trash2 } from "lucide-react";
import type { Job, Photo } from "@/lib/types";
import { api, useStore } from "@/lib/store/store";
import { cn, timeAgo } from "@/lib/utils";
import { isActiveJob, isOpenEnquiry, JOB_STATUS_LABEL } from "@/lib/derive";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, Sheet, SheetContent } from "@/components/ui/sheet";
import { JobTile } from "@/components/common/job-tile";
import { toast } from "@/components/ui/toaster";

/** Shrink a photo on the phone (max 1600px JPEG) so uploads are quick on site. */
export async function resizePhoto(file: File): Promise<{ dataBase64: string; mimeType: "image/jpeg"; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable"));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    return { dataBase64: dataUrl.split(",")[1], mimeType: "image/jpeg", width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function upload(file: File, relatedType: Photo["relatedType"], relatedId: string, caption?: string) {
  const img = await resizePhoto(file);
  const r = await api<{ ok?: boolean; error?: string }>("/api/photos", { json: { relatedType, relatedId, caption, ...img } });
  return r.status === 200 && r.body.ok ? { ok: true as const } : { ok: false as const, error: r.body.error ?? "Couldn't save the photo" };
}

/** Photos on a job or enquiry, with an Add photo tile and a full-size viewer. */
export function PhotoGrid({ relatedType, relatedId }: { relatedType: Photo["relatedType"]; relatedId: string }) {
  const { data, refresh, can, user } = useStore();
  const photos = data.photos.filter((p) => p.relatedType === relatedType && p.relatedId === relatedId);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<Photo | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  const onPick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    const r = await upload(file, relatedType, relatedId).catch(() => ({ ok: false as const, error: "Couldn't read that photo" }));
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!r.ok) return toast(r.error, "error");
    toast("Photo added", "success");
    await refresh();
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpen(p)} className="group relative aspect-square overflow-hidden rounded-lg bg-raised ring-1 ring-line-strong">
            <img src={`/api/photos/${p.id}`} alt={p.caption ?? "Site photo"} loading="lazy" className="size-full object-cover transition group-active:scale-[0.98]" />
          </button>
        ))}
        {can("notes.write") ? (
          <label className={cn("grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-line-strong bg-card text-center text-[13px] font-medium text-muted-foreground transition hover:text-foreground", busy && "pointer-events-none opacity-60")}>
            <span className="flex flex-col items-center gap-1">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5 text-accent-icon" />}
              {busy ? "Saving…" : "Add photo"}
            </span>
            <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onPick(e.target.files?.[0])} />
          </label>
        ) : null}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open ? (
          <DialogContent title={open.caption ?? "Site photo"} description={`Added by ${open.createdBy} · ${timeAgo(open.createdAt)}`}>
            <img src={`/api/photos/${open.id}`} alt={open.caption ?? "Site photo"} className="max-h-[60dvh] w-full rounded-xl object-contain ring-1 ring-line" />
            {can("notes.write") && (user.role !== "staff" || open.createdBy === user.name) ? (
              <Button
                variant="destructive"
                className="mt-4 w-full"
                onClick={async () => {
                  const r = await api<{ ok?: boolean; error?: string }>(`/api/photos/${open.id}`, { method: "DELETE" });
                  if (r.status !== 200) return toast(r.body.error ?? "Couldn't delete", "error");
                  setOpen(null);
                  toast("Photo deleted");
                  await refresh();
                }}
              >
                <Trash2 /> Delete photo
              </Button>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

/** Jobs in the order you're most likely to be photographing them. */
function rankJobs(jobs: Job[]): Job[] {
  const today = new Date().toISOString().slice(0, 10);
  const score = (j: Job) =>
    j.status === "in_progress" || j.status === "snagging" ? 0 : j.status === "scheduled" && j.startDate && j.startDate <= today ? 1 : j.status === "scheduled" ? 2 : 3;
  return jobs.filter(isActiveJob).sort((a, b) => score(a) - score(b) || (a.startDate ?? "9").localeCompare(b.startDate ?? "9"));
}

/** "Snap a photo": take it, Bob suggests the job, tap to file it. */
export function SnapPhotoButton({ className, label = false }: { className?: string; label?: boolean }) {
  const { data, refresh, can } = useStore();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [caption, setCaption] = React.useState("");
  const [showEnquiries, setShowEnquiries] = React.useState(false);
  const [saving, setSaving] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  if (!can("notes.write")) return null;

  const jobs = rankJobs(data.jobs);
  const enquiries = data.enquiries.filter(isOpenEnquiry).slice(0, 8);
  const close = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setCaption("");
    setShowEnquiries(false);
    if (input.current) input.current.value = "";
  };
  const fileTo = async (relatedType: Photo["relatedType"], relatedId: string, name: string) => {
    if (!file) return;
    setSaving(relatedId);
    const r = await upload(file, relatedType, relatedId, caption.trim() || undefined).catch(() => ({ ok: false as const, error: "Couldn't read that photo" }));
    setSaving(null);
    if (!r.ok) return toast(r.error, "error");
    toast(`Photo filed to ${name}`, "success");
    close();
    await refresh();
  };

  return (
    <>
      <label className={cn("inline-flex cursor-pointer items-center justify-center gap-2", className)} aria-label="Add photo" title="Add photo">
        <Camera className="size-[22px]" strokeWidth={1.7} />
        {label ? <span>Photo</span> : null}
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f);
            setPreview(URL.createObjectURL(f));
          }}
        />
      </label>
      <Sheet open={!!file} onOpenChange={(o) => !o && close()}>
        <SheetContent side="bottom" title="File this photo" className="flex max-h-[92dvh] flex-col p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="t-section pr-12">File this photo</div>
          <div className="mt-3 flex gap-3">
            {preview ? <img src={preview} alt="Your photo" className="size-24 shrink-0 rounded-xl object-cover ring-1 ring-line-strong" /> : null}
            <div className="min-w-0 flex-1">
              <label htmlFor="photo-caption" className="mb-1.5 block text-[14px] font-medium text-foreground/90">
                Note (optional)
              </label>
              <input
                id="photo-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={200}
                placeholder="e.g. Damp patch behind the units"
                className="h-12 w-full rounded-xl bg-[#0f0e0c] px-3.5 text-[16px] text-foreground outline-none ring-1 ring-line-strong placeholder:text-subtle focus:ring-2 focus:ring-copper-400/80"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="t-eyebrow">{showEnquiries ? "Which enquiry?" : "Which job? Bob's best guess first"}</div>
            <button type="button" onClick={() => setShowEnquiries((v) => !v)} className="h-9 px-1 text-[13.5px] font-medium text-accent-fg">
              {showEnquiries ? "Show jobs" : "It's for an enquiry"}
            </button>
          </div>
          <ul className="mt-2 min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-xl bg-card ring-1 ring-line">
            {(showEnquiries ? enquiries : jobs).length === 0 ? (
              <li className="px-4 py-4 text-[14.5px] text-muted-foreground">{showEnquiries ? "No open enquiries." : "No active jobs."}</li>
            ) : null}
            {showEnquiries
              ? enquiries.map((e) => (
                  <li key={e.id}>
                    <button type="button" disabled={!!saving} onClick={() => void fileTo("enquiry", e.id, `${e.customerName}'s enquiry`)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 active:bg-raised disabled:opacity-60">
                      <div className="min-w-0 flex-1">
                        <div className="t-name truncate">{e.customerName}</div>
                        <div className="truncate text-[13.5px] text-muted-foreground">
                          {e.title} · {e.location}
                        </div>
                      </div>
                      {saving === e.id ? <Loader2 className="size-4 animate-spin text-accent-fg" /> : null}
                    </button>
                  </li>
                ))
              : jobs.map((j, i) => (
                  <li key={j.id}>
                    <button type="button" disabled={!!saving} onClick={() => void fileTo("job", j.id, `${j.customerName}'s ${j.title.toLowerCase()}`)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 active:bg-raised disabled:opacity-60", i === 0 && "bg-raised/60")}>
                      <JobTile kind={j.kind} className="size-10 rounded-lg [&_svg]:size-5" />
                      <div className="min-w-0 flex-1">
                        <div className="t-name truncate">
                          {j.title} · {j.customerName}
                        </div>
                        <div className="flex items-center gap-1 truncate text-[13.5px] text-muted-foreground">
                          <MapPin className="size-3.5 shrink-0" /> {j.location} · {JOB_STATUS_LABEL[j.status]}
                        </div>
                      </div>
                      {saving === j.id ? <Loader2 className="size-4 animate-spin text-accent-fg" /> : i === 0 ? <span className="rounded-md bg-copper-500/15 px-1.5 py-0.5 text-[12px] font-medium text-accent-fg">Likely</span> : null}
                    </button>
                  </li>
                ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
