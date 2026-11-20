import { authed, fromResult, readJson } from "@/server/http";
import { deleteUpdate, editUpdate } from "@/server/services/updates";

export const runtime = "nodejs";

export const PATCH = authed(async (req, ctx, params) => fromResult(editUpdate(ctx, params.id, await readJson(req))), { workers: true });
export const DELETE = authed(async (_req, ctx, params) => fromResult(deleteUpdate(ctx, params.id)), { workers: true });
