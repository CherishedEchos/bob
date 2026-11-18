import { authed, fromResult, readJson } from "@/server/http";
import { addAbsence, cancelAbsence } from "@/server/services/absences";

export const runtime = "nodejs";

/**
 * Leave from My work: request holiday (employees) or record unavailable dates
 * (subcontractors), or cancel your own. Only ever for the signed-in person —
 * the service ignores any other person id from a worker.
 */
export const POST = authed(async (req, ctx) => {
  const body = await readJson(req);
  if (body.action === "cancel") return fromResult(cancelAbsence(ctx, typeof body.id === "string" ? body.id : ""));
  return fromResult(addAbsence(ctx, body.input));
}, { workers: true });
