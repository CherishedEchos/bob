import { authed, fromResult, readJson } from "@/server/http";
import { eraseCustomer } from "@/server/services/privacy";
import { buildSnapshot } from "@/server/services/snapshot";

export const runtime = "nodejs";

export const POST = authed(async (req, ctx) => {
  const { customerId } = await readJson(req);
  const res = fromResult(eraseCustomer(ctx, typeof customerId === "string" ? customerId : ""));
  if (res instanceof Response) return res;
  return { ...res, snapshot: buildSnapshot(ctx) };
});
