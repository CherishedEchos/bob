import "server-only";
import { cookies } from "next/headers";
import type { AppUser, OrgConfig, Role } from "@/lib/types";
import { getDb } from "@/server/db";
import { HttpError, type Ctx } from "@/server/context";
import { randomToken, sha256, verifyPassword } from "./password";

/**
 * Local session auth (used when Supabase is not configured).
 * - Passwords: scrypt hashes.
 * - Sessions: random 256-bit token in an httpOnly, SameSite=Lax cookie
 *   (Secure in production); only its SHA-256 is stored in the database.
 * - Login is rate limited per email.
 * With Supabase configured, swap this module for Supabase Auth — everything
 * else consumes the same `Ctx`.
 */

export const SESSION_COOKIE = "bob_session";
const SESSION_DAYS = 14;
const MAX_ATTEMPTS = 8;
const WINDOW_MIN = 15;

interface MembershipRow {
  org_id: string;
  role: Role;
  config: string;
}

export function membershipsFor(userId: string) {
  const rows = getDb()
    .prepare("SELECT m.org_id, m.role, o.config FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.created_at")
    .all(userId) as unknown as MembershipRow[];
  return rows.map((r) => ({ orgId: r.org_id, role: r.role, org: JSON.parse(r.config) as OrgConfig }));
}

function rateLimited(key: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT count, window_start FROM login_attempts WHERE key = ?").get(key) as
    | { count: number; window_start: string }
    | undefined;
  if (!row) return false;
  const expired = Date.now() - new Date(row.window_start).getTime() > WINDOW_MIN * 60_000;
  if (expired) {
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
    return false;
  }
  return row.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  getDb()
    .prepare(
      "INSERT INTO login_attempts (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
    )
    .run(key, new Date().toISOString());
}

export type LoginResult = { ok: true; token: string; expires: Date } | { ok: false; error: string; status: number };

export function authenticate(email: string, password: string, orgId?: string): LoginResult {
  const key = `email:${email.trim().toLowerCase()}`;
  if (rateLimited(key)) return { ok: false, error: "Too many attempts. Wait 15 minutes and try again.", status: 429 };
  const db = getDb();
  const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email.trim().toLowerCase()) as
    | { id: string; password_hash: string }
    | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailure(key);
    return { ok: false, error: "That email and password don't match.", status: 401 };
  }
  db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
  const memberships = membershipsFor(user.id);
  const chosen = orgId ? memberships.find((m) => m.orgId === orgId) : memberships[0];
  if (!chosen) return { ok: false, error: "This account isn't a member of any business yet.", status: 403 };
  return createSession(user.id, chosen.orgId);
}

export function createSession(userId: string, orgId: string): LoginResult {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  getDb()
    .prepare("INSERT INTO sessions (token_hash, user_id, org_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sha256(token), userId, orgId, new Date().toISOString(), expires.toISOString());
  return { ok: true, token, expires };
}

export function destroySession(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** Resolve a raw session token into a request context (or null). */
export function contextFromToken(token: string | undefined, via: Ctx["via"] = "dashboard"): Ctx | null {
  if (!token) return null;
  const db = getDb();
  const s = db.prepare("SELECT user_id, org_id, expires_at FROM sessions WHERE token_hash = ?").get(sha256(token)) as
    | { user_id: string; org_id: string; expires_at: string }
    | undefined;
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    return null;
  }
  // Membership is re-checked on every request: removing a user from an
  // organisation takes effect immediately.
  const m = db
    .prepare("SELECT m.role, o.config, u.name FROM memberships m JOIN orgs o ON o.id = m.org_id JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND m.org_id = ?")
    .get(s.user_id, s.org_id) as { role: Role; config: string; name: string } | undefined;
  if (!m) return null;
  return { orgId: s.org_id, userId: s.user_id, userName: m.name, role: m.role, org: JSON.parse(m.config), via };
}

export async function getContext(via: Ctx["via"] = "dashboard"): Promise<Ctx | null> {
  const jar = await cookies();
  return contextFromToken(jar.get(SESSION_COOKIE)?.value, via);
}

export async function requireContext(via: Ctx["via"] = "dashboard"): Promise<Ctx> {
  const ctx = await getContext(via);
  if (!ctx) throw new HttpError(401, "Please sign in.");
  return ctx;
}

export function usersInOrg(orgId: string): AppUser[] {
  return (
    getDb()
      .prepare("SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.name")
      .all(orgId) as unknown as AppUser[]
  ).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
}

export function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && process.env.BOB_INSECURE_COOKIES !== "true",
    path: "/",
    expires,
  };
}
