import "server-only";
/**
 * Customer handover reports: one working draft per job, owners/admins only.
 *
 *  1. createReport: preselects the job's updates, their photos and any
 *     finished/completion photos; costs off. Customer, title and site come
 *     from the job.
 *  2. generateReport: sends ONLY the selected facts to the AI (no internal
 *     notes, site access, money or unselected files). If AI isn't available,
 *     the selections are kept and an editable draft is built from the job
 *     details and photos instead.
 *  3. saveReport: optimistic concurrency — a save based on an older revision
 *     is refused with the current version, so Luke and Ryan never silently
 *     overwrite each other.
 *  4. exportReport: renders the PDF and saves it as a dated, numbered
 *     version (a JobFile with reportId), so the exact document issued can
 *     always be downloaded again. Report edits never touch invoices,
 *     payments or any bookkeeping record.
 */
import type { ActivityEntry, FileCategory, HandoverReport, Invoice, Job, JobFile, JobUpdate, Payment, ReportContent, ReportPhoto, ReportSection, ReportSelection, ReportVersion, Task, Variation } from "@/lib/types";
import { MANUAL_COST_NOTE, manualCostLines, reportCostSummary } from "@/lib/report-costs";
import { formatDayShort } from "@/lib/dates";
import { uid } from "@/lib/utils";
import { getDb, scoped, tx } from "@/server/db";
import { fail, ok, type Ctx, type Result } from "@/server/context";
import { createHash } from "node:crypto";
import { audit, getCustomer } from "./records";
import { STAGE_LABEL } from "./updates";
import { AiUnavailable, draftReport, rewriteSection, type ReportFacts } from "@/server/report-ai";
import { renderReportPdf, type PdfImage } from "@/server/report-pdf";

const now = () => new Date().toISOString();
const isManager = (ctx: Ctx) => ctx.role === "owner" || ctx.role === "office";
const deny = () => fail("forbidden", "Only an owner or admin can prepare handover reports.");
const PHOTO_CATS: FileCategory[] = ["progress", "completion"];
const embeddable = (f: JobFile) => f.mimeType === "image/jpeg" || f.mimeType === "image/png" || f.hasThumb;

export function listReports(ctx: Ctx): HandoverReport[] {
  if (!isManager(ctx)) return [];
  return scoped(ctx).list<HandoverReport>("handover_reports", { order: "updated_at DESC" });
}

export function listReportVersions(ctx: Ctx): ReportVersion[] {
  if (!isManager(ctx)) return [];
  return scoped(ctx).list<ReportVersion & { content?: unknown; selection?: unknown }>("report_versions", { order: "created_at DESC" }).map(({ content: _c, selection: _s, ...v }) => {
    void _c;
    void _s;
    return v;
  });
}

interface JobData {
  job: Job;
  files: JobFile[];
  updates: JobUpdate[];
}

function jobData(ctx: Ctx, jobId: string): JobData | null {
  const db = scoped(ctx);
  const job = db.get<Job>("jobs", jobId);
  if (!job) return null;
  return {
    job,
    files: db.list<JobFile>("job_files", { where: "job_id = ? AND deleted_at IS NULL AND report_id IS NULL", params: [jobId], order: "created_at" }),
    updates: db.list<JobUpdate & { deletedAt?: string }>("job_updates", { where: "job_id = ? AND deleted_at IS NULL", params: [jobId], order: "created_at" }),
  };
}

/** The completion date only when the records support it: when the job was moved to Completed. */
function recordedCompletion(ctx: Ctx, job: Job): string | undefined {
  if (job.status !== "completed") return undefined;
  const a = scoped(ctx).list<ActivityEntry>("activity", { where: "entity_id = ? AND action = 'job.status_changed' AND summary LIKE '%moved to Completed'", params: [job.id], order: "at DESC", limit: 1 })[0];
  return a?.at.slice(0, 10);
}

