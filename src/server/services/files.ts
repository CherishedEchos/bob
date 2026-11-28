import "server-only";
/**
 * Job files & photos: drawings, progress photos, completion photos and
 * documents, from desktop or phone.
 *
 * Storage: the bytes go into the `file_blobs` table of the same database as
 * the metadata, written in ONE transaction with the `job_files` row — so a
 * failed upload never leaves an orphaned blob or a file row without bytes.
 * Each upload carries a client reference: retrying the same upload returns the
 * file that was already saved instead of creating a duplicate.
 *
 * Permissions (checked here, on every call):
 *  - owners, admins (office) and the site team: every file in the business;
 *  - invited workers: only files shared with the team ("team" visibility) on
 *    jobs they're currently booked on, and they may add photos/documents there;
 *  - delete: owners/admins, or the uploader (unless it's in a saved handover).
 */
import { createHash } from "node:crypto";
import type { Enquiry, FileCategory, Job, JobFile } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { uid } from "@/lib/utils";
import { getDb, scoped, tx } from "@/server/db";
import { fail, ok, type Ctx, type Result } from "@/server/context";
import { audit } from "./records";
import { workerJobIds } from "./team";
import { getUpdateForUpload } from "./updates";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Short site videos (about a minute on a phone). Larger files strain the server's memory and the database. */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
export const isVideoMime = (m?: string) => !!m && m.startsWith("video/");
const MAX_THUMB_BYTES = 400 * 1024;
export const FILE_CATEGORIES: FileCategory[] = ["drawing", "progress", "completion", "other"];
export const FILE_CATEGORY_LABEL: Record<FileCategory, string> = { drawing: "Drawings", progress: "Progress photos", completion: "Completion", other: "Other" };

type Row = JobFile & { deletedBy?: string; checksum?: string; clientRef?: string };

const now = () => new Date().toISOString();
const isManager = (ctx: Ctx) => ctx.role === "owner" || ctx.role === "office";

/* ------------------------------ File types ------------------------------ */

interface Kind {
  mime: string;
  previewable: boolean;
  label: string;
}

const EXT: Record<string, Kind> = {
  jpg: { mime: "image/jpeg", previewable: true, label: "JPEG photo" },
  jpeg: { mime: "image/jpeg", previewable: true, label: "JPEG photo" },
  png: { mime: "image/png", previewable: true, label: "PNG image" },
  webp: { mime: "image/webp", previewable: true, label: "WebP image" },
  gif: { mime: "image/gif", previewable: true, label: "GIF image" },
  heic: { mime: "image/heic", previewable: false, label: "iPhone HEIC photo" },
  heif: { mime: "image/heif", previewable: false, label: "HEIF photo" },
  pdf: { mime: "application/pdf", previewable: true, label: "PDF" },
  doc: { mime: "application/msword", previewable: false, label: "Word document" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", previewable: false, label: "Word document" },
  xls: { mime: "application/vnd.ms-excel", previewable: false, label: "Excel spreadsheet" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", previewable: false, label: "Excel spreadsheet" },
  dwg: { mime: "image/vnd.dwg", previewable: false, label: "DWG drawing" },
  dxf: { mime: "image/vnd.dxf", previewable: false, label: "DXF drawing" },
  mp4: { mime: "video/mp4", previewable: true, label: "MP4 video" },
  m4v: { mime: "video/mp4", previewable: true, label: "MP4 video" },
  mov: { mime: "video/quicktime", previewable: true, label: "iPhone video (MOV)" },
  webm: { mime: "video/webm", previewable: true, label: "WebM video" },
  txt: { mime: "text/plain", previewable: false, label: "Text file" },
  csv: { mime: "text/csv", previewable: false, label: "CSV file" },
};

export const ACCEPTED_TYPES_TEXT = "photos (JPG, PNG, WebP, HEIC), short videos (MP4, MOV), PDFs, Word or Excel documents and DWG/DXF drawings";

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString("latin1");

/** What the bytes really are. Never trusts the browser's claimed type. */
function sniff(b: Buffer): string | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (ascii(b, 0, 4) === "GIF8") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (ascii(b, 4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(b, 8, 12))) return "heic";
  if (ascii(b, 4, 8) === "ftyp" && ascii(b, 8, 12) === "qt  ") return "mov";
  if (ascii(b, 4, 8) === "ftyp" && /^(isom|iso2|iso4|iso5|iso6|mp41|mp42|avc1|M4V |M4VH|M4VP|MSNV|dash|3gp4|3gp5|3g2a)$/.test(ascii(b, 8, 12))) return "mp4";
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  // Older QuickTime files start with a moov/mdat/wide box rather than ftyp.
  if (/^(moov|mdat|wide|free|skip)$/.test(ascii(b, 4, 8))) return "mov";
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0])) return "ole";
  if (ascii(b, 0, 4) === "AC10") return "dwg";
  return null;
}

