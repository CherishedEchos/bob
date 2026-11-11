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

## Testing the database policies

```bash
# with a local Postgres 16:
psql -f supabase/tests/auth_stub.sql -f supabase/migrations/0001_bob_multitenant.sql -f supabase/tests/rls_test.sql
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