const defaultSections = (includeCosts: boolean): ReportSection[] => [
  { id: "overview", kind: "text", heading: "Overview", body: "" },
  { id: "work", kind: "bullets", heading: "Work completed", items: [] },
  { id: "photos", kind: "photos", heading: "Photos" },
  { id: "costs", kind: "costs", heading: "Cost summary", hidden: !includeCosts },
  { id: "aftercare", kind: "bullets", heading: "Aftercare", items: [], hidden: true },
  { id: "outstanding", kind: "bullets", heading: "Still to do", items: [], hidden: true },
];

/** Photos in the report follow the selection: keep existing captions/order, add new ones at the end. */
function syncPhotos(content: ReportContent, sel: ReportSelection, files: JobFile[]): ReportPhoto[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const kept = content.photos.filter((p) => sel.photoIds.includes(p.fileId) && byId.has(p.fileId));
  const have = new Set(kept.map((p) => p.fileId));
  const added = sel.photoIds.filter((id) => !have.has(id) && byId.has(id)).map((id) => ({ fileId: id, caption: byId.get(id)!.description ?? byId.get(id)!.title ?? "", include: true }));
  return [...kept, ...added];
}

function pickCover(photos: ReportPhoto[], files: JobFile[], updates: JobUpdate[]): string | undefined {
  const byId = new Map(files.map((f) => [f.id, f]));
  const finishedUpdates = new Set(updates.filter((u) => u.stage === "finished").map((u) => u.id));
  const scored = photos.filter((p) => p.include).map((p) => {
    const f = byId.get(p.fileId);
    const finished = f?.category === "completion" || (f?.updateId && finishedUpdates.has(f.updateId));
    return { id: p.fileId, score: (finished ? 2 : 0), at: f?.createdAt ?? "" };
  });
  scored.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at));
  return scored[0]?.id;
}

function promptsFor(content: ReportContent, sel: ReportSelection, files: JobFile[]): ReportContent["prompts"] {
  const out: ReportContent["prompts"] = [];
  const byId = new Map(files.map((f) => [f.id, f]));
  if (!content.sections.find((s) => s.id === "overview")?.body?.trim()) out.push({ target: "overview", text: "Add a short overview of the project for the customer." });
  if (!(content.sections.find((s) => s.id === "work")?.items ?? []).some((i) => i.trim())) out.push({ target: "work", text: "List the work that was completed — the selected updates don't say." });
  for (const p of content.photos.filter((x) => x.include)) {
    const f = byId.get(p.fileId);
    if (!p.caption.trim()) out.push({ target: p.fileId, text: `No caption for ${f?.title ?? f?.filename ?? "a photo"} — add one, or it prints without a caption.` });
    if (f && !embeddable(f)) out.push({ target: p.fileId, text: `${f.filename} is a format the PDF can't show (e.g. HEIC). Re-upload it as JPEG, or it will be left out.` });
  }
  if (!content.completionDate) out.push({ target: "completionDate", text: "No completion date is recorded. Add one if the work is finished." });
  if (sel.includeCosts && content.costMode === "manual" && !content.manualFigures.length) out.push({ target: "costs", text: "Enter the figures to show, or turn the cost summary off." });
  return out;
}

/** An editable draft from what Bob already knows (used when AI isn't available, and as the starting point). */
function knownDraft(ctx: Ctx, d: JobData, sel: ReportSelection, base?: ReportContent): ReportContent {
  const c = getCustomer(ctx, d.job.customerId);
  const content: ReportContent = base ?? {
    title: d.job.title,
    customerName: c?.name ?? d.job.customerName ?? "Customer",
    siteAddress: d.job.siteAddress || d.job.location,
    completionDate: recordedCompletion(ctx, d.job),
    sections: defaultSections(sel.includeCosts),
    photos: [],
    costMode: "records",
    manualFigures: [],
    prompts: [],
  };
  const selectedUpdates = d.updates.filter((u) => sel.updateIds.includes(u.id) && u.note?.trim());
  content.sections = content.sections.map((s) => {
    if (s.id === "overview" && !s.body?.trim()) return { ...s, body: d.job.description?.trim() ?? "" };
    if (s.id === "work" && !(s.items ?? []).length) return { ...s, items: selectedUpdates.filter((u) => u.stage !== "before").map((u) => u.note!.trim()) };
    if (s.id === "costs") return { ...s, hidden: !sel.includeCosts };
    return s;
  });
  content.photos = syncPhotos(content, sel, d.files);
  if (!content.coverFileId || !content.photos.some((p) => p.fileId === content.coverFileId && p.include)) content.coverFileId = pickCover(content.photos, d.files, d.updates);
  content.prompts = promptsFor(content, sel, d.files);
  return content;
}

