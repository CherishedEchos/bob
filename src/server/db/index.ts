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
import { seedAll } from "./seed";

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
  tasks: {
    title: "text", dueDate: "text", done: "bool", customerId: "text", relatedType: "text", relatedId: "text",
    assignedUserId: "text", createdAt: "text", createdBy: "text", completedAt: "text",
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
  role TEXT NOT NULL CHECK (role IN ('owner','office','staff')),
  PRIMARY KEY (org_id, user_id)
);
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
CREATE TABLE IF NOT EXISTS counters (
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (org_id, name)
);
`;

declare global {
  // eslint-disable-next-line no-var
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
  db.exec(SYSTEM_DDL);
  db.exec(businessDDL());
  const row = db.prepare("SELECT COUNT(*) AS n FROM orgs").get() as { n: number };
  if (row.n === 0) {
    seedAll(db, insertRaw);
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
