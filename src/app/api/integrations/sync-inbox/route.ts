import { authed, fromResult } from "@/server/http";
import { syncInbox } from "@/server/integrations/inbox";
import { buildSnapshot } from "@/server/services/snapshot";

export const runtime = "nodejs";

export const POST = authed(async (_req, ctx) => {
  const r = await syncInbox(ctx);
  const res = fromResult(r);
  if (res instanceof Response) return res;
  return { ...res, snapshot: buildSnapshot(ctx) };
});