function defaultSelection(d: JobData): ReportSelection {
  const updateIds = d.updates.map((u) => u.id);
  const photoIds = d.files.filter((f) => PHOTO_CATS.includes(f.category) && f.mimeType.startsWith("image/") && ((f.updateId && updateIds.includes(f.updateId)) || f.category === "completion")).map((f) => f.id);
  return { updateIds, photoIds, fileIds: [], includeCosts: false };
}

export function createReport(ctx: Ctx, input: { jobId?: unknown }): Result<HandoverReport> {
  if (!isManager(ctx)) return deny();
  const jobId = typeof input.jobId === "string" ? input.jobId : "";
  const d = jobData(ctx, jobId);
  if (!d) return fail("not_found", "Job not found");
  const existing = scoped(ctx).list<HandoverReport>("handover_reports", { where: "job_id = ?", params: [jobId] })[0];
  if (existing) return ok(existing);
  const selection = defaultSelection(d);
  const r: HandoverReport = {
    id: uid("rep"), jobId, selection, content: knownDraft(ctx, d, selection), revision: 1, aiStatus: "none",
    createdBy: ctx.userName, createdAt: now(), updatedBy: ctx.userName, updatedAt: now(),
  };
  tx(() => {
    scoped(ctx).insert("handover_reports", r);
    audit(ctx, "report.created", `Handover report started for ${d.job.title}`, "job", jobId);
  });
  return ok(r);
}

/* ------------------------------ Save (with conflict protection) ------------------------------ */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").slice(0, max) : "");

function cleanSelection(raw: unknown, d: JobData): ReportSelection {
  const r = (raw ?? {}) as Partial<Record<keyof ReportSelection, unknown>>;
  const ids = (v: unknown, allowed: Set<string>) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.has(x)))] : []);
  const photoFiles = new Set(d.files.filter((f) => f.mimeType.startsWith("image/")).map((f) => f.id));
  const docFiles = new Set(d.files.map((f) => f.id));
  return { updateIds: ids(r.updateIds, new Set(d.updates.map((u) => u.id))), photoIds: ids(r.photoIds, photoFiles), fileIds: ids(r.fileIds, docFiles), includeCosts: r.includeCosts === true };
}

