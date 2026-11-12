import "server-only";
/**
 * Batch replies: "Bob, reply to all outstanding enquiries".
 *
 *  - prepareBatch drafts one reply per enquiry from its original message,
 *    earlier messages and the business's own sign-off. It never promises a
 *    price, date or commitment the business hasn't confirmed: if the customer
 *    asks for one, the draft holds back and the item is flagged for a decision.
 *  - sendBatchItem sends ONE approved reply. Each item is sent on its own, so a
 *    failure can be retried without resending the others. An enquiry is marked
 *    replied only when the email provider confirms the send (or, in a sample
 *    workspace with no inbox, when the user chose a clearly labelled simulated
 *    send, or confirmed they replied outside Bob).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Enquiry, EnquirySource } from "@/lib/types";
import { needsReply, sortEnquiries } from "@/lib/derive";
import { uid } from "@/lib/utils";
import { scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { getEmailProvider } from "@/server/integrations/registry";
import * as R from "./records";
import { askedTiming, buildDraft, latestInbound, type DraftFlag } from "@/lib/reply-draft";

export { askedTiming, buildDraft };

/** "Reply to all outstanding enquiries" (and the ways people say it). */
export const BATCH_REPLY_ALL =
  /\b(reply|respond|answer|get back|write back)( to)? (all|every|each)( of)?( my| the)?( (outstanding|unanswered|new|waiting|pending|open|unreplied))? ?(enquir\w*|leads?|messages?|customers?|people)\b|\b(draft|write|do|prepare) (all )?(the |my )?(replies|responses)( to| for)? (all|every|everyone|everybody|(the )?(outstanding|unanswered|waiting|new) (enquir\w*|ones|messages))\b|\b(reply|respond|get back) to (everyone|everybody)\b|\bbatch repl(y|ies)\b|^draft replies$/i;
/** "Reply to all of them" — the list currently in context. */
export const BATCH_REPLY_THEM =
  /\b(reply|respond|answer|get back|write back)( to)? (all of (them|those|these)|(them|those|these) all|all (those|these)|(them|those|these) (lot|people|enquir\w*))\b|\b(draft|write|do|prepare) (the )?(replies|responses) (to|for) (all of )?(them|those|these)\b/i;
export const isBatchReplyRequest = (text: string) => BATCH_REPLY_ALL.test(text) || BATCH_REPLY_THEM.test(text);

export type BatchMode = "send" | "simulate" | "copy";
export type { FlagKind } from "@/lib/reply-draft";
export type BatchFlag = DraftFlag;
export interface BatchItem {
  enquiryId: string;
  customerName: string;
  title: string;
  location: string;
  source: EnquirySource;
  receivedAt: string;
  /** How the reply goes: by email through Bob, or by the user on Instagram / phone. */
  channel: "email" | "instagram" | "phone" | "other";
  /** Email address, Instagram handle or phone number. */
  to?: string;
  /** Bob can send it (an email address and an inbox, or simulated in a sample workspace). */
  sendable: boolean;
  subject: string;
  original: { body: string; at: string; subject?: string };
  history: { direction: "inbound" | "outbound"; at: string; body: string }[];
  draft: string;
  /** The user's own saved draft was used as-is. */
  savedDraft: boolean;
  flags: BatchFlag[];
}
export interface Batch {
  mode: BatchMode;
  /** e.g. "Gmail", "Demo inbox". Absent when nothing is connected. */
  providerLabel?: string;
  items: BatchItem[];
  /** Asked for, but no longer waiting on a reply. */
  alreadyReplied: { enquiryId: string; customerName: string }[];
}

/* ------------------------------ Draft building ------------------------------ */

function channelOf(e: Enquiry): BatchItem["channel"] {
  if (e.email) return "email";
  if (e.source === "instagram" || e.instagramHandle) return "instagram";
  if (e.phone) return "phone";
  return "other";
}

export function batchMode(ctx: Ctx): { mode: BatchMode; providerLabel?: string } {
  const provider = getEmailProvider(ctx);
  if (provider) return { mode: "send", providerLabel: provider.label };
  return { mode: ctx.org.dataMode === "sample" ? "simulate" : "copy" };
}

/** The enquiries still waiting on a reply, in the same order as Today and Enquiries. */
export function outstandingIds(ctx: Ctx): string[] {
  return sortEnquiries(R.listEnquiries(ctx).filter(needsReply)).map((e) => e.id);
}

export function prepareBatch(ctx: Ctx, ids?: string[]): Result<Batch> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const wanted = ids?.length ? [...new Set(ids)].slice(0, 50) : outstandingIds(ctx);
  const { mode, providerLabel } = batchMode(ctx);
  const items: BatchItem[] = [];
  const alreadyReplied: Batch["alreadyReplied"] = [];
  for (const id of wanted) {
    const e = R.getEnquiry(ctx, id);
    if (!e) continue;
    if (!needsReply(e)) {
      alreadyReplied.push({ enquiryId: e.id, customerName: e.customerName });
      continue;
    }
    const last = latestInbound(e);
    const channel = channelOf(e);
    const { draft, flags, savedDraft } = buildDraft(e);
    items.push({
      enquiryId: e.id,
      customerName: e.customerName,
      title: e.title,
      location: e.location,
      source: e.source,
      receivedAt: e.receivedAt,
      channel,
      to: channel === "email" ? e.email : channel === "instagram" ? e.instagramHandle : channel === "phone" ? e.phone : undefined,
      sendable: channel === "email" && mode !== "copy",
      subject: `Re: ${last?.subject?.replace(/^re:\s*/i, "") ?? e.title}`,
      original: { body: last?.body ?? e.description, at: last?.at ?? e.receivedAt, subject: last?.subject },
      history: e.messages
        .filter((m) => m !== last)
        .slice(-3)
        .map((m) => ({ direction: m.direction, at: m.at, body: m.body })),
      draft,
      savedDraft,
      flags,
    });
  }
  return ok({ mode, providerLabel, items, alreadyReplied });
}

