# Ninety3 live workspace: provisioning and invites

The live workspace is **Ninety3 Carpentry and Build Ltd** (slug `ninety3ltd`). It's separate from the fictional demo (slug `ninety3`, "Demo · sample data"), which stays available as it is.

- **Starts empty:** no jobs, customers, merchants, bills or money records.
- **Settings:** Europe/London time zone, UK dates and £, the existing Ninety3 logo (`/brand/ninety3-logo.png`).
- **Company contact:** `hello@ninety3ltd.co.uk`. This is a contact detail only. It isn't a login, and no mailbox is connected.
- **People:** Luke (owner) and Ryan (admin) each get a Team record, so they can be booked straight away. Each also gets a single-use invite link once their email is supplied.

Logins, emails and invite links never go into the repository. The workspace file lives only on the server (`workspaces*.json` is git-ignored).

## Roles

| | Luke: **Owner** | Ryan: **Admin** (`office`) |
|---|---|---|
| Diary: see, schedule, move and assign workers | ✓ | ✓ |
| Jobs, Enquiries, Customers, Tasks | ✓ | ✓ |
| Materials, Merchants (incl. trade account refs) | ✓ | ✓ |
| Money: invoices, payments, bills to pay | ✓ | ✓ |
| Team: add people, invite staff and subcontractors | ✓ | ✓ |
| Give someone **Admin** access | ✓ | — |
| Remove an admin's access | ✓ | — |
| Settings (business profile, VAT and payment terms, other workspace settings) | ✓ | — |
| Connected accounts (email, Xero/QuickBooks) | ✓ | — |
| Delete/anonymise customer data, retention, export | ✓ | — |

Nobody can remove the owner's access from inside Bob.

## Before real data (needed on the current Render service)

The Render service is on the **free plan**, whose disk is wiped on every deploy and restart. A live workspace there would lose Luke's and Ryan's logins and every job each time. Pick one of these first:

1. **Render paid instance with a disk** (quickest):
   - Render → **bob** → **Settings** → **Instance type** → Starter.
   - **Disks** → **Add disk**, with mount path `/var/data` and 1 GB.
   - **Environment** → add `BOB_DB_PATH` = `/var/data/bob.sqlite`.
   - Set up backups (see `docs/SETUP.md` → Backups and restore).
2. **Supabase:** the planned production database. It isn't wired in yet (see `docs/SETUP.md`).

## Provision the workspace and get the invite links

Merge this branch to main ("push to main"), then in the Render dashboard:

1. **bob → Environment → Secret Files → Add Secret File.**
   - **Filename:** `workspaces.json`
   - **Contents:** paste `docs/workspaces.ninety3.example.json` and **enter Luke's and Ryan's login emails** in the two `"email": ""` fields. These are the addresses they'll sign in with, not hello@.
2. **bob → Environment → Environment Variables:**
   - `BOB_WORKSPACES_FILE` = `/etc/secrets/workspaces.json`
   - `BOB_PUBLIC_URL` = the site's address, e.g. `https://bob-xxxx.onrender.com` (no trailing slash)
3. **Save Changes**, then **Manual Deploy → Deploy latest commit**.
4. Open the site once, e.g. `/login`. The first request starts the database and runs provisioning.
5. **bob → Logs.** Search for `invite link for`. You'll see one line each, with the email partly hidden:
   `Ninety3 Carpentry and Build Ltd: invite link for Luke (owner, l***@…) — works once, 7 days: https://…/invite/…`
   `… invite link for Ryan (admin, r***@…) …`
6. Copy each link and send it from your own phone or mailbox (WhatsApp, text or email). **Bob doesn't send them.** Each link:
   - works once,
   - works only for that email,
   - expires after 7 days.

If an email is still blank, the log says `Luke (owner) is waiting for an email`. The workspace and Team records exist anyway. Add the email to the Secret File, save, and restart (**Manual Deploy → Restart service**) to get the link.

## Opening the invite where a demo is already signed in

