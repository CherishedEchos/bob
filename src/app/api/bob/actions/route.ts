import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/server/http";
import { listActions, requestAction } from "@/server/bob/actions";

export const runtime = "nodejs";

const schema = z.object({ tool: z.string().min(1).max(60), args: z.unknown() });

/**
 * Propose an action from the dashboard (e.g. "Send invoice"). It comes back
 * pending; the UI shows the same confirmation card as Bob, then approves.
 */
export const POST = authed(async (req, ctx) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const out = await requestAction(ctx, parsed.data.tool, parsed.data.args, { origin: "dashboard" });
  if (out.kind !== "action") return NextResponse.json({ error: out.message, code: out.kind }, { status: out.kind === "forbidden" ? 403 : 422 });
  return { action: out.view, duplicate: !!out.duplicate };
});

/** Action history (audit of Bob actions). */
export const GET = authed(async (_req, ctx) => ({ actions: listActions(ctx) }));
