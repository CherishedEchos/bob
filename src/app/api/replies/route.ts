import { authed, fromResult } from "@/server/http";
import { prepareBatch } from "@/server/services/batch-replies";

export const runtime = "nodejs";

/** Draft one reply per enquiry (?ids=a,b,c — or every enquiry still waiting on a reply). */
export const GET = authed(async (req, ctx) => {
  const ids = new URL(req.url).searchParams.get("ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  return fromResult(prepareBatch(ctx, ids));
});
