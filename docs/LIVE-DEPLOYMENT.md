# Live deployment: Ninety3 Carpentry & Build at bob.cresaro.co

This is a **separate** Render web service from the sales demo (`bob`, free plan, `render.yaml`), and the demo stays exactly as it is. Reference config: `render.live.yaml`.

## 1. What to deploy

- **Code:** `main` once the review branch `live-deploy-no-demo` is merged. That's `main` at `d415bc5` (the tested pilot release) plus one small live-only switch, `BOB_DEMO_WORKSPACES=off`.
  - Without the switch, a new database also gets the two fictional demo workspaces, with logins using the public password `bob-demo`. They can't see Ninety3's records, but they don't belong on a customer's server.
- **Runtime:** Node 22 (`NODE_VERSION=22`; the app needs Node ≥ 22.5 for its built-in SQLite).
- **Build command:** `npm ci && npm run build`
- **Start command:** `npx next start -p $PORT -H 0.0.0.0`
- **Health check path:** `/login`

## 2. Where everything is saved

- **One SQLite database file** holds accounts, sessions, invites, every record (jobs, customers, diary, leave, extras, Jobs to price) **and uploaded photos, videos and documents** (stored as blobs in the same file).
- There's no external database or object storage to create; Supabase isn't used by this release.
- **Create:** a Render persistent disk on the live service, mount path `/var/data`, 1 GB to start. Then set `BOB_DB_PATH=/var/data/bob.sqlite`.
- **Migrations:** none to run by hand. On every start Bob creates or updates its tables (additive only, versioned with `PRAGMA user_version`). `supabase/migrations` is for a future Supabase move and isn't used here.
- **Instance:** **Starter**, Render's lowest paid instance type (a persistent disk needs a paid instance).
  - Check the current price on Render's pricing page before choosing; disks are billed per GB on top.
  - Starter's memory is small; watch it during the pilot, as 60 MB video uploads are the heaviest thing Bob does.
- Services with a disk run as a single instance, and deploys briefly interrupt service.
- **Backups:** `docs/BACKUP-RESTORE.md`. Download from `/api/cresaro/backup` (Cresaro admins), or run `scripts/backup-db.cjs` in Render Shell.

## 3. Environment variables

