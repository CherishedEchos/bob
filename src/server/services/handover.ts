import "server-only";
/**
 * Customer handover: an owner/admin picks specific files from a job and Bob
 * builds a ZIP of those ORIGINAL files plus a readable, branded index.
 *
 *  - Nothing is included unless it was explicitly selected. Internal notes,
 *    money records and unselected files never go in.
 *  - The selection is saved as a handover record with its exact contents.
 *    Later uploads don't change it; files in it keep their bytes even if
 *    they're later deleted from the job, so it always downloads the same.
 *  - The ZIP is built on request from that record; if building fails, the job
 *    and its files are untouched and the download can simply be retried.
 *  - Download only. Bob doesn't email or share the handover anywhere.
 */
import fs from "node:fs";
import path from "node:path";
import type { FileCategory, Handover, HandoverItem, Job, JobFile } from "@/lib/types";
import { uid } from "@/lib/utils";
import { getDb, scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { audit } from "./records";
import { FILE_CATEGORY_LABEL } from "./files";
import { buildZip, type ZipEntry } from "@/server/zip";

const MAX_HANDOVER_BYTES = 1024 * 1024 * 1024;
const FOLDER: Record<FileCategory, string> = { drawing: "Drawings", progress: "Progress photos", completion: "Completion photos", other: "Documents" };

export function listHandovers(ctx: Ctx): Handover[] {
  if (!(ctx.role === "owner" || ctx.role === "office")) return [];
  return scoped(ctx).list<Handover>("handovers", { order: "created_at DESC" });
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

/** Give every file a unique path inside the ZIP: "Drawings/plan.pdf", then "Drawings/plan (2).pdf". */
export function zipPaths(files: Pick<JobFile, "category" | "filename">[]): string[] {
  const used = new Set<string>();
  return files.map((f) => {
    const base = safeName(f.filename);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let p = `${FOLDER[f.category]}/${base}`;
    for (let n = 2; used.has(p.toLowerCase()); n++) p = `${FOLDER[f.category]}/${stem} (${n})${ext}`;
    used.add(p.toLowerCase());
    return p;
  });
}

export function createHandover(ctx: Ctx, input: { jobId?: unknown; fileIds?: unknown; title?: unknown; message?: unknown; completionDate?: unknown }): Result<Handover> {
  const no = denied(ctx, "jobs.write");
  if (no) return no;
  if (!(ctx.role === "owner" || ctx.role === "office")) return fail("forbidden", "Only an owner or admin can create a customer handover.");
  const db = scoped(ctx);
  const job = typeof input.jobId === "string" ? db.get<Job>("jobs", input.jobId) : undefined;
  if (!job) return fail("not_found", "Job not found");
  const ids = Array.isArray(input.fileIds) ? [...new Set(input.fileIds.filter((x): x is string => typeof x === "string"))] : [];
  if (!ids.length) return fail("invalid", "Choose at least one file or photo to include.", { fileIds: "Choose at least one file" });
  if (ids.length > 500) return fail("invalid", "That's too many files for one handover (500 max).");
  const files: JobFile[] = [];
  for (const id of ids) {
    const f = db.get<JobFile>("job_files", id);
    if (!f || f.deletedAt || f.jobId !== job.id) return fail("not_found", "One of the selected files is no longer on this job. Refresh and choose again.");
    files.push(f);
  }
  const total = files.reduce((s, f) => s + f.bytes, 0);
  if (total > MAX_HANDOVER_BYTES) return fail("invalid", "Those files add up to more than 1 GB. Split them into two handovers.");
  const order: FileCategory[] = ["drawing", "completion", "progress", "other"];
  files.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.createdAt.localeCompare(b.createdAt));
  const paths = zipPaths(files);
  const items: HandoverItem[] = files.map((f, i) => ({
    fileId: f.id, zipPath: paths[i], title: f.title ?? f.filename, filename: f.filename, category: f.category,
    description: f.description, revision: f.revision, bytes: f.bytes, mimeType: f.mimeType,
  }));
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const completion = typeof input.completionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.completionDate) ? input.completionDate : undefined;
  const h: Handover = {
    id: uid("ho"),
    jobId: job.id,
    title: str(input.title, 120) ?? `${job.title} — handover`,
    jobTitle: job.title,
    siteAddress: job.siteAddress || job.location,
    completionDate: completion,
    message: str(input.message, 2000),
    items,
    createdAt: new Date().toISOString(),
    createdBy: ctx.userName,
    downloads: 0,
  };
  tx(() => {
    db.insert("handovers", h);
    audit(ctx, "handover.created", `Customer handover saved for ${job.title}: ${items.length} file${items.length === 1 ? "" : "s"}`, "job", job.id);
  });
  return ok(h);
}

