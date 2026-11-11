# Ninety3 Assistant

Bespoke operations assistant for **Ninety3 Ltd**, built by **Cresaro**.
One responsive web app: a voice-first assistant on the phone and a clear operations dashboard on desktop.

> **Demo build.** All customers, jobs and payments are fictional and live only in your browser.
> No email, Instagram, speech, accounting or database accounts are connected.

## Run it locally

Requires Node.js 20+ (tested on Node 22).

```bash
npm install
npm run dev
```

Open http://localhost:3000. On a desktop browser `/` goes to the Overview; on a phone (or a narrow window) it shows the voice assistant.
To try it on your phone, run `npm run dev -- -H 0.0.0.0` and open `http://<your-computer-ip>:3000` on the same Wi‑Fi (voice needs HTTPS or localhost, so typing works but the mic won't be available over plain LAN HTTP).

Production build:

```bash
npm run build && npm start
```

Reset the demo any time: **Settings → Reset demo data** (owner profile).

## What works

| Area | Functional |
|---|---|
| Navigation | Bottom tabs (mobile), sidebar (desktop), More menu, reminders bell |
| Overview | Live stats, today's priorities (with Reply / Open / Done actions), active jobs, reminders, recent activity |
| Enquiries | Filter by status and source, search, open detail panel, change status and priority, set follow-up date, notes, editable suggested reply (copy / save draft), mark as replied (with confirmation), turn into a job, log a new phone/email/Instagram enquiry |
| Jobs | Filter by status, detail panel with quote / deposit / paid / balance, change status, next action, notes, payment history, create a job |
| Payments | Deposits due, outstanding balances, received; record a payment (review → confirm step, over-payment blocked); payment-reminder message to copy, then "I've sent it" logs the chase and sets a follow-up reminder |
| Reminders | Create, complete, reopen, delete (owner only), linked to jobs/enquiries |
| Activity | Audit trail of every change, with who did it |
| Assistant | Chat with typed messages or voice, quick actions, cards you can tap, follow-up suggestions, confirmation cards for every change |
| Roles | Switch between **Owner** and **Office** demo profiles; actions are attributed in the audit log; Office can't delete or reset |
| PWA | Web app manifest, icons, standalone display, safe-area aware layout |

Assistant commands it understands (try typing or saying them):

- "Morning, what have I got to sort out today?" → "Go through them"
- "What have I missed today?"
- "Who needs a reply?" / "Follow up on enquiries"
- "Draft a reply to Tom asking for some photos"
- "Add a job for James in Crawley" → then "Loft conversion, quote £32,000 with a £6,400 deposit"
- "Add a new job for the Smiths. Kitchen refit in Horsham, quote is £14,000 and they've paid a £5,000 deposit today."
- "Mark Sarah's deposit as paid"
- "Remind me to call Dave tomorrow"
- "What jobs are waiting for deposits?" / "Who owes me money?" / "Active jobs"

## What is simulated (and what isn't)

- **Assistant brain:** a deterministic, rule-based engine (`src/lib/assistant/demo-engine.ts`) over the fictional data. It is not an AI model. It asks when details are missing and says when it can't find someone; it never makes up customers or amounts.
- **Nothing changes without confirmation.** The assistant only *proposes* changes. Jobs, payments, replies and reminders are recorded only after you tap Confirm, and the success message is built from what the store actually recorded.
- **Messages are never sent.** Replies and payment reminders are drafts to copy. "Mark as replied" is something you confirm after sending it yourself.
- **Payments** are records of money already received, not card charges.
- **Voice input is real but browser-dependent.** It uses the browser's Web Speech API (Chrome, Edge, Safari), so the browser asks for microphone permission and a red "Listening" indicator shows while it's on. If voice isn't supported (e.g. Firefox), the app says so and switches to typing. In Chrome, speech audio is processed by Google's speech service, so it must be replaced by a provider under a UK GDPR data processing agreement before real customer data is used.
- **Read replies aloud** (assistant ⋯ menu) uses on-device speech synthesis; off by default.
- **Storage** is browser `localStorage`, for demo only.
- **Logo:** `public/brand/ninety3-logo.png` is cropped from the supplied mock-up as a stand-in. Swap in the original artwork using the same filename.

## Project structure

```
src/
  app/(app)/…            pages: / (assistant), overview, enquiries, jobs, payments, reminders, activity, settings
  app/api/assistant      server endpoint for the future AI engine (returns 501 in the demo)
  components/assistant   orb, voice/chat view, cards, confirmation card
  components/…           layout shell, enquiry/job panels, forms, shadcn-style UI primitives
  lib/types.ts           domain model
  lib/derive.ts          pure business logic (balances, priorities, overdue deposits)
  lib/validation.ts      zod schemas for every write (reused server-side later)
  lib/store/             app store (validate → change → audit log → persist) + UI state
  lib/data/              Repository boundary: LocalDemoRepository now, SupabaseRepository next
  lib/assistant/         engine contract, demo engine, parsers, executor (applies confirmed actions)
  lib/voice/             speech recognition hook + read-aloud
  lib/integrations/      interfaces for email, Instagram, phone, speech, accounting, notifications
  lib/auth/permissions   role → permission map
  lib/supabase/          browser/server clients (inactive without env vars)
  middleware.ts          auth gate (off in demo mode)
supabase/migrations/     Postgres schema with Row Level Security and audit log
docs/ARCHITECTURE.md     architecture, security and next steps
```

Note: shadcn/ui's registry couldn't be reached from the build environment, so the primitives in `src/components/ui` were written by hand in the shadcn pattern (Radix + CVA + `cn`). `npx shadcn add …` will work alongside them once you run it on your own machine.
