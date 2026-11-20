"use client";

/* eslint-disable @next/next/no-img-element -- private, auth-protected files served by our own API */

/**
 * Files & photos for a job (or enquiry): search, filter by category, sort by
 * date, thumbnails, an image/PDF viewer, download, drawing revisions with the
 * current version marked, and owner/admin controls.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, Download, FileImage, FileText, History, ImageOff, MoreHorizontal, Pencil, Search, Trash2, Upload } from "lucide-react";
import type { FileCategory, JobFile } from "@/lib/types";
import { api, useStore } from "@/lib/store/store";
import { CATEGORY_LABEL, CATEGORY_SINGULAR, extOf, fileUrl, formatBytes } from "@/lib/files/upload";
import { cn, formatDateKey, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/sheet";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { toast } from "@/components/ui/toaster";
import { UploadButtons, UploadQueue } from "./upload-queue";

type Filter = "all" | FileCategory;
const ALL_ORDER: FileCategory[] = ["drawing", "progress", "completion", "other"];

/** Revision groups: current (newest) first, then the older versions. */
export function groupRevisions(files: JobFile[]): { current: JobFile; history: JobFile[] }[] {
  const groups = new Map<string, JobFile[]>();
  for (const f of files) groups.set(f.groupId, [...(groups.get(f.groupId) ?? []), f]);
  return [...groups.values()].map((g) => {
    const sorted = [...g].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { current: sorted[0], history: sorted.slice(1) };
  });
}

