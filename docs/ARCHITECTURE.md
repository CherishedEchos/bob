# Architecture & roadmap

## Principles

1. **One app, two experiences.** The same routes and components serve phone and desktop. Layout changes at the `lg` breakpoint (sidebar + panels) and the phone shell (bottom tabs, voice-first home).
2. **The assistant proposes, the person confirms.** Engines are pure functions from text + data to a reply. Any change comes back as a `ProposedAction`; only `executeAction` applies it, and only after the user taps Confirm.
3. **Every write goes through one path:** validate (zod) → apply → audit log → persist. Forms, the assistant and future integrations all use it.
4. **No customer data in public pages.** Pages render client-side from the user's own data; in production, data is fetched with the user's session under RLS. `robots: noindex` and `X-Robots-Tag` are set globally.

## Assistant layer

```
User text/voice ─▶ AssistantProvider ─▶ AssistantEngine.respond(text, {data, memory})
                                          │  (pure, no side effects)
                                          ▼
                                   AssistantReply { text, cards, chips, proposal? }
                                          │
                    Confirm tapped ──▶ executeAction(proposal, store.actions)
                                          │  validated write + audit entry
                                          ▼
                                   reply built from the recorded result
```

- `DemoAssistantEngine`: regex intents and slot filling (e.g. it asks for the missing job details).
- **Next: `LlmAssistantEngine`.** The client POSTs to `/api/assistant`. The server authenticates, checks the role, validates, then calls the model with **tool definitions that mirror `ProposedAction`** (create_job, record_payment, save_draft, mark_replied, create_reminder) plus read-only tools (list enquiries, job finance and so on). The model returns proposals; the client still renders the confirmation card. Keep the deterministic parsers as validators for model-supplied arguments (e.g. amount ≤ balance, customer exists).
- Speech: swap `useSpeechRecognition` for a `SpeechToTextProvider` (server-side, DPA-covered). Record with `MediaRecorder`, upload, and transcribe.

## Data

The demo uses `LocalDemoRepository` (localStorage, whole snapshot). For production:

1. Apply `supabase/migrations/0001_initial_schema.sql` (tables, enums, RLS, audit_log). Use a UK/EU region project.
2. Implement `SupabaseRepository` with per-entity server actions. Each action does `requireUser()` → `can(role, perm)` → zod parse → write + `audit_log` insert in one transaction (Postgres function or RPC).
3. Replace the store's in-memory mutations with calls to those actions (keep the same `Result<T>` signatures so the UI doesn't change).
4. Move reads to server components or route handlers using `getSupabaseServerClient()`.

Money is stored as integer pence in the database. The UI uses pounds.

## Security & UK GDPR checklist (before real data)

- [ ] Supabase Auth with email + password/magic link and **MFA** for both users; set `AUTH_REQUIRED=true`; complete session refresh in `middleware.ts`.
- [ ] Roles: `owner`, `admin` in `memberships`; enforce `can()` in every server action as well as RLS.
- [ ] RLS on every table (in migration); test with a second organisation to prove isolation.
- [ ] Audit log insert-only; surface it in Activity.
- [ ] Secrets only in server env / Supabase Vault. Nothing sensitive in `NEXT_PUBLIC_*`.
- [ ] Rate-limit `/api/*`; validate webhook signatures (Meta) and OAuth state.
- [ ] Content Security Policy (add once third-party origins are known).
- [ ] UK GDPR: privacy notice for customers, lawful basis (legitimate interests / contract), retention policy (e.g. delete enquiries that never converted after 24 months), subject access export, erasure via `customers.anonymised_at`, DPAs with Supabase, the AI provider and the speech provider, record of processing.
- [ ] Backups and point-in-time recovery enabled.

## Integrations (interfaces in `src/lib/integrations/types.ts`)

| Integration | Approach |
|---|---|
| Gmail / Microsoft 365 | OAuth (server-side tokens), poll or push notifications → `InboundMessage` → enquiry; replies sent only after confirmation |
| Instagram DMs | Official Meta Graph API on a Business/Creator account, webhook with signature verification, 24-hour reply window |
| Phone | Manual capture already works ("Log enquiry"); later, call logs or voicemail transcription |
| Speech | Server STT/TTS provider with a UK GDPR DPA |
| Accounting | Xero / QuickBooks / FreeAgent: push invoices, pull paid status into `payments` |
| Notifications | Web Push via service worker (PWA) for new enquiries and due reminders |

## Recommended next stage

**Stage 6: real accounts and data.** Supabase project (UK/EU), Auth with MFA for owner and office, apply the migration, implement `SupabaseRepository` and server actions, and add a service worker for installable offline shell and push reminders. Then **Stage 7:** connect the LLM engine behind `/api/assistant` with proposal-only tools. Then **Stage 8:** Gmail/M365 and Instagram intake, so enquiries arrive automatically.
