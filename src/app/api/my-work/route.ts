import { authed, fromResult, readJson } from "@/server/http";
import { completeMyTask, myWork, type MyWork } from "@/server/services/team";
import { listFiles } from "@/server/services/files";
import { myAbsences } from "@/server/services/absences";
import { listUpdates } from "@/server/services/updates";
import type { Ctx } from "@/server/context";

export const runtime = "nodejs";

/** My work plus the files shared on those jobs and the person's own leave. */
function full(ctx: Ctx) {
  const r = myWork(ctx);
  if (!r.ok) return r;
  const jobs = new Set(r.value.bookings.map((b) => b.job.id));
  const value: MyWork = { ...r.value, files: listFiles(ctx).filter((f) => f.jobId && jobs.has(f.jobId)), updates: listUpdates(ctx).filter((u) => jobs.has(u.jobId)), absences: r.value.person ? myAbsences(ctx) : [] };
  return { ok: true as const, value };
}

/** The signed-in person's own booked work only. */
export const GET = authed(async (_req, ctx) => fromResult(full(ctx)), { workers: true });

/** Tick off a task assigned to me. */
export const POST = authed(async (req, ctx) => {
  const body = await readJson(req);
  const r = completeMyTask(ctx, typeof body.taskId === "string" ? body.taskId : "", body.done !== false);
  if (!r.ok) return fromResult(r);
  return fromResult(full(ctx));
}, { workers: true });
