/**
 * Add a real company without a code change.
 *
 * Set BOB_WORKSPACES_FILE to a JSON file listing workspaces (see
 * docs/workspaces.example.json). The file lives on the server (e.g. a Render
 * Secret File) and is never committed: it holds people's login emails.
 *
 * On start-up:
 *  - each workspace that doesn't exist yet is created with its own name, logo,
 *    contact details and time zone, starting EMPTY ("live" data — no demo
 *    jobs, customers, merchants or money);
 *  - each person under `users` gets a Team record (so they can be booked) the
 *    first time they appear;
 *  - each of those people with an email and no login yet gets a one-time
 *    invite link (role owner or office), printed to the server log. The link
 *    works once, only for that email, and expires in 7 days. A new link is only
 *    printed when there's no unexpired one, so restarts don't break links you
 *    have already sent (set "newLink": true on a user to replace a lost one). People without an email are listed in the log as
 *    "waiting for an email".
 * An existing workspace's name, branding and settings are never changed by
 * this file — edit those in Settings → Business profile.
 */
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import type { OrgConfig } from "@/lib/types";

type InviteRole = "owner" | "office";

interface WorkspaceUser {
  name: string;
  email?: string;
  role: InviteRole;
  /**
   * Cancel an unused link and print a fresh one on this start (e.g. the first
   * was lost). Remove it again afterwards, or every restart makes a new link.
   */
  newLink?: boolean;
  /** From the older `ownerEmail` form: no Team record, as before. */
  noTeamRecord?: boolean;
}

interface WorkspaceSpec {
  slug: string;
  name: string;
  shortName?: string;
  /** Older single-owner form. Same as users: [{ name, email: ownerEmail, role: "owner" }]. */
  ownerEmail?: string;
  users?: WorkspaceUser[];
  tradeType?: string;
  logoUrl?: string;
  accent?: string;
  services?: string[];
  serviceArea?: string[];
  timeZone?: string;
  contact?: OrgConfig["contact"];
  signOff?: string;
}

