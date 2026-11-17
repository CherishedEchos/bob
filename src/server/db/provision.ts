/**
 * Add a new company without a code change.
 *
 * Set BOB_WORKSPACES_FILE to a JSON file listing workspaces (see
 * docs/workspaces.example.json). On start-up each one that doesn't exist yet
 * is created with its own name, logo, colours and settings, starting empty
 * ("live" data), and a one-time owner setup link is printed to the server log.
 * The link works once, only for the owner email given, and expires in 7 days.
 * Existing workspaces are never changed by this file.
 */
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import type { OrgConfig } from "@/lib/types";

interface WorkspaceSpec {
  slug: string;
  name: string;
  shortName?: string;
  ownerEmail: string;
  tradeType?: string;
  logoUrl?: string;
  accent?: string;
  services?: string[];
  serviceArea?: string[];
  timeZone?: string;
  contact?: OrgConfig["contact"];
  signOff?: string;
}

export function provisionWorkspaces(db: DatabaseSync, file = process.env.BOB_WORKSPACES_FILE): { created: { slug: string; setupPath: string }[] } {
  const created: { slug: string; setupPath: string }[] = [];
  if (!file) return { created };
  let specs: WorkspaceSpec[];
  try {
    specs = JSON.parse(fs.readFileSync(file, "utf8")) as WorkspaceSpec[];
  } catch (e) {
    console.error(`[bob] Couldn't read BOB_WORKSPACES_FILE (${file}):`, e instanceof Error ? e.message : e);
    return { created };
  }
  for (const w of Array.isArray(specs) ? specs : []) {
    if (!w?.slug || !/^[a-z0-9-]{2,40}$/.test(w.slug) || !w.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w.ownerEmail ?? "")) {
      console.error(`[bob] Skipped a workspace in BOB_WORKSPACES_FILE: needs slug (a-z, 0-9, -), name and ownerEmail.`);
      continue;
    }
    if (db.prepare("SELECT 1 FROM orgs WHERE slug = ?").get(w.slug)) continue;
    const id = `org_${w.slug.replace(/-/g, "_")}`;
    const now = new Date().toISOString();
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
    const token = randomBytes(32).toString("base64url");
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO orgs (id, slug, config, created_at) VALUES (?, ?, ?, ?)").run(id, w.slug, JSON.stringify(config), now);
      db.prepare("INSERT INTO invites (id, org_id, person_id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, '', ?, 'owner', ?, 'provisioning', ?, ?)").run(
        `inv_owner_${w.slug}`, id, w.ownerEmail.toLowerCase(), createHash("sha256").update(token).digest("hex"), now, new Date(Date.now() + 7 * 864e5).toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    created.push({ slug: w.slug, setupPath: `/invite/${token}` });
    console.log(`[bob] Created workspace "${w.name}". Owner setup link (works once, for ${w.ownerEmail}, 7 days): ${process.env.BOB_PUBLIC_URL ?? ""}/invite/${token}`);
  }
  return { created };
}
