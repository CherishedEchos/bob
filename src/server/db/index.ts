/**
 * Local database (demo / development).
 *
 * Uses Node's built-in SQLite so the app runs with zero external services.
 * Production uses Supabase Postgres with the SAME tables and columns (see
 * supabase/migrations/0002_bob_multitenant.sql) plus row-level security.
 *
 * Isolation rule: business tables are only reachable through `scoped(ctx)`,
 * which binds `org_id` from the authenticated server-side context into every
 * statement. Nothing in the request body can choose the organisation.
 */
import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { seedAll, upgradeSampleData } from "./seed";
import { provisionWorkspaces } from "./provision";

type ColType = "text" | "real" | "bool" | "json";

/** Business tables. Keys are camelCase TS fields, stored as snake_case columns. */
export const TABLES = {
  customers: {
    name: "text", email: "text", phone: "text", instagramHandle: "text", address: "text", town: "text",
    notes: "json", createdAt: "text",
  },
  enquiries: {
    customerId: "text", customerName: "text", email: "text", phone: "text", instagramHandle: "text",
    source: "text", provider: "text", externalThreadId: "text", title: "text", description: "text",
    location: "text", receivedAt: "text", status: "text", priority: "text", assignedUserId: "text",
    followUpDate: "text", lastContactAt: "text", jobId: "text", notes: "json", messages: "json",
    draftReply: "text", suggestedReply: "text",
  },
  jobs: {
    customerId: "text", title: "text", description: "text", location: "text", kind: "text",
    quotedValue: "real", depositRequired: "real", status: "text", startDate: "text", depositDueDate: "text",
    nextAction: "text", notes: "json", enquiryId: "text", lastChasedAt: "text", createdAt: "text",
    siteAddress: "text", what3words: "text", sharedNotes: "text", accessNote: "text",
  },
  quotes: {
    customerId: "text", jobId: "text", enquiryId: "text", description: "text", amount: "real", status: "text",
    sentAt: "text", respondedAt: "text", followUpDate: "text", createdAt: "text",
  },
  invoices: {
    customerId: "text", jobId: "text", draftRef: "text", number: "text", status: "text", lines: "json",
    amountsAre: "text", vatRate: "real", subtotal: "real", vat: "real", total: "real", issueDate: "text",
    dueDate: "text", amountPaid: "real", provider: "text", externalId: "text", sentAt: "text", paidAt: "text",
    lastSyncedAt: "text", createdAt: "text", createdBy: "text",
  },
  payments: {
    jobId: "text", invoiceId: "text", amount: "real", type: "text", method: "text", receivedAt: "text",
    reference: "text", recordedBy: "text", recordedAt: "text",
  },
  expenses: {
    jobId: "text", amount: "real", category: "text", description: "text", incurredOn: "text",
    recordedBy: "text", createdAt: "text",
  },
  photos: {
    relatedType: "text", relatedId: "text", caption: "text", mimeType: "text", data: "text", width: "real", height: "real",
    bytes: "real", createdAt: "text", createdBy: "text",
  },
  tasks: {
    title: "text", dueDate: "text", done: "bool", customerId: "text", relatedType: "text", relatedId: "text",
    assignedUserId: "text", createdAt: "text", createdBy: "text", completedAt: "text", assignedPersonId: "text", priority: "text",
  },
  people: {
    name: "text", kind: "text", company: "text", trade: "text", phone: "text", email: "text", userId: "text",
    archivedAt: "text", createdAt: "text",
  },
  bookings: {
    jobId: "text", date: "text", endDate: "text", startTime: "text", endTime: "text", personIds: "json", notes: "text",
    createdAt: "text", updatedAt: "text", createdBy: "text",
  },
  materials: {
    jobId: "text", item: "text", quantity: "text", supplier: "text", neededBy: "text", status: "text",
    createdAt: "text", updatedAt: "text", unit: "text", merchantId: "text", orderRef: "text", expectedDelivery: "text", notes: "text",
  },
  bills: {
    supplier: "text", description: "text", amount: "real", dueDate: "text", status: "text", jobId: "text",
    reference: "text", paidAt: "text", createdAt: "text", merchantId: "text", paidOn: "text", paymentMethod: "text",
  },
  merchants: {
    name: "text", branch: "text", phone: "text", email: "text", website: "text", notes: "text", accountRef: "text",
    passwordManagerUrl: "text", accessManagedBy: "text", archivedAt: "text", createdAt: "text",
  },
  job_files: {
    jobId: "text", enquiryId: "text", category: "text", title: "text", filename: "text", mimeType: "text", bytes: "real",
    description: "text", revision: "text", groupId: "text", visibility: "text", previewable: "bool", hasThumb: "bool",
    width: "real", height: "real", uploadedBy: "text", uploadedByUserId: "text", createdAt: "text", deletedAt: "text",
    deletedBy: "text", checksum: "text", clientRef: "text", updateId: "text", reportId: "text",
  },
  job_updates: {
    jobId: "text", note: "text", stage: "text", authorName: "text", authorUserId: "text", createdAt: "text", updatedAt: "text",
    clientRef: "text", deletedAt: "text",
  },
  variations: {
    jobId: "text", description: "text", amount: "real", amountsAre: "text", status: "text", invoiceId: "text", approvedAt: "text",
    createdAt: "text", createdBy: "text",
  },
  handover_reports: {
    jobId: "text", selection: "json", content: "json", revision: "real", aiStatus: "text", aiNote: "text", createdBy: "text",
    createdAt: "text", updatedBy: "text", updatedAt: "text",
  },
  report_versions: {
    reportId: "text", jobId: "text", version: "real", fileId: "text", filename: "text", pages: "real", createdBy: "text", createdAt: "text",
    content: "json",
  },
  handovers: {
    jobId: "text", title: "text", jobTitle: "text", siteAddress: "text", completionDate: "text", message: "text",
    items: "json", createdAt: "text", createdBy: "text", downloads: "real",
  },
  absences: {
    personId: "text", kind: "text", startDate: "text", endDate: "text", part: "text", status: "text", reason: "text",
    requestedBy: "text", requestedByUserId: "text", decidedBy: "text", decidedAt: "text", createdAt: "text", updatedAt: "text",
  },
  activity: {
    at: "text", actor: "text", via: "text", action: "text", summary: "text", entityType: "text", entityId: "text",
  },
} satisfies Record<string, Record<string, ColType>>;