export function classify(filename: string, bytes: Buffer): { ok: true; kind: Kind; ext: string } | { ok: false; error: string } {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const kind = EXT[ext];
  if (!kind) return { ok: false, error: `${filename}: this type of file isn't supported. Bob accepts ${ACCEPTED_TYPES_TEXT}.` };
  const found = sniff(bytes);
  const matches =
    ext === "jpg" || ext === "jpeg" ? found === "jpg"
    : ext === "png" || ext === "gif" || ext === "webp" || ext === "pdf" ? found === ext
    : ext === "heic" || ext === "heif" ? found === "heic"
    : ext === "mp4" || ext === "m4v" ? found === "mp4" || found === "mov"
    : ext === "mov" ? found === "mov" || found === "mp4"
    : ext === "webm" ? found === "webm"
    : ext === "docx" || ext === "xlsx" ? found === "zip"
    : ext === "doc" || ext === "xls" ? found === "ole"
    : ext === "dwg" ? found === "dwg"
    : /* dxf, txt, csv: plain text — refuse anything with binary signatures */ found === null && !bytes.subarray(0, 4096).includes(0);
  if (!matches) return { ok: false, error: `${filename} doesn't look like a real ${kind.label}. Check the file and try again.` };
  return { ok: true, kind, ext };
}

/* ------------------------------ Access ------------------------------ */

/** Files this person can see (metadata only, newest first). */
export function listFiles(ctx: Ctx, opts: { includeDeleted?: boolean } = {}): JobFile[] {
  const all = scoped(ctx).list<Row>("job_files", { where: opts.includeDeleted ? undefined : "deleted_at IS NULL", order: "created_at DESC" });
  // Exported handover reports can show money: owners and admins only.
  const rows = isManager(ctx) ? all : all.filter((f) => !f.reportId);
  if (can(ctx.role, "records.read")) return rows.map(meta);
  if (!can(ctx.role, "mywork.read")) return [];
  const jobs = workerJobIds(ctx);
  return rows.filter((f) => f.jobId && jobs.has(f.jobId) && f.visibility === "team").map(meta);
}

const meta = (r: Row): JobFile => {
  const { deletedBy: _d, checksum: _c, clientRef: _r, ...rest } = r;
  void _d; void _c; void _r;
  return rest;
};

function canSee(ctx: Ctx, f: Row): boolean {
  if ((f.deletedAt || f.reportId) && !isManager(ctx)) return false;
  if (can(ctx.role, "records.read")) return true;
  if (!can(ctx.role, "mywork.read")) return false;
  return !!f.jobId && f.visibility === "team" && workerJobIds(ctx).has(f.jobId);
}

/** The bytes, for a preview or download. null if missing or not allowed (indistinguishable on purpose). */
export function readFile(ctx: Ctx, id: string, variant: "original" | "thumb"): { file: JobFile; data: Buffer } | null {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return null;
  const f = scoped(ctx).get<Row>("job_files", id);
  if (!f || !canSee(ctx, f)) return null;
  const blob = getDb().prepare("SELECT data FROM file_blobs WHERE org_id = ? AND file_id = ? AND kind = ?").get(ctx.orgId, id, variant) as { data: Uint8Array } | undefined;
  if (!blob) return null;
  return { file: meta(f), data: Buffer.from(blob.data) };
}

