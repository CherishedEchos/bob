import "server-only";
/**
 * Storage durability and backups.
 *
 * Everything Bob keeps — accounts, jobs, schedules, leave, documents, photos
 * and videos — lives in ONE SQLite file (uploaded files are stored as blobs in
 * the `file_blobs` table, in the same transaction as their metadata). So:
 *  - durability = that file sitting on storage that survives restarts and
 *    redeploys (on Render: a persistent disk, with BOB_DB_PATH pointing at it);
 *  - a backup = a consistent copy of that one file (VACUUM INTO, safe while the
 *    app is running), which includes every file's bytes.
 *
 * Bob can't detect a persistent disk by itself, so the operator declares it with
 * BOB_PERSISTENT_STORAGE=true once the disk is attached. Until then, a live
 * workspace shows a clear warning to its owner and admins.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDb } from "./index";

export interface StorageStatus {
  /** The operator has declared the database is on persistent storage. */
  persistent: boolean;
  /** Where the database file is (shown to Cresaro admins only). */
  path: string;
  /** Live (non-sample) workspaces on this server. */
  liveWorkspaces: number;
  /** A live workspace exists but storage isn't declared persistent: records could be lost on redeploy. */
  atRisk: boolean;
  databaseBytes: number;
  fileBytes: number;
  files: number;
}

export function dbPath(): string {
  if (process.env.BOB_DB_PATH) return process.env.BOB_DB_PATH;
  if (process.env.VERCEL) return "/tmp/bob.sqlite";
  return path.join(process.cwd(), ".data", "bob.sqlite");
}

/** Cheap check for every request: has the operator declared persistent storage? */
export function storagePersistent(): boolean {
  return process.env.BOB_PERSISTENT_STORAGE === "true" && !!process.env.BOB_DB_PATH;
}

export function storageStatus(): StorageStatus {
  const db = getDb();
  const persistent = storagePersistent();
  const live = (db.prepare("SELECT config FROM orgs").all() as { config: string }[]).filter((r) => (JSON.parse(r.config) as { dataMode?: string }).dataMode === "live").length;
  const files = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS b FROM file_blobs WHERE kind = 'original'").get() as { n: number; b: number };
  let databaseBytes = 0;
  try {
    databaseBytes = fs.statSync(dbPath()).size;
  } catch {
    /* in-memory (tests) */
  }
  return { persistent, path: dbPath(), liveWorkspaces: live, atRisk: live > 0 && !persistent, databaseBytes, fileBytes: Number(files.b), files: Number(files.n) };
}

/**
 * Write a consistent copy of the whole database (records and files) to `dest`.
 * Safe while the app is running. Returns what was copied, checked by reopening it.
 */
export function backupTo(dest: string, source: DatabaseSync = getDb()): { path: string; bytes: number; orgs: number; files: number; integrity: string } {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists`);
  source.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  return verifyBackup(dest);
}

/** Open a backup read-only and check it's whole: SQLite's integrity check plus row counts. */
export function verifyBackup(file: string): { path: string; bytes: number; orgs: number; files: number; integrity: string } {
  const b = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = (b.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    const orgs = (b.prepare("SELECT COUNT(*) AS n FROM orgs").get() as { n: number }).n;
    const files = (b.prepare("SELECT COUNT(*) AS n FROM file_blobs").get() as { n: number }).n;
    return { path: file, bytes: fs.statSync(file).size, orgs: Number(orgs), files: Number(files), integrity };
  } finally {
    b.close();
  }
}

/** A temporary backup file for a download (the caller deletes it). */
export function backupToTemp(): string {
  const file = path.join(os.tmpdir(), `bob-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.sqlite`);
  backupTo(file);
  return file;
}
