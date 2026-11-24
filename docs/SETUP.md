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
| `ANTHROPIC_API_KEY` | Ask Bob uses Claude (with Bob's own tools) for free-form, multi-turn conversation, instead of the built-in engine. Kept server-side only | console.anthropic.com |
| `BOB_CLAUDE_MODEL` | Optional. Which Claude model Ask Bob uses (default `claude-opus-5-5`) | — |
| `BOB_CLAUDE_EFFORT` | Optional. `low`, `medium` or `high` — lower is faster for voice | — |
| `BOB_CLAUDE_TIMEOUT_MS` | Optional. How long one Claude request may take before Bob's built-in engine answers instead (default `30000`) | — |
| `BOB_CLAUDE_ROUTING` | Optional. `auto` sends simple questions to a cheaper model (`BOB_CLAUDE_FAST_MODEL`, default `claude-sonnet-5-5`, effort `BOB_CLAUDE_FAST_EFFORT`); changes, invoices and multi-part requests stay on the main model. Off by default; see `docs/AI-COSTS.md` | — |
| `BOB_CLAUDE_CACHE_TTL` | Optional. `1h` keeps the prompt cache for an hour instead of 5 minutes (writes cost 2× instead of 1.25×; worth it when people ask Bob something every 5–60 minutes). `BOB_CLAUDE_CACHE=off` disables caching (for benchmarking only) | — |
| `BOB_PLATFORM_ADMINS` | Comma-separated emails of Cresaro staff who can open the Cresaro admin area (AI usage and cost per workspace, spending limits, connection test). A customer's owner does not see it | — |
| `BOB_ENGINE` | Optional. Set to `rules` to force the built-in engine even when a key is set | — |
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

## Files, photos and handovers

- **Where the bytes live:** locally (and on Render with a disk) in the `file_blobs` table of the same SQLite database, written in the same transaction as the file's metadata — so there are no orphaned files, and the existing backup of `BOB_DB_PATH` covers uploads too. Plan for disk size: up to **25 MB per file**. On Supabase, use a **private** Storage bucket `job-files` (see the header of `0005`), served only through `/api/files`.
- **Accepted:** JPG, PNG, WebP, GIF, HEIC/HEIF, PDF, Word, Excel, DWG, DXF, TXT, CSV. Checked by content, not just the name. Only verified images and PDFs preview inline; everything else downloads. HEIC is stored as the original but can't be previewed in most browsers (iPhones usually send JPEG from the file picker).
- **Thumbnails** are made on the uploading device; the original is always kept untouched.
- **Retries:** each upload carries a client reference, so retrying never creates a duplicate.
- **Who sees what:** owners, admins and site team see all files. Invited workers see files marked "Shared with people booked" on jobs they're booked on (until a week after the booking ends) and can add photos/documents there, not drawings. Delete: owners/admins, or the uploader.
- **Customer handover:** owners/admins tick specific files, preview, then Bob saves the selection and downloads a ZIP (originals + a branded `Start here - index.html`). The saved handover is frozen: files in it keep their bytes even if later deleted from the job. **Download only** — nothing is emailed or shared from Bob.

## Job updates and the customer handover report

- **Add update** (job Overview, Files & photos, and My work for crew): a short note and/or photos, an optional stage (Before / In progress / Finished), saved as one dated update with the author's name. Photos keep their original files and also appear in Files & photos (Finished photos are filed as Completion). Each photo uploads on its own with Retry; a retried save never makes a second update. Crew can add updates only on jobs they're booked on, and caption their own photos.
- **Variations** (job → Money): description, amount, VAT treatment, status, and the invoice it was billed on (so it's never counted twice).
- **Handover report** (job → Handover report, owners/admins): choose updates, photos, drawings/documents and whether to include costs → **Draft the report** → edit headings, paragraphs, bullets and captions, pick the cover photo, reorder and hide → **Preview PDF** (the exact file) → **Save version & download PDF**. Each export is a numbered version kept on the job ("Ninety3 - Garden Room - Handover v1.pdf"); later edits make v2. Versions can't be deleted and only owners/admins can download them. A version can go into the Handover pack, where it sits at the top as the overview.
- **What the AI sees:** only the ticked updates, photo captions, document titles and completed tasks, plus the job title and description. Never internal notes, site access notes, entry codes, money or unticked files. It writes prose only; any sentence it returns with a £ amount is dropped. All figures come from Bob: agreed price, approved variations, invoiced to date (sent/paid invoices, VAT as recorded), payments received, left to pay, and "due on invoices" only for invoiced, unpaid amounts. Supplier costs, expenses and margins are never read. If there's no agreed price, the section can be left out or filled with figures typed in for this report (labelled as such; bookkeeping isn't changed).
- **AI configuration:** set `ANTHROPIC_API_KEY` (and optionally `BOB_CLAUDE_MODEL`, default `claude-opus-5-5`). Without it, or if the request fails, Bob keeps the selections and opens an editable draft from the job details, updates and photos, and says so in the editor. "Rewrite this section" needs the key; without it the text is left unchanged.
- **Branding:** the PDF uses the workspace's light wordmark (or logo), name, contact details and `brandColor` (falls back to the accent). Ninety3 uses `#7B2001`, sampled from its supplied logo. Other businesses set `brandColor` and `wordmark` in their workspace file.
- **Photos in the PDF:** JPEG and PNG originals are embedded as uploaded (EXIF rotation respected; fitted, never stretched or cropped). HEIC and WebP use the thumbnail made on the phone; if there isn't one, the editor says the photo will be left out.
- **Sending:** download only. Gmail/Outlook adapters exist but aren't connected or live-tested and don't support attachments, so there's no "Send to customer" yet.
- **Dependency:** `pdfkit` (server-side, listed in `serverExternalPackages`).

## Leave and availability

- Team → **Holidays** (also linked from the Diary). Employees request full or half days from My work; owners/admins approve, decline or record leave directly. Subcontractors add "Unavailable" dates, which apply straight away.
- **Policy** (Settings → Team & holidays, default on): owners/admins can record their own leave as approved. Turn it off and a main user's own leave needs the other main user's approval.
- Approved leave shows on the Diary (pending is dashed and labelled) and in a person's Team record. Booking someone during approved leave gives a warning the planner can override; approving leave lists their existing bookings in that period. Reasons are private to the person and owners/admins.
- Dates are plain date keys, so half days and ranges never shift across time zones or the clock change. Leave isn't included in calendar feeds yet.

## Migrations

- **Local SQLite (what runs today, including Render):** automatic on start-up. `src/server/db/index.ts` → `migrate()` + `addMissingColumns()`. Additive only: new tables, new columns, and a copy-across rebuild of `memberships` to allow the `worker` role. Recorded in `PRAGMA user_version` (now 2). Sample workspaces get the demo team and week once; live workspaces are never given demo records.
- **Supabase (production):** apply in order:
  ```
  supabase/migrations/0001_bob_multitenant.sql
  supabase/migrations/0002_team_schedule.sql
  supabase/migrations/0003_merchants_feeds.sql
  supabase/migrations/0004_admin_invites.sql
  supabase/migrations/0005_files_handover_leave.sql
  supabase/migrations/0006_updates_variations_reports.sql
  ```
  `0006` adds job updates, variations, handover reports and report versions (owners/admins only), and hides report PDFs from everyone else. Local SQLite is at schema version 5.
  `0005` adds job files (with drawing revisions), customer handovers, leave/availability (`absences`) and the `site_visit` enquiry stage, with RLS. Workers reach files only through `public.my_files(org)`. Tested on Postgres 16 with `supabase/tests/rls_files_test.sql` (run it after `rls_team_test.sql` in the same database).
  Local SQLite is at schema version 4 and upgrades on start-up: new tables `job_files`, `file_blobs`, `handovers`, `absences`; existing site photos are copied into Files & photos once (the old `photos` rows are kept). Sample workspaces get demo drawings, photos, a saved handover and leave once.
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

## Ask Bob: invoicing by conversation

Typed and spoken messages go through the same handler (`/api/bob/message` → `handleTurn`). With `ANTHROPIC_API_KEY` set, Claude answers using Bob's tools: `find_jobs_to_bill` (fuzzy search across customer name, site address, town and type of work, tolerating Mackay/McKay/Mackey), `get_job_billing` (Bob's own figures: contract value, deposit, invoices issued, remaining to invoice, unpaid on invoices), `save_invoice_draft` / `delete_invoice_draft` (drafts only, one open draft per job, Undo) and `send_invoice` (separate, with an approval card showing recipient and amount; blocked unless Xero or QuickBooks is connected). Tools are filtered by the signed-in user's role, a turn is limited to 6 model calls, and each call to 30 seconds. If Claude is unavailable or slow, Bob's built-in engine answers the same message with the same billing logic and says so.

