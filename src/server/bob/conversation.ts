import "server-only";
/**
 * Conversation persistence + turn orchestration. Voice and text both arrive
 * here as plain text, so they share exactly the same engine, permissions and
 * approval workflow.
 */
import type { BobMessage, BobTurnResponse, Card, Chip } from "@/lib/bob/types";
import { uid } from "@/lib/utils";
import { getDb } from "@/server/db";
import type { Ctx } from "@/server/context";
import { getActionView } from "./actions";
import { claudeConfigured, claudeTurn, noteClaudeFailure } from "./claude";
import { spendStatus } from "@/server/services/ai-usage";
import { getCustomer, getEnquiry, getJob } from "@/server/services/records";
import { rulesTurn, type BobState, type Reply } from "./rules";
import { BRIEFING_REQUEST } from "./briefing";
import { isBatchReplyRequest } from "@/server/services/batch-replies";
import { NEEDS_ORDERING, WHO_IS_ON } from "./schedule-answers";

interface StoredPayload {
  text: string;
  cards?: Card[];
  chips?: Chip[];
  actionId?: string;
  via?: "voice" | "text";
  engine?: "rules" | "claude";
}

interface ConvRow {
  id: string;
  state: string;
}

function getConversation(ctx: Ctx, id?: string): ConvRow | undefined {
  const db = getDb();
  if (id) {
    // Must belong to this org AND this user.
    return db.prepare("SELECT id, state FROM conversations WHERE id = ? AND org_id = ? AND user_id = ?").get(id, ctx.orgId, ctx.userId) as unknown as ConvRow | undefined;
  }
  return db
    .prepare("SELECT id, state FROM conversations WHERE org_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(ctx.orgId, ctx.userId) as unknown as ConvRow | undefined;
}

export function startConversation(ctx: Ctx): string {
  const id = uid("conv");
  const now = new Date().toISOString();
  getDb().prepare("INSERT INTO conversations (id, org_id, user_id, state, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)").run(id, ctx.orgId, ctx.userId, now, now);
  return id;
}

function appendMessage(ctx: Ctx, conversationId: string, role: "user" | "assistant", payload: StoredPayload): BobMessage {
  const id = uid("msg");
  const createdAt = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO conversation_messages (id, org_id, conversation_id, role, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, ctx.orgId, conversationId, role, JSON.stringify(payload), createdAt);
  return hydrate(ctx, { id, role, payload, createdAt });
}

function hydrate(ctx: Ctx, m: { id: string; role: "user" | "assistant"; payload: StoredPayload; createdAt: string }): BobMessage {
  return {
    id: m.id,
    role: m.role,
    text: m.payload.text,
    createdAt: m.createdAt,
    via: m.payload.via,
    cards: m.payload.cards,
    chips: m.payload.chips,
    engine: m.payload.engine,
    action: m.payload.actionId ? getActionView(ctx, m.payload.actionId) : undefined,
  };
}

export function loadConversation(ctx: Ctx, conversationId?: string): { conversationId: string | null; messages: BobMessage[] } {
  const conv = getConversation(ctx, conversationId);
  if (!conv) return { conversationId: null, messages: [] };
  const rows = getDb()
    .prepare("SELECT id, role, payload, created_at FROM conversation_messages WHERE conversation_id = ? AND org_id = ? ORDER BY created_at, rowid LIMIT 200")
    .all(conv.id, ctx.orgId) as unknown as { id: string; role: "user" | "assistant"; payload: string; created_at: string }[];
  return {
    conversationId: conv.id,
    messages: rows.map((r) => hydrate(ctx, { id: r.id, role: r.role, payload: JSON.parse(r.payload), createdAt: r.created_at })),
  };
}

export function activeEngine(): "rules" | "claude" {
  return claudeConfigured() ? "claude" : "rules";
}

export type PageRef = { type: "job" | "customer" | "enquiry"; id: string };

/**
 * The record on the user's screen becomes the conversation's focus, so "add
 * another £450 for the shelving" on a job page is about that job. The id is
 * looked up in this workspace (the client can't point Bob at anything else).
 */
export function applyPageContext(ctx: Ctx, state: BobState, page?: PageRef) {
  const focus = { ...(state.focus ?? {}) };
  delete focus.onPage;
  if (page?.type === "job") {
    const j = getJob(ctx, page.id);
    if (j) Object.assign(focus, { jobId: j.id, customerId: j.customerId, customerName: j.customerName, onPage: { type: "job", id: j.id, label: `${j.customerName} — ${j.title}` } });
  } else if (page?.type === "customer") {
    const c = getCustomer(ctx, page.id);
    if (c) {
      if (focus.customerId !== c.id) delete focus.jobId;
      Object.assign(focus, { customerId: c.id, customerName: c.name, onPage: { type: "customer", id: c.id, label: c.name } });
    }
  } else if (page?.type === "enquiry") {
    const e = getEnquiry(ctx, page.id) as { id: string; customerName?: string; customerId?: string; summary?: string } | undefined;
    if (e) Object.assign(focus, { enquiryId: e.id, ...(e.customerId ? { customerId: e.customerId } : {}), ...(e.customerName ? { customerName: e.customerName } : {}), onPage: { type: "enquiry", id: e.id, label: e.customerName ?? "this enquiry" } });
  }
  state.focus = focus;
}

export async function handleTurn(ctx: Ctx, input: { conversationId?: string; text: string; via: "voice" | "text"; context?: PageRef }): Promise<BobTurnResponse> {
  const bobCtx: Ctx = { ...ctx, via: "bob" };
  // An unknown or someone else's conversation id simply starts a fresh conversation.
  let conv = input.conversationId ? getConversation(bobCtx, input.conversationId) : undefined;
  if (!conv) conv = { id: startConversation(bobCtx), state: "{}" };
  const state = JSON.parse(conv.state || "{}") as BobState;
  applyPageContext(bobCtx, state, input.context);
  const history = loadConversation(bobCtx, conv.id).messages.map((m) => ({ role: m.role, text: m.text })).filter((m) => m.text);

  const userMsg = appendMessage(bobCtx, conv.id, "user", { text: input.text, via: input.via });

  // The briefing and batch replies are built only from records (and batch
  // replies go to a review screen), so they're the same whichever engine is on.
  // Schedule and order-list questions are answered from Bob's own records by the rules engine.
  // Batch replies open a review screen, so they always use the built-in flow. With Claude on, everything
  // else (briefing, schedule, materials…) goes to Claude, which has tools for each of those records.
  let engine = isBatchReplyRequest(input.text) || (activeEngine() !== "claude" && (BRIEFING_REQUEST.test(input.text) || WHO_IS_ON.test(input.text) || NEEDS_ORDERING.test(input.text))) ? "rules" : activeEngine();
  let out: { replies: Reply[]; state: BobState; changed: boolean };
  let fallbackNote: string | undefined;
  // Monthly AI spending limit (set by Cresaro admins): once reached, Bob's built-in assistant answers.
  if (engine === "claude" && spendStatus(bobCtx).blocked) {
    engine = "rules";
    fallbackNote = "This month's AI allowance has been used, so Bob's built-in assistant answered this one.";
  }
  try {
    out = engine === "claude" ? await claudeTurn(bobCtx, input.text, history, state, conv.id, input.via) : await rulesTurn(bobCtx, input.text, state, conv.id);
  } catch (e) {
    if (engine === "claude") {
      // LLM unavailable → fall back to the deterministic engine rather than failing.
      console.error("Claude engine failed, falling back to rules:", e instanceof Error ? `${e.name}: ${e.message}` : e);
      noteClaudeFailure(e);
      engine = "rules";
      const timeout = /timeout|timed out/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));
      fallbackNote = timeout ? "The AI service didn't respond in time, so Bob's built-in assistant answered this one." : "The AI service wasn't available just now, so Bob's built-in assistant answered this one.";
      out = await rulesTurn(bobCtx, input.text, state, conv.id);
    } else throw e;
  }

  if (fallbackNote && out.replies[0]) out.replies[0] = { ...out.replies[0], text: `${out.replies[0].text}\n\n(${fallbackNote})` };
  const replies = out.replies.map((r) => appendMessage(bobCtx, conv!.id, "assistant", { text: r.text, cards: r.cards, chips: r.chips, actionId: r.actionId, engine }));
  getDb().prepare("UPDATE conversations SET state = ?, updated_at = ? WHERE id = ? AND org_id = ?").run(JSON.stringify(out.state), new Date().toISOString(), conv.id, ctx.orgId);
  return { conversationId: conv.id, messages: [userMsg, ...replies], changed: out.changed };
}

/** UK GDPR: retention. Deletes conversations older than the org's setting. */
export function purgeOldConversations(ctx: Ctx): number {
  const cutoff = new Date(Date.now() - ctx.org.retention.conversationDays * 86_400_000).toISOString();
  const res = getDb().prepare("DELETE FROM conversations WHERE org_id = ? AND updated_at < ?").run(ctx.orgId, cutoff);
  return Number(res.changes);
}