/* ---------------------------------- Sending ---------------------------------- */

export const sendItemSchema = z.object({
  enquiryId: z.string().min(1).max(100),
  body: z.string().trim().min(1, "The reply is empty.").max(5000),
  subject: z.string().trim().max(200).optional(),
  /** send: through the connected inbox · simulate: sample workspace, no inbox · replied_elsewhere: the user replied themselves. */
  mode: z.enum(["send", "simulate", "replied_elsewhere"]),
});

export type SendItemResult =
  | { status: "sent" | "simulated" | "marked"; enquiryId: string; message: string }
  | { status: "already_replied"; enquiryId: string; message: string }
  | { status: "failed"; enquiryId: string; message: string; retryable: boolean };

export async function sendBatchItem(ctx: Ctx, input: unknown): Promise<Result<SendItemResult>> {
  const parsed = sendItemSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Invalid reply");
  const { enquiryId, body, mode } = parsed.data;
  const no = denied(ctx, mode === "replied_elsewhere" ? "enquiries.write" : "email.send");
  if (no) return no;

  // Re-read the enquiry now: it may have been answered since the drafts were made.
  const e = R.getEnquiry(ctx, enquiryId);
  if (!e) return fail("not_found", "Enquiry not found");
  if (!needsReply(e)) return ok({ status: "already_replied", enquiryId, message: `${e.customerName} has already had a reply — not sent again.` });
  const subject = parsed.data.subject || `Re: ${e.title}`;

  const record = (channel: string, externalId: string | undefined, auditAction: string, summary: string) =>
    tx(() => {
      scoped(ctx).update<Enquiry>("enquiries", e.id, {
        messages: [...e.messages, { id: uid("msg"), direction: "outbound", at: new Date().toISOString(), subject: channel === "manual" ? undefined : subject, body, channel, externalId }],
        status: "replied",
        lastContactAt: new Date().toISOString(),
        draftReply: undefined,
      });
      R.audit(ctx, auditAction, summary, "enquiry", e.id);
    });

  if (mode === "replied_elsewhere") {
    record("manual", undefined, "enquiry.marked_replied", `${e.customerName} marked as replied to (reply sent outside Bob)`);
    return ok({ status: "marked", enquiryId, message: `${e.customerName} marked as replied.` });
  }

  if (!e.email) return fail("invalid", `There's no email address for ${e.customerName}. Copy the draft and reply another way.`);
  const provider = getEmailProvider(ctx);

  if (mode === "simulate") {
    if (provider) return fail("conflict", "An inbox is connected, so this reply would be sent for real. Refresh and use Send.");
    if (ctx.org.dataMode !== "sample") return fail("forbidden", "Simulated sending is only available with sample data.");
    record("simulated", undefined, "email.simulated", `Simulated reply to ${e.customerName} (demo — nothing was sent)`);
    return ok({ status: "simulated", enquiryId, message: `Simulated — nothing was sent to ${e.email}.` });
  }

  if (!provider) return fail("unavailable", "No inbox is connected, so Bob can't send email. Copy the draft instead.");
  // Same enquiry + same words → same key, so a retry after a timeout can't send it twice.
  const idempotencyKey = `batch:${e.id}:${createHash("sha256").update(body).digest("hex").slice(0, 24)}`;
  let outcome;
  try {
    outcome = await provider.send(ctx, { to: e.email, subject, body }, idempotencyKey);
  } catch (err) {
    outcome = { ok: false as const, error: err instanceof Error ? err.message : "Email provider error", retryable: true };
  }
  if (!outcome.ok) {
    // Keep the approved words on the enquiry so nothing is lost.
    tx(() => {
      scoped(ctx).update<Enquiry>("enquiries", e.id, { draftReply: body });
      R.audit(ctx, "email.failed", `Reply to ${e.customerName} failed: ${outcome.error}. Draft kept.`, "enquiry", e.id);
    });
    return ok({ status: "failed", enquiryId, message: outcome.error, retryable: outcome.retryable });
  }
  record(
    provider.id,
    outcome.externalId,
    "email.sent",
    `${outcome.simulated ? "Simulated email (demo, not sent)" : "Email sent"} to ${e.email}: "${subject}"`,
  );
  return ok({
    status: outcome.simulated ? "simulated" : "sent",
    enquiryId,
    message: outcome.simulated ? `Demo inbox — nothing actually left Bob.` : `Sent to ${e.email}.`,
  });
}