export function FilesPanel({ jobId, enquiryId, compact = false, only }: { jobId?: string; enquiryId?: string; compact?: boolean; only?: FileCategory[] }) {
  const { data, refresh, can, user } = useStore();
  const all = data.files.filter((f) => (jobId ? f.jobId === jobId : f.enquiryId === enquiryId && !f.jobId) && !f.deletedAt && (!only || only.includes(f.category)));
  const ORDER = only ? ALL_ORDER.filter((c) => only.includes(c)) : ALL_ORDER;
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<"newest" | "oldest">("newest");
  const [picked, setPicked] = React.useState<File[] | null>(null);
  const [revisionOf, setRevisionOf] = React.useState<JobFile | null>(null);
  const [viewing, setViewing] = React.useState<{ list: JobFile[]; index: number } | null>(null);
  const [editing, setEditing] = React.useState<JobFile | null>(null);
  const [deleting, setDeleting] = React.useState<JobFile | null>(null);
  const [openHistory, setOpenHistory] = React.useState<Set<string>>(new Set());
  const manager = user.role === "owner" || user.role === "office";
  const canUpload = can("notes.write");

  const q = query.trim().toLowerCase();
  const groups = groupRevisions(all)
    .filter(({ current }) => filter === "all" || current.category === filter)
    .filter(({ current, history }) => !q || [current, ...history].some((f) => [f.title, f.filename, f.description, f.revision, f.uploadedBy].some((x) => x?.toLowerCase().includes(q))))
    .sort((a, b) => (sort === "newest" ? b.current.createdAt.localeCompare(a.current.createdAt) : a.current.createdAt.localeCompare(b.current.createdAt)));
  const counts = Object.fromEntries(ORDER.map((c) => [c, groupRevisions(all).filter((g) => g.current.category === c).length])) as Record<FileCategory, number>;

  const sections = ORDER.map((c) => ({ c, groups: groups.filter((g) => g.current.category === c) })).filter((s) => s.groups.length);

  const open = (f: JobFile) => {
    const list = groups.map((g) => g.current).filter((x) => x.previewable);
    const i = list.findIndex((x) => x.id === f.id);
    setViewing(i >= 0 ? { list, index: i } : { list: [f], index: 0 });
  };

  const actionsFor = (f: JobFile, isCurrent: boolean): MenuItem[] => {
    const mine = f.uploadedByUserId === user.id;
    return [
      { label: "Download original", icon: Download, onSelect: () => window.open(fileUrl(f.id, { download: true }), "_blank", "noopener") },
      ...(canUpload && (manager || mine) ? [{ label: "Edit details", icon: Pencil, onSelect: () => setEditing(f) }] : []),
      ...(canUpload && isCurrent && f.category === "drawing" ? [{ label: "Add new revision", icon: Upload, onSelect: () => setRevisionOf(f) }] : []),
      ...(manager || mine ? [{ label: "Delete", icon: Trash2, onSelect: () => setDeleting(f) }] : []),
    ];
  };

  return (
    <div>
      {/* Toolbar: one primary action, search, compact filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {canUpload ? <UploadButtons onPick={setPicked} primaryLabel={compact ? "Add files" : "Upload files"} /> : null}
        {all.length ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:justify-end">
            <div className="relative min-w-[200px] flex-1 lg:max-w-[280px]">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" aria-label="Search files" className="pl-9" />
            </div>
            <label className="w-[170px]">
              <span className="sr-only">Show</span>
              <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                <option value="all">All files ({groupRevisions(all).length})</option>
                {ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]} ({counts[c]})
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="w-[130px]">
              <span className="sr-only">Sort</span>
              <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest")}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </NativeSelect>
            </label>
          </div>
        ) : null}
      </div>

      {!all.length ? (
        <div className="mt-4 rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center">
          <FileImage className="mx-auto size-7 text-subtle" aria-hidden />
          <p className="mt-2 text-[15.5px] font-semibold text-heading">No files yet</p>
          <p className="mx-auto mt-1 max-w-md text-[14.5px] text-muted-foreground">
            {canUpload ? "Add drawings, progress photos and documents. On a phone you can take a photo straight from the camera." : "Files added by the team will show here."}
          </p>
        </div>
      ) : !groups.length ? (
        <p className="mt-6 text-center text-[15px] text-muted-foreground">No files match. Try a different search or filter.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {sections.map(({ c, groups: gs }) => (
            <section key={c} aria-labelledby={`fs-${c}`}>
              <h3 id={`fs-${c}`} className="mb-2 flex items-baseline gap-2 text-[14px] font-semibold text-heading">
                {CATEGORY_LABEL[c]} <span className="font-normal text-muted-foreground">{gs.length}</span>
              </h3>
              {c === "progress" || c === "completion" ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {gs.map(({ current: f }) => (
                    <li key={f.id} className="group overflow-hidden rounded-xl bg-card ring-1 ring-line-strong">
                      <button type="button" onClick={() => open(f)} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={`View ${f.title ?? f.filename}`}>
                        <Thumb file={f} className="aspect-[4/3] w-full" />
                      </button>
                      <div className="flex items-start gap-1 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium text-heading">{f.title ?? f.description ?? f.filename}</div>
                          <div className="truncate text-[12.5px] text-muted-foreground">
                            {f.uploadedBy} · {formatDateKey(f.createdAt.slice(0, 10))}
                          </div>
                        </div>
                        <FileMenu items={actionsFor(f, true)} name={f.title ?? f.filename} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card ring-1 ring-line-strong">
                  {gs.map(({ current: f, history }) => (
                    <li key={f.id}>
                      <FileRow file={f} current={c === "drawing"} revisions={history.length} onOpen={() => (f.previewable ? open(f) : window.open(fileUrl(f.id, { download: true }), "_blank", "noopener"))} menu={actionsFor(f, true)}>
                        {history.length ? (
                          <button
                            type="button"
                            aria-expanded={openHistory.has(f.groupId)}
                            onClick={() => setOpenHistory((s) => { const n = new Set(s); if (n.has(f.groupId)) n.delete(f.groupId); else n.add(f.groupId); return n; })}
                            className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[13.5px] font-semibold text-accent-fg hover:bg-copper-500/10"
                          >
                            <History className="size-3.5" aria-hidden /> {openHistory.has(f.groupId) ? "Hide" : "Show"} {history.length} earlier revision{history.length === 1 ? "" : "s"}
                          </button>
                        ) : null}
                      </FileRow>
                      {openHistory.has(f.groupId) ? (
                        <ul className="border-t border-line bg-surface-2/60" aria-label={`Earlier revisions of ${f.title ?? f.filename}`}>
                          {history.map((h) => (
                            <li key={h.id} className="border-b border-line last:border-0">
                              <FileRow file={h} superseded onOpen={() => (h.previewable ? setViewing({ list: [h], index: 0 }) : window.open(fileUrl(h.id, { download: true }), "_blank", "noopener"))} menu={actionsFor(h, false)} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {picked ? (
        <UploadQueue
          target={{ jobId, enquiryId }}
          files={picked}
          defaultCategory={filter === "all" ? "progress" : filter}
          onClose={() => setPicked(null)}
          onSaved={async (saved) => {
            await refresh();
            toast(`${saved.length} file${saved.length === 1 ? "" : "s"} saved`, "success");
          }}
        />
      ) : null}
      {revisionOf ? (
        <RevisionPicker
          file={revisionOf}
          onClose={() => setRevisionOf(null)}
          onSaved={async () => {
            await refresh();
            toast("New revision saved — it's now the current version", "success");
          }}
          target={{ jobId, enquiryId }}
        />
      ) : null}
      {viewing ? <FileViewer list={viewing.list} index={viewing.index} onIndex={(i) => setViewing({ ...viewing, index: i })} onClose={() => setViewing(null)} /> : null}
      {editing ? <EditFile file={editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {deleting ? <DeleteFile file={deleting} inHandover={data.handovers.some((h) => h.items.some((i) => i.fileId === deleting.id))} onClose={() => setDeleting(null)} onDone={refresh} /> : null}
    </div>
  );
}

function FileMenu({ items, name }: { items: MenuItem[]; name: string }) {
  return (
    <Menu
      label={`Actions for ${name}`}
      items={items}
      triggerClassName="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-3 hover:text-foreground"
      trigger={<MoreHorizontal className="size-5" aria-hidden />}
    />
  );
}

export function Thumb({ file, className }: { file: JobFile; className?: string }) {
  const [broken, setBroken] = React.useState(false);
  if (file.hasThumb && !broken) return <img src={fileUrl(file.id, { thumb: true })} alt="" loading="lazy" onError={() => setBroken(true)} className={cn("bg-surface-2 object-cover", className)} />;
  if (file.previewable && file.mimeType.startsWith("image/") && !broken) return <img src={fileUrl(file.id)} alt="" loading="lazy" onError={() => setBroken(true)} className={cn("bg-surface-2 object-cover", className)} />;
  return (
    <span className={cn("grid place-items-center bg-surface-2 text-muted-foreground", className)}>
      <span className="flex flex-col items-center gap-1 text-[12px] font-semibold uppercase">
        {file.mimeType.startsWith("image/") ? <ImageOff className="size-6" aria-hidden /> : <FileText className="size-6" aria-hidden />}
        {extOf(file.filename)}
      </span>
    </span>
  );
}

function FileRow({ file: f, current, superseded, revisions = 0, onOpen, menu, children }: { file: JobFile; current?: boolean; superseded?: boolean; revisions?: number; onOpen: () => void; menu: MenuItem[]; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-3 py-3 sm:px-4">
      <button type="button" onClick={onOpen} className="shrink-0 overflow-hidden rounded-lg ring-1 ring-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${f.previewable ? "View" : "Download"} ${f.title ?? f.filename}`}>
        <Thumb file={f} className="size-14" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" onClick={onOpen} className="min-w-0 truncate text-left text-[15px] font-semibold text-heading hover:text-accent-fg hover:underline">
            {f.title ?? f.filename}
          </button>
          {f.revision ? <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[12.5px] font-semibold text-foreground">{f.revision}</span> : null}
          {current ? <span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[12.5px] font-semibold text-good-fg">Current{revisions ? ` · ${revisions + 1} versions` : ""}</span> : null}
          {superseded ? <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[12.5px] font-medium text-muted-foreground">Superseded</span> : null}
          {f.visibility === "office" ? <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[12.5px] font-medium text-muted-foreground">Office only</span> : null}
        </div>
        <div className="mt-0.5 text-[13.5px] text-muted-foreground">
          {f.title ? `${f.filename} · ` : ""}
          {CATEGORY_SINGULAR[f.category]} · {formatBytes(f.bytes)} · {f.uploadedBy}, {timeAgo(f.createdAt)}
        </div>
        {f.description ? <p className="mt-1 text-[14.5px] text-foreground/90">{f.description}</p> : null}
        {!f.previewable ? <p className="mt-0.5 text-[13px] text-subtle">{f.mimeType.startsWith("image/") ? "Preview isn't available for this photo format — download to view the original." : "No preview — download to open."}</p> : null}
        {children}
      </div>
      <a href={fileUrl(f.id, { download: true })} className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-[14px] font-medium text-muted-foreground hover:bg-surface-3 hover:text-foreground sm:inline-flex" aria-label={`Download ${f.title ?? f.filename}`}>
        <Download className="size-4" aria-hidden /> Download
      </a>
      <FileMenu items={menu} name={f.title ?? f.filename} />
    </div>
  );
}

export function FileViewer({ list, index, onIndex, onClose }: { list: JobFile[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const f = list[index];
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && index < list.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, list.length, onIndex]);
  if (!f) return null;
  const pdf = f.mimeType === "application/pdf";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={f.title ?? f.filename}
        description={`${CATEGORY_SINGULAR[f.category]}${f.revision ? ` · ${f.revision}` : ""} · added by ${f.uploadedBy}, ${timeAgo(f.createdAt)}`}
        className="sm:w-[min(1100px,calc(100vw-3rem))]"
      >
        {pdf ? (
          <iframe src={fileUrl(f.id)} title={f.title ?? f.filename} className="h-[70dvh] w-full rounded-xl bg-surface-2 ring-1 ring-line" />
        ) : f.previewable ? (
          <img src={fileUrl(f.id)} alt={f.description ?? f.title ?? f.filename} className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-xl object-contain ring-1 ring-line" />
        ) : (
          <p className="rounded-xl bg-surface-2 p-6 text-center text-[15px] text-muted-foreground">No preview for this file. Download the original to open it.</p>
        )}
        {f.description ? <p className="mt-3 text-[15px]">{f.description}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {list.length > 1 ? (
            <>
              <Button variant="secondary" size="sm" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Previous file">
                <ChevronLeft /> Previous
              </Button>
              <span className="text-[14px] tabular text-muted-foreground">
                {index + 1} of {list.length}
              </span>
              <Button variant="secondary" size="sm" disabled={index === list.length - 1} onClick={() => onIndex(index + 1)} aria-label="Next file">
                Next <ChevronRight />
              </Button>
            </>
          ) : null}
          <Button asChild size="sm" className="ml-auto">
            <a href={fileUrl(f.id, { download: true })}>
              <Download /> Download original
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevisionPicker({ file, target, onClose, onSaved }: { file: JobFile; target: { jobId?: string; enquiryId?: string }; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [picked, setPicked] = React.useState<File[] | null>(null);
  if (picked) return <UploadQueue target={target} files={picked.slice(0, 1)} revisionOf={file} onClose={onClose} onSaved={onSaved} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`New revision of ${file.title ?? file.filename}`} description={`Current: ${file.revision ?? "no revision label"}. The earlier versions stay in the history.`}>
        <UploadButtons onPick={setPicked} allowCamera={false} primaryLabel="Choose the revised file" />
      </DialogContent>
    </Dialog>
  );
}

function EditFile({ file, onClose, onSaved }: { file: JobFile; onClose: () => void; onSaved: () => Promise<void> }) {
  const { actions } = useStore();
  const [v, setV] = React.useState({ title: file.title ?? "", description: file.description ?? "", category: file.category, revision: file.revision ?? "", visibility: file.visibility });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Edit file details" description={file.filename}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await actions.run("updateFile", { id: file.id, patch: v });
            setBusy(false);
            if (!r.ok) return setError(r.errors._ || "Couldn't save");
            toast("File details saved");
            await onSaved();
            onClose();
          }}
        >
          <div>
            <Label htmlFor="ef-title">Title</Label>
            <Input id="ef-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={160} placeholder={file.filename} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ef-cat">Category</Label>
              <NativeSelect id="ef-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as FileCategory })}>
                {ALL_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_SINGULAR[c]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="ef-rev">Revision</Label>
              <Input id="ef-rev" value={v.revision} onChange={(e) => setV({ ...v, revision: e.target.value })} maxLength={30} placeholder="e.g. Rev C" />
            </div>
          </div>
          <div>
            <Label htmlFor="ef-vis">Who can see it</Label>
            <NativeSelect id="ef-vis" value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value as "team" | "office" })}>
              <option value="team">Shared with people booked on the job</option>
              <option value="office">Office only</option>
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="ef-desc">Description</Label>
            <Textarea id="ef-desc" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={500} />
          </div>
          {error ? (
            <p role="alert" className="text-[14px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteFile({ file, inHandover, onClose, onDone }: { file: JobFile; inHandover: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Delete ${file.title ?? file.filename}?`} description={inHandover ? "It's in a saved customer handover, so a copy is kept inside that handover. It disappears from the job straight away." : "It disappears from the job for everyone. This can't be undone."}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await api<{ ok?: boolean; error?: string }>(`/api/files/${file.id}`, { method: "DELETE" });
              setBusy(false);
              if (r.status !== 200) return toast(r.body.error ?? "Couldn't delete", "error");
              toast("File deleted");
              await onDone();
              onClose();
            }}
          >
            <Trash2 /> Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
