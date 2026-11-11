import "server-only";
/**
 * The action engine: the ONLY path by which Bob (or the dashboard's approval
 * dialogs) can execute an action tool.
 *
 * Guarantees:
 *  - Permissions are checked when the action is proposed AND when approved.
 *  - Arguments are validated, and eligibility re-checked at approval time
 *    (records may have changed since the proposal).
 *  - External / financial actions never run without an explicit approve call.
 *  - Approval is atomic (pending → executing), so double taps and network
 *    retries cannot execute an action twice. Each action carries a unique
 *    idempotency key that is passed to external providers.
 *  - Identical requests within 15 minutes return the existing action rather
 *    than creating a duplicate.
 *  - Every execution, failure, cancellation and undo is recorded.
 */
import type { ActionView } from "@/lib/bob/types";
import { can } from "@/lib/auth/permissions";
import { uid } from "@/lib/utils";
import { getDb } from "@/server/db";
import type { Ctx } from "@/server/context";
import { sha256 } from "@/server/auth/password";
import { audit } from "@/server/services/records";
import { getTool, type ActionTool, type Prepared } from "./tools";

const PENDING_TTL_MS = 30 * 60_000;
const UNDO_WINDOW_MS = 30 * 60_000;
const DEDUPE_WINDOW_MS = 15 * 60_000;

interface ActionRow {
  id: string;
  org_id: string;
  user_id: string;
  conversation_id: string | null;
  origin: string;
  tool: string;
  category: string;
  args: string;
  view: string;
  status: ActionView["status"];
  idempotency_key: string;
  payload_hash: string;
  result: string | null;
  error: string | null;
  undo: string | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
  expires_at: string;
}

type StoredView = Pick<ActionView, "title" | "lines" | "preview" | "notices" | "approveLabel" | "simulated" | "category">;

export type RequestOutcome =
  | { kind: "action"; view: ActionView; ranImmediately: boolean; duplicate?: boolean }
  | { kind: "clarify" | "blocked" | "forbidden" | "not_found" | "invalid"; message: string };

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

function getRow(ctx: Ctx, id: string): ActionRow | undefined {
  return getDb().prepare("SELECT * FROM bob_actions WHERE id = ? AND org_id = ?").get(id, ctx.orgId) as unknown as ActionRow | undefined;
}

export function viewFromRow(row: ActionRow): ActionView {
  const stored = JSON.parse(row.view) as StoredView;
  const result = row.result ? (JSON.parse(row.result) as { message?: string; links?: ActionView["links"] }) : undefined;
  let status = row.status;
  if (status === "pending" && new Date(row.expires_at).getTime() < Date.now()) status = "expired";
  const tool = getTool(row.tool);
  const canUndo =
    status === "executed" &&
    !!row.undo &&
    tool?.kind === "action" &&
    !!tool.undo &&
    !!row.executed_at &&
    Date.now() - new Date(row.executed_at).getTime() < UNDO_WINDOW_MS;
  return {
    id: row.id,
    tool: row.tool,
    category: (stored.category ?? row.category) as ActionView["category"],
    title: stored.title,
    lines: stored.lines,
    preview: stored.preview,
    notices: stored.notices ?? [],
    status,
    approveLabel: stored.approveLabel,
    simulated: !!stored.simulated,
    canUndo,
    resultMessage: result?.message,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    links: result?.links,
  };
}

export function getActionView(ctx: Ctx, id: string): ActionView | undefined {
  const row = getRow(ctx, id);
  return row ? viewFromRow(row) : undefined;
}

function toStoredView(p: Prepared<unknown>, tool: ActionTool<unknown>): StoredView {
  return {
    title: p.title,
    lines: p.lines,
    preview: p.preview,
    notices: p.notices ?? [],
    approveLabel: p.approveLabel,
    simulated: !!p.simulated,
    category: p.category ?? tool.category,
  };
}

