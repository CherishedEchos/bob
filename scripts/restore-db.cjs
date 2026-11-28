/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Restore Bob from a backup made by scripts/backup-db.cjs (or the Cresaro admin download).
//   node scripts/restore-db.cjs <backup.sqlite> [database]
// STOP BOB FIRST (or run this before it starts): restoring under a running server isn't safe.
// Checks the backup's integrity before touching anything, keeps the current database as
// <database>.before-restore-<time>, then copies the backup into place and checks it again.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const backup = process.argv[2];
const dest = process.argv[3] || process.env.BOB_DB_PATH || path.join(process.cwd(), '.data', 'bob.sqlite');
if (!backup || !fs.existsSync(backup)) { console.error('Usage: node scripts/restore-db.cjs <backup.sqlite> [database]'); process.exit(1); }

function check(file) {
  const b = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = b.prepare('PRAGMA integrity_check').get().integrity_check;
    const orgs = Number(b.prepare('SELECT COUNT(*) AS n FROM orgs').get().n);
    const files = Number(b.prepare("SELECT COUNT(*) AS n FROM file_blobs WHERE kind = 'original'").get().n);
    return { integrity, orgs, files };
  } finally { b.close(); }
}

const before = check(backup);
if (before.integrity !== 'ok' || before.orgs < 1) { console.error('That backup failed its check — nothing was changed.', before); process.exit(1); }
fs.mkdirSync(path.dirname(dest), { recursive: true });
let kept = null;
if (fs.existsSync(dest)) {
  kept = `${dest}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.renameSync(dest, kept);
  // Its write-ahead log goes with it, so the kept copy stays complete.
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(dest + ext)) fs.renameSync(dest + ext, kept + ext);
}
fs.copyFileSync(backup, dest);
const after = check(dest);
console.log(JSON.stringify({ restored: dest, from: backup, previousKeptAt: kept, ...after }, null, 2));
process.exit(after.integrity === 'ok' ? 0 : 1);
