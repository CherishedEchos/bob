import "server-only";
/**
 * "Invite someone": the Team screen's one-step invite, and emailing invites.
 *
 * Builds on the existing single-use, expiring invite links (team.createInvite):
 *  - inviteSomeone: name + email + Employee/Subcontractor. If they're already on
 *    the crew (same email, or the person chosen), their existing profile is
 *    invited, so their bookings stay attached to them. A different person with
 *    the same email is refused rather than duplicated.
 *  - sendInvite: (re)issues the link and emails it. Resending replaces the old
 *    link (it stops working), so only the latest email ever works.
 * Every email attempt is recorded honestly (src/server/mail.ts); when email
 * isn't set up, the link is returned so the inviter can send it themselves.
 */
import type { Person } from "@/lib/types";
import { personInputSchema } from "@/lib/validation";
import { getDb, scoped } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { inviteEmail, sendSystemEmail, type MailStatus } from "@/server/mail";
import { audit } from "./records";
import { createInvite, createPerson, updatePerson, type InviteRole } from "./team";

export interface SentInvite {
  personId: string;
  inviteId: string;
  /** The link, returned once to the person who created it (copy it if the email didn't go). */
  path: string;
  email: string;
  expiresAt: string;
  role: InviteRole;
  emailStatus: MailStatus;
  emailError?: string;
}

/** Issue (or reissue) an invite link for an existing person and email it. */
export async function sendInvite(ctx: Ctx, args: { personId: string; email?: string; role?: InviteRole; origin: string }): Promise<Result<SentInvite>> {
  const created = createInvite(ctx, args.personId, args.email, args.role ?? "worker");
  if (!created.ok) return created;
  const inv = created.value;
  const person = scoped(ctx).get<Person>("people", args.personId)!;
  const existingAccount = !!getDb().prepare("SELECT 1 FROM users WHERE email = ?").get(inv.email);
  const url = `${args.origin.replace(/\/$/, "")}${inv.path}`;
  const msg = inviteEmail({ businessName: ctx.org.name, inviterName: ctx.userName, personName: person.name, url, expiresAt: inv.expiresAt, existingAccount, myWorkOnly: inv.role === "worker" });
  const sent = await sendSystemEmail({ orgId: ctx.orgId, sample: ctx.org.dataMode === "sample", kind: "invite", refId: inv.inviteId, to: inv.email, subject: msg.subject, text: msg.text, html: msg.html, storedText: msg.storedText, createdBy: ctx.userName });
  audit(
    ctx,
    `team.invite_email_${sent.status}`,
    sent.status === "sent" ? `Invite emailed to ${person.name} (${inv.email})` : sent.status === "failed" ? `Invite email to ${person.name} failed: ${sent.error}` : `Invite link for ${person.name} ready to share (email isn't set up)`,
    "person",
    person.id,
  );
  return ok({ personId: person.id, inviteId: inv.inviteId, path: inv.path, email: inv.email, expiresAt: inv.expiresAt, role: inv.role, emailStatus: sent.status, emailError: sent.error });
}

/**
 * Team → Invite someone. Uses the existing crew profile when there is one
 * (personId, or the same email), otherwise adds them to the team first.
 */
export async function inviteSomeone(ctx: Ctx, raw: { personId?: unknown; name?: unknown; email?: unknown; kind?: unknown; role?: unknown; origin: string }): Promise<Result<SentInvite & { createdPerson: boolean }>> {
  const no = denied(ctx, "team.manage");
  if (no) return no;
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("invalid", "Enter their email address.", { email: "Enter a valid email" });
  const role: InviteRole = raw.role === "office" ? "office" : "worker";
  const db = scoped(ctx);
  const people = db.list<Person>("people");
  const sameEmail = people.find((p) => (p.email ?? "").toLowerCase() === email);

  let person: Person | undefined;
  let createdPerson = false;
  if (typeof raw.personId === "string" && raw.personId) {
    person = db.get<Person>("people", raw.personId);
    if (!person) return fail("not_found", "Person not found");
    if (sameEmail && sameEmail.id !== person.id) return fail("conflict", `${email} belongs to ${sameEmail.name} on your team. Invite them from their profile instead.`, { email: "Already used by someone else on your team" });
  } else if (sameEmail) {
    person = sameEmail;
  } else {
    const parsed = personInputSchema.safeParse({ name: raw.name, kind: raw.kind === "employee" ? "employee" : "subcontractor", email });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      return fail("invalid", "Check their details.", fe);
    }
    const r = createPerson(ctx, parsed.data);
    if (!r.ok) return r;
    person = r.value;
    createdPerson = true;
  }
  if (person.archivedAt) return fail("invalid", `${person.name} is archived. Restore them on the Team screen first.`);
  if (person.userId) return fail("conflict", `${person.name} already has access to Bob.`);
  // Keep the email on their profile, so the invite and their record agree.
  if ((person.email ?? "").toLowerCase() !== email) {
    const u = updatePerson(ctx, person.id, { name: person.name, kind: person.kind, company: person.company, trade: person.trade, phone: person.phone, email });
    if (!u.ok) return u;
  }
  const sent = await sendInvite(ctx, { personId: person.id, email, role, origin: raw.origin });
  if (!sent.ok) return sent;
  return ok({ ...sent.value, createdPerson });
}

/** Retry the email for a person's current invite. Issues a fresh link (the old one stops working). */
export async function resendInvite(ctx: Ctx, args: { personId: string; origin: string }): Promise<Result<SentInvite>> {
  const no = denied(ctx, "team.manage");
  if (no) return no;
  const last = getDb().prepare("SELECT email, role FROM invites WHERE org_id = ? AND person_id = ? ORDER BY created_at DESC LIMIT 1").get(ctx.orgId, args.personId) as { email: string; role: string } | undefined;
  if (!last) return fail("not_found", "There's no invite to resend. Use Invite to Bob.");
  return sendInvite(ctx, { personId: args.personId, email: last.email, role: last.role === "office" ? "office" : "worker", origin: args.origin });
}
