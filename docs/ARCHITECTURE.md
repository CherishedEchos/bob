# Bob — architecture

**Bob** (by Cresaro) is a voice-first admin assistant for UK trade businesses. **Ninety3 Carpentry & Build** is the first pilot organisation.
*You do the work. Bob does the admin.*

## One engine, three ways in

```
 Voice (browser speech → text) ─┐
 Text chat ─────────────────────┼─► POST /api/bob/message ─► conversation.handleTurn
                                │                               │
                                │             ┌─────────────────┴─────────────────┐
                                │             │ Engine (picks tools)              │
                                │             │  • Claude (ANTHROPIC_API_KEY)     │
                                │             │  • Rules engine (demo / fallback) │
                                │             └─────────────────┬─────────────────┘
                                │                               ▼
 Dashboard buttons/forms ───────┴──► /api/ops, /api/bob/actions ─► Tool registry + Action engine
                                                                  │  (permissions, zod validation,
                                                                  │   approvals, idempotency, audit)
                                                                  ▼
                                                     Services (records, finance, reports)
                                                                  ▼
                                               Org-scoped DB (SQLite locally / Supabase + RLS)
```

Voice and text are the same request: the browser turns speech into text and sends it like typing. The dashboard uses the same services, so permissions, validation and the audit log are shared. External or financial actions started from the dashboard (sending an email or invoice) go through the same approval card that Bob uses.

## Key modules

| Path | What it does |
|---|---|
| `src/server/db/` | Local SQLite database (Node built-in). `scoped(ctx)` binds `org_id` from the session into every query, so no request body can choose the organisation. `seed.ts` holds the fictional data for Ninety3 (sample) and Ridgeway (demo business). |
| `src/server/auth/` | Login with scrypt password hashes. Sessions use a random token in an httpOnly cookie, and only its SHA-256 is stored. Login is rate limited, and membership is re-checked on every request. |
| `src/server/services/` | Domain operations: customers, enquiries, jobs, tasks, costs, quotes, invoices, payments, privacy. Every write checks the role, validates input (zod), stays inside the org, runs in a transaction and writes an audit entry. |
| `src/server/services/reports.ts` | Deterministic reporting (enquiry counts by channel and period, quotes, jobs won or booked, money owed with source and last-updated time, today's summary). Bob only explains these numbers; he never calculates them himself. |
| `src/server/bob/tools.ts` | **The only way Bob reads or changes data.** Read tools run automatically for permitted roles. Action tools have `prepare` (validate, check eligibility, build a preview, write nothing) and `execute`. |
| `src/server/bob/actions.ts` | Action engine. It checks permission when an action is proposed and again when it is approved. Approval is an atomic `pending → executing` change, so an action runs at most once. Each action gets a unique idempotency key, which is passed to providers. Identical requests within 15 minutes are de-duplicated. Pending actions expire after 30 minutes, and undo is available for 30 minutes after an action runs. Failures are logged. |
| `src/server/bob/rules.ts` | Deterministic conversation engine: intents, multi-turn questions for missing details, "which one?" choices, corrections ("no, I meant…"). |
| `src/server/bob/claude.ts` | LLM engine. It uses Claude tool use over the same registry, filtered by the user's role. When an action needs approval, the turn stops so the model can't chain further actions. It falls back to the rules engine on error. |
| `src/server/bob/resolve.ts` | Works out which customer, job or enquiry the user means, using names, towns and type of work. If it's ambiguous Bob asks; he never picks one. |
| `src/server/integrations/` | Provider-independent email and accounting interfaces. OAuth for Gmail, Outlook, Xero and QuickBooks. Tokens are encrypted with AES-256-GCM. Inbox import is de-duplicated. There are clearly labelled demo adapters, plus prompt-injection detection. |
| `supabase/migrations/0001_bob_multitenant.sql` | Production schema with row-level security per org and role, tested in `supabase/tests/rls_test.sql`. |

## Approval policy

| Category | Examples | Behaviour |
|---|---|---|
| Read | summaries, statistics, lookups | Runs automatically if the role allows it. |
| Internal, low risk | reminders, notes, enquiry status | Runs straight away with an **Undo** button. |
| Internal, consequential | new job, job status, job costs, invoice draft | Confirmation card first. |
| External / financial | send email, send invoice, record payment | Explicit **approval** every time. Demo integrations say "(demo)" and never send anything. |

When an action is approved the engine re-runs `prepare` first, because records may have changed since it was proposed. A duplicate invoice (same job and total) is blocked.

## Never guessing

- **VAT treatment, VAT rate, due dates and payment terms** come from org settings; if they aren't set, Bob asks. Ninety3's finance settings are deliberately left unset.
- **Invoice numbers** are only set from an accounting provider's response. `BOB-0001`-style refs are labelled as Bob's internal reference.
- **Money figures** include where the data came from and when it was last updated.
- **Enquiry totals** say which channels aren't connected.

## Prompt-injection defence

1. Customer text is stored and displayed as data. The rules engine never parses it for commands. The LLM receives it inside `<untrusted_external_content>` tags, with system instructions to treat it as data.
2. Anything external or financial needs a human tap to approve, so injected text cannot send, pay or delete anything.
3. A heuristic flags suspicious messages on import and in the UI.

## Multi-tenancy

- Every business row has `org_id`. Locally, isolation comes from `scoped(ctx)`. In Supabase it comes from RLS policies that use `is_member()` / `has_role()` on `auth.uid()`.
- Org configuration (`OrgConfig`): name, logo, accent, services, area, hours, contact details, assistant sign-off, finance settings, retention period, and data mode (`sample` / `live`).
- A user can belong to several organisations. The workspace switcher only offers orgs they are a member of.

## Going to production (not done yet)

The local SQLite layer is complete and tested. The Supabase schema and RLS are written and tested on Postgres 16, but the app has **not** been switched to a Supabase data adapter or to Supabase Auth. See `docs/SETUP.md` → "Before real data".