/** Absolute UK date for a document the customer keeps ("18 November 2026"), never "today". */
const longDate = (key: string) => new Date(`${key.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** The readable index inside the ZIP. Only the job title, site, dates and the selected files' own details. */
export function handoverIndexHtml(ctx: Pick<Ctx, "org">, h: Handover, logoFile?: string): string {
  const accent = /^#[0-9a-f]{6}$/i.test(ctx.org.accent) ? ctx.org.accent : "#b5532a";
  const groups = (["drawing", "completion", "progress", "other"] as FileCategory[])
    .map((c) => ({ c, items: h.items.filter((i) => i.category === c) }))
    .filter((g) => g.items.length);
  const contact = [ctx.org.contact.phone, ctx.org.contact.email, ctx.org.contact.website].filter(Boolean).map((x) => esc(x!)).join(" · ");
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(h.title)}</title>
<style>
body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d1d1f;background:#f6f5f3;margin:0}
main{max-width:820px;margin:0 auto;padding:32px 20px 48px}
header{display:flex;align-items:center;gap:16px;border-bottom:3px solid ${accent};padding-bottom:16px}
header img{height:56px;width:auto;max-width:220px;object-fit:contain}
h1{font-size:26px;margin:0}
.sub{color:#5c5c62;margin:2px 0 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:20px 0}
dt{color:#5c5c62}
dd{margin:0;font-weight:600}
h2{font-size:18px;margin:28px 0 8px;color:${accent}}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e1dc;border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #eeece8;vertical-align:top}
th{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#5c5c62;background:#faf9f7}
td a{color:${accent};font-weight:600;word-break:break-word}
.msg{background:#fff;border-left:4px solid ${accent};padding:12px 16px;white-space:pre-wrap;margin-top:20px}
footer{margin-top:32px;color:#5c5c62;font-size:14px}
</style></head><body><main>
<header>${logoFile ? `<img src="${esc(logoFile)}" alt="${esc(ctx.org.name)}">` : ""}<div><h1>${esc(h.jobTitle)}</h1><p class="sub">${esc(ctx.org.name)} · Customer handover</p></div></header>
<dl>
${h.siteAddress ? `<dt>Site</dt><dd>${esc(h.siteAddress)}</dd>` : ""}
${h.completionDate ? `<dt>Completed</dt><dd>${esc(longDate(h.completionDate))}</dd>` : ""}
<dt>Prepared</dt><dd>${esc(longDate(h.createdAt))}</dd>
<dt>Files</dt><dd>${h.items.length}</dd>
</dl>
${h.message ? `<div class="msg">${esc(h.message)}</div>` : ""}
${groups
  .map(
    (g) => `<h2>${esc(FILE_CATEGORY_LABEL[g.c])}</h2>
<table><thead><tr><th>File</th><th>Description</th>${g.c === "drawing" ? "<th>Revision</th>" : ""}<th>Size</th></tr></thead><tbody>
${g.items
  .map(
    (i) => `<tr><td><a href="${esc(encodeURI(i.zipPath))}">${esc(i.title)}</a>${i.title !== i.filename ? `<br><small>${esc(i.filename)}</small>` : ""}</td><td>${i.description ? esc(i.description) : "—"}</td>${g.c === "drawing" ? `<td>${i.revision ? esc(i.revision) : "—"}</td>` : ""}<td>${size(i.bytes)}</td></tr>`,
  )
  .join("\n")}
</tbody></table>`,
  )
  .join("\n")}
<footer>${esc(ctx.org.name)}${contact ? ` · ${contact}` : ""}</footer>
</main></body></html>
`;
}

function logoBytes(logoUrl?: string): { name: string; data: Buffer } | undefined {
  if (!logoUrl || !/^\/brand\/[\w.-]+\.(png|jpe?g|webp)$/i.test(logoUrl)) return undefined;
  const file = path.join(process.cwd(), "public", logoUrl);
  try {
    return { name: `logo${path.extname(file).toLowerCase()}`, data: fs.readFileSync(file) };
  } catch {
    return undefined;
  }
}

/** Build the ZIP for a saved handover. Read-only: a failure here changes nothing. */
export function buildHandoverZip(ctx: Ctx, id: string): Result<{ filename: string; data: Buffer }> {
  if (!(ctx.role === "owner" || ctx.role === "office")) return fail("forbidden", "Only an owner or admin can download a customer handover.");
  const h = scoped(ctx).get<Handover>("handovers", id);
  if (!h) return fail("not_found", "Handover not found");
  const stmt = getDb().prepare("SELECT data FROM file_blobs WHERE org_id = ? AND file_id = ? AND kind = 'original'");
  const entries: ZipEntry[] = [];
  const missing: string[] = [];
  for (const i of h.items) {
    const row = stmt.get(ctx.orgId, i.fileId) as { data: Uint8Array } | undefined;
    if (!row) missing.push(i.title);
    else entries.push({ name: i.zipPath, data: row.data });
  }
  if (missing.length) return fail("unavailable", `Couldn't find ${missing.length === 1 ? `"${missing[0]}"` : `${missing.length} files`} in storage. Nothing was downloaded — contact support.`);
  const logo = logoBytes(ctx.org.wordmark?.onLight ?? ctx.org.logoUrl);
  if (logo) entries.unshift({ name: logo.name, data: logo.data });
  entries.unshift({ name: "Start here - index.html", data: Buffer.from(handoverIndexHtml(ctx, h, logo?.name), "utf8") });
  const data = buildZip(entries);
  getDb().prepare("UPDATE handovers SET downloads = COALESCE(downloads, 0) + 1 WHERE org_id = ? AND id = ?").run(ctx.orgId, id);
  const filename = `${safeName(h.jobTitle)} - handover ${h.createdAt.slice(0, 10)}.zip`;
  return ok({ filename, data });
}