function cleanContent(raw: unknown, prev: ReportContent): ReportContent {
  const r = (raw ?? {}) as Partial<ReportContent>;
  const prevSections = new Map(prev.sections.map((s) => [s.id, s]));
  const sections: ReportSection[] = Array.isArray(r.sections)
    ? r.sections.filter((s) => s && prevSections.has(s.id)).map((s) => {
        const base = prevSections.get(s.id)!;
        return {
          id: base.id,
          kind: base.kind,
          heading: str(s.heading, 80).trim() || base.heading,
          body: base.kind === "text" ? str(s.body, 4000) : undefined,
          items: base.kind === "bullets" ? (Array.isArray(s.items) ? s.items.map((i) => str(i, 400)).slice(0, 25) : []) : undefined,
          hidden: s.hidden === true,
        };
      })
    : prev.sections;
  for (const s of prev.sections) if (!sections.some((x) => x.id === s.id)) sections.push(s);
  const photos: ReportPhoto[] = Array.isArray(r.photos) ? r.photos.filter((p) => p && typeof p.fileId === "string").map((p) => ({ fileId: p.fileId, caption: str(p.caption, 220), include: p.include !== false })) : prev.photos;
  const figures = Array.isArray(r.manualFigures) ? r.manualFigures.slice(0, 12).map((f) => ({ label: str(f?.label, 80), amount: Math.round(Number(f?.amount) * 100) / 100 })).filter((f) => Number.isFinite(f.amount)) : prev.manualFigures;
  const date = typeof r.completionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.completionDate) ? r.completionDate : r.completionDate === "" ? undefined : prev.completionDate;
  return {
    title: str(r.title ?? prev.title, 120).trim() || prev.title,
    customerName: str(r.customerName ?? prev.customerName, 120).trim() || prev.customerName,
    siteAddress: r.siteAddress !== undefined ? str(r.siteAddress, 200).trim() || undefined : prev.siteAddress,
    completionDate: date,
    coverFileId: typeof r.coverFileId === "string" ? r.coverFileId : prev.coverFileId,
    sections,
    photos,
    costMode: r.costMode === "manual" ? "manual" : r.costMode === "records" ? "records" : prev.costMode,
    manualFigures: figures,
    prompts: prev.prompts,
  };
}

export function saveReport(ctx: Ctx, input: { id?: unknown; baseRevision?: unknown; selection?: unknown; content?: unknown; step?: unknown }): Result<HandoverReport> & { current?: HandoverReport } {
  if (!isManager(ctx)) return deny();
  const db = scoped(ctx);
  const r = typeof input.id === "string" ? db.get<HandoverReport>("handover_reports", input.id) : undefined;
  if (!r) return fail("not_found", "Report not found");
  const step = Number.isInteger(input.step) && (input.step as number) >= 1 && (input.step as number) <= 5 ? (input.step as number) : undefined;
  // Moving between steps only remembers the place; it isn't an edit (no new revision, no conflict).
  if (input.selection === undefined && input.content === undefined) {
    if (step === undefined) return ok(r);
    return ok(db.update<HandoverReport>("handover_reports", r.id, { step })!);
  }
  if (Number(input.baseRevision) !== r.revision) {
    return { ...fail("conflict", `${r.updatedBy} saved changes to this report since you opened it. Your edits are still on screen — review their version, then reapply yours.`), current: r };
  }
  const d = jobData(ctx, r.jobId)!;
  const selection = input.selection !== undefined ? cleanSelection(input.selection, d) : r.selection;
  let content = input.content !== undefined ? cleanContent(input.content, r.content) : r.content;
  // The cost section follows "Include cost summary"; it can still be hidden while on.
  content = { ...content, sections: content.sections.map((s) => (s.id === "costs" ? { ...s, hidden: !selection.includeCosts || (input.selection === undefined && !!s.hidden) } : s)) };
  content.photos = syncPhotos(content, selection, d.files);
  if (!content.coverFileId || !content.photos.some((p) => p.fileId === content.coverFileId && p.include)) content.coverFileId = pickCover(content.photos, d.files, d.updates);
  content.prompts = promptsFor(content, selection, d.files);
  const out = db.update<HandoverReport>("handover_reports", r.id, { selection, content, revision: r.revision + 1, updatedBy: ctx.userName, updatedAt: now(), ...(step ? { step } : {}) })!;
  return ok(out);
}

/* ------------------------------ AI ------------------------------ */

