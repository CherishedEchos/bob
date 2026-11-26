"use client";

/**
 * Pick files → choose what they are → upload, each with its own progress bar,
 * error and Retry. Doesn't depend on the dashboard store, so My work (invited
 * workers) uses it too. Input survives failures: nothing is cleared until a
 * file is saved.
 */
import * as React from "react";
import { AlertCircle, Camera, CheckCircle2, FileText, Loader2, RotateCw, Upload, X } from "lucide-react";
import type { FileCategory, JobFile } from "@/lib/types";
import { ACCEPT, CATEGORY_SINGULAR, formatBytes, guessCategory, newClientRef, precheck, uploadFile } from "@/lib/files/upload";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { DialogContent, Dialog } from "@/components/ui/sheet";

type Item = {
  key: string;
  file: File;
  category: FileCategory;
  clientRef: string;
  status: "ready" | "uploading" | "saved" | "failed";
  progress: number;
  error?: string;
  retryable?: boolean;
};

export interface UploadTarget {
  jobId?: string;
  enquiryId?: string;
}

/** Hidden pickers + the buttons that open them. Use `UploadButtons` to start. */
export function UploadButtons({ onPick, allowCamera = true, primaryLabel = "Upload files", className }: { onPick: (files: File[]) => void; allowCamera?: boolean; primaryLabel?: string; className?: string }) {
  const id = React.useId();
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])];
    e.target.value = "";
    if (list.length) onPick(list);
  };
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <label htmlFor={`${id}-files`} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgb(16_24_40/0.12)] transition hover:bg-copper-600 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <Upload className="size-[18px]" aria-hidden /> {primaryLabel}
        <input id={`${id}-files`} type="file" multiple accept={ACCEPT} className="sr-only" onChange={pick} />
      </label>
      {allowCamera ? (
        <label htmlFor={`${id}-camera`} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-card px-4 text-[15px] font-semibold text-foreground ring-1 ring-line-strong transition hover:bg-raised-hover focus-within:ring-2 focus-within:ring-ring sm:hidden">
          <Camera className="size-[18px]" aria-hidden /> Take photo
          <input id={`${id}-camera`} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
        </label>
      ) : null}
    </div>
  );
}