export type TableName = keyof typeof TABLES;

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

function businessDDL(): string {
  return (Object.keys(TABLES) as TableName[])
    .map((t) => {
      const cols = Object.entries(TABLES[t] as Record<string, ColType>)
        .map(([k, type]) => `${snake(k)} ${type === "real" ? "REAL" : type === "bool" ? "INTEGER" : "TEXT"}`)
        .join(",\n  ");
      return `CREATE TABLE IF NOT EXISTS ${t} (\n  id TEXT PRIMARY KEY,\n  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,\n  ${cols}\n);\nCREATE INDEX IF NOT EXISTS ${t}_org_idx ON ${t}(org_id);`;
    })
    .join("\n");
}

const SYSTEM_DDL = `
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','office','staff','worker')),
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_user_id TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS invites_org_person_idx ON invites(org_id, person_id);
CREATE TABLE IF NOT EXISTS calendar_feeds (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('company','person')),
  person_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS calendar_feeds_org_user_idx ON calendar_feeds(org_id, user_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_org_user_idx ON conversations(org_id, user_id, updated_at);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_messages_conv_idx ON conversation_messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS bob_actions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  origin TEXT NOT NULL,
  tool TEXT NOT NULL,
  category TEXT NOT NULL,
  args TEXT NOT NULL,
  view TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result TEXT,
  error TEXT,
  undo TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bob_actions_org_idx ON bob_actions(org_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS bob_actions_idem_idx ON bob_actions(org_id, idempotency_key);
CREATE INDEX IF NOT EXISTS bob_actions_hash_idx ON bob_actions(org_id, payload_hash, created_at);
CREATE TABLE IF NOT EXISTS connections (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  account_label TEXT,
  token_enc TEXT,
  meta TEXT,
  last_sync_at TEXT,
  error TEXT,
  PRIMARY KEY (org_id, provider)
);
CREATE TABLE IF NOT EXISTS imported_messages (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  enquiry_id TEXT,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (org_id, provider, external_id)
);
CREATE TABLE IF NOT EXISTS file_blobs (
  file_id TEXT NOT NULL,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('original','thumb')),
  data BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, file_id, kind)
);
CREATE TABLE IF NOT EXISTS counters (
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (org_id, name)
);
`;