| Name | Required | What it does | Where the value comes from |
|---|---|---|---|
| `NODE_VERSION` | Yes | Node 22 | Type `22` |
| `BOB_DB_PATH` | Yes | Where the database (records and files) lives | `/var/data/bob.sqlite` (on the disk) |
| `BOB_PERSISTENT_STORAGE` | Yes | Tells Bob the disk is permanent; without it owners see a "storage isn't permanent" warning | `true`, once the disk is attached |
| `BOB_DEMO_WORKSPACES` | Yes | **Live-only:** no fictional workspaces or demo logins are ever created | `off` |
| `BOB_SHOW_DEMO_LOGINS` | Yes | Hides "Try the demo" on the sign-in page (also hidden automatically when the setting above is `off`) | `false` |
| `BOB_WORKSPACES_FILE` | Yes | The workspace and its first two users (Luke and Ryan) | `/etc/secrets/workspaces.json` (a Secret File, see step 4) |
| `BOB_PUBLIC_URL` | Yes | The address in invite links | `https://bob.cresaro.co` |
| `BOB_ENCRYPTION_KEY` | Yes | Encrypts connected-account tokens (email or accounting) | Render: **Generate** (or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) |
| `BOB_PLATFORM_ADMINS` | Yes | Cresaro staff who can download backups and see AI usage (customers never can) | Your own login email, e.g. `<you@cresaro.co>` |
| `ANTHROPIC_API_KEY` | Optional | Ask Bob uses Claude (otherwise Bob's built-in rules engine answers) | Anthropic Console → API keys: `<sk-ant-…>` |
| `ELEVENLABS_API_KEY` | Optional | Bob's spoken replies | ElevenLabs → Profile → API key: `<…>` |
| `BOB_MAIL_TRANSPORT`, `RESEND_API_KEY`, `BOB_MAIL_FROM` | Optional | Email team invites from Bob (otherwise Bob shows the link to send by hand) | Resend account with a verified sending domain: `resend`, `<re_…>`, `Ninety3 via Bob <invites@cresaro.co>` |
| `BOB_MAIL_ALLOWED_RECIPIENTS` | Optional | While testing: only these addresses or `@domains` can receive invite emails | e.g. `<you@cresaro.co>` |

**Leave unset on the live service:**
- `BOB_DEMO_LUKE_EMAIL`, `BOB_DEMO_LUKE_PASSWORD`, `BOB_DEMO_RYAN_EMAIL`, `BOB_DEMO_RYAN_PASSWORD`, `BOB_DEMO_PASSWORD`: these are demo-only;
- `BOB_INSECURE_COOKIES`: testing only.

**How production stays clear of demo features:**
- **Demo sign-ins and sample-data seeding:** `BOB_DEMO_WORKSPACES=off` means no demo workspaces or demo users exist. The sign-in page offers no demo, and `owner@ninety3.example` with `bob-demo` is refused.
- **Reset controls:** "Reset sample data" is refused by the server for any live workspace (it only works on `dataMode: "sample"`), and provisioned workspaces are always live.

## 4. Create the workspace, make Luke Owner and Ryan Admin, invite them

There's no sign-up screen. The workspace is created from a Secret File when the service first starts:

1. Copy `docs/workspaces.ninety3-live.example.json` (name **"Ninety3 Carpentry & Build"**).
2. Replace `LUKE_LOGIN_EMAIL` and `RYAN_LOGIN_EMAIL` with the emails they'll sign in with.
3. Render → live service → **Environment → Secret Files → Add Secret File**: filename `workspaces.json`, paste the contents.
4. On start, Bob creates the empty live workspace and Team records for Luke and Ryan, and prints **one single-use invite link each** to **Logs**:
   - Luke as **owner**, Ryan as **admin**;
   - search the logs for `invite link for`;
   - each link expires after 7 days and works only for that email.
5. **Nothing is emailed.** Provisioning never sends email, even if email delivery is set up. You copy each link from the log and send it yourself, when you choose. Creating the workspace doesn't create accounts either: each person sets their own password when they open their link.
6. Lost link: add `"newLink": true` to that user in the Secret File and restart (remove it afterwards).

Later invitations (subcontractors and staff) are made in the app: **Team → Invite someone**. Those *are* emailed, if `BOB_MAIL_TRANSPORT` is set up. Otherwise Bob shows the link and says plainly that nothing was sent.

## 5. Subcontractor access on this release

Implemented and tested in `d415bc5`, so it's included in `main`:

- **Team → Invite someone:** picks up existing crew profiles (their bookings stay attached), single-use links that expire after 7 days, resend and cancel, pending/accepted status, remove access.
- **Removing access** signs them out immediately (membership is re-checked on every request); their bookings and updates stay.
- **Subcontractors land on My work** and see only the jobs they're booked on: date, time, site address and directions, who they're working with, notes shared with the crew, files shared with the team, and adding photos or updates.
- **Enforced on the server:**
  - other jobs, office-only files and private notes return "not found";
  - the company data, diary and operations endpoints refuse them (403);
  - a direct link to a job sends them to My work;
  - **Ask Bob** refuses them at the route *and* inside the engine;
  - **file links** for another job, or office-only files, return 404.
  - Tests: `tests/pilot-access.test.ts`, `scripts/e2e-pilot-acceptance.cjs` (56 checks).
- **One sharing decision to review:** My work shows the customer's name and phone ("Call …") to the crew booked on a job.

## Click-by-click checklist

Nothing below is done for you. Each step is yours.

**A. Merge the live-only switch**
1. GitHub → pull request **`live-deploy-no-demo` → `main`** → review → **Merge**. This also redeploys the demo service, which is unchanged because `BOB_DEMO_WORKSPACES` isn't set there.

**B. Create the live service**
1. Render → **New + → Web Service** → connect **CherishedEchos/bob** → branch **main**.
2. **Name:** `bob-ninety3` · **Region:** Frankfurt · **Runtime:** Node.
3. **Build command:** `npm ci && npm run build` · **Start command:** `npx next start -p $PORT -H 0.0.0.0`.
4. **Instance type:** Starter (check the price shown).
5. **Advanced → Add Disk:** name `bob-data`, mount path `/var/data`, size 1 GB.
6. **Advanced → Health Check Path:** `/login`.
7. **Environment Variables:** add every "Required" row from the table in section 3.
8. **Secret Files → Add:** `workspaces.json`, with Luke's and Ryan's real emails (section 4).
9. **Create Web Service** and wait for **Live**.

**C. Domain**
1. Service → **Settings → Custom Domains → Add** `bob.cresaro.co`.
2. At the DNS provider for `cresaro.co`, add the **CNAME** Render shows (`bob` → `bob-ninety3.onrender.com`). Wait for Render to show the certificate as issued.

**D. Check it before inviting anyone**
1. Open `https://bob.cresaro.co/login`. There's no "Try the demo"; `owner@ninety3.example` with `bob-demo` must fail.
2. **Logs:** search `Created live workspace "Ninety3 Carpentry & Build"` and `invite link for` (one line for Luke, one for Ryan).
3. **Manual Deploy → Restart service.** Logs show **no new** links (the unexpired ones are kept), which proves the database survived the restart.
4. Sign in with your `BOB_PLATFORM_ADMINS` email if you have an account. Otherwise skip this and download a backup later from `/api/cresaro/backup` once you've been added. Keep the backup safe.

**E. When you're ready, and not before**
1. Send Luke his link, and Ryan his, yourself.
2. After they accept: Luke is shown as **Owner** and Ryan as **Admin** in Settings → Team, and there's **no** "storage isn't permanent" strip.
