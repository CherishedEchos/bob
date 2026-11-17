import { authed, fromResult, readJson } from "@/server/http";
import { createFeed, listMyFeeds, revokeFeed } from "@/server/services/calendar";

export const runtime = "nodejs";

/** A worker's own calendar link (My work). Office roles use /api/ops createFeed. */
export const GET = authed(async (_req, ctx) => ({ feeds: listMyFeeds(ctx) }), { workers: true });
export const POST = authed(async (req, ctx) => {
  const body = await readJson(req);
  if (body.action === "revoke") return fromResult(revokeFeed(ctx, typeof body.id === "string" ? body.id : ""));
  return fromResult(createFeed(ctx, "person"));
}, { workers: true });
