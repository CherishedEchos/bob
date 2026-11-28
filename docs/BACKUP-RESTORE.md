# Backing up and restoring Bob

## What Bob keeps, and where

Everything is in **one SQLite database file**:

- accounts, sessions and invites
- every workspace's records: jobs, customers, schedules, leave, extras, Jobs to price, quotes, invoices, the activity log
- **uploaded files**: photos, videos, drawings, documents and handover PDFs. These are stored inside the database (`file_blobs` table) in the same transaction as their details, so there's no separate file store to lose track of.

The file lives at `BOB_DB_PATH`. Without it, Bob uses `.data/bob.sqlite` inside the app folder, which on Render's free plan is wiped on every deploy and restart.

So:

- **durability** means the database file sits on storage that survives restarts and redeploys (on Render, a persistent disk);
- **a backup** is one consistent copy of that file, and it includes every photo and video.

Bob can't detect a persistent disk itself. Once the disk is attached and `BOB_DB_PATH` points at it, set `BOB_PERSISTENT_STORAGE=true`. Until then, owners and admins of a live workspace see a warning strip: *"Storage isn't permanent on this server yet."*

## Making a backup

All three ways are safe while Bob is running, because they use SQLite's `VACUUM INTO` to take a consistent copy.

1. **Download (Cresaro admins).** Sign in with an email listed in `BOB_PLATFORM_ADMINS`, then open `/api/cresaro/backup`.
   - It downloads `bob-backup-YYYY-MM-DD.sqlite`, which holds every workspace's records and files.
   - The activity log records each download.
   - Keep the file somewhere private: it contains customer data.
2. **Render Shell** (paid instances only):

   ```bash
   node scripts/backup-db.cjs "$BOB_DB_PATH" /var/data/backups
   ```

   It prints the backup's path, the SQLite integrity check result (`ok`) and the number of workspaces, users, jobs and files. A copy on the same disk doesn't protect against losing the disk, so download it or copy it off as well.
3. **Render disk snapshots.** Render takes automatic snapshots of persistent disks. Check the current retention and restore steps in Render's documentation for your plan before relying on them.

**Suggested routine for the pilot:** download a backup every evening (or after any big day of data entry), plus Render's automatic snapshots.

## Restoring

```bash
node scripts/restore-db.cjs <backup.sqlite> [database path, default $BOB_DB_PATH]
```

The script works like this:

1. It checks the backup first: SQLite's integrity check, plus at least one workspace in it. If the check fails, nothing is changed.
2. It renames the current database (and its `-wal`/`-shm` files) to `<database>.before-restore-<time>`, so you can go back.
3. It copies the backup into place and checks it again.

**Stop Bob first, or restart it straight after.** A running server keeps using the file it already has open. On Render:

1. Upload the backup to the disk. Render's SSH/`scp` access to persistent disks depends on the plan, so check the current documentation.
2. Run the restore in the Shell.
3. Click **Manual Deploy → Restart service**.

## What has been tested, and what hasn't

| | Status |
|---|---|
| Backup while the server is running; the copy contains every record and file, byte for byte | **Tested.** `tests/pilot-access.test.ts` and `scripts/e2e-pilot-acceptance.cjs`, on this machine |
| Restore with `restore-db.cjs` into a new location, start a production server on the restored file: the same logins work, the same jobs, the same file bytes | **Tested.** `scripts/e2e-pilot-acceptance.cjs` step 7 (production build, `next start`), on this machine |
| Records and files survive a server restart on the same database file | **Tested.** Same script (stop, start, sign in again, re-download a file and compare bytes) |
| Restore on Render (uploading a backup to the disk, running the script in Render Shell, restarting) | **Not yet tested.** Needs the paid instance and disk |
| Restoring from a Render disk snapshot | **Not yet tested.** Render dashboard feature; try it once on a non-live service before relying on it |
| Downloading a backup from the live Render service via `/api/cresaro/backup` | **Not yet tested on Render.** Works locally; needs `BOB_PLATFORM_ADMINS` set |

## If you move to Supabase later

The Postgres schema mirrors these tables (`supabase/migrations`, including `0012_pricing_extras_outbox.sql`). File bytes would then move to Supabase Storage. That needs its own backup plan; Supabase's backups depend on the plan you choose.
