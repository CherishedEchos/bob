import { authed } from "@/server/http";
import { morningBriefing } from "@/server/bob/briefing";

export const runtime = "nodejs";

/** The spoken morning briefing, from Bob's records. */
export const GET = authed(async (_req, ctx) => morningBriefing(ctx));