declare global {
   
  var __bobDb: DatabaseSync | undefined;
}

function defaultPath(): string {
  if (process.env.BOB_DB_PATH) return process.env.BOB_DB_PATH;
  if (process.env.VERCEL) return "/tmp/bob.sqlite";
  return path.join(process.cwd(), ".data", "bob.sqlite");
}

/** Open (and migrate/seed on first use) the local database. */
export function getDb(): DatabaseSync {
  if (globalThis.__bobDb) return globalThis.__bobDb;
  const file = defaultPath();
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  initDb(db);
  globalThis.__bobDb = db;
  return db;
}

export function initDb(db: DatabaseSync) {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  migrate(db);
  db.exec(SYSTEM_DDL);
  db.exec(businessDDL());
  addMissingColumns(db);
  // A retried upload (same client reference) never creates a second file.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS job_files_client_ref_idx ON job_files(org_id, client_ref) WHERE client_ref IS NOT NULL");
  db.exec("CREATE INDEX IF NOT EXISTS job_files_job_idx ON job_files(org_id, job_id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS job_updates_client_ref_idx ON job_updates(org_id, client_ref) WHERE client_ref IS NOT NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS report_versions_num_idx ON report_versions(org_id, report_id, version)");
  db.exec("CREATE INDEX IF NOT EXISTS absences_person_idx ON absences(org_id, person_id, start_date)");
  const row = db.prepare("SELECT COUNT(*) AS n FROM orgs").get() as { n: number };
  if (row.n === 0) {
    seedAll(db, insertRaw);
  } else {
    // Existing databases: give sample workspaces the new demo records (team,
    // schedule, materials, bills) once. Live workspaces are never touched.
    upgradeSampleData(db, insertRaw);
  }
  migrateJobPhotos(db);
  provisionWorkspaces(db);
  addNinety3Wordmark(db);
}

/**
 * Schema migrations for existing databases. Additive only: nothing is dropped
 * and every existing row is kept. Recorded in PRAGMA user_version.
 */
