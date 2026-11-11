import "server-only";
/**
 * Email → enquiry import (provider-independent).
 *
 *  - Deduplicated per provider message id (imported_messages table), so a
 *    re-sync or retry never creates duplicates.
 *  - Obvious non-enquiries (newsletters, no-reply senders) are skipped.
 *  - Messages are matched to existing customers by email address.
 *  - Only what the product needs is stored: sender, subject, body text (capped).
 *  - Bodies are untrusted: stored as data, scanned for injection attempts.
 */
import type { Enquiry } from "@/lib/types";
import { uid } from "@/lib/utils";
import { can } from "@/lib/auth/permissions";
import { getDb, scoped, tx } from "@/server/db";
import { fail, ok, type Ctx, type Result } from "@/server/context";
import { audit, createEnquiry, listCustomers, listEnquiries } from "@/server/services/records";
import { parseLocation, parseWorkTitle } from "@/server/bob/nlu";
import { getEmailProvider, touchSync } from "./registry";
import { detectInjection } from "./safety";
import type { InboundEmail } from "./types";

export function looksLikeEnquiry(m: InboundEmail): boolean {
  const from = m.from.email.toLowerCase();
  if (/^(no-?reply|newsletter|deals|marketing|notifications?|mailer-daemon)@/.test(from)) return false;
  if (/\bunsubscribe\b/i.test(m.body)) return false;
  return true;
}

export interface SyncResult {
  created: Enquiry[];
  appended: number;
  skipped: number;
  duplicates: number;
  flagged: { customerName: string; reasons: string[] }[];
}

export async function syncInbox(ctx: Ctx): Promise<Result<SyncResult>> {
  if (!can(ctx.role, "enquiries.write")) return fail("forbidden", "Your account can't import enquiries.");
  const provider = getEmailProvider(ctx);
  if (!provider) return fail("unavailable", "No email account is connected.");
  let messages: InboundEmail[];
  try {
    messages = await provider.listRecent(ctx);
  } catch (e) {
    return fail("unavailable", e instanceof Error ? e.message : "Couldn't reach the mailbox");
  }
  const db = getDb();
  const seen = db.prepare("SELECT 1 FROM imported_messages WHERE org_id = ? AND provider = ? AND external_id = ?");
  const mark = db.prepare("INSERT OR IGNORE INTO imported_messages (org_id, provider, external_id, enquiry_id, imported_at) VALUES (?, ?, ?, ?, ?)");
  const out: SyncResult = { created: [], appended: 0, skipped: 0, duplicates: 0, flagged: [] };
  const sysCtx: Ctx = { ...ctx, via: "integration" };
  const customers = listCustomers(ctx);

  for (const m of messages) {
    if (seen.get(ctx.orgId, provider.id, m.externalId)) {
      out.duplicates++;
      continue;
    }
    if (!looksLikeEnquiry(m)) {
      mark.run(ctx.orgId, provider.id, m.externalId, null, new Date().toISOString());
      out.skipped++;
      continue;
    }
    const injection = detectInjection(`${m.subject}\n${m.body}`);
    const customer = customers.find((c) => c.email && c.email.toLowerCase() === m.from.email.toLowerCase());
    const body = m.body.slice(0, 8000);
    tx(() => {
      // Existing open thread from the same sender → append, don't duplicate.
      const existing = listEnquiries(ctx).find(
        (e) => (m.threadId && e.externalThreadId === m.threadId) || (e.email?.toLowerCase() === m.from.email.toLowerCase() && e.status !== "won" && e.status !== "lost"),
      );
      if (existing) {
        scoped(ctx).update<Enquiry>("enquiries", existing.id, {
          messages: [...existing.messages, { id: uid("msg"), direction: "inbound", at: m.receivedAt, subject: m.subject, body, channel: provider.id, externalId: m.externalId }],
          status: existing.status === "replied" || existing.status === "quoted" ? "awaiting_reply" : existing.status,
        });
        audit(sysCtx, "enquiry.message_received", `New email from ${existing.customerName} added to their enquiry`, "enquiry", existing.id);
        mark.run(ctx.orgId, provider.id, m.externalId, existing.id, new Date().toISOString());
        out.appended++;
        return;
      }
      const created = createEnquiry(
        sysCtx,
        {
          customerName: m.from.name || m.from.email,
          customerId: customer?.id,
          email: m.from.email,
          source: "email",
          title: parseWorkTitle(`${m.subject} ${m.body}`) ?? (m.subject.slice(0, 80) || "Email enquiry"),
          description: body,
          location: parseLocation(m.body) ?? customer?.town ?? "Not stated",
          priority: "medium",
        },
        {
          provider: provider.id,
          externalThreadId: m.threadId,
          receivedAt: m.receivedAt,
          messages: [{ id: uid("msg"), direction: "inbound", at: m.receivedAt, subject: m.subject, body, channel: provider.id, externalId: m.externalId }],
          notes: injection.suspicious
            ? [{ id: uid("note"), text: `⚠ Bob flagged this message: it contains text aimed at an assistant (${injection.reasons.join("; ")}). It was treated as plain text and ignored.`, createdAt: new Date().toISOString(), author: "Bob" }]
            : [],
        },
      );
      if (!created.ok) throw new Error(created.error);
      mark.run(ctx.orgId, provider.id, m.externalId, created.value.id, new Date().toISOString());
      out.created.push(created.value);
      if (injection.suspicious) out.flagged.push({ customerName: created.value.customerName, reasons: injection.reasons });
    });
  }
  touchSync(ctx, provider.id);
  return ok(out);
}
