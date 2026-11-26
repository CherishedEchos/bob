"use client";

/* eslint-disable @next/next/no-img-element -- private thumbnails from our own API */

/** The job's updates, newest first: note, stage, photos with captions, who and when. */
import * as React from "react";
import { Camera, Pencil, Trash2 } from "lucide-react";
import type { Job, JobFile, JobUpdate } from "@/lib/types";
import { api, useStore } from "@/lib/store/store";
import { fileUrl } from "@/lib/files/upload";
import { cn, timeAgo } from "@/lib/utils";
import { formatDayShort } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { FileViewer } from "@/components/files/files-panel";
import { AddUpdateDialog, STAGE_LABEL } from "./add-update";

export function AddUpdateButton({ job, className, label = "Add update", variant, size }: { job: Job; className?: string; label?: string; variant?: "secondary" | "ghost"; size?: "sm" }) {
  const { refresh, can } = useStore();
  const [open, setOpen] = React.useState(false);
  if (!can("notes.write")) return null;
  return (
    <>
      <Button className={className} variant={variant} size={size} onClick={() => setOpen(true)}>
        <Camera /> {label}
      </Button>
      {open ? <AddUpdateDialog jobId={job.id} jobTitle={job.title} onClose={() => setOpen(false)} onSaved={refresh} /> : null}
    </>
  );
}

const STAGE_TONE = { before: "bg-surface-3 text-foreground", in_progress: "bg-sky-500/10 text-info-fg", finished: "bg-emerald-500/12 text-good-fg" } as const;

export function UpdatesTimeline({ job, limit }: { job: Job; limit?: number }) {
  const { data, refresh, user } = useStore();
  const [editing, setEditing] = React.useState<JobUpdate | null>(null);
  const [viewing, setViewing] = React.useState<{ list: JobFile[]; index: number } | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const updates = data.updates.filter((u) => u.jobId === job.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const photosFor = (u: JobUpdate) => data.files.filter((f) => f.updateId === u.id && !f.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const manager = user.role === "owner" || user.role === "office";
  const shown = limit && !showAll ? updates.slice(0, limit) : updates;
  if (!updates.length) return <p className="text-[15px] text-muted-foreground">No updates yet. Add one from site with a photo and a line about what&apos;s been done.</p>;
  return (
    <>
      <ol className="relative space-y-5 border-l-2 border-line pl-5">
        {shown.map((u) => {
          const photos = photosFor(u);
          const mine = u.authorUserId === user.id;
          return (
            <li key={u.id} className="relative">
              <span aria-hidden className={cn("absolute -left-[27px] top-1.5 size-3 rounded-full ring-4 ring-card", u.stage === "finished" ? "bg-emerald-500" : "bg-copper-500")} />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px] text-muted-foreground">
                <time dateTime={u.createdAt} className="font-semibold text-foreground">{formatDayShort(u.createdAt.slice(0, 10))}</time>
                <span>· {u.authorName}</span>
                {u.stage ? <span className={cn("rounded-md px-1.5 py-0.5 text-[13.5px] font-semibold", STAGE_TONE[u.stage])}>{STAGE_LABEL[u.stage]}</span> : null}
                <span className="sr-only">{timeAgo(u.createdAt)}</span>
                {manager || mine ? (
                  <span className="ml-auto flex">
                    <button type="button" onClick={() => setEditing(u)} aria-label="Edit update" className="grid size-9 place-items-center rounded-lg hover:bg-surface-3 hover:text-foreground"><Pencil className="size-4" /></button>
                    <button
                      type="button"
                      aria-label="Remove update"
                      onClick={async () => {
                        if (!window.confirm("Remove this update? Its photos stay in Files & photos.")) return;
                        const r = await api<{ error?: string }>(`/api/job-updates/${u.id}`, { method: "DELETE" });
                        if (r.status !== 200) return toast(r.body.error ?? "Couldn't remove it", "error");
                        toast("Update removed — photos kept in Files & photos");
                        await refresh();
                      }}
                      className="grid size-9 place-items-center rounded-lg hover:bg-surface-3 hover:text-danger-fg"
                    ><Trash2 className="size-4" /></button>
                  </span>
                ) : null}
              </div>
              {u.note ? <p className="mt-1 whitespace-pre-wrap text-[15.5px] leading-relaxed text-foreground">{u.note}</p> : null}
              {photos.length ? (
                <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((f, i) => (
                    <li key={f.id}>
                      <button type="button" onClick={() => setViewing({ list: photos.filter((x) => x.previewable), index: Math.max(0, photos.filter((x) => x.previewable).indexOf(f)) })} className="block w-full overflow-hidden rounded-lg ring-1 ring-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View photo ${i + 1}${f.description ? `: ${f.description}` : ""}`}>
                        <img src={fileUrl(f.id, { thumb: f.hasThumb })} alt={f.description ?? ""} loading="lazy" className="aspect-square w-full bg-surface-2 object-cover" />
                      </button>
                      {f.description ? <p className="mt-1 line-clamp-2 text-[13.5px] text-muted-foreground">{f.description}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      {limit && updates.length > limit ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 h-10 text-[15px] font-semibold text-accent-fg">
          {showAll ? "Show fewer" : `Show all ${updates.length} updates`}
        </button>
      ) : null}
      {editing ? <AddUpdateDialog jobId={job.id} jobTitle={job.title} existing={editing} existingPhotos={photosFor(editing)} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {viewing ? <FileViewer list={viewing.list} index={viewing.index} onIndex={(i) => setViewing({ ...viewing, index: i })} onClose={() => setViewing(null)} /> : null}
    </>
  );
}
