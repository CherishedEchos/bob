import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/server/http";
import { approveAction, cancelAction, getActionView, undoAction } from "@/server/bob/actions";

export const runtime = "nodejs";

const schema = z.object({
  decision: z.enum(["approve", "cancel", "undo"]),
  edits: z.record(z.string(), z.string().max(10000)).optional(),
});

/** Approve / cancel / undo an action. Approval is atomic and idempotent. */
export const POST = authed(async (req, ctx, params) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!getActionView(ctx, params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { decision, edits } = parsed.data;
  const action = decision === "approve" ? await approveAction(ctx, params.id, edits) : decision === "cancel" ? cancelAction(ctx, params.id) : undoAction(ctx, params.id);
  return { action, changed: action.status === "executed" || action.status === "undone" };
});

export const GET = authed(async (_req, ctx, params) => {
  const action = getActionView(ctx, params.id);
  if (!action) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return { action };
});
