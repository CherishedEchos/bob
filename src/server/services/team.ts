import "server-only";
/**
 * Team, invitations, the schedule, job materials and bills to pay.
 *
 * Permissions are checked here on every call (never trusted from the client):
 *  - owners/office plan the schedule and manage the team;
 *  - the site team can read the schedule;
 *  - invited workers (employees or subcontractors) only reach their own booked
 *    work through myWork()/myJob() — never the company schedule, customer list
 *    or anything financial.
 * A person record is separate from login access: people can be booked before
 * (or without ever) being invited. Accepting an invite links the two.
 */
import type { Absence, Bill, Booking, Job, JobFile, Material, Person, PersonAccess, Role, Task } from "@/lib/types";
import { bookingInputSchema, billInputSchema, billPaymentSchema, materialInputSchema, personInputSchema } from "@/lib/validation";
import { addDays, formatDayShort, formatTimeRange, rangeKeys, timeToMinutes } from "@/lib/dates";
import { can } from "@/lib/auth/permissions";
import { todayKey, uid, gbp } from "@/lib/utils";
import { getDb, scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { audit, getCustomer, getJob, listJobs } from "./records";
import { ABSENCE_LABEL, absenceClashes, absenceWhen } from "./absences";

const now = () => new Date().toISOString();
const INVITE_DAYS = 7;
/** Workers keep access to a job for a week after their last booking on it (to finish snagging, check notes). */
const ACCESS_GRACE_DAYS = 7;

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}

/* ---------------------------------- People ---------------------------------- */

export function listPeople(ctx: Ctx): Person[] {
  if (!can(ctx.role, "schedule.read") && !can(ctx.role, "team.manage")) return [];
  return scoped(ctx).list<Person>("people", { order: "archived_at IS NOT NULL, name" });
}

export function createPerson(ctx: Ctx, input: unknown): Result<Person> {
  const no = denied(ctx, "team.manage");
  if (no) return no;
  const parsed = personInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check their details.", fieldErrors(parsed.error.issues));
  const person: Person = { id: uid("per"), ...parsed.data, createdAt: now() };
  tx(() => {
    scoped(ctx).insert("people", person);
    audit(ctx, "team.person_added", `${person.name} added to the team (${person.kind === "subcontractor" ? "subcontractor" : "employee"})`, "person", person.id);
  });
  return ok(person);
}

export function updatePerson(ctx: Ctx, id: string, input: unknown): Result<Person> {
  const no = denied(ctx, "team.manage");
  if (no) return no;
  const p = scoped(ctx).get<Person>("people", id);
  if (!p) return fail("not_found", "Person not found");
  const parsed = personInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check their details.", fieldErrors(parsed.error.issues));
  const u = tx(() => {
    const out = scoped(ctx).update<Person>("people", id, { ...parsed.data, company: parsed.data.company ?? (null as unknown as undefined), trade: parsed.data.trade ?? (null as unknown as undefined), phone: parsed.data.phone ?? (null as unknown as undefined), email: parsed.data.email ?? (null as unknown as undefined) })!;
    audit(ctx, "team.person_updated", `${out.name}'s details updated`, "person", id);
    return out;
  });
  return ok(u);
}

/**
 * Archive: they drop off the planner and lose any login access, but every
 * past booking (and who did it) is kept.
 */
export function archivePerson(ctx: Ctx, id: string, archived = true): Result<Person> {
  const no = denied(ctx, "team.manage");
  if (no) return no;
  const p = scoped(ctx).get<Person>("people", id);
  if (!p) return fail("not_found", "Person not found");
  const u = tx(() => {
    if (archived) revokeAccessInner(ctx, p);
    const out = scoped(ctx).update<Person>("people", id, { archivedAt: archived ? now() : (null as unknown as undefined) })!;
    audit(ctx, archived ? "team.person_archived" : "team.person_restored", `${p.name} ${archived ? "archived — access removed, history kept" : "restored"}`, "person", id);
    return out;
  });
  return ok(u);
}

