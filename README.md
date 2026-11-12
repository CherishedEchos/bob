# Bob

**You do the work. Bob does the admin.**
Bob is a voice-first AI admin assistant for UK trade businesses, built by **Cresaro**. **Ninety3 Carpentry & Build** is the first pilot customer.

You can talk to Bob, type to him, or use the dashboard. All three use the same server-side engine, the same permissions and the same approval workflow.

> **Demo mode.** The local build runs on a SQLite database with **fictional** data for two organisations. No real email or invoice is ever sent: Ninety3 has no integrations connected, and Ridgeway uses clearly labelled *simulated* adapters.

## Quick start

```bash
npm install
npm run dev      # → http://localhost:3000 (Node 22+)
npm test         # engine + safety tests
```

On `/login`, tap **Try the demo**. It opens the Ninety3 workspace with fictional records, and nothing is ever sent. Other demo logins are tucked under "Other demo logins":

- **Ninety3 workspace** (sample data, VAT/terms not configured, no integrations): Owner · Office · Site team
- **Ridgeway Build & Joinery** (fictional demo business, VAT 20%, 14-day terms, demo inbox and demo accounting): Alex (owner) · Priya (office) · Sam (site team)

## First demo: Today, Enquiries, Ask Bob

1. **Today:** the three most important things, each with one action button. Reminders about the same issue are merged, and business stats sit below.
2. **Enquiries:** *Needs your reply / Follow up / All*, with Filters behind one button. **Add enquiry**, then **Ask Bob who needs a reply**.
3. Ask Bob *"Draft a reply to <name>"*, edit the draft in the card, then tap **Save draft**. Open the enquiry: the customer's message sits beside the draft. **Copy** leaves it open; **Mark as replied** clears it from Today and the count.
4. **Ask Bob:** the input sits at the top. If several enquiries match, Bob asks which one. If the mic fails, typing keeps working.

## Things to try

| Say or type | What happens |
|---|---|
| "Bob, what needs sorting today?" | Summary built from your records, plus a priorities card |
| "How many enquiries have I had in the last month?" | Counts by channel from the database, the exact period, how many still need action, and which channels aren't connected |
| "Remind me to call Dave tomorrow" | Finds Dave Collins and creates the reminder straight away, with **Undo** |
| "Add a new kitchen job for Sarah in Crawley for £12,000" | Matches the existing customer (offers "different Sarah") and shows a confirmation card before adding |
| "Invoice Sophie £7,500 for the Copthorne job" | Finds the right Sophie and job, checks existing invoices, and asks about VAT and the due date. Ninety3: saves a **draft** that can't be sent. Ridgeway: **simulated** send after approval |
| "Who's not paid me?" / "Has James paid his deposit?" | Answer from recorded data, with the source and last-updated time |
| "Draft a reply to the customer who emailed about decking" | Draft to edit. Send needs approval; if email isn't connected, it's saved as a draft instead |
| "Add £450 of materials to the Copthorne job" | Asks which one (there are two Copthorne jobs) |
| Ridgeway → Enquiries → **Check demo inbox** | Imports emails. One contains a prompt-injection attempt, which is flagged and ignored |

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the engine, approvals, multi-tenancy and safety work
- [`docs/SETUP.md`](docs/SETUP.md): credentials, integrations, RLS tests, and the go-live checklist for Ninety3

## Status

| Working (tested) | Written, not yet live-tested | Not started |
|---|---|---|
| Auth and sessions, org isolation, roles, Bob tool registry and approval engine, rules engine, reporting, enquiries, jobs, customers, tasks, costs, quotes, invoice drafts, payments, audit log, demo integrations, GDPR export/erase/reset, Supabase RLS (on Postgres 16) | Claude engine (unit-tested with a mocked API), Gmail, Outlook, Xero and QuickBooks adapters and OAuth | Supabase data adapter and Supabase Auth, server-side speech-to-text, Instagram, website-form webhook |
