# Bob — setup, credentials and go-live checklist

## Run it locally (no credentials needed)

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 46 engine / safety tests
```

Sign in with a demo account on `/login` (the password is shown there). The local database is created and seeded in `.data/bob.sqlite`. Delete that file to start fresh, or use **Settings → Reset sample data**.

**Node 22+** is required, because the local database uses Node's built-in SQLite.

## What each credential unlocks

| Variable(s) | Unlocks | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Bob understands free-form requests with Claude, instead of the demo rules engine | console.anthropic.com |
| `BOB_ENCRYPTION_KEY` | Storing any integration's OAuth tokens (required for every integration) | Generate locally: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `BOB_APP_URL` | OAuth redirect URIs | Your HTTPS domain |
| `GOOGLE_CLIENT_ID/SECRET` | Gmail: read enquiries, send approved replies | Google Cloud console → OAuth client (Web). Scopes: `gmail.readonly`, `gmail.send`. Needs Google's OAuth verification before it can be used by the public. |
| `MICROSOFT_CLIENT_ID/SECRET` | Outlook / Microsoft 365 | Microsoft Entra → App registrations. Delegated: `Mail.Read`, `Mail.Send`, `offline_access`, `User.Read` |
| `XERO_CLIENT_ID/SECRET` (+ `XERO_SALES_ACCOUNT_CODE`) | Create and email invoices in Xero | developer.xero.com → Web app |
| `QUICKBOOKS_CLIENT_ID/SECRET`, `QUICKBOOKS_SERVICE_ITEM_ID` | Create and send invoices in QuickBooks Online | developer.intuit.com |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Production database and auth (once the adapter is switched — see below) | supabase.com project (choose the London region for UK data residency) |

Each redirect URI is `$BOB_APP_URL/api/integrations/<provider>/callback`.

> The Gmail, Outlook, Xero and QuickBooks adapters are written against the official APIs but **have not been tested against live accounts**. Test each one with a sandbox or test account before relying on it.

| `BOB_WORKSPACES_FILE` | Create another company (name, logo, colour, time zone) without a code change — see "Adding a company" below | A JSON file on the server |
| `BOB_PUBLIC_URL` | Printed in front of owner setup links in the server log | Your HTTPS domain |
| `BOB_DB_PATH` | Where the local SQLite database lives. On Render free it's the temporary disk (reset on every deploy) | A path on a persistent disk |

## Team, schedule and invites

- **People and logins are separate.** Add employees and subcontractors in **Team** and book them straight away. Invite them when you're ready, as **My work only** (default) or, for the owner only, **Admin** (the `office` role): Bob makes a single-use link (7 days, only for their email). **Bob doesn't send the email** — copy the link and send it by text, WhatsApp or email. To send invites by email later, connect a mail provider and add an "Email invite" action that goes through the approval card (not built yet).
- **Workers see only My work:** their bookings from a week ago onwards, the site address, directions, what3words, instructions, their tasks and the materials for those jobs. No prices, customers list, team or company schedule. Every API refuses them unless the route opts in (`authed(handler, { workers: true })` in `src/server/http.ts`).
- **Changes reach workers on their next load or refresh.** No push notifications or texts are sent.
- **Times** are wall-clock times in the workspace time zone (Settings → Business profile; default `Europe/London`), so bookings don't move when the clocks change.
- **Calendar (one-way subscription feeds):** Settings → Calendar creates a private `.ics` link — the company diary (owners/office/site team) or "My bookings" (the person linked to your login). Workers get their own link in My work. Links are hashed in the database, can be turned off, and are re-checked on every fetch: leaving the business, losing the role, removing access or archiving the Team record stops the feed. Feeds contain the job, town/site address, times and names — never customer phone/email, site access notes, entry codes, instructions or private notes. Each booking has a stable UID, so a moved booking updates the same event and a cancelled one disappears. **The receiving calendar decides how often it refreshes** (Google can take several hours). Tested: the feed parses with the Python `icalendar` library and in unit tests; **not yet tested in Google Calendar, Apple Calendar or Outlook** (needs a public HTTPS URL — try it on the deployed site). A two-way Google/Microsoft sync needs a Google Cloud or Microsoft Entra app with calendar scopes — not built.
- **QuickBooks:** the existing adapter covers invoices (written, not live-tested). Bills to pay are kept in Bob only. **Open QuickBooks** in Money goes to the link set in Settings → Connected accounts → "Open QuickBooks shortcut" (the demo uses `https://qbo.intuit.com/app/bills`); Money shows the real QuickBooks connection status. Pulling bills from QuickBooks needs a Bills sync (not built).
- **Merchants:** trade account references, the password-manager link and "login managed by" are owner/office only — the server removes them for everyone else. Bob refuses text that looks like a password in merchant, material and job fields.
- **Site details:** each job has its own site address (separate from the customer's address, with "Copy customer address"), optional what3words (format checked only — no what3words API key configured, so the square isn't verified) and a site access note.

## Migrations

