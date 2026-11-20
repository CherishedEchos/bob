import "server-only";
/**
 * Job updates: a dated note and/or photos from site ("Fitted the worktops").
 * The photos are ordinary job files carrying the update's id, so originals
 * are kept exactly as uploaded and they appear in Files & photos too.
 *
 * Who: owners, admins and the site team on any job; invited crew on jobs
 * they're booked on. Edit/delete: owners/admins or the author.
 * Retries: an update carries a client reference, so a retried save on a poor
 * connection returns the update already saved instead of creating another.
 */
import type { Job, JobUpdate, UpdateStage } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { uid } from "@/lib/utils";
import { getDb, scoped, tx } from "@/server/db";
import { fail, ok, type Ctx, type Result } from "@/server/context";
import { audit } from "./records";
import { workerJobIds } from "./team";

type Row = JobUpdate & { clientRef?: string; deletedAt?: string };
const STAGES: UpdateStage[] = ["before", "in_progress", "finished"];
export const STAGE_LABEL: Record<UpdateStage, string> = { before: "Before", in_progress: "In progress", finished: "Finished" };
const now = () => new Date().toISOString();
const isManager = (ctx: Ctx) => ctx.role === "owner" || ctx.role === "office";
const SECRETY = /\b(password|passcode|pin|entry code|door code|alarm code|key safe)\s*[:=]?\s*\d{3,}/i;

const meta = (r: Row): JobUpdate => ({ id: r.id, jobId: r.jobId, note: r.note, stage: r.stage, authorName: r.authorName, authorUserId: r.authorUserId, createdAt: r.createdAt, updatedAt: r.updatedAt });

function mayUseJob(ctx: Ctx, jobId: string): boolean {
  if (can(ctx.role, "notes.write")) return !!scoped(ctx).get<Job>("jobs", jobId);
  if (can(ctx.role, "mywork.read")) return workerJobIds(ctx).has(jobId);
  return false;
}

export function listUpdates(ctx: Ctx): JobUpdate[] {
  const rows = scoped(ctx).list<Row>("job_updates", { where: "deleted_at IS NULL", order: "created_at DESC" });
  if (can(ctx.role, "records.read")) return rows.map(meta);
  if (!can(ctx.role, "mywork.read")) return [];
  const jobs = workerJobIds(ctx);
  return rows.filter((u) => jobs.has(u.jobId)).map(meta);
}

const cleanNote = (v: unknown) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, 2000) || undefined : undefined);
const cleanStage = (v: unknown): UpdateStage | undefined => (STAGES.includes(v as UpdateStage) ? (v as UpdateStage) : undefined);

/** Save a new update. A note is optional (photos are added next, each on its own request). */
export function createUpdate(ctx: Ctx, input: { jobId?: unknown; note?: unknown; stage?: unknown; clientRef?: unknown }): Result<JobUpdate & { existed: boolean }> {
  const jobId = typeof input.jobId === "string" ? input.jobId : "";
  if (!mayUseJob(ctx, jobId)) return fail("not_found", "Job not found");
  const clientRef = typeof input.clientRef === "string" && input.clientRef.length <= 80 ? input.clientRef : undefined;
  const db = scoped(ctx);
  if (clientRef) {
    const prior = db.list<Row>("job_updates", { where: "client_ref = ?", params: [clientRef] })[0];
    if (prior && prior.jobId === jobId) return ok({ ...meta(prior), existed: true });
  }
  const note = cleanNote(input.note);
  if (note && SECRETY.test(note)) return fail("invalid", "That looks like an entry code or password. Keep codes out of job updates — customers may see them.", { note: "Remove the code" });
  const job = db.get<Job>("jobs", jobId)!;
  const row: Row = { id: uid("upd"), jobId, note, stage: cleanStage(input.stage), authorName: ctx.userName, authorUserId: ctx.userId, createdAt: now(), updatedAt: now(), clientRef };
  try {
    tx(() => {
      db.insert("job_updates", row);
      audit(ctx, "job.update_added", `Update on ${job.title}${note ? `: ${note.slice(0, 80)}` : ""}`, "job", jobId);
    });
  } catch (e) {
    if (clientRef && e instanceof Error && /UNIQUE/.test(e.message)) {
      const prior = db.list<Row>("job_updates", { where: "client_ref = ?", params: [clientRef] })[0];
      if (prior) return ok({ ...meta(prior), existed: true });
    }
    throw e;
  }
  return ok({ ...meta(row), existed: false });
}

export function getUpdateForUpload(ctx: Ctx, updateId: string): JobUpdate | undefined {
  const u = scoped(ctx).get<Row>("job_updates", updateId);
  if (!u || u.deletedAt || !mayUseJob(ctx, u.jobId)) return undefined;
  return meta(u);
}

function mayEdit(ctx: Ctx, u: Row) {
  return isManager(ctx) || (u.authorUserId === ctx.userId && mayUseJob(ctx, u.jobId));
}

export function editUpdate(ctx: Ctx, id: string, patch: { note?: unknown; stage?: unknown }): Result<JobUpdate> {
  const db = scoped(ctx);
  const u = db.get<Row>("job_updates", id);
  if (!u || u.deletedAt || !mayUseJob(ctx, u.jobId) && !isManager(ctx)) return fail("not_found", "Update not found");
  if (!mayEdit(ctx, u)) return fail("forbidden", "Only Luke, Ryan or the person who added it can change this update.");
  const next: Partial<Row> = { updatedAt: now() };
  if (patch.note !== undefined) {
    const note = cleanNote(patch.note);
    if (note && SECRETY.test(note)) return fail("invalid", "That looks like an entry code or password. Keep codes out of job updates.", { note: "Remove the code" });
    next.note = note ?? (null as unknown as undefined);
  }
  if (patch.stage !== undefined) next.stage = cleanStage(patch.stage) ?? (null as unknown as undefined);
  const out = tx(() => {
    const r = db.update<Row>("job_updates", id, next)!;
    audit(ctx, "job.update_edited", "Job update edited", "job", u.jobId);
    return r;
  });
  return ok(meta(out));
}

/** Remove an update. Its photos stay on the job (in Files & photos) — nothing is lost. */
export function deleteUpdate(ctx: Ctx, id: string): Result<{ id: string }> {
  const db = scoped(ctx);
  const u = db.get<Row>("job_updates", id);
  if (!u || u.deletedAt) return fail("not_found", "Update not found");
  if (!mayEdit(ctx, u)) return fail("forbidden", "Only Luke, Ryan or the person who added it can remove this update.");
  tx(() => {
    db.update<Row>("job_updates", id, { deletedAt: now() });
    getDb().prepare("UPDATE job_files SET update_id = NULL WHERE org_id = ? AND update_id = ?").run(ctx.orgId, id);
    audit(ctx, "job.update_removed", "Job update removed (its photos stay in Files & photos)", "job", u.jobId);
  });
  return ok({ id });
}