Without a key, the built-in engine handles the same invoice conversation. Set **Settings → VAT status** and **payment terms** so Bob doesn't need to ask about VAT and due dates on each invoice.

Test: `npx vitest run tests/invoice-chat.test.ts` (conversations, plus a simulated Claude client) and `node scripts/e2e-ask-bob-invoice.cjs` (the real UI on a throwaway database).

### What Ask Bob can look up (Claude engine)

Claude reads the workspace through server-side tools, one question at a time — never a whole-database dump: diary bookings (`get_schedule`), availability (`get_team_availability`), holidays (`list_holidays`), the team (`list_team`), materials (`list_materials`), merchants with what's waiting to order (`list_merchants`, contact details only — account numbers, password-manager links and merchant notes are never sent), a full job profile (`get_job_profile`: crew, bookings, materials, tasks, updates, variations, money, handover status), jobs by stage including ready to invoice (`list_jobs`), quotes, enquiries to quote, tasks with assignees, site updates, handover reports, the morning briefing and someone's priorities (`get_person_priorities`). Every tool runs with the signed-in user's role: money tools aren't offered to site accounts, and leave reasons are never included. Bob remembers the job, customer and person being discussed for follow-ups.

Voice requests get a short spoken first sentence; extra detail is shown on screen. At most two record cards appear under an answer.

**Is Claude really answering?** Settings → Bob → AI connection shows how many answers came from Claude and how many fell back to the built-in assistant since the server started, the last error, and a **Test connection** button that makes a tiny live request. A fallback is also labelled under the reply ("…so Bob's built-in assistant answered this one").