export function UploadQueue({
  target,
  files,
  onClose,
  onSaved,
  defaultCategory = "progress",
  worker = false,
  revisionOf,
}: {
  target: UploadTarget;
  files: File[];
  onClose: () => void;
  onSaved: (saved: JobFile[]) => void | Promise<void>;
  defaultCategory?: FileCategory;
  /** Invited workers: no drawings, always shared with the team. */
  worker?: boolean;
  /** Adding a new revision of this drawing. */
  revisionOf?: JobFile;
}) {
  const [items, setItems] = React.useState<Item[]>(() =>
    files.map((file, i) => {
      const problem = precheck(file);
      const cat = revisionOf ? "drawing" : guessCategory(file, defaultCategory);
      return { key: `${i}-${file.name}-${file.size}`, file, category: worker && cat === "drawing" ? "other" : cat, clientRef: newClientRef(), status: problem ? "failed" : "ready", progress: 0, error: problem ?? undefined, retryable: false };
    }),
  );
  const [description, setDescription] = React.useState("");
  const [revision, setRevision] = React.useState("");
  const [title, setTitle] = React.useState(revisionOf?.title ?? "");
  const [visibility, setVisibility] = React.useState<"team" | "office">("team");
  const [running, setRunning] = React.useState(false);
  const saved = React.useRef<JobFile[]>([]);

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const runOne = async (it: Item) => {
    patch(it.key, { status: "uploading", progress: 0, error: undefined });
    const r = await uploadFile(
      it.file,
      {
        ...target,
        category: it.category,
        clientRef: it.clientRef,
        description: description.trim() || undefined,
        revision: it.category === "drawing" ? revision.trim() || undefined : undefined,
        title: items.length === 1 ? title.trim() || undefined : undefined,
        replacesId: revisionOf?.id,
        visibility: worker ? "team" : visibility,
      },
      (f) => patch(it.key, { progress: f }),
    );
    if (r.ok) {
      saved.current.push(r.file);
      patch(it.key, { status: "saved", progress: 1 });
    } else patch(it.key, { status: "failed", error: r.error, retryable: r.retryable });
    return r.ok;
  };

  const start = async (only?: Item[]) => {
    setRunning(true);
    const todo = only ?? items.filter((x) => x.status === "ready" || (x.status === "failed" && x.retryable));
    // Two at a time: quick on Wi-Fi, gentle on a phone signal.
    const queue = [...todo];
    await Promise.all(
      [0, 1].map(async () => {
        while (queue.length) await runOne(queue.shift()!);
      }),
    );
    setRunning(false);
    if (saved.current.length) {
      await onSaved(saved.current);
      saved.current = [];
    }
  };

  const ready = items.filter((x) => x.status === "ready").length;
  const failed = items.filter((x) => x.status === "failed");
  const done = items.length > 0 && items.every((x) => x.status === "saved" || (x.status === "failed" && !x.retryable));
  const savedCount = items.filter((x) => x.status === "saved").length;
  const hasDrawing = items.some((x) => x.category === "drawing");

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent
        title={revisionOf ? `New revision of ${revisionOf.title ?? revisionOf.filename}` : `Add ${items.length} file${items.length === 1 ? "" : "s"}`}
        description={revisionOf ? "The earlier versions stay in the history." : "Each file uploads on its own — if one fails, retry just that one."}
        className="sm:w-[min(620px,calc(100vw-2rem))]"
      >
        <ul className="divide-y divide-line rounded-xl ring-1 ring-line" aria-label="Files to upload">
          {items.map((it) => (
            <li key={it.key} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground" aria-hidden>
                  {it.status === "saved" ? <CheckCircle2 className="size-5 text-good-fg" /> : it.status === "failed" ? <AlertCircle className="size-5 text-danger-fg" /> : it.status === "uploading" ? <Loader2 className="size-5 animate-spin text-accent-fg" /> : <FileText className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium" title={it.file.name}>
                    {it.file.name}
                  </div>
                  <div className="text-[14px] text-muted-foreground">
                    {formatBytes(it.file.size)}
                    {it.status === "uploading" ? ` · ${Math.round(it.progress * 100)}%` : it.status === "saved" ? " · Saved" : ""}
                  </div>
                  {it.status === "uploading" ? (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={`Uploading ${it.file.name}`} aria-valuenow={Math.round(it.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-copper-500 transition-[width]" style={{ width: `${Math.max(4, it.progress * 100)}%` }} />
                    </div>
                  ) : null}
                  {it.error ? (
                    <p role="alert" className="mt-1 text-[14.5px] text-danger-fg">
                      {it.error}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 pl-12 sm:pl-0">
                {it.status === "ready" && !revisionOf ? (
                  <label className="w-[170px]">
                    <span className="sr-only">What is {it.file.name}?</span>
                    <NativeSelect value={it.category} onChange={(e) => patch(it.key, { category: e.target.value as FileCategory })} className="h-10 text-[15px]">
                      {(worker ? (["progress", "completion", "other"] as FileCategory[]) : (["drawing", "progress", "completion", "other"] as FileCategory[])).map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_SINGULAR[c]}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                ) : null}
                {it.status === "failed" && it.retryable ? (
                  <Button size="sm" variant="secondary" disabled={running} onClick={() => void start([it])} className="h-10">
                    <RotateCw /> Retry
                  </Button>
                ) : null}
                {it.status === "ready" || it.status === "failed" ? (
                  <button type="button" disabled={running} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} aria-label={`Remove ${it.file.name}`} className="grid size-10 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-foreground disabled:opacity-40">
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {ready > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {items.length === 1 ? (
              <div className="sm:col-span-2">
                <Label htmlFor="up-title">Title (optional)</Label>
                <Input id="up-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={revisionOf ? "Same as before" : "e.g. Ground floor plan"} />
              </div>
            ) : null}
            {hasDrawing ? (
              <div>
                <Label htmlFor="up-rev">Drawing revision (optional)</Label>
                <Input id="up-rev" value={revision} onChange={(e) => setRevision(e.target.value)} maxLength={30} placeholder="e.g. Rev C" />
              </div>
            ) : null}
            {!worker && !revisionOf ? (
              <div className={hasDrawing ? "" : "sm:col-span-2"}>
                <Label htmlFor="up-vis">Who can see {items.length === 1 ? "it" : "them"}</Label>
                <NativeSelect id="up-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as "team" | "office")}>
                  <option value="team">Shared with people booked on the job</option>
                  <option value="office">Office only (owners, admins, site team)</option>
                </NativeSelect>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Label htmlFor="up-desc">Description (optional)</Label>
              <Textarea id="up-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} placeholder="e.g. First fix electrics, kitchen wall" />
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {done ? (
            <>
              <p className="mr-auto text-[15px] text-muted-foreground" aria-live="polite">
                {savedCount} saved{failed.length ? ` · ${failed.length} not uploaded` : ""}
              </p>
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={running} onClick={onClose}>
                {savedCount ? "Close" : "Cancel"}
              </Button>
              <Button disabled={running || (!ready && !failed.some((f) => f.retryable))} onClick={() => void start()}>
                {running ? <Loader2 className="animate-spin" /> : <Upload />}
                {running ? "Uploading…" : ready ? `Upload ${ready} file${ready === 1 ? "" : "s"}` : "Retry failed"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
