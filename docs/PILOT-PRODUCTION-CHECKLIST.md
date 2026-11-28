# Ninety3 live pilot: production checklist (Render)

Hosting today: one Render web service (`bob`, **free plan**, Frankfurt), deployed from `main`, running SQLite on the instance's temporary disk. The free plan wipes that disk on every deploy and restart. That's fine for the demo and **not acceptable for live records**.

Nothing in this list happens automatically. Each step needs your go-ahead. **Merging to `main` deploys.**

## Blocks the live pilot (do these before inviting Luke and Ryan)

1. **Persistent storage** (a plan decision, and a cost):
   - Render → `bob` → **Settings → Instance type**: Starter or higher. A persistent disk needs a paid instance; check current Render pricing.
   - **Disks → Add disk**: mount path `/var/data`, 1 GB to start. Photos and short videos are stored in the database, so watch the size.
   - **Environment**:
     - `BOB_DB_PATH=/var/data/bob.sqlite`
     - `BOB_PERSISTENT_STORAGE=true`
   - Render notes for services with a disk: they run as one instance and deploys aren't zero-downtime (expect a few seconds' interruption). Check Render's current documentation.
   - The first start on the new disk creates a fresh database: the fictional demo workspaces plus the live workspace from the workspaces file. Nothing from the old temporary disk carries over, and nothing real exists yet.
2. **Workspace and logins:**
   - **Secret File** `workspaces.json`: see `docs/NINETY3-GO-LIVE.md`. Enter Luke's and Ryan's real login emails.
   - Set `BOB_WORKSPACES_FILE=/etc/secrets/workspaces.json`.
   - Set `BOB_PUBLIC_URL=https://<your Render address>` (no trailing slash).
3. **Separate the demo from the live logins:**
   - On the live service, remove `BOB_DEMO_LUKE_EMAIL`, `BOB_DEMO_LUKE_PASSWORD`, `BOB_DEMO_RYAN_EMAIL` and `BOB_DEMO_RYAN_PASSWORD`, so their real emails aren't tied to the demo password.
   - Set `BOB_SHOW_DEMO_LOGINS=false`.
   - For sales demonstrations, keep the demo on its own free Render service (it can keep resetting on deploy).
4. **Backups in place before real data:**
   - Set `BOB_PLATFORM_ADMINS` to your email.
   - Download one backup from `/api/cresaro/backup`.
   - Restore it once on a copy (see `docs/BACKUP-RESTORE.md`). The Render-side restore hasn't been tested yet.
5. **Check on real phones** (an iPhone with Safari and an Android phone with Chrome), using test recipients:
   - accept an invite, then open My work;
   - tap Directions;
   - add a progress photo;
   - record and play back a short video (Chrome can't play iPhone HEVC `.mov` files; Safari can);
   - use "Speak" dictation on a pricing note.
6. **Your go-ahead to merge** the review branch to `main` (which deploys), then restart once to see provisioning print Luke's and Ryan's invite links in **Logs**.

## Inviting Luke and Ryan safely

- Steps 1 to 6 above are done.
- After a deploy *and* a restart, the warning strip "Storage isn't permanent" does **not** appear for the owner.
- One backup has been downloaded and opened.

Then send each of them their invite link from the Render log, or let Bob email it once email is set up (below). Each link works once, only for that email, and expires after 7 days.

## Optional, can follow the pilot

- **Invite emails from Bob.** Without this, Bob shows the link and says plainly that nothing was emailed; Luke copies it into WhatsApp or a text.
  - To switch it on: a Resend account, a verified sending domain (DNS records on a domain you control), then set `BOB_MAIL_TRANSPORT=resend`, `RESEND_API_KEY` and `BOB_MAIL_FROM="Ninety3 via Bob <invites@your-domain>"`.
  - First set `BOB_MAIL_ALLOWED_RECIPIENTS=you@your-domain` and send yourself a test.
  - Failures show as failed with **Try again**; they're never shown as sent.
- **Rough estimates (pilot):** Settings → Prices for estimates. Luke switches it on and enters his own day rate and material prices. Nothing is sent to customers.
- **Concept designs:** not available. No image-generation provider is configured, and text-model access doesn't include images. To add it you'd need to choose a provider, add an API key, set a monthly spending limit and agree a data-handling position on customer photos. The control is kept out of the live workflow until then.
- **Password reset and two-step sign-in:** still not built. Until there's self-service reset, a forgotten password means removing access and sending a new invite.
- **Confirmed days worked:** Bob doesn't track attendance; deciding whether to add it is a follow-up.
- **Getting started guide:** its screenshots predate these changes (Home was the first screen; "Holidays" is now "Time off"). Regenerate it with `docs/manual` once the pilot screens settle.
- **Supabase:** migration `0012_pricing_extras_outbox.sql` is ready for when you move.