/** Exactly what the AI may see: the selected records, nothing private. */
export function reportFacts(ctx: Ctx, r: HandoverReport): ReportFacts {
  const d = jobData(ctx, r.jobId)!;
  const sel = r.selection;
  const byId = new Map(d.files.map((f) => [f.id, f]));
  const photoRefs = new Map<string, string>();
  r.content.photos.filter((p) => p.include).forEach((p, i) => photoRefs.set(p.fileId, `P${i + 1}`));
  const updates = d.updates.filter((u) => sel.updateIds.includes(u.id));
  const tasks = scoped(ctx).list<Task>("tasks", { where: "related_type = 'job' AND related_id = ? AND done = 1", params: [r.jobId] });
  return {
    business: ctx.org.name,
    job: { title: r.content.title, description: d.job.description || undefined, town: d.job.location, status: d.job.status },
    customerName: r.content.customerName,
    completionDate: r.content.completionDate,
    updates: updates.map((u) => ({ date: formatDayShort(u.createdAt.slice(0, 10)), stage: u.stage ? STAGE_LABEL[u.stage] : undefined, note: u.note, author: u.authorName.split(" ")[0], photoRefs: d.files.filter((f) => f.updateId === u.id && photoRefs.has(f.id)).map((f) => photoRefs.get(f.id)!) })),
    photos: r.content.photos.filter((p) => p.include).map((p) => {
      const f = byId.get(p.fileId);
      const u = f?.updateId ? d.updates.find((x) => x.id === f.updateId) : undefined;
      return { ref: photoRefs.get(p.fileId)!, caption: p.caption || f?.description || undefined, category: f?.category === "completion" ? "finished" : "progress", stage: u?.stage ? STAGE_LABEL[u.stage] : undefined, date: formatDayShort((f?.createdAt ?? "").slice(0, 10)) };
    }),
    documents: sel.fileIds.map((id) => byId.get(id)).filter(Boolean).map((f, i) => ({ ref: `D${i + 1}`, title: f!.title ?? f!.filename, kind: f!.category === "drawing" ? ("drawing" as const) : ("document" as const), revision: f!.revision, description: f!.description })),
    completedTasks: tasks.map((t) => t.title),
    // Extra work the customer agreed (descriptions only — the app supplies every figure).
    approvedVariations: scoped(ctx).list<Variation>("variations", { where: "job_id = ? AND status = 'approved'", params: [r.jobId] }).map((v) => v.description),
  };
}

export async function generateReport(ctx: Ctx, input: { id?: unknown; baseRevision?: unknown }): Promise<Result<HandoverReport & { usedAi: boolean; aiError?: string }> & { current?: HandoverReport }> {
  if (!isManager(ctx)) return deny();
  const db = scoped(ctx);
  const r = typeof input.id === "string" ? db.get<HandoverReport>("handover_reports", input.id) : undefined;
  if (!r) return fail("not_found", "Report not found");
  if (Number(input.baseRevision) !== r.revision) return { ...fail("conflict", `${r.updatedBy} changed this report since you opened it. Review their version first.`), current: r };
  const d = jobData(ctx, r.jobId)!;
  const base = knownDraft(ctx, d, r.selection, { ...r.content, sections: r.content.sections.map((s) => (s.kind === "text" ? { ...s, body: "" } : s.kind === "bullets" ? { ...s, items: [] } : s)) });
  let content = base;
  let usedAi = false;
  let aiError: string | undefined;
  try {
    const draft = await draftReport(reportFacts(ctx, { ...r, content: base }), ctx);
    const refs = new Map(base.photos.filter((p) => p.include).map((p, i) => [`P${i + 1}`, p.fileId]));
    const captions = new Map(draft.captions.map((c) => [refs.get(c.ref), c.caption]));
    content = {
      ...base,
      sections: base.sections.map((s) => {
        if (s.id === "overview") return { ...s, body: draft.overview || s.body };
        if (s.id === "work") return { ...s, items: draft.workCompleted.length ? draft.workCompleted : s.items };
        if (s.id === "aftercare") return { ...s, items: draft.aftercare, hidden: !draft.aftercare.length };
        if (s.id === "outstanding") return { ...s, items: draft.outstanding, hidden: !draft.outstanding.length };
        return s;
      }),
      // Captions the team wrote are kept; AI only fills empty ones.
      photos: base.photos.map((p) => (p.caption.trim() ? p : { ...p, caption: captions.get(p.fileId) ?? "" })),
    };
    content.prompts = [...promptsFor(content, r.selection, d.files), ...draft.questions.map((q) => ({ target: "ai", text: q }))];
    usedAi = true;
  } catch (e) {
    aiError = e instanceof AiUnavailable ? e.message : "The AI draft failed.";
    // Keep anything already written; fill gaps from known details.
    content = knownDraft(ctx, d, r.selection, r.content);
  }
  const out = tx(() => {
    const u = db.update<HandoverReport>("handover_reports", r.id, { content, revision: r.revision + 1, aiStatus: usedAi ? "drafted" : "fallback", aiNote: aiError ?? (null as unknown as undefined), updatedBy: ctx.userName, updatedAt: now() })!;
    audit(ctx, "report.drafted", usedAi ? `Handover report drafted with AI for ${d.job.title}` : `Handover report draft prepared without AI for ${d.job.title} (${aiError})`, "job", r.jobId);
    return u;
  });
  return ok({ ...out, usedAi, aiError });
}

