import { authed } from "@/server/http";
import { buildSnapshot } from "@/server/services/snapshot";

export const runtime = "nodejs";

export const GET = authed(async (_req, ctx) => buildSnapshot(ctx));