If the browser or phone already has the demo open (for example in the meeting), the invite page says so: it shows the demo account that's signed in and the email the invite is for. **Sign in as Luke** signs the demo out and creates Luke's own login for the invited email only. Nothing from the demo is carried over, and the demo account never gets access to the live workspace. A used link can't be claimed again.

## Checking Luke's membership

- In Bob as Luke: Settings → Team lists Luke as **Owner** with his email; the sidebar shows the Ninety3 wordmark and there's no "Demo · sample data" strip.
- In the Render log: once he has accepted, restarts print nothing new for him.
- Activity log (Settings → Activity): "Luke accepted their invite and signed in as the owner".

## What Luke and Ryan do

1. Open the link and choose a password (8+ characters).
2. Click **Set up my login**.
3. They land on the **team diary** in the Ninety3 workspace (people down the side, days across; "Who's where" on a phone). The business overview is under **Overview**. From then on they sign in at `/login` → **Sign in to your business** with their email and password, on any device. "Try the demo" on the same page is separate and only ever opens the fictional workspace.

Each sees the other's changes on the Diary within about 20 seconds, or straight away when they switch back to the tab. Verified in a test workspace: see `scripts/e2e-live-workspace.cjs`.

## Inviting staff and subcontractors (in the app)

1. Open **Team** and tap **Invite someone**.
2. Type their name. If they're already on the crew list, Bob offers **Invite <name>**: choose it, and their existing bookings stay with them.
3. Enter their email and choose **Subcontractor** or **Employee**. Only the owner sees the choice between **My work only** (the default) and **Admin**.
4. Tap **Send invite**. The invite names the business and you.
   - **Emailed:** shown as emailed.
   - **Email failed:** shown as failed, with **Try again**.
   - **Email isn't set up on the server:** Bob says so plainly and shows the link to copy into a text or WhatsApp. It never claims something was sent.
5. On the person's profile, the invite shows as **Invite pending** (sent by whom, when, and whether it was emailed), then **Accepted**. **Resend invite** issues a fresh link (the old one stops working). **Cancel invite** and **Remove access** are there too. Removing access signs them out at once and keeps their bookings and updates.

People can be booked on the Diary before they're invited, or without ever being invited. Subcontractors and staff with "My work only" land on **My work**: their own bookings, the site address with directions, who they're working with, the shared site notes, and buttons to add a photo or an update. They never see prices, other jobs, private notes or Ask Bob.

## If something goes wrong

- **A link expired unused:** restart the service and a new one is printed to the log.
- **A link was lost unused:** add `"newLink": true` to that person in the Secret File and restart. The old link stops working and a new one is printed. **Remove `newLink` afterwards**, or every restart makes a new link.
- **Ryan's link is lost after Luke is set up:** Luke can open **Team → Ryan → Access to Bob**, choose **Admin**, then click **New invite link**.
- **Forgotten password:** there's no self-service reset yet. See the notes below.

## Still to configure

- Persistent storage (above). This must be in place before they start using the workspace for real.
- **Password reset:** there's no "forgot password" flow yet. Until there is, a lost password means removing the person's access (admins) or a server-side reset.
- **Two-step sign-in (MFA):** not built in the current login. It comes with the Supabase Auth switch.
- **Mailbox (hello@ninety3ltd.co.uk):** disconnected. Connecting it needs a Google Cloud or Microsoft Entra app (see `docs/SETUP.md`). Luke connects it in Settings → Connected accounts.
- **Demo on the same site:** while `BOB_SHOW_DEMO_LOGINS=true`, `/login` shows "Try the demo". It opens the fictional workspace only; it has no access to Ninety3's live records. Set it to `false` if you don't want the demo offered on the live site.
- **Ask Bob with Claude:** add `ANTHROPIC_API_KEY` in Render → Environment (optional: `BOB_CLAUDE_MODEL`, `BOB_CLAUDE_EFFORT=low` for snappier voice replies, `BOB_CLAUDE_TIMEOUT_MS`). Without it, Bob's built-in engine handles the invoice conversation. Either way, set VAT status and payment terms in Settings so Bob doesn't have to ask on each invoice. Invoices are only ever saved as drafts in Bob unless Xero or QuickBooks is connected and someone approves sending.
