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

- **People and logins are separate.** Add employees and subcontractors in **Team** and book them straight away. Invite them when you're ready: Bob makes a single-use link (7 days, only for their email). **Bob doesn't send the email** — copy the link and send it by text, WhatsApp or email. To send invites by email later, connect a mail provider and add an "Email invite" action that goes through the approval card (not built yet).
- **Workers see only My work:** their bookings from a week ago onwards, the site address, directions, what3words, instructions, their tasks and the materials for those jobs. No prices, customers list, team or company schedule. Every API refuses them unless the route opts in (`authed(handler, { workers: true })` in `src/server/http.ts`).
- **Changes reach workers on their next load or refresh.** No push notifications or texts are sent.
- **Times** are wall-clock times in the workspace time zone (Settings → Business profile; default `Europe/London`), so bookings don't move when the clocks change.
- **Calendar sync** (Google/Outlook) isn't built. The schedule works on its own. Building it needs a Google Cloud / Microsoft Entra app with calendar scopes, and a decision on one-way (Bob → calendar) vs two-way sync.
- **QuickBooks:** the existing adapter covers invoices (written, not live-tested). Bills to pay are kept in Bob only; when QuickBooks is connected the Bills page shows an **Open QuickBooks** link. Pulling bills from QuickBooks needs the `com.intuit.quickbooks.accounting` scope (already requested) and a Bills sync (not built).

## Migrations

- **Local SQLite (what runs today, including Render):** automatic on start-up. `src/server/db/index.ts` → `migrate()` + `addMissingColumns()`. Additive only: new tables, new columns, and a copy-across rebuild of `memberships` to allow the `worker` role. Recorded in `PRAGMA user_version` (now 2). Sample workspaces get the demo team and week once; live workspaces are never given demo records.
- **Supabase (production):** apply in order:
  ```
  supabase/migrations/0001_bob_multitenant.sql
  supabase/migrations/0002_team_schedule.sql
  ```
  `0002` is additive. It also tightens `is_member()` so invited workers no longer count as members for existing tables; they read their work only through `public.my_work(org)`.

## Adding a company (no code change)

1. Write a JSON file like `docs/workspaces.example.json` (slug, name, short name, owner email, logo link, colour, services, area, time zone).
2. Set `BOB_WORKSPACES_FILE=/path/to/workspaces.json` (and `BOB_PUBLIC_URL`) and restart.
3. The server log prints a one-time **owner setup link** for each new company. Send it to the owner; it works once, only for their email, for 7 days.
4. The company starts empty and "live". Its branding can be changed later in Settings → Business profile. Running again never changes an existing company.

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