/** Propose (and, for low-risk undoable tools invoked by Bob, run) an action. */
export async function requestAction(
  ctx: Ctx,
  toolName: string,
  rawArgs: unknown,
  opts: { conversationId?: string; origin: "bob" | "dashboard" },
): Promise<RequestOutcome> {
  const tool = getTool(toolName);
  if (!tool || tool.kind !== "action") return { kind: "invalid", message: `Unknown action ${toolName}` };
  if (!can(ctx.role, tool.permission)) {
    audit(ctx, "bob.action_denied", `Blocked: ${ctx.userName} doesn't have permission for ${toolName.replace(/_/g, " ")}`);
    return { kind: "forbidden", message: "Your account doesn't have permission to do that. Ask the account owner if you need it." };
  }
  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) return { kind: "invalid", message: parsed.error.issues[0]?.message ?? "Some details are missing." };
  const prepared = await tool.prepare(ctx, parsed.data);
  if (!prepared.ok) return { kind: prepared.code, message: prepared.message };

  const payloadHash = sha256(`${ctx.userId}|${toolName}|${stable(prepared.value.payload)}`);
  const db = getDb();
  const recent = db
    .prepare(
      "SELECT * FROM bob_actions WHERE org_id = ? AND payload_hash = ? AND created_at > ? AND status IN ('pending','executing','executed') ORDER BY created_at DESC LIMIT 1",
    )
    .get(ctx.orgId, payloadHash, new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()) as unknown as ActionRow | undefined;
  if (recent) {
    const view = viewFromRow(recent);
    if (view.status === "pending") return { kind: "action", view, ranImmediately: false, duplicate: true };
    if (view.status === "executed" || view.status === "executing") return { kind: "action", view, ranImmediately: false, duplicate: true };
  }

  const now = new Date();
  const id = uid("act");
  db.prepare(
    `INSERT INTO bob_actions (id, org_id, user_id, conversation_id, origin, tool, category, args, view, status, idempotency_key, payload_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  ).run(
    id,
    ctx.orgId,
    ctx.userId,
    opts.conversationId ?? null,
    opts.origin,
    toolName,
    prepared.value.category ?? tool.category,
    JSON.stringify(prepared.value.payload),
    JSON.stringify(toStoredView(prepared.value, tool)),
    `${id}-${uid("k")}`,
    payloadHash,
    now.toISOString(),
    new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
  );

  if (tool.confirmation === "undoable" && opts.origin === "bob") {
    const view = await approveAction(ctx, id);
    return { kind: "action", view, ranImmediately: true };
  }
  return { kind: "action", view: getActionView(ctx, id)!, ranImmediately: false };
}

/** Approve a pending action. Safe to call more than once. */
export async function approveAction(ctx: Ctx, id: string, edits?: Record<string, unknown>): Promise<ActionView> {
  const db = getDb();
  let row = getRow(ctx, id);
  if (!row) throw new Error("not_found");
  const tool = getTool(row.tool) as ActionTool<unknown, unknown> | undefined;
  if (!tool || tool.kind !== "action") throw new Error("not_found");

  // Optional edits (e.g. the user tweaked the email text) — only allowed fields, re-validated.
  if (edits && row.status === "pending" && tool.editable?.length) {
    const args = JSON.parse(row.args) as Record<string, unknown>;
    let changed = false;
    for (const k of tool.editable as string[]) {
      if (typeof edits[k] === "string" && edits[k] !== args[k]) {
        args[k] = edits[k];
        changed = true;
      }
    }
    if (changed) {
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) {
        db.prepare("UPDATE bob_actions SET status = 'failed', error = ? WHERE id = ? AND org_id = ? AND status = 'pending'").run(
          parsed.error.issues[0]?.message ?? "Invalid edit",
          id,
          ctx.orgId,
        );
        return getActionView(ctx, id)!;
      }
      const prep = await tool.prepare(ctx, parsed.data);
      if (prep.ok)
        db.prepare("UPDATE bob_actions SET args = ?, view = ? WHERE id = ? AND org_id = ? AND status = 'pending'").run(
          JSON.stringify(prep.value.payload),
          JSON.stringify(toStoredView(prep.value, tool)),
          id,
          ctx.orgId,
        );
      row = getRow(ctx, id)!;
    }
  }

  // Atomic claim: only one caller can move pending → executing.
  const nowIso = new Date().toISOString();
  const claim = db
    .prepare("UPDATE bob_actions SET status = 'executing', decided_at = ? WHERE id = ? AND org_id = ? AND status = 'pending' AND expires_at > ?")
    .run(nowIso, id, ctx.orgId, nowIso);
  if (Number(claim.changes) === 0) {
    const current = getRow(ctx, id)!;
    if (current.status === "pending") db.prepare("UPDATE bob_actions SET status = 'expired' WHERE id = ? AND org_id = ?").run(id, ctx.orgId);
    return getActionView(ctx, id)!; // already executed / cancelled / expired — idempotent
  }

  const finish = (status: "executed" | "failed", fields: { result?: unknown; error?: string; undo?: unknown }) => {
    db.prepare("UPDATE bob_actions SET status = ?, result = ?, error = ?, undo = ?, executed_at = ? WHERE id = ? AND org_id = ?").run(
      status,
      fields.result !== undefined ? JSON.stringify(fields.result) : null,
      fields.error ?? null,
      fields.undo !== undefined ? JSON.stringify(fields.undo) : null,
      new Date().toISOString(),
      id,
      ctx.orgId,
    );
  };

  if (!can(ctx.role, tool.permission)) {
    finish("failed", { error: "Your account doesn't have permission to approve this." });
    audit(ctx, "bob.action_denied", `Approval blocked: no permission for ${row.tool.replace(/_/g, " ")}`);
    return getActionView(ctx, id)!;
  }

  const recheck = await tool.prepare(ctx, JSON.parse(row.args));
  if (!recheck.ok) {
    finish("failed", { error: recheck.message });
    return getActionView(ctx, id)!;
  }

  const actx: Ctx = { ...ctx, via: row.origin === "bob" ? "bob" : ctx.via };
  try {
    const out = await tool.execute(actx, recheck.value.payload, { idempotencyKey: row.idempotency_key, actionId: id });
    if (out.ok) finish("executed", { result: { message: out.message, links: out.links, data: out.result }, undo: out.undo });
    else {
      finish("failed", { error: out.error });
      audit(actx, "bob.action_failed", `${recheck.value.title} failed: ${out.error}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    finish("failed", { error: `Something went wrong: ${msg}. Nothing further was changed.` });
    audit(actx, "bob.action_failed", `${recheck.value.title} failed: ${msg}`);
  }
  return getActionView(ctx, id)!;
}

