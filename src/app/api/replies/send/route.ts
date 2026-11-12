import { authed, fromResult, readJson } from "@/server/http";
import { sendBatchItem } from "@/server/services/batch-replies";

export const runtime = "nodejs";

/** Send ONE approved reply. Called per item so a failure can be retried on its own. */
export const POST = authed(async (req, ctx) => fromResult(await sendBatchItem(ctx, await readJson(req))));