/** A proposed replacement for one narrative section. Nothing is saved until the user accepts it. */
export async function proposeRewrite(ctx: Ctx, input: { id?: unknown; sectionId?: unknown; instruction?: unknown; current?: unknown }): Promise<Result<{ sectionId: string; body?: string; items?: string[] }>> {
  if (!isManager(ctx)) return deny();
  const r = typeof input.id === "string" ? scoped(ctx).get<HandoverReport>("handover_reports", input.id) : undefined;
  if (!r) return fail("not_found", "Report not found");
  const sec = r.content.sections.find((s) => s.id === input.sectionId);
  if (!sec || (sec.kind !== "text" && sec.kind !== "bullets")) return fail("invalid", "Only text sections can be rewritten.");
  // Rewrite what's on screen (it may not be saved yet).
  const cur = (input.current ?? {}) as { body?: unknown; items?: unknown; heading?: unknown };
  const onScreen = { heading: str(cur.heading ?? sec.heading, 80), body: sec.kind === "text" ? str(cur.body ?? sec.body, 4000) : undefined, items: sec.kind === "bullets" ? (Array.isArray(cur.items) ? cur.items.map((i) => str(i, 400)) : sec.items ?? []) : undefined };
  try {
    const p = await rewriteSection(reportFacts(ctx, r), onScreen, typeof input.instruction === "string" ? input.instruction : undefined, ctx);
    return ok({ sectionId: sec.id, ...p });
  } catch (e) {
    return fail("unavailable", e instanceof AiUnavailable ? `${e.message} Your text is unchanged.` : "Couldn't rewrite that section. Your text is unchanged.");
  }
}

/* ------------------------------ PDF ------------------------------ */

function costData(ctx: Ctx, jobId: string) {
  const db = scoped(ctx);
  return { variations: db.list<Variation>("variations", { where: "job_id = ?", params: [jobId] }), invoices: db.list<Invoice>("invoices", { where: "job_id = ?", params: [jobId] }), payments: db.list<Payment>("payments", { where: "job_id = ?", params: [jobId] }) };
}

export async function renderReport(ctx: Ctx, r: HandoverReport) {
  const d = jobData(ctx, r.jobId)!;
  const byId = new Map(d.files.map((f) => [f.id, f]));
  const images = new Map<string, PdfImage>();
  const get = getDb().prepare("SELECT data FROM file_blobs WHERE org_id = ? AND file_id = ? AND kind = ?");
  for (const p of r.content.photos.filter((x) => x.include)) {
    const f = byId.get(p.fileId);
    if (!f) continue;
    const kind = f.mimeType === "image/jpeg" || f.mimeType === "image/png" ? "original" : f.hasThumb ? "thumb" : null;
    if (!kind) continue;
    const row = get.get(ctx.orgId, f.id, kind) as { data: Uint8Array } | undefined;
    if (row) images.set(f.id, { data: Buffer.from(row.data) });
  }
  let costLines: ReturnType<typeof manualCostLines> = [];
  let costNote: string | undefined;
  if (r.selection.includeCosts) {
    if (r.content.costMode === "manual") {
      costLines = manualCostLines(r.content.manualFigures);
      costNote = costLines.length ? MANUAL_COST_NOTE : undefined;
    } else {
      const s = reportCostSummary(d.job, costData(ctx, r.jobId));
      costLines = s.lines;
      costNote = s.notes.join(" ") || undefined;
    }
  }
  return renderReportPdf({ org: ctx.org, content: r.content, costLines, costNote, images });
}