- **Local SQLite (what runs today, including Render):** automatic on start-up. `src/server/db/index.ts` → `migrate()` + `addMissingColumns()`. Additive only: new tables, new columns, and a copy-across rebuild of `memberships` to allow the `worker` role. Recorded in `PRAGMA user_version` (now 2). Sample workspaces get the demo team and week once; live workspaces are never given demo records.
- **Supabase (production):** apply in order:
  ```
  supabase/migrations/0001_bob_multitenant.sql
  supabase/migrations/0002_team_schedule.sql
  supabase/migrations/0003_merchants_feeds.sql
  supabase/migrations/0004_admin_invites.sql
  ```
  `0004` lets invites grant the `office` (Admin) role.
  `0003` adds merchants, calendar feeds, material order fields, bill payment fields and `jobs.access_note` (all additive). Local SQLite is at schema version 3 and upgrades on start-up; older sample workspaces get demo merchants and access notes once.
  `0002` is additive. It also tightens `is_member()` so invited workers no longer count as members for existing tables; they read their work only through `public.my_work(org)`.

## Adding a company (no code change)

Step-by-step for Ninety3: **[docs/NINETY3-GO-LIVE.md](NINETY3-GO-LIVE.md)**.

1. Write a JSON file like `docs/workspaces.ninety3.example.json`: slug, name, logo, time zone, contact, and `users` (each with a name, a role of `owner` or `office` (Admin), and their login email). Keep it on the server only; `workspaces*.json` is git-ignored. On Render, use a Secret File, which is mounted at `/etc/secrets/<filename>`.
2. Set `BOB_WORKSPACES_FILE` to that path, set `BOB_PUBLIC_URL`, then restart.
3. A new company is created empty and "live". Each user gets a Team record. Each user with an email gets a one-time invite link in the server log: it works once, only for their email, for 7 days. Emails are partly hidden in the log.
4. Users without an email are logged as "waiting for an email". Add the email and restart. Restarts never replace an unexpired link, unless that user has `"newLink": true`.
5. Running again never changes an existing company's name, branding or settings. Edit those in Settings → Business profile. The older single `ownerEmail` form still works.

## Backups and restore

- **Render free (current demo):** the SQLite file is on the instance's temporary disk. **There are no backups** and the data resets to the sample on every deploy or restart. That's fine for the fictional demo and **not acceptable for real data**.
- **Before real data**, pick one:
  - **Supabase (recommended):** daily backups on the Pro plan, point-in-time recovery as an add-on. Restore from the Supabase dashboard (Database → Backups), into a new project first to check it.
  - **Render paid plan with a disk:** set `BOB_DB_PATH` to the disk. Render takes daily disk snapshots. Also take your own copy: `sqlite3 "$BOB_DB_PATH" ".backup /backups/bob-$(date +%F).sqlite"` on a schedule, kept off the instance. To restore, stop the service, copy the backup over `BOB_DB_PATH`, then start it.
- Test a restore before go-live, and again every quarter.

## Testing the database policies

```bash
# with a local Postgres 16:
psql -f supabase/tests/auth_stub.sql -f supabase/migrations/0001_bob_multitenant.sql -f supabase/migrations/0002_team_schedule.sql -f supabase/tests/rls_test.sql
# then, in a fresh database:
psql -f supabase/tests/auth_stub.sql -f supabase/migrations/0001_bob_multitenant.sql -f supabase/migrations/0002_team_schedule.sql -f supabase/tests/rls_team_test.sql
```

All 9 checks should print `PASS` (cross-org read/insert/update/move, token secrecy, append-only audit log, staff limits, no session).

## Before real data (Ninety3 go-live checklist)

1. **Database:** create the Supabase project, apply the migration and run the RLS tests against it. Then implement the Supabase data adapter: swap `src/server/db` `scoped()` for Supabase queries made with the user's JWT, and keep the service interfaces the same.
2. **Auth:** switch login to Supabase Auth (email magic link or password, with MFA for owners), create Ninety3's real users, and turn off demo logins (`BOB_SHOW_DEMO_LOGINS=false`).
3. **Organisation:** create Ninety3 with `dataMode: "live"`. Fill in the VAT status, rate and payment terms in Settings. Replace `public/brand/ninety3-logo.png` with the original artwork.
4. **Integrations:** connect Gmail or Outlook and Xero or QuickBooks with test accounts first. Confirm one approved email and one approved invoice end to end.
5. **Voice privacy:** browser speech recognition (Chrome/Edge) sends audio to the browser vendor. For customer data, either accept that and document it, or add a server-side speech-to-text provider covered by a UK GDPR data-processing agreement.
6. **Hosting:** HTTPS only, environment secrets in the host's secret store, database backups, and error monitoring without customer data in the logs.
7. **GDPR paperwork:** privacy notice for customers, DPAs with Anthropic, Supabase, the email provider and the accounting provider, a retention schedule (set in Settings), and a breach procedure.
8. **Security review:** an independent review or penetration test of auth, RLS and the approval flow.