/** Remove someone's login access to this business (and any pending invite). Their bookings stay. */
export function revokeAccess(ctx: Ctx, personId: string): Result<Person> {
  const no = denied(ctx, "team.manage");
  if (no) return no;
  const p = scoped(ctx).get<Person>("people", personId);
  if (!p) return fail("not_found", "Person not found");
  const theirRole = p.userId ? memberRole(ctx.orgId, p.userId) : undefined;
  if (theirRole === "owner") return fail("forbidden", "An owner's access can't be removed here.");
  if (theirRole === "office" && ctx.role !== "owner") return fail("forbidden", "Only the owner can remove an admin's access.");
  tx(() => {
    revokeAccessInner(ctx, p);
    audit(ctx, "team.access_revoked", `${p.name}'s access to Bob removed`, "person", personId);
  });
  return ok(scoped(ctx).get<Person>("people", personId)!);
}

function revokeAccessInner(ctx: Ctx, p: Person) {
  const db = getDb();
  db.prepare("UPDATE invites SET revoked_at = ? WHERE org_id = ? AND person_id = ? AND accepted_at IS NULL AND revoked_at IS NULL").run(now(), ctx.orgId, p.id);
  if (p.userId) {
    const role = (db.prepare("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?").get(ctx.orgId, p.userId) as { role: Role } | undefined)?.role;
    // Never removes an owner. Only an owner can remove an admin (office) login.
    if (role === "owner" || (role === "office" && ctx.role !== "owner")) return;
    db.prepare("DELETE FROM memberships WHERE org_id = ? AND user_id = ? AND role IN ('worker','office')").run(ctx.orgId, p.userId);
    db.prepare("DELETE FROM sessions WHERE org_id = ? AND user_id = ?").run(ctx.orgId, p.userId);
    db.prepare("UPDATE calendar_feeds SET revoked_at = ? WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL").run(now(), ctx.orgId, p.userId);
    scoped(ctx).update<Person>("people", p.id, { userId: null as unknown as undefined });
  }
}

/* --------------------------------- Invites --------------------------------- */

interface InviteRow {
  id: string;
  org_id: string;
  person_id: string;
  email: string;
  role: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_user_id: string | null;
  revoked_at: string | null;
}

function memberRole(orgId: string, userId: string): Role | undefined {
  return (getDb().prepare("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?").get(orgId, userId) as { role: Role } | undefined)?.role;
}

/** Roles an invite can grant. Owner invites only come from provisioning. */
export type InviteRole = "worker" | "office";

const inviteState = (r: InviteRow): PersonAccess["state"] =>
  r.accepted_at ? "accepted" : r.revoked_at ? "revoked" : new Date(r.expires_at).getTime() < Date.now() ? "expired" : "pending";

/** Each person's current access, for the Team screen. Never includes tokens. */
export function listAccess(ctx: Ctx): PersonAccess[] {
  if (!can(ctx.role, "team.manage")) return [];
  const rows = getDb().prepare("SELECT * FROM invites WHERE org_id = ? ORDER BY created_at").all(ctx.orgId) as unknown as InviteRow[];
  const latest = new Map<string, InviteRow>();
  for (const r of rows) latest.set(r.person_id, r);
  const people = scoped(ctx).list<Person>("people");
  return people.map((p) => {
    const r = latest.get(p.id);
    const role = p.userId ? memberRole(ctx.orgId, p.userId) : undefined;
    if (!r) return { personId: p.id, state: p.userId ? "accepted" : "not_invited", role };
    const state = inviteState(r);
    // An accepted invite whose login was later removed reads as "revoked".
    const effective = state === "accepted" && !p.userId ? "revoked" : state;
    return { personId: p.id, state: effective, email: r.email, sentAt: r.created_at, expiresAt: r.expires_at, acceptedAt: r.accepted_at ?? undefined, inviteId: r.id, role: role ?? (effective === "pending" ? (r.role as Role) : undefined) };
  });
}

/**
 * Create a single-use invite link for a person. Any earlier pending link for
 * them stops working. Returns the link once — only its hash is stored.
 */