export async function previewReport(ctx: Ctx, id: string): Promise<Result<{ data: Buffer; pages: number }>> {
  if (!isManager(ctx)) return deny();
  const r = scoped(ctx).get<HandoverReport>("handover_reports", id);
  if (!r) return fail("not_found", "Report not found");
  return ok(await renderReport(ctx, r));
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

export async function exportReport(ctx: Ctx, input: { id?: unknown; baseRevision?: unknown }): Promise<Result<ReportVersion> & { current?: HandoverReport }> {
  if (!isManager(ctx)) return deny();
  const db = scoped(ctx);
  const r = typeof input.id === "string" ? db.get<HandoverReport>("handover_reports", input.id) : undefined;
  if (!r) return fail("not_found", "Report not found");
  if (input.baseRevision !== undefined && Number(input.baseRevision) !== r.revision) return { ...fail("conflict", `${r.updatedBy} changed this report since you opened it. Review their version before exporting.`), current: r };
  let pdf: { data: Buffer; pages: number };
  try {
    pdf = await renderReport(ctx, r);
  } catch (e) {
    console.error(e);
    return fail("unavailable", "Couldn't build the PDF. Nothing was saved — try again.");
  }
  const prev = getDb().prepare("SELECT MAX(version) AS v FROM report_versions WHERE org_id = ? AND report_id = ?").get(ctx.orgId, r.id) as { v: number | null };
  const version = (prev.v ?? 0) + 1;
  const filename = `${fileSafe(ctx.org.shortName)} - ${fileSafe(titleCase(r.content.title))} - Handover v${version}.pdf`;
  const fileId = uid("fil");
  const at = now();
  const v: ReportVersion = { id: uid("rv"), reportId: r.id, jobId: r.jobId, version, fileId, filename, pages: pdf.pages, createdBy: ctx.userName, createdAt: at, revision: r.revision };
  tx(() => {
    db.insert("job_files", {
      id: fileId, jobId: r.jobId, category: "other", title: `Handover report v${version}`, filename, mimeType: "application/pdf", bytes: pdf.data.length,
      description: `Customer handover report, version ${version} (${pdf.pages} page${pdf.pages === 1 ? "" : "s"})`, groupId: `rep_${r.id}`, visibility: "office", previewable: true, hasThumb: false,
      uploadedBy: ctx.userName, uploadedByUserId: ctx.userId, createdAt: at, checksum: createHash("sha256").update(pdf.data).digest("hex"), reportId: r.id,
    } as JobFile & { id: string });
    getDb().prepare("INSERT INTO file_blobs (file_id, org_id, kind, data, created_at) VALUES (?, ?, 'original', ?, ?)").run(fileId, ctx.orgId, pdf.data, at);
    db.insert("report_versions", { ...v, content: r.content, selection: r.selection } as ReportVersion & { content: ReportContent; selection: ReportSelection });
    audit(ctx, "report.exported", `Handover report v${version} saved for ${r.content.title} (${pdf.pages} page${pdf.pages === 1 ? "" : "s"})`, "job", r.jobId);
  });
  return ok(v);
}

/* ------------------------------ Finish, sent, pack ------------------------------ */

/** The exported PDF that matches the report as it is now, if there is one. */
function versionForRevision(ctx: Ctx, r: HandoverReport): (ReportVersion & { selection?: ReportSelection }) | undefined {
  return scoped(ctx).list<ReportVersion & { selection?: ReportSelection }>("report_versions", { where: "report_id = ? AND revision = ?", params: [r.id, r.revision], order: "version DESC" })[0];
}

/**
 * Finish the handover: make sure there's a PDF of the report exactly as it is
 * now (exporting one if needed), and record it as the published version —
 * when, and by whom. Finishing again after changes publishes a new version;
 * earlier versions are kept.
 */
export async function finishReport(ctx: Ctx, input: { id?: unknown }): Promise<Result<{ report: HandoverReport; version: ReportVersion }>> {
  if (!isManager(ctx)) return deny();
  const db = scoped(ctx);
  const r = typeof input.id === "string" ? db.get<HandoverReport>("handover_reports", input.id) : undefined;
  if (!r) return fail("not_found", "Report not found");
  let version: ReportVersion | undefined = versionForRevision(ctx, r);
  if (!version) {
    const ex = await exportReport(ctx, { id: r.id });
    if (!ex.ok) return ex;
    version = ex.value;
  }
  const at = now();
  const report = tx(() => {
    const u = db.update<HandoverReport>("handover_reports", r.id, { completedAt: at, completedBy: ctx.userName, completedRevision: r.revision, step: 5 })!;
    audit(ctx, "report.completed", `Handover finished for ${r.content.title} (version ${version!.version})`, "job", r.jobId);
    return u;
  });
  const { selection: _s, content: _c, ...clean } = version as ReportVersion & { selection?: unknown; content?: unknown };
  void _s;
  void _c;
  return ok({ report, version: clean });
}

/** Record that the person has sent the finished handover to the customer themselves. Bob doesn't send it. */
export function markReportSent(ctx: Ctx, input: { id?: unknown; sent?: unknown }): Result<HandoverReport> {
  if (!isManager(ctx)) return deny();
  const db = scoped(ctx);
  const r = typeof input.id === "string" ? db.get<HandoverReport>("handover_reports", input.id) : undefined;
  if (!r) return fail("not_found", "Report not found");
  if (input.sent === false) return ok(db.update<HandoverReport>("handover_reports", r.id, { sentAt: null as unknown as undefined, sentBy: null as unknown as undefined, sentVersion: null as unknown as undefined })!);
  if (!r.completedAt) return fail("invalid", "Finish the handover first, then mark it as sent.");
  if (r.completedRevision !== r.revision) return fail("invalid", "You've changed the report since it was finished. Finish it again first, so the customer gets the latest version.");
  const v = versionForRevision(ctx, r);
  const out = tx(() => {
    const u = db.update<HandoverReport>("handover_reports", r.id, { sentAt: now(), sentBy: ctx.userName, sentVersion: v?.version })!;
    audit(ctx, "report.sent", `Handover for ${r.content.title} marked as sent to the customer${v ? ` (version ${v.version})` : ""}`, "job", r.jobId);
    return u;
  });
  return ok(out);
}

/**
 * The handover pack (ZIP) for the published version: its PDF first, then the
 * photos and documents chosen when it was made. Falls back to the latest PDF
 * and the current choices for older versions.
 */
export async function reportPack(ctx: Ctx, input: { id?: unknown }) {
  if (!isManager(ctx)) return deny();
  const db = scoped(ctx);
  const r = typeof input.id === "string" ? db.get<HandoverReport>("handover_reports", input.id) : undefined;
  if (!r) return fail("not_found", "Report not found");
  const all = db.list<ReportVersion & { selection?: ReportSelection }>("report_versions", { where: "report_id = ?", params: [r.id], order: "version DESC" });
  const v = (r.completedRevision !== undefined ? all.find((x) => x.revision === r.completedRevision) : undefined) ?? all[0];
  if (!v) return fail("invalid", "Make the PDF first (Review & finish → Download PDF), then the pack.");
  const sel = v.selection ?? r.selection;
  const { createHandover } = await import("./handover");
  return createHandover(ctx, { jobId: r.jobId, fileIds: [v.fileId, ...sel.photoIds, ...sel.fileIds], completionDate: r.content.completionDate, title: `${r.content.title} — handover` });
}
