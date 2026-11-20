import { authed, fromResult, readJson } from "@/server/http";
import { createUpdate } from "@/server/services/updates";

export const runtime = "nodejs";

/** Save a job update (note, stage). Photos follow via /api/files with updateId. Crew may post on jobs they're booked on. */
export const POST = authed(async (req, ctx) => fromResult(createUpdate(ctx, await readJson(req))), { workers: true });
