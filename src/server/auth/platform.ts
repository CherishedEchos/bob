import "server-only";
import { getDb } from "@/server/db";
import type { Ctx } from "@/server/context";

/**
 * Cresaro platform administrators (the people who run Bob, not a customer's
 * owner): emails listed in BOB_PLATFORM_ADMINS, comma-separated. Only they see
 * AI usage, spending limits, model settings and API diagnostics.
 */
export function isPlatformAdmin(ctx: Pick<Ctx, "userId">): boolean {
  const list = (process.env.BOB_PLATFORM_ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  const row = getDb().prepare("SELECT email FROM users WHERE id = ?").get(ctx.userId) as { email?: string } | undefined;
  return !!row?.email && list.includes(row.email.toLowerCase());
}
