import "server-only";
/**
 * System emails from Bob itself (team invitations), as opposed to customer
 * emails, which only ever go through the business's own connected mailbox.
 *
 * Delivery is honest: every attempt is written to the `outbox` table with what
 * really happened, and the UI shows exactly that.
 *  - "sent": the provider accepted it (we never claim more than that).
 *  - "failed": the provider refused it or couldn't be reached; the UI offers a retry.
 *  - "not_configured": no email provider is set up on this server (or it's a
 *    sample workspace), so nothing left Bob. The person who invited copies the
 *    link and sends it themselves.
 *
 * Configuration (server environment):
 *  - BOB_MAIL_TRANSPORT=resend, RESEND_API_KEY, BOB_MAIL_FROM ("Bob <invites@your-domain>")
 *  - BOB_MAIL_ALLOWED_RECIPIENTS (optional, for development and staging): a
 *    comma-separated list of addresses or @domains. Anything else is refused
 *    and recorded as failed, so test invites can never reach a real person.
 *  - RESEND_API_URL (tests only): point at a local stand-in.
 *
 * Message bodies are stored with the invite link removed: the link is a
 * credential and is only ever shown to the person who created it.
 */
import { getDb } from "@/server/db";
import { uid } from "@/lib/utils";

export type MailStatus = "sent" | "failed" | "not_configured";

export interface SystemEmail {
  orgId: string;
  /** Sample workspaces never send real email. */
  sample: boolean;
  kind: "invite";
  refId?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** The text as stored in the outbox (secrets removed). */
  storedText: string;
  createdBy?: string;
}

export interface MailResult {
  status: MailStatus;
  error?: string;
  outboxId: string;
}

export function mailTransport(): "resend" | null {
  const t = (process.env.BOB_MAIL_TRANSPORT ?? "").trim().toLowerCase();
  if (t === "resend" && process.env.RESEND_API_KEY && process.env.BOB_MAIL_FROM) return "resend";
  return null;
}

/** For Settings and the Cresaro admin: is real email delivery set up, and is it restricted? */
export function mailStatus(): { configured: boolean; transport: string | null; restrictedTo: string[] } {
  return { configured: !!mailTransport(), transport: mailTransport(), restrictedTo: allowList() };
}

function allowList(): string[] {
  return (process.env.BOB_MAIL_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function recipientAllowed(to: string, list = allowList()): boolean {
  if (!list.length) return true;
  const addr = to.trim().toLowerCase();
  return list.some((rule) => (rule.startsWith("@") ? addr.endsWith(rule) : addr === rule));
}

function record(m: SystemEmail, transport: string, status: MailStatus, error?: string, providerId?: string): string {
  const id = uid("out");
  getDb()
    .prepare("INSERT INTO outbox (id, org_id, kind, ref_id, to_address, subject, body, transport, status, error, provider_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, m.orgId, m.kind, m.refId ?? null, m.to, m.subject, m.storedText, transport, status, error ?? null, providerId ?? null, m.createdBy ?? null, new Date().toISOString());
  return id;
}

export async function sendSystemEmail(m: SystemEmail): Promise<MailResult> {
  const transport = mailTransport();
  if (m.sample) return { status: "not_configured", error: "Sample workspace: no email is sent.", outboxId: record(m, "none", "not_configured", "Sample workspace") };
  if (!transport) return { status: "not_configured", error: "Email delivery isn't set up on this server.", outboxId: record(m, "none", "not_configured") };
  if (!recipientAllowed(m.to)) {
    const error = "Not sent: this server only emails its test recipients.";
    return { status: "failed", error, outboxId: record(m, transport, "failed", error) };
  }
  try {
    const res = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.BOB_MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      const error = `The email service refused it (${res.status}${body.message ? `: ${String(body.message).slice(0, 160)}` : ""}).`;
      return { status: "failed", error, outboxId: record(m, transport, "failed", error) };
    }
    return { status: "sent", outboxId: record(m, transport, "sent", undefined, body.id) };
  } catch (e) {
    const error = `Couldn't reach the email service${e instanceof Error && e.name === "TimeoutError" ? " (timed out)" : ""}. Try again.`;
    return { status: "failed", error, outboxId: record(m, transport, "failed", error) };
  }
}

/** The latest delivery attempt for each reference (e.g. invite id). */
export function latestDeliveries(orgId: string): Map<string, { status: MailStatus; error?: string; at: string }> {
  const rows = getDb()
    .prepare("SELECT ref_id, status, error, created_at FROM outbox WHERE org_id = ? AND ref_id IS NOT NULL ORDER BY created_at")
    .all(orgId) as { ref_id: string; status: MailStatus; error: string | null; created_at: string }[];
  const out = new Map<string, { status: MailStatus; error?: string; at: string }>();
  for (const r of rows) out.set(r.ref_id, { status: r.status, error: r.error ?? undefined, at: r.created_at });
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The invitation email: names the business and who invited them. Plain and short. */
export function inviteEmail(a: { businessName: string; inviterName: string; personName: string; url: string; expiresAt: string; existingAccount: boolean; myWorkOnly: boolean }): { subject: string; text: string; html: string; storedText: string } {
  const until = new Date(a.expiresAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
  const subject = `${a.inviterName} has invited you to ${a.businessName} on Bob`;
  const what = a.myWorkOnly
    ? "You'll see the jobs you're booked on: dates, times, the site address, directions and what to know when you arrive. You can add progress photos and updates from your phone."
    : `You'll be able to see and manage ${a.businessName}'s work in Bob.`;
  const how = a.existingAccount ? "You already have a Bob login with this email. Open the link and sign in with your usual password to accept." : "Open the link on your phone and choose a password. That's it.";
  const lines = (link: string) => [
    `Hi ${a.personName.split(/\s+/)[0]},`,
    "",
    `${a.inviterName} at ${a.businessName} has invited you to Bob.`,
    "",
    what,
    "",
    how,
    "",
    link,
    "",
    `The link works once, only for this email address, until ${until}. If you weren't expecting this, you can ignore it.`,
    "",
    `${a.businessName}, via Bob`,
  ];
  const text = lines(a.url).join("\n");
  const storedText = lines("[invite link — shown only to the person who sent it]").join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1d1b19;max-width:520px">
<p>Hi ${esc(a.personName.split(/\s+/)[0])},</p>
<p><strong>${esc(a.inviterName)}</strong> at <strong>${esc(a.businessName)}</strong> has invited you to Bob.</p>
<p>${esc(what)}</p>
<p>${esc(how)}</p>
<p><a href="${esc(a.url)}" style="display:inline-block;background:#e4752f;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Accept the invite</a></p>
<p style="color:#6b6560;font-size:14px">The link works once, only for this email address, until ${esc(until)}. If you weren't expecting this, you can ignore it.</p>
<p style="color:#6b6560;font-size:14px">${esc(a.businessName)}, via Bob</p></div>`;
  return { subject, text, html, storedText };
}
