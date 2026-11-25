import { authed } from "@/server/http";
import { buildSnapshot } from "@/server/services/snapshot";
import { processDueReminders } from "@/server/services/followups";

export const runtime = "nodejs";

export const GET = authed(async (_req, ctx) => {
  // Review reminders that have come due (automatic mode only); there's no background worker on the free plan.
  await processDueReminders(ctx).catch((e) => console.error("[bob] follow-up reminders:", e));
  return buildSnapshot(ctx);
});