export interface ProvisionResult {
  created: { slug: string; setupPath: string }[];
  workspaces: string[];
  invites: { slug: string; name: string; role: InviteRole; email: string; path: string }[];
  waitingForEmail: { slug: string; name: string; role: InviteRole }[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const rid = (p: string) => `${p}_${randomBytes(9).toString("base64url")}`;

/** Never log a whole email: "l***@example.com". */
const maskEmail = (e: string) => e.replace(/^(.)[^@]*/, "$1***");

export function provisionWorkspaces(db: DatabaseSync, file = process.env.BOB_WORKSPACES_FILE): ProvisionResult {
  const out: ProvisionResult = { created: [], workspaces: [], invites: [], waitingForEmail: [] };
  if (!file) return out;
  let specs: WorkspaceSpec[];
  try {
    specs = JSON.parse(fs.readFileSync(file, "utf8")) as WorkspaceSpec[];
  } catch (e) {
    console.error(`[bob] Couldn't read BOB_WORKSPACES_FILE (${file}):`, e instanceof Error ? e.message : e);
    return out;
  }
  const base = process.env.BOB_PUBLIC_URL ?? "";
  for (const w of Array.isArray(specs) ? specs : []) {
    if (!w?.slug || !/^[a-z0-9-]{2,40}$/.test(w.slug) || !w.name) {
      console.error(`[bob] Skipped a workspace in BOB_WORKSPACES_FILE: needs a slug (a-z, 0-9, -) and a name.`);
      continue;
    }
    const users: WorkspaceUser[] = [...(w.users ?? [])];
    if (w.ownerEmail && !users.some((u) => (u.email ?? "").toLowerCase() === w.ownerEmail!.toLowerCase())) users.unshift({ name: w.ownerEmail.split("@")[0], email: w.ownerEmail, role: "owner", noTeamRecord: true });
    const bad = users.find((u) => !u?.name?.trim() || (u.role !== "owner" && u.role !== "office") || (u.email && !EMAIL.test(u.email)));
    if (bad) {
      console.error(`[bob] Skipped workspace "${w.slug}": each user needs a name, role "owner" or "office", and a valid email (or leave email out until you have it).`);
      continue;
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      let org = db.prepare("SELECT id, config FROM orgs WHERE slug = ?").get(w.slug) as { id: string; config: string } | undefined;
      const now = new Date().toISOString();
      if (!org) {
        const id = `org_${w.slug.replace(/-/g, "_")}`;
        const config: OrgConfig = {
          id,
          slug: w.slug,
          name: w.name,
          shortName: w.shortName ?? w.name.split(/\s+/)[0],
          tradeType: w.tradeType ?? "Building & carpentry",
          logoUrl: w.logoUrl,
          accent: w.accent ?? "#E4752F",
          services: w.services ?? [],
          serviceArea: w.serviceArea ?? [],
          workingHours: { days: "Mon–Fri", start: "08:00", end: "17:00" },
          contact: w.contact ?? {},
          assistant: { name: "Bob", signOff: w.signOff ?? `Thanks,\n${w.shortName ?? w.name}`, tone: "friendly", readAloudDefault: true },
          finance: { vatRegistered: null, vatRate: null, defaultPaymentTermsDays: null },
          dataMode: "live",
          isDemo: false,
          retention: { closedEnquiryMonths: 24, conversationDays: 90 },
          timeZone: w.timeZone ?? "Europe/London",
        };
        db.prepare("INSERT INTO orgs (id, slug, config, created_at) VALUES (?, ?, ?, ?)").run(id, w.slug, JSON.stringify(config), now);
        db.prepare("INSERT INTO activity (id, org_id, at, actor, via, action, summary, entity_type, entity_id) VALUES (?, ?, ?, 'Provisioning', 'system', 'org.created', ?, NULL, NULL)").run(
          rid("act"), id, now, `${w.name} workspace created (live data, no sample records)`,
        );
        org = { id, config: JSON.stringify(config) };
        console.log(`[bob] Created live workspace "${w.name}" (${w.slug}).`);
      }
      const orgId = org.id;
      out.workspaces.push(w.slug);

      for (const u of users) {
        const name = u.name.trim();
        const email = u.email?.trim().toLowerCase();
        // 1) A Team record, so they can be booked and assigned. Matched by email, then name.
        let person: { id: string; user_id: string | null } | undefined = u.noTeamRecord ? { id: "", user_id: null } : undefined;
        if (!u.noTeamRecord) person = (email ? db.prepare("SELECT id, user_id FROM people WHERE org_id = ? AND lower(email) = ?").get(orgId, email) : undefined) as { id: string; user_id: string | null } | undefined;
        if (!u.noTeamRecord) person ??= db.prepare("SELECT id, user_id FROM people WHERE org_id = ? AND lower(name) = lower(?) AND archived_at IS NULL").get(orgId, name) as { id: string; user_id: string | null } | undefined;
        if (!person) {
          const pid = rid("per");
          db.prepare("INSERT INTO people (id, org_id, name, kind, email, created_at) VALUES (?, ?, ?, 'employee', ?, ?)").run(pid, orgId, name, email ?? null, now);
          person = { id: pid, user_id: null };
        } else if (email && person.id) {
          db.prepare("UPDATE people SET email = COALESCE(email, ?) WHERE org_id = ? AND id = ?").run(email, orgId, person.id);
        }

        if (!email) {
          out.waitingForEmail.push({ slug: w.slug, name, role: u.role });
          console.log(`[bob] ${w.name}: ${name} (${u.role === "owner" ? "owner" : "admin"}) is waiting for an email — add it to BOB_WORKSPACES_FILE and restart to get their invite link.`);
          continue;
        }
        // 2) Already signed up? Nothing to do.
        const member = db.prepare("SELECT 1 FROM memberships m JOIN users x ON x.id = m.user_id WHERE m.org_id = ? AND x.email = ?").get(orgId, email);
        if (member || person.user_id) continue;
        // 3) A link that still works was already issued: keep it (you may have sent it),
        //    unless asked for a new one.
        if (u.newLink) db.prepare("UPDATE invites SET revoked_at = ? WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL").run(now, orgId, email);
        const live = db.prepare("SELECT 1 FROM invites WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?").get(orgId, email, now);
        if (live) continue;
        // 4) Issue a new single-use link. Only its hash is stored.
        const token = randomBytes(32).toString("base64url");
        db.prepare("INSERT INTO invites (id, org_id, person_id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'provisioning', ?, ?)").run(
          rid("inv"), orgId, person.id, email, u.role, sha256(token), now, new Date(Date.now() + 7 * 864e5).toISOString(),
        );
        const path = `/invite/${token}`;
        out.invites.push({ slug: w.slug, name, role: u.role, email, path });
        if (u.role === "owner") out.created.push({ slug: w.slug, setupPath: path });
        console.log(`[bob] ${w.name}: invite link for ${name} (${u.role === "owner" ? "owner" : "admin"}, ${maskEmail(email)}) — works once, 7 days: ${base}${path}`);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return out;
}