export const SCHEMA_VERSION = 5;
function migrate(db: DatabaseSync) {
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const hasMemberships = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memberships'").get();
  if (version < 2 && hasMemberships) {
    // v2: allow the 'worker' role. SQLite can't alter a CHECK constraint, so
    // the memberships table is rebuilt with every row copied across.
    const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE name='memberships'").get() as { sql: string }).sql;
    if (!ddl.includes("'worker'")) {
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(`BEGIN;
        CREATE TABLE memberships_v2 (
          org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('owner','office','staff','worker')),
          PRIMARY KEY (org_id, user_id)
        );
        INSERT INTO memberships_v2 (org_id, user_id, role) SELECT org_id, user_id, role FROM memberships;
        DROP TABLE memberships;
        ALTER TABLE memberships_v2 RENAME TO memberships;
        COMMIT;`);
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * v4: site photos filed against a job or enquiry become files (category
 * "Progress photos"), so they show in Files & photos and can go into a
 * handover. The photo rows are kept; this copy runs once per photo
 * (client_ref "photo:<id>").
 */
function migrateJobPhotos(db: DatabaseSync) {
  const rows = db
    .prepare("SELECT p.* FROM photos p WHERE p.related_type IN ('job','enquiry') AND NOT EXISTS (SELECT 1 FROM job_files f WHERE f.org_id = p.org_id AND f.client_ref = 'photo:' || p.id)")
    .all() as Record<string, string | number | null>[];
  if (!rows.length) return;
  db.exec("BEGIN");
  try {
    for (const p of rows) {
      const id = `fil_${String(p.id).replace(/^pho_?/, "")}`;
      const data = Buffer.from(String(p.data ?? ""), "base64");
      insertRaw(db, "job_files", String(p.org_id), {
        id, jobId: p.related_type === "job" ? p.related_id : undefined, enquiryId: p.related_type === "enquiry" ? p.related_id : undefined, category: "progress", title: p.caption ?? undefined, filename: `photo-${String(p.created_at).slice(0, 10)}.jpg`,
        mimeType: String(p.mime_type), bytes: data.length, groupId: id, visibility: "team", previewable: true, hasThumb: false,
        width: p.width ?? undefined, height: p.height ?? undefined, uploadedBy: p.created_by ?? "Someone", createdAt: p.created_at, clientRef: `photo:${p.id}`,
      } as { id: string });
      db.prepare("INSERT OR IGNORE INTO file_blobs (file_id, org_id, kind, data, created_at) VALUES (?, ?, 'original', ?, ?)").run(id, String(p.org_id), data, String(p.created_at));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Ninety3 workspaces created before the wordmark existed (the live one and the
 * demo) get it once. Only sets a missing field; nothing else in the config changes.
 */
function addNinety3Wordmark(db: DatabaseSync) {
  const rows = db.prepare("SELECT id, config FROM orgs").all() as { id: string; config: string }[];
  for (const r of rows) {
    const c = JSON.parse(r.config) as { logoUrl?: string; wordmark?: unknown; brandColor?: string };
    if (c.logoUrl !== "/brand/ninety3-logo.png" || (c.wordmark && c.brandColor)) continue;
    const next = { ...c, wordmark: c.wordmark ?? { onDark: "/brand/ninety3-wordmark-white.png", onLight: "/brand/ninety3-wordmark.png" }, brandColor: c.brandColor ?? "#7B2001" };
    db.prepare("UPDATE orgs SET config = ? WHERE id = ?").run(JSON.stringify(next), r.id);
  }
}

/** New columns on existing business tables (e.g. jobs.site_address). */
function addMissingColumns(db: DatabaseSync) {
  for (const t of Object.keys(TABLES) as TableName[]) {
    const have = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
    for (const [k, type] of Object.entries(TABLES[t] as Record<string, ColType>)) {
      const col = snake(k);
      if (!have.has(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${type === "real" ? "REAL" : type === "bool" ? "INTEGER" : "TEXT"}`);
    }
  }
}

/** Replace the global DB (tests). */
export function setDbForTests(db: DatabaseSync | undefined) {
  globalThis.__bobDb = db;
}

/** Run fn inside a transaction (all-or-nothing). Re-entrant. */
let txDepth = 0;
export function tx<T>(fn: () => T): T {
  const db = getDb();
  if (txDepth > 0) return fn();
  db.exec("BEGIN IMMEDIATE");
  txDepth++;
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    txDepth--;
  }
}

/* ------------------------------ Row mapping ------------------------------ */

type Row = Record<string, unknown>;

function toRow(table: TableName, obj: Row): Row {
  const spec = TABLES[table] as Record<string, ColType>;
  const out: Row = {};
  for (const [k, type] of Object.entries(spec)) {
    if (!(k in obj)) continue;
    const v = obj[k];
    out[snake(k)] =
      v === undefined || v === null ? null : type === "json" ? JSON.stringify(v) : type === "bool" ? (v ? 1 : 0) : v;
  }
  return out;
}

function fromRow<T>(table: TableName, row: Row): T {
  const spec = TABLES[table] as Record<string, ColType>;
  const out: Row = { id: row.id };
  for (const [k, type] of Object.entries(spec)) {
    const v = row[snake(k)];
    if (v === null || v === undefined) {
      if (type === "json") out[k] = [];
      if (type === "bool") out[k] = false;
      continue;
    }
    out[k] = type === "json" ? JSON.parse(v as string) : type === "bool" ? v === 1 : v;
  }
  return out as T;
}

export interface OrgScope {
  orgId: string;
}

type SqlParam = string | number | null;

/**
 * Org-scoped data access. `where` fragments are internal (never user text);
 * values are always bound parameters.
 */
export function scoped(ctx: OrgScope) {
  const db = getDb();
  const orgId = ctx.orgId;
  if (!orgId) throw new Error("Missing organisation scope");

  return {
    list<T>(table: TableName, opts: { where?: string; params?: SqlParam[]; order?: string; limit?: number } = {}): T[] {
      const sql = `SELECT * FROM ${table} WHERE org_id = ?${opts.where ? ` AND (${opts.where})` : ""}${
        opts.order ? ` ORDER BY ${opts.order}` : ""
      }${opts.limit ? ` LIMIT ${Math.floor(opts.limit)}` : ""}`;
      return (db.prepare(sql).all(orgId, ...(opts.params ?? [])) as Row[]).map((r) => fromRow<T>(table, r));
    },
    get<T>(table: TableName, id: string): T | undefined {
      const row = db.prepare(`SELECT * FROM ${table} WHERE org_id = ? AND id = ?`).get(orgId, id) as Row | undefined;
      return row ? fromRow<T>(table, row) : undefined;
    },
    insert<T extends { id: string }>(table: TableName, obj: T): T {
      const row = toRow(table, obj as unknown as Row);
      const cols = ["id", "org_id", ...Object.keys(row)];
      const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      db.prepare(sql).run(obj.id, orgId, ...(Object.values(row) as SqlParam[]));
      return obj;
    },
    update<T>(table: TableName, id: string, patch: Partial<T>): T | undefined {
      const row = toRow(table, patch as Row);
      const keys = Object.keys(row);
      if (keys.length) {
        const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE org_id = ? AND id = ?`;
        db.prepare(sql).run(...(Object.values(row) as SqlParam[]), orgId, id);
      }
      return this.get<T>(table, id);
    },
    remove(table: TableName, id: string): boolean {
      const res = db.prepare(`DELETE FROM ${table} WHERE org_id = ? AND id = ?`).run(orgId, id);
      return Number(res.changes) > 0;
    },
    /** Aggregate helper for reports: SELECT <expr> FROM table WHERE org scoped. */
    aggregate<T extends Row>(table: TableName, select: string, opts: { where?: string; params?: SqlParam[]; group?: string } = {}): T[] {
      const sql = `SELECT ${select} FROM ${table} WHERE org_id = ?${opts.where ? ` AND (${opts.where})` : ""}${
        opts.group ? ` GROUP BY ${opts.group}` : ""
      }`;
      return db.prepare(sql).all(orgId, ...(opts.params ?? [])) as T[];
    },
    nextCounter(name: string): number {
      db.prepare(
        "INSERT INTO counters (org_id, name, value) VALUES (?, ?, 1) ON CONFLICT(org_id, name) DO UPDATE SET value = value + 1",
      ).run(orgId, name);
      return (db.prepare("SELECT value FROM counters WHERE org_id = ? AND name = ?").get(orgId, name) as { value: number }).value;
    },
  };
}

export type Scoped = ReturnType<typeof scoped>;

/** Raw insert used by the seeder (runs before the global DB is set). */
export function insertRaw(db: DatabaseSync, table: TableName, orgId: string, obj: { id: string }) {
  const row = toRow(table, obj as unknown as Row);
  const cols = ["id", "org_id", ...Object.keys(row)];
  db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
    obj.id,
    orgId,
    ...(Object.values(row) as SqlParam[]),
  );
}