export function createInvite(ctx: Ctx, personId: string, emailInput?: string, roleInput: InviteRole = "worker"): Result<{ inviteId: string; path: string; expiresAt: string; email: string; emailed: false; role: InviteRole }> {
  const no = denied(ctx, "team.manage");
  if (no) return no;
  if (roleInput !== "worker" && roleInput !== "office") return fail("invalid", "Choose My work only or Admin.");
  // Admins can invite staff and subcontractors; only the owner can make someone an admin.
  if (roleInput === "office" && ctx.role !== "owner") return fail("forbidden", "Only the owner can give someone admin access.");
  const p = scoped(ctx).get<Person>("people", personId);
  if (!p) return fail("not_found", "Person not found");
  if (p.archivedAt) return fail("invalid", "Restore this person before inviting them.");
  if (p.userId) return fail("conflict", `${p.name} already has access.`);
  const email = (emailInput ?? p.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("invalid", "Add their email address first — the invite only works for that email.", { email: "Enter a valid email" });
  const existing = getDb().prepare("SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ? AND m.org_id = ?").get(email, ctx.orgId) as { id: string } | undefined;
  if (existing) return fail("conflict", "That email already has an account in this business.");
  const token = randomToken();
  const id = uid("inv");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  tx(() => {
    const db = getDb();
    db.prepare("UPDATE invites SET revoked_at = ? WHERE org_id = ? AND person_id = ? AND accepted_at IS NULL AND revoked_at IS NULL").run(now(), ctx.orgId, personId);
    db.prepare("INSERT INTO invites (id, org_id, person_id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, ctx.orgId, personId, email, roleInput, sha256(token), ctx.userName, now(), expiresAt,
    );
    if (!p.email) scoped(ctx).update<Person>("people", personId, { email });
    audit(ctx, "team.invite_created", `${roleInput === "office" ? "Admin invite" : "Invite"} link created for ${p.name} (${email}), expires in ${INVITE_DAYS} days`, "person", personId);
  });
  // No email is sent from here: the owner shares the link (WhatsApp, text, email).
  return ok({ inviteId: id, path: `/invite/${token}`, expiresAt, email, emailed: false, role: roleInput });
}

export function revokeInvite(ctx: Ctx, inviteId: string): Result<true> {
  const no = denied(ctx, "team.manage");
  if (no) return no;
  const r = getDb().prepare("SELECT * FROM invites WHERE org_id = ? AND id = ?").get(ctx.orgId, inviteId) as InviteRow | undefined;
  if (!r) return fail("not_found", "Invite not found");
  if (r.accepted_at) return fail("conflict", "That invite was already accepted — remove their access instead.");
  getDb().prepare("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), inviteId);
  audit(ctx, "team.invite_revoked", `Invite for ${r.email} cancelled`, "person", r.person_id);
  return ok(true);
}

/** The role an invite grants. Anything unexpected falls back to the least access. */
const inviteRoleOf = (r: InviteRow): Role => (r.role === "owner" || r.role === "office" ? r.role : "worker");

function inviteByToken(token: string): InviteRow | undefined {
  if (!token || token.length < 20 || token.length > 200) return undefined;
  return getDb().prepare("SELECT * FROM invites WHERE token_hash = ?").get(sha256(token)) as InviteRow | undefined;
}

/** Public: what the invite page shows before sign-up. Reveals nothing for a bad link. */
export function inviteInfo(token: string): { state: PersonAccess["state"] | "invalid"; businessName?: string; personName?: string; email?: string; hasAccount?: boolean; owner?: boolean; role?: Role } {
  const r = inviteByToken(token);
  if (!r) return { state: "invalid" };
  const state = inviteState(r);
  if (state !== "pending") return { state };
  const org = getDb().prepare("SELECT config FROM orgs WHERE id = ?").get(r.org_id) as { config: string };
  const person = (r.person_id ? (getDb().prepare("SELECT name FROM people WHERE org_id = ? AND id = ?").get(r.org_id, r.person_id) as { name: string } | undefined) : undefined) ?? (r.role === "owner" ? { name: "there" } : undefined);
  const hasAccount = !!getDb().prepare("SELECT 1 FROM users WHERE email = ?").get(r.email);
  return { state, businessName: (JSON.parse(org.config) as { name: string }).name, personName: person?.name, email: r.email, hasAccount, owner: r.role === "owner", role: inviteRoleOf(r) };
}

/**
 * Accept an invite. Bound to the invited email: a new account is created for
 * exactly that address, or an existing account must prove it owns it with its
 * password. Single use (an atomic update), expires, and can't be used once
 * revoked. Returns a session for the new login.
 */
export function acceptInvite(token: string, input: { password?: unknown; name?: unknown }): Result<{ token: string; expires: Date; orgId: string }> {
  const r = inviteByToken(token);
  if (!r) return fail("not_found", "This invite link isn't valid. Ask for a new one.");
  const state = inviteState(r);
  if (state === "accepted") return fail("conflict", "This invite has already been used. Sign in instead.");
  if (state === "revoked") return fail("forbidden", "This invite was cancelled. Ask for a new one.");
  if (state === "expired") return fail("forbidden", "This invite has expired. Ask for a new one.");
  const password = typeof input.password === "string" ? input.password : "";
  const db = getDb();
  const role = inviteRoleOf(r);
  // Older owner setup links aren't tied to a Team record; newer owner/admin links are.
  const linked = r.person_id
    ? (db.prepare("SELECT id, name, archived_at FROM people WHERE org_id = ? AND id = ?").get(r.org_id, r.person_id) as { id: string; name: string; archived_at: string | null } | undefined)
    : undefined;
  const person = linked ?? (role === "owner" && !r.person_id ? { id: "", name: r.email.split("@")[0], archived_at: null } : undefined);
  if (!person || person.archived_at) return fail("forbidden", "This invite is no longer active. Ask for a new one.");
  const existing = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(r.email) as { id: string; password_hash: string } | undefined;
  if (existing) {
    if (!verifyPassword(password, existing.password_hash)) return fail("forbidden", `Enter the password for ${r.email} to accept.`, { password: "That password doesn't match this email" });
  } else if (password.length < 8) {
    return fail("invalid", "Choose a password of at least 8 characters.", { password: "At least 8 characters" });
  }
  let userId = existing?.id;
  db.exec("BEGIN IMMEDIATE");
  try {
    const claimed = db.prepare("UPDATE invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?").run(now(), r.id, now());
    if (Number(claimed.changes) !== 1) throw new Error("claimed");
    if (!userId) {
      userId = uid("usr");
      const name = typeof input.name === "string" && input.name.trim().length >= 2 ? input.name.trim().slice(0, 120) : person.name;
      db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, r.email, name, hashPassword(password), now());
    }
    db.prepare("INSERT OR IGNORE INTO memberships (org_id, user_id, role) VALUES (?, ?, ?)").run(r.org_id, userId, role);
    db.prepare("UPDATE invites SET accepted_user_id = ? WHERE id = ?").run(userId, r.id);
    if (person.id) db.prepare("UPDATE people SET user_id = ? WHERE org_id = ? AND id = ?").run(userId, r.org_id, person.id);
    const what = role === "worker" ? "can now see their work in Bob" : `signed in as ${role === "owner" ? "the owner" : "an admin"}`;
    db.prepare("INSERT INTO activity (id, org_id, at, actor, via, action, summary, entity_type, entity_id) VALUES (?, ?, ?, ?, 'system', 'team.invite_accepted', ?, 'person', ?)").run(
      uid("act"), r.org_id, now(), person.name, `${person.name} accepted their invite and ${what}`, person.id || null,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    if (e instanceof Error && e.message === "claimed") return fail("conflict", "This invite has already been used. Sign in instead.");
    throw e;
  }
  const session = createSession(userId!, r.org_id);
  if (!session.ok) return fail("unavailable", "Couldn't sign you in. Try signing in.");
  return ok({ token: session.token, expires: session.expires, orgId: r.org_id });
}

/* -------------------------------- Bookings -------------------------------- */

export function listBookings(ctx: Ctx): Booking[] {
  if (!can(ctx.role, "schedule.read")) return [];
  return scoped(ctx).list<Booking>("bookings", { order: "date, start_time" });
}

const bookingEnd = (b: Pick<Booking, "date" | "endDate">) => b.endDate ?? b.date;

/** Two bookings clash if their days overlap and their hours overlap (all day overlaps everything). */
export function bookingsOverlap(a: Pick<Booking, "date" | "endDate" | "startTime" | "endTime">, b: Pick<Booking, "date" | "endDate" | "startTime" | "endTime">): boolean {
  if (bookingEnd(a) < b.date || bookingEnd(b) < a.date) return false;
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return true;
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}

export interface Clash {
  /** "booking": already on another job. "absence": approved leave or unavailability. */
  kind?: "booking" | "absence";
  personId: string;
  personName: string;
  bookingId: string;
  jobTitle: string;
  when: string;
}

export function findClashes(ctx: Ctx, draft: Pick<Booking, "date" | "endDate" | "startTime" | "endTime" | "personIds"> & { id?: string }): Clash[] {
  const people = new Map(scoped(ctx).list<Person>("people").map((p) => [p.id, p]));
  const jobs = new Map(listJobs(ctx).map((j) => [j.id, j]));
  const out: Clash[] = [];
  for (const other of scoped(ctx).list<Booking>("bookings", { where: "date <= ?", params: [bookingEnd(draft)] })) {
    if (other.id === draft.id || !bookingsOverlap(draft, other)) continue;
    for (const pid of draft.personIds) {
      if (!other.personIds.includes(pid)) continue;
      const j = jobs.get(other.jobId);
      const days = rangeKeys(other.date, bookingEnd(other));
      out.push({
        kind: "booking",
        personId: pid,
        personName: people.get(pid)?.name ?? "Someone",
        bookingId: other.id,
        jobTitle: j ? `${j.title} · ${j.customerName}` : "another job",
        when: `${formatDayShort(days[0])}${days.length > 1 ? `–${formatDayShort(days.at(-1)!)}` : ""}, ${formatTimeRange(other.startTime, other.endTime)}`,
      });
    }
  }
  for (const { personId, absence } of absenceClashes(ctx, draft)) {
    out.push({ kind: "absence", personId, personName: people.get(personId)?.name ?? "Someone", bookingId: absence.id, jobTitle: ABSENCE_LABEL[absence.kind].toLowerCase(), when: absenceWhen(absence) });
  }
  return out;
}

export const clashMessage = (c: Clash[]) =>
  c.map((x) => (x.kind === "absence" ? `${x.personName} is on approved ${x.jobTitle} (${x.when}).` : `${x.personName} is already booked on ${x.jobTitle} (${x.when}).`)).join(" ");

/**
 * Create or update a booking. Clashes for the same person are refused unless
 * the planner confirms an intentional overlap (confirmOverlap).
 */
export function saveBooking(ctx: Ctx, input: unknown): Result<Booking> & { clashes?: Clash[] } {
  const no = denied(ctx, "schedule.manage");
  if (no) return no;
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the booking.", fieldErrors(parsed.error.issues));
  const v = parsed.data;
  const job = getJob(ctx, v.jobId);
  if (!job) return fail("not_found", "Job not found", { jobId: "Pick a job" });
  const existing = v.id ? scoped(ctx).get<Booking>("bookings", v.id) : undefined;
  if (v.id && !existing) return fail("not_found", "That booking no longer exists — it may have been deleted.");
  const personIds = [...new Set(v.personIds)];
  for (const pid of personIds) {
    const p = scoped(ctx).get<Person>("people", pid);
    if (!p) return fail("not_found", "One of the people isn't in your team any more.", { personIds: "Choose people from your team" });
    if (p.archivedAt) return fail("invalid", `${p.name} is archived. Restore them before booking.`, { personIds: `${p.name} is archived` });
  }
  const draft: Booking = {
    id: existing?.id ?? uid("bk"),
    jobId: v.jobId,
    date: v.date,
    endDate: v.endDate && v.endDate !== v.date ? v.endDate : undefined,
    startTime: v.allDay ? undefined : v.startTime,
    endTime: v.allDay ? undefined : v.endTime,
    personIds,
    notes: v.notes,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    createdBy: existing?.createdBy ?? ctx.userName,
  };
  const clashes = findClashes(ctx, draft);
  if (clashes.length && !v.confirmOverlap) {
    return { ...fail("conflict", clashMessage(clashes), { overlap: clashMessage(clashes) }), clashes };
  }
  const names = personIds.map((id) => scoped(ctx).get<Person>("people", id)!.name);
  tx(() => {
    if (existing) {
      scoped(ctx).update<Booking>("bookings", draft.id, {
        ...draft,
        endDate: draft.endDate ?? (null as unknown as undefined),
        startTime: draft.startTime ?? (null as unknown as undefined),
        endTime: draft.endTime ?? (null as unknown as undefined),
        notes: draft.notes ?? (null as unknown as undefined),
      });
    } else scoped(ctx).insert("bookings", draft);
    // A booked job reads as booked: move it on from quoted / awaiting deposit only if it hasn't started.
    if (!job.startDate || job.startDate > draft.date) scoped(ctx).update<Job>("jobs", job.id, { startDate: draft.date });
    audit(
      ctx,
      existing ? "schedule.booking_updated" : "schedule.booking_created",
      `${existing ? "Booking changed" : "Work scheduled"}: ${job.title} for ${job.customerName}, ${formatDayShort(draft.date)}${draft.endDate ? `–${formatDayShort(draft.endDate)}` : ""} ${formatTimeRange(draft.startTime, draft.endTime)} — ${names.length ? names.join(", ") : "nobody assigned yet"}${clashes.length ? " (overlap confirmed)" : ""}`,
      "job",
      job.id,
    );
  });
  return ok(scoped(ctx).get<Booking>("bookings", draft.id)!);
}

export function deleteBooking(ctx: Ctx, id: string): Result<true> {
  const no = denied(ctx, "schedule.manage");
  if (no) return no;
  const b = scoped(ctx).get<Booking>("bookings", id);
  if (!b) return fail("not_found", "Booking not found");
  const job = getJob(ctx, b.jobId);
  tx(() => {
    scoped(ctx).remove("bookings", id);
    audit(ctx, "schedule.booking_deleted", `Booking removed: ${job?.title ?? "job"} on ${formatDayShort(b.date)}`, "job", b.jobId);
  });
  return ok(true);
}

/* -------------------------------- Materials -------------------------------- */

export function listMaterials(ctx: Ctx): Material[] {
  if (!can(ctx.role, "records.read")) return [];
  return scoped(ctx).list<Material>("materials", { order: "needed_by IS NULL, needed_by, created_at" });
}

export function saveMaterial(ctx: Ctx, input: unknown): Result<Material> {
  const no = denied(ctx, "materials.write");
  if (no) return no;
  const parsed = materialInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the item.", fieldErrors(parsed.error.issues));
  const v = parsed.data;
  const job = getJob(ctx, v.jobId);
  if (!job) return fail("not_found", "Job not found");
  const existing = v.id ? scoped(ctx).get<Material>("materials", v.id) : undefined;
  if (v.id && !existing) return fail("not_found", "That item no longer exists.");
  if (v.merchantId && !scoped(ctx).get("merchants", v.merchantId)) return fail("not_found", "Merchant not found", { merchantId: "Choose a merchant from the list" });
  const row: Material = { id: existing?.id ?? uid("mat"), ...v, createdAt: existing?.createdAt ?? now(), updatedAt: now() };
  const n = <T,>(x: T | undefined) => (x ?? (null as unknown as undefined));
  tx(() => {
    if (existing)
      scoped(ctx).update<Material>("materials", row.id, {
        ...row, supplier: n(row.supplier), neededBy: n(row.neededBy), unit: n(row.unit), merchantId: n(row.merchantId), orderRef: n(row.orderRef), expectedDelivery: n(row.expectedDelivery), notes: n(row.notes),
      });
    else scoped(ctx).insert("materials", row);
    audit(ctx, existing ? "materials.updated" : "materials.added", `${existing ? "Updated" : "Added"} ${row.quantity} × ${row.item} for ${job.title} (${STATUS_WORD[row.status]})`, "job", job.id);
  });
  return ok(row);
}

const STATUS_WORD: Record<Material["status"], string> = { to_order: "to order", ordered: "ordered", on_site: "on site" };

export function setMaterialStatus(ctx: Ctx, id: string, status: Material["status"]): Result<Material> {
  const no = denied(ctx, "materials.write");
  if (no) return no;
  const m = scoped(ctx).get<Material>("materials", id);
  if (!m) return fail("not_found", "Item not found");
  if (!["to_order", "ordered", "on_site"].includes(status)) return fail("invalid", "Unknown status");
  const u = tx(() => {
    const out = scoped(ctx).update<Material>("materials", id, { status, updatedAt: now() })!;
    audit(ctx, "materials.status", `${m.item}: ${STATUS_WORD[status]}`, "job", m.jobId);
    return out;
  });
  return ok(u);
}

export function deleteMaterial(ctx: Ctx, id: string): Result<true> {
  const no = denied(ctx, "materials.write");
  if (no) return no;
  const m = scoped(ctx).get<Material>("materials", id);
  if (!m) return fail("not_found", "Item not found");
  tx(() => {
    scoped(ctx).remove("materials", id);
    audit(ctx, "materials.removed", `Removed ${m.item} from the order list`, "job", m.jobId);
  });
  return ok(true);
}

/* ---------------------------------- Bills ---------------------------------- */

export function listBills(ctx: Ctx): Bill[] {
  if (!can(ctx.role, "finance.read")) return [];
  return scoped(ctx).list<Bill>("bills", { order: "status, due_date" });
}

export function createBill(ctx: Ctx, input: unknown): Result<Bill> {
  const no = denied(ctx, "payments.record");
  if (no) return no;
  const parsed = billInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the bill.", fieldErrors(parsed.error.issues));
  if (parsed.data.jobId && !getJob(ctx, parsed.data.jobId)) return fail("not_found", "Job not found");
  if (parsed.data.merchantId && !scoped(ctx).get("merchants", parsed.data.merchantId)) return fail("not_found", "Merchant not found");
  const bill: Bill = { id: uid("bill"), ...parsed.data, status: "due", createdAt: now() };
  tx(() => {
    scoped(ctx).insert("bills", bill);
    audit(ctx, "bills.added", `Bill added: ${bill.supplier} ${gbp(bill.amount)}, due ${formatDayShort(bill.dueDate)}`, "bill", bill.id);
  });
  return ok(bill);
}

/**
 * Record that a bill was paid elsewhere (bank app, card) on a given date.
 * Bob never moves money. `paid: false` undoes it.
 */
export function setBillPaid(ctx: Ctx, id: string, paid: boolean, payment: unknown = {}): Result<Bill> {
  const no = denied(ctx, "payments.record");
  if (no) return no;
  const b = scoped(ctx).get<Bill>("bills", id);
  if (!b) return fail("not_found", "Bill not found");
  const p = billPaymentSchema.safeParse({ paidOn: todayKey(), ...(payment as object) });
  if (paid && !p.success) return fail("invalid", "Check the payment date.", fieldErrors(p.error.issues));
  if (paid && b.status === "paid") return fail("conflict", "That bill is already recorded as paid.");
  const u = tx(() => {
    const out = scoped(ctx).update<Bill>("bills", id, {
      status: paid ? "paid" : "due",
      paidAt: paid ? now() : (null as unknown as undefined),
      paidOn: paid && p.success ? p.data.paidOn : (null as unknown as undefined),
      paymentMethod: paid && p.success ? p.data.paymentMethod : (null as unknown as undefined),
    })!;
    audit(ctx, paid ? "bills.marked_paid" : "bills.reopened", `${b.supplier} ${gbp(b.amount)} ${paid ? "recorded as paid (outside Bob)" : "marked as not paid"}`, "bill", id);
    return out;
  });
  return ok(u);
}

/* --------------------------------- My work --------------------------------- */

export interface MyBooking {
  id: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  updatedAt: string;
  job: MyJob;
  withPeople: string[];
}
export interface MyJob {
  id: string;
  title: string;
  siteAddress: string;
  what3words?: string;
  instructions?: string;
  /** Side gate, parking, entrance. */
  accessNote?: string;
  /** First name and phone of the customer on site — only for jobs they're booked on. */
  contactName?: string;
  contactPhone?: string;
}
export interface MyWork {
  person: Pick<Person, "id" | "name" | "kind" | "trade" | "company"> | null;
  businessName: string;
  /** White wordmark for the dark header, if the business has one. */
  wordmarkOnDark?: string;
  sample: boolean;
  today: string;
  bookings: MyBooking[];
  tasks: Pick<Task, "id" | "title" | "dueDate" | "done" | "relatedId">[];
  materials: (Pick<Material, "id" | "item" | "quantity" | "status" | "neededBy"> & { jobId: string })[];
  /** Files shared with the team on these jobs (added by the My work route). */
  files?: JobFile[];
  /** Their own leave / unavailability (added by the My work route). */
  absences?: Absence[];
  generatedAt: string;
}

/**
 * Jobs an invited worker may reach right now: booked on them, ending no more
 * than a week ago. Removing them from the booking (or their access) removes it.
 */
export function workerJobIds(ctx: Ctx): Set<string> {
  const person = myPerson(ctx);
  return new Set(person ? accessibleBookings(ctx, person).map((b) => b.jobId) : []);
}

export function myPerson(ctx: Ctx): Person | undefined {
  return scoped(ctx).list<Person>("people", { where: "user_id = ? AND archived_at IS NULL", params: [ctx.userId] })[0];
}

/** Jobs this person may see: booked on it, with the booking ending no more than a week ago. */
function accessibleBookings(ctx: Ctx, person: Person): Booking[] {
  const from = addDays(todayKey(), -ACCESS_GRACE_DAYS);
  return scoped(ctx)
    .list<Booking>("bookings", { where: "COALESCE(end_date, date) >= ?", params: [from], order: "date, start_time" })
    .filter((b) => b.personIds.includes(person.id));
}

function toMyJob(ctx: Ctx, j: Job): MyJob {
  const c = getCustomer(ctx, j.customerId);
  return {
    id: j.id,
    title: j.title,
    siteAddress: j.siteAddress || j.location,
    what3words: j.what3words,
    instructions: j.sharedNotes,
    accessNote: j.accessNote,
    contactName: c?.name,
    contactPhone: c?.phone,
  };
}

/** Only this person's own booked work, upcoming first. Nothing financial, nothing unassigned. */
export function myWork(ctx: Ctx): Result<MyWork> {
  const no = denied(ctx, "mywork.read");
  if (no) return no;
  const person = myPerson(ctx);
  const base = { businessName: ctx.org.name, wordmarkOnDark: ctx.org.wordmark?.onDark, sample: ctx.org.dataMode === "sample", today: todayKey(), generatedAt: now() };
  if (!person) return ok({ ...base, person: null, bookings: [], tasks: [], materials: [] });
  const bookings = accessibleBookings(ctx, person);
  const jobIds = new Set(bookings.map((b) => b.jobId));
  const people = new Map(scoped(ctx).list<Person>("people").map((p) => [p.id, p.name]));
  const jobs = new Map<string, MyJob>();
  for (const id of jobIds) {
    const j = getJob(ctx, id);
    if (j) jobs.set(id, toMyJob(ctx, j));
  }
  const today = todayKey();
  const out: MyBooking[] = bookings
    .filter((b) => bookingEnd(b) >= today && jobs.has(b.jobId))
    .map((b) => ({
      id: b.id,
      date: b.date,
      endDate: b.endDate,
      startTime: b.startTime,
      endTime: b.endTime,
      notes: b.notes,
      updatedAt: b.updatedAt,
      job: jobs.get(b.jobId)!,
      withPeople: b.personIds.filter((p) => p !== person.id).map((p) => people.get(p) ?? "Someone"),
    }));
  const tasks = scoped(ctx)
    .list<Task>("tasks", { where: "assigned_person_id = ? AND done = 0", params: [person.id], order: "due_date" })
    .filter((t) => !t.relatedId || t.relatedType !== "job" || jobIds.has(t.relatedId))
    .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, done: t.done, relatedId: t.relatedType === "job" ? t.relatedId : undefined }));
  const materials = scoped(ctx)
    .list<Material>("materials")
    .filter((m) => jobIds.has(m.jobId))
    .map((m) => ({ id: m.id, jobId: m.jobId, item: m.item, quantity: m.quantity, status: m.status, neededBy: m.neededBy }));
  return ok({ ...base, person: { id: person.id, name: person.name, kind: person.kind, trade: person.trade, company: person.company }, bookings: out, tasks, materials });
}

/** A worker ticks off a task that was assigned to them — and only that. */
export function completeMyTask(ctx: Ctx, taskId: string, done: boolean): Result<true> {
  const no = denied(ctx, "mywork.read");
  if (no) return no;
  const person = myPerson(ctx);
  const t = scoped(ctx).get<Task>("tasks", taskId);
  if (!person || !t || t.assignedPersonId !== person.id) return fail("not_found", "Task not found");
  tx(() => {
    scoped(ctx).update<Task>("tasks", taskId, { done, completedAt: done ? now() : (null as unknown as undefined) });
    audit(ctx, done ? "task.completed" : "task.reopened", `${person.name} ${done ? "completed" : "reopened"}: ${t.title}`, "task", taskId);
  });
  return ok(true);
}
