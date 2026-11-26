"use client";

import * as React from "react";
import { ChefHat, Home, DoorClosed, Building2, Fence, Footprints, Hammer, ShowerHead } from "lucide-react";
import { fileUrl } from "@/lib/files/upload";
import type { Job, JobFile, JobKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<JobKind, typeof Home> = {
  kitchen: ChefHat,
  loft: Home,
  wardrobes: DoorClosed,
  extension: Building2,
  decking: Fence,
  staircase: Footprints,
  bathroom: ShowerHead,
  general: Hammer,
};

const RANK: Record<string, number> = { completion: 3, progress: 2, other: 1, drawing: 0 };

/** The best picture for each job: a finished photo, else the latest progress photo, else any image. */
export function jobCovers(files: JobFile[]): Map<string, JobFile> {
  const out = new Map<string, JobFile>();
  for (const f of files) {
    if (!f.jobId || f.deletedAt || !f.previewable || !f.mimeType.startsWith("image/")) continue;
    const cur = out.get(f.jobId);
    const better = !cur || (RANK[f.category] ?? 0) > (RANK[cur.category] ?? 0) || ((RANK[f.category] ?? 0) === (RANK[cur.category] ?? 0) && f.createdAt > cur.createdAt);
    if (better) out.set(f.jobId, f);
  }
  return out;
}

export function useJobCovers(files: JobFile[]) {
  return React.useMemo(() => jobCovers(files), [files]);
}

/** A job's cover photo, or a calm neutral placeholder with the type of work. */
export function JobCover({ job, file, className, large, small, children }: { job: Pick<Job, "kind" | "title">; file?: JobFile; className?: string; large?: boolean; small?: boolean; children?: React.ReactNode }) {
  const [broken, setBroken] = React.useState(false);
  const Icon = KIND_ICON[job.kind] ?? Hammer;
  const label = file?.description?.startsWith("Illustrative") ? "Illustrative image" : file?.description?.startsWith("Demo photo") ? "Demo photo" : null;
  return (
    <div className={cn("relative overflow-hidden bg-[#efede8]", className)}>
      {file && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, authenticated file route; sized by the container
        <img
          src={fileUrl(file.id, { thumb: file.hasThumb && !large })}
          alt={file.title || job.title}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div aria-hidden className="absolute inset-0 grid place-items-center bg-[radial-gradient(120%_90%_at_30%_10%,#f7f5f1_0%,#ebe8e2_60%,#e4e0d8_100%)]">
          <div className="absolute inset-0 opacity-[0.5] [background-image:linear-gradient(rgb(0_0_0/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(0_0_0/0.035)_1px,transparent_1px)] [background-size:22px_22px]" />
          <Icon className={cn("relative text-[#b9b2a6]", large ? "size-14" : small ? "size-4" : "size-9")} strokeWidth={1.4} />
        </div>
      )}
      {label && !broken && !small ? (
        <span className="absolute bottom-2 right-2 rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">{label}</span>
      ) : null}
      {children}
    </div>
  );
}
