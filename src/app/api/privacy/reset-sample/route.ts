import { authed, fromResult } from "@/server/http";
import { resetSampleData } from "@/server/services/privacy";
import { buildSnapshot } from "@/server/services/snapshot";

export const runtime = "nodejs";

export const POST = authed(async (_req, ctx) => {
  const res = fromResult(resetSampleData(ctx));
  if (res instanceof Response) return res;
  return { ...res, snapshot: buildSnapshot(ctx) };
});
