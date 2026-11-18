import { authed, fromResult, readJson } from "@/server/http";
import { createHandover } from "@/server/services/handover";

export const runtime = "nodejs";

/** Save a handover with exactly the selected files. */
export const POST = authed(async (req, ctx) => fromResult(createHandover(ctx, await readJson(req))));