/* ------------------------------ Upload ------------------------------ */

export interface UploadInput {
  jobId?: string;
  enquiryId?: string;
  category?: string;
  title?: string;
  description?: string;
  revision?: string;
  replacesId?: string;
  updateId?: string;
  visibility?: string;
  clientRef?: string;
  width?: number;
  height?: number;
  filename: string;
  data: Buffer;
  thumb?: Buffer;
}

const clean = (v: string | undefined, max: number) => {
  const t = (v ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

/** Looks like a password or entry code: keep those out of file descriptions. */
const SECRETY = /\b(password|passcode|pin|entry code|door code|alarm code)\s*[:=]\s*\S+/i;

export function uploadFile(ctx: Ctx, input: UploadInput): Result<JobFile & { existed: boolean }> {
  const worker = !can(ctx.role, "records.read");
  if (worker ? !can(ctx.role, "mywork.read") : !can(ctx.role, "notes.write")) return fail("forbidden", "Your account can't add files.");
  const db = scoped(ctx);

  const clientRef = clean(input.clientRef, 80);
  if (clientRef) {
    const prior = db.list<Row>("job_files", { where: "client_ref = ?", params: [clientRef] })[0];
    if (prior && canSee(ctx, prior)) return ok({ ...meta(prior), existed: true });
  }

  let job: Job | undefined;
  let enquiry: Enquiry | undefined;
  if (input.jobId) job = db.get<Job>("jobs", input.jobId);
  else if (input.enquiryId && !worker) enquiry = db.get<Enquiry>("enquiries", input.enquiryId);
  if (!job && !enquiry) return fail("not_found", input.enquiryId ? "Enquiry not found" : "Job not found");
  if (worker && (!job || !workerJobIds(ctx).has(job.id))) return fail("not_found", "Job not found");

  let updateId: string | undefined;
  if (input.updateId) {
    const u = getUpdateForUpload(ctx, input.updateId);
    if (!u || !job || u.jobId !== job.id) return fail("not_found", "That job update wasn't found. Save the update again, then retry the photo.");
    updateId = u.id;
  }

  const filename = (clean(input.filename, 160) ?? "file").replace(/[\\/:*?"<>|]+/g, "-");
  if (!input.data.length) return fail("invalid", `${filename} is empty.`);
  const kind = classify(filename, input.data);
  const limit = kind.ok && isVideoMime(kind.kind.mime) ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
  if (input.data.length > limit) return fail("invalid", `${filename} is ${(input.data.length / 1048576).toFixed(1)} MB — the limit is ${limit / 1048576} MB per ${limit === MAX_VIDEO_BYTES ? "video (keep it to about a minute)" : "file"}.`);
  if (!kind.ok) return fail("invalid", kind.error);

  const requested = FILE_CATEGORIES.includes(input.category as FileCategory) ? (input.category as FileCategory) : kind.kind.mime.startsWith("image/") ? "progress" : "other";
  // Workers add site photos and documents; drawings come from the office.
  const category: FileCategory = worker && requested === "drawing" ? "other" : requested;
  // Pricing photos and notes on an enquiry stay with the office by default, so they don't reach
  // subcontractors when the enquiry becomes a job. Job uploads are shared with the crew unless marked office-only.
  const visibility = worker ? "team" : input.visibility === "office" || (!job && input.visibility !== "team") ? "office" : "team";
  const description = clean(input.description, 500);
  const title = clean(input.title, 160);
  if ([description, title].some((t) => t && SECRETY.test(t))) return fail("invalid", "That looks like a password or entry code. Keep codes in your password manager, not in Bob.", { description: "Remove the code" });

  let groupId: string | undefined;
  if (input.replacesId) {
    if (worker) return fail("forbidden", "Only the office can add a new revision.");
    const prev = db.get<Row>("job_files", input.replacesId);
    if (!prev || prev.deletedAt || (job ? prev.jobId !== job.id : prev.enquiryId !== enquiry?.id)) return fail("not_found", "The drawing you're revising wasn't found.");
    groupId = prev.groupId;
  }

  let thumb: Buffer | undefined = input.thumb && input.thumb.length <= MAX_THUMB_BYTES && sniffThumb(input.thumb) ? input.thumb : undefined;
  if (!kind.kind.mime.startsWith("image/")) thumb = undefined;

  const id = uid("fil");
  const row: Row = {
    id,
    jobId: job?.id,
    enquiryId: enquiry?.id ?? (job ? undefined : input.enquiryId),
    category,
    title,
    filename,
    mimeType: kind.kind.mime,
    bytes: input.data.length,
    description,
    revision: clean(input.revision, 30),
    groupId: groupId ?? id,
    updateId,
    visibility,
    previewable: kind.kind.previewable,
    hasThumb: !!thumb,
    width: Number.isFinite(input.width) && input.width! > 0 && input.width! < 20000 ? Math.round(input.width!) : undefined,
    height: Number.isFinite(input.height) && input.height! > 0 && input.height! < 20000 ? Math.round(input.height!) : undefined,
    uploadedBy: ctx.userName,
    uploadedByUserId: ctx.userId,
    createdAt: now(),
    checksum: createHash("sha256").update(input.data).digest("hex"),
    clientRef,
  };
  const where = job ? `${job.title} job` : `${enquiry!.customerName}'s enquiry`;
  try {
    tx(() => {
      db.insert("job_files", row);
      const put = getDb().prepare("INSERT INTO file_blobs (file_id, org_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)");
      put.run(id, ctx.orgId, "original", input.data, row.createdAt);
      if (thumb) put.run(id, ctx.orgId, "thumb", thumb, row.createdAt);
      audit(ctx, groupId ? "files.revised" : "files.added", `${groupId ? "New revision" : FILE_CATEGORY_LABEL[category].replace(/s$/, "")} added to ${where}: ${title ?? filename}${row.revision ? ` (${row.revision})` : ""}`, job ? "job" : "enquiry", job?.id ?? enquiry!.id);
    });
  } catch (e) {
    // Two tabs retrying the same upload at once: the unique client reference wins.
    if (clientRef && e instanceof Error && /UNIQUE/.test(e.message)) {
      const prior = db.list<Row>("job_files", { where: "client_ref = ?", params: [clientRef] })[0];
      if (prior) return ok({ ...meta(prior), existed: true });
    }
    throw e;
  }
  return ok({ ...meta(row), existed: false });
}

const sniffThumb = (b: Buffer) => startsWith(b, [0xff, 0xd8, 0xff]) || startsWith(b, [0x89, 0x50, 0x4e, 0x47]) || (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP");

/* ------------------------------ Edit / delete ------------------------------ */

export function updateFile(ctx: Ctx, id: string, patch: { title?: unknown; description?: unknown; category?: unknown; revision?: unknown; visibility?: unknown }): Result<JobFile> {
  const db = scoped(ctx);
  const f = db.get<Row>("job_files", id);
  if (!f || f.deletedAt || !canSee(ctx, f)) return fail("not_found", "File not found");
  // Crew can caption their own photos on jobs they're booked on.
  if (!can(ctx.role, "notes.write") && !(can(ctx.role, "mywork.read") && f.uploadedByUserId === ctx.userId)) return fail("forbidden", "Your account can't edit files.");
  if (f.reportId) return fail("conflict", "Issued handover reports can't be edited.");
  if (!isManager(ctx) && f.uploadedByUserId !== ctx.userId) return fail("forbidden", "Only the office or the person who added it can edit this file.");
  const s = (v: unknown, max: number) => (typeof v === "string" ? clean(v, max) ?? (null as unknown as undefined) : undefined);
  const next: Partial<Row> = {};
  if (patch.title !== undefined) next.title = s(patch.title, 160);
  if (patch.description !== undefined) next.description = s(patch.description, 500);
  if (patch.revision !== undefined) next.revision = s(patch.revision, 30);
  if (typeof patch.category === "string" && FILE_CATEGORIES.includes(patch.category as FileCategory)) next.category = patch.category as FileCategory;
  if (patch.visibility === "team" || patch.visibility === "office") next.visibility = patch.visibility;
  if ([next.title, next.description].some((t) => typeof t === "string" && SECRETY.test(t))) return fail("invalid", "That looks like a password or entry code. Keep codes in your password manager, not in Bob.");
  const out = tx(() => {
    const u = db.update<Row>("job_files", id, next)!;
    audit(ctx, "files.updated", `File details updated: ${u.title ?? u.filename}`, f.jobId ? "job" : "enquiry", f.jobId ?? f.enquiryId);
    return u;
  });
  return ok(meta(out));
}

/** Is this file part of a saved handover? Then its bytes must be kept. */
function inHandover(ctx: Ctx, fileId: string): boolean {
  return scoped(ctx).list<{ items: { fileId: string }[] }>("handovers").some((h) => h.items.some((i) => i.fileId === fileId));
}

/**
 * Delete: the file leaves every list straight away. Its bytes are erased,
 * unless a saved handover includes it (then they're kept so that handover
 * still downloads exactly as it was).
 */
export function deleteFile(ctx: Ctx, id: string): Result<{ id: string; keptForHandover: boolean }> {
  const db = scoped(ctx);
  const f = db.get<Row>("job_files", id);
  if (!f || f.deletedAt || !canSee(ctx, f)) return fail("not_found", "File not found");
  if (f.reportId) return fail("conflict", "Issued handover reports are kept so you can always retrieve the exact version sent.");
  const mine = f.uploadedByUserId === ctx.userId;
  if (!isManager(ctx) && !mine) return fail("forbidden", "Only an owner or admin, or the person who added it, can delete this file.");
  const kept = inHandover(ctx, id);
  if (kept && !isManager(ctx)) return fail("forbidden", "This file is in a customer handover. Ask an owner or admin to remove it.");
  tx(() => {
    db.update<Row>("job_files", id, { deletedAt: now(), deletedBy: ctx.userName });
    if (!kept) getDb().prepare("DELETE FROM file_blobs WHERE org_id = ? AND file_id = ?").run(ctx.orgId, id);
    audit(ctx, "files.deleted", `File deleted: ${f.title ?? f.filename}${kept ? " (kept inside its saved handover)" : ""}`, f.jobId ? "job" : "enquiry", f.jobId ?? f.enquiryId);
  });
  return ok({ id, keptForHandover: kept });
}

/** When an enquiry becomes a job, its attachments come along (they keep their enquiry link too). */
export function carryEnquiryFiles(ctx: Ctx, enquiryId: string, jobId: string) {
  getDb().prepare("UPDATE job_files SET job_id = ? WHERE org_id = ? AND enquiry_id = ? AND job_id IS NULL").run(jobId, ctx.orgId, enquiryId);
}

/** Privacy: erase files for these records completely (bytes too). */
export function eraseFilesFor(ctx: Ctx, relatedIds: string[]) {
  const db = getDb();
  for (const rid of relatedIds) {
    db.prepare("DELETE FROM handovers WHERE org_id = ? AND job_id = ?").run(ctx.orgId, rid);
    const ids = db.prepare("SELECT id FROM job_files WHERE org_id = ? AND (job_id = ? OR enquiry_id = ?)").all(ctx.orgId, rid, rid) as { id: string }[];
    for (const { id } of ids) {
      db.prepare("DELETE FROM file_blobs WHERE org_id = ? AND file_id = ?").run(ctx.orgId, id);
      db.prepare("DELETE FROM job_files WHERE org_id = ? AND id = ?").run(ctx.orgId, id);
    }
  }
}
