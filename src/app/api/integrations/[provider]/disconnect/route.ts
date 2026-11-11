import { authed } from "@/server/http";
import { HttpError } from "@/server/context";
import { can } from "@/lib/auth/permissions";
import { disconnect } from "@/server/integrations/oauth";
import { audit } from "@/server/services/records";
import { buildSnapshot } from "@/server/services/snapshot";

export const runtime = "nodejs";

/** Disconnect and DELETE stored tokens. */
export const POST = authed(async (_req, ctx, params) => {
  if (!can(ctx.role, "integrations.manage")) throw new HttpError(403, "Only the account owner can manage integrations.");
  disconnect(ctx, params.provider);
  audit(ctx, "integration.disconnected", `${params.provider} disconnected and its tokens deleted`);
  return { ok: true, snapshot: buildSnapshot(ctx) };
});