export function cancelAction(ctx: Ctx, id: string): ActionView {
  const row = getRow(ctx, id);
  if (!row) throw new Error("not_found");
  getDb()
    .prepare("UPDATE bob_actions SET status = 'cancelled', decided_at = ? WHERE id = ? AND org_id = ? AND status = 'pending'")
    .run(new Date().toISOString(), id, ctx.orgId);
  return getActionView(ctx, id)!;
}

export function undoAction(ctx: Ctx, id: string): ActionView {
  const row = getRow(ctx, id);
  if (!row) throw new Error("not_found");
  const view = viewFromRow(row);
  const tool = getTool(row.tool);
  if (!view.canUndo || !tool || tool.kind !== "action" || !tool.undo) return view;
  if (!can(ctx.role, tool.permission)) return { ...view, error: "Your account can't undo this." };
  const claim = getDb()
    .prepare("UPDATE bob_actions SET status = 'undone' WHERE id = ? AND org_id = ? AND status = 'executed'")
    .run(id, ctx.orgId);
  if (Number(claim.changes) === 0) return getActionView(ctx, id)!;
  const res = tool.undo(ctx, JSON.parse(row.undo!));
  if (!res.ok) {
    getDb().prepare("UPDATE bob_actions SET status = 'executed', error = ? WHERE id = ? AND org_id = ?").run(res.error, id, ctx.orgId);
  } else {
    const result = row.result ? JSON.parse(row.result) : {};
    getDb()
      .prepare("UPDATE bob_actions SET result = ? WHERE id = ? AND org_id = ?")
      .run(JSON.stringify({ ...result, message: res.message, links: undefined }), id, ctx.orgId);
  }
  return getActionView(ctx, id)!;
}

/** Recent actions for the audit view. */
export function listActions(ctx: Ctx, limit = 50): ActionView[] {
  return (
    getDb().prepare("SELECT * FROM bob_actions WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(ctx.orgId, limit) as unknown as ActionRow[]
  ).map(viewFromRow);
}
