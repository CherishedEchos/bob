import { authed, fromResult, readJson } from "@/server/http";
import { completeMyTask, myWork } from "@/server/services/team";

export const runtime = "nodejs";

/** The signed-in person's own booked work only. */
export const GET = authed(async (_req, ctx) => fromResult(myWork(ctx)));

/** Tick off a task assigned to me. */
export const POST = authed(async (req, ctx) => {
  const body = await readJson(req);
  const r = completeMyTask(ctx, typeof body.taskId === "string" ? body.taskId : "", body.done !== false);
  if (!r.ok) return fromResult(r);
  return fromResult(myWork(ctx));
});
