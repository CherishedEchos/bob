/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Back up Bob: ONE file holds every record AND every uploaded file (photos, videos, documents).
//   node scripts/backup-db.cjs [database] [backup-folder]
// Defaults: $BOB_DB_PATH (or .data/bob.sqlite) → ./backups. Safe while Bob is running (VACUUM INTO).
// Prints the backup path and what it contains, after re-opening it and running SQLite's integrity check.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const src = process.argv[2] || process.env.BOB_DB_PATH || path.join(process.cwd(), '.data', 'bob.sqlite');
const dir = process.argv[3] || path.join(process.cwd(), 'backups');
if (!fs.existsSync(src)) { console.error(`No database at ${src}`); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
const dest = path.join(dir, `bob-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(src);
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
const b = new DatabaseSync(dest, { readOnly: true });
const integrity = b.prepare('PRAGMA integrity_check').get().integrity_check;
const count = (sql) => Number(b.prepare(sql).get().n);
const out = { backup: dest, bytes: fs.statSync(dest).size, integrity, workspaces: count('SELECT COUNT(*) AS n FROM orgs'), users: count('SELECT COUNT(*) AS n FROM users'), jobs: count('SELECT COUNT(*) AS n FROM jobs'), files: count("SELECT COUNT(*) AS n FROM file_blobs WHERE kind = 'original'") };
b.close();
console.log(JSON.stringify(out, null, 2));
process.exit(integrity === 'ok' ? 0 : 1);
