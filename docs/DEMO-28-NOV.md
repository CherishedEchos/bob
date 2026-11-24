# Ninety3 demonstration: Saturday 28 November 2026

The demo uses the **Ninety3 demonstration workspace** (slug `ninety3`). Every customer, address and phone number in it is fictional, and the app shows a "Demo workspace" label.

Luke (Owner) and Ryan (Admin) each sign in with their own email and password. They share the same:

- Diary
- Jobs and customers
- Enquiries
- Team and subcontractors, and holidays
- Tasks and materials
- Money
- Documents and handover reports

Anything one of them changes, the other sees on the next page load.

The separate live workspace (`ninety3ltd`, see `NINETY3-GO-LIVE.md`) is not touched.

## 1. Set up Luke's and Ryan's sign-ins (Render)

**Render → bob → Environment → Environment Variables**, add:

| Key | Value |
|---|---|
| `BOB_DEMO_LUKE_EMAIL` | the email Luke will sign in with |
| `BOB_DEMO_LUKE_PASSWORD` | a password of at least 10 characters |
| `BOB_DEMO_RYAN_EMAIL` | the email Ryan will sign in with |
| `BOB_DEMO_RYAN_PASSWORD` | a password of at least 10 characters |
| `BOB_SHOW_DEMO_LOGINS` | `false`, so the sign-in page shows only the email and password form |
| `BOB_PLATFORM_ADMINS` | your Cresaro email (for `/cresaro`); never Luke's or Ryan's |
| `ANTHROPIC_API_KEY` | already set, keep it (the full AI assistant) |

Then **Save Changes** → **Manual Deploy → Deploy latest commit**.

- **Use different emails from the live workspace.** If an email is already used by another Bob account, that sign-in isn't changed, and the Logs say why.
- **What a successful deploy logs:** `Ninety3 demo: Luke's individual sign-in is set.` (and the same for Ryan).
- **Survives the free plan's disk wipe.** The sign-ins are re-applied on every start, so they come back after a redeploy or restart. The demo data, including the finished handover report, is rebuilt at the same time.
- **Changing a password** signs that person out everywhere.
- **The shared demo password no longer opens Luke's or Ryan's account** once these are set. The other fictional demo accounts still work while `BOB_SHOW_DEMO_LOGINS` is true.
- **Send each person their password yourself** (by phone or in person). Bob never sends credentials.

## 2. Before the demo (Friday)

1. Open the site once, so the free instance wakes up (a first load after idling can take about a minute).
2. Sign in as Luke and check the Diary shows this week's bookings.
3. Settings → Data & privacy → **Reset sample data**. This restores the demo after any rehearsal and rebuilds the handover report.
4. On each phone, sign in and **Add to Home Screen**.
   - iPhone: Safari → Share → Add to Home Screen.
5. Optional, as Cresaro admin: `/cresaro` → **Test connection** to confirm the AI key works. Check the monthly limit isn't close.

## 3. Suggested walkthrough (about 12 minutes)

1. **Luke's phone, from the home-screen icon.**
   - The Diary opens on today: who's where, what's next, and holidays (shown in purple).
   - Tap tomorrow in the week strip.
2. **Ask Bob, spoken.** Tap the mic and say: *"Where is everyone working tomorrow?"* Bob answers in a sentence and reads it aloud.
3. **Ask Bob, an action.** Say: *"Book Sam Okoro on the Reigate media wall on Friday, 8 till 4, and remind Ryan to order the oak veneer."*
   - Two compact cards appear: **Book work** and **Add task**.
   - Approve both.
4. **Ryan's phone.**
   - Ryan opens Tasks and sees the oak task under Today.
   - He opens the Diary and sees Sam's Friday booking.
   - Then Jobs → **Media wall** → **Add material**: "Oak veneered MDF 18mm × 6".
5. **Luke, desktop.**
   - Materials shows Ryan's item to order.
   - Open the **Oak Road kitchen** job, then use the **Ask Bob** button (bottom right).
   - Say or type *"Add another £450 for the shelving"*. Bob prepares a **Record variation** card for that job, because it knows which page you're on.
6. **Handover report.** Jobs → **Garden room** (Completed) → **Handover report**. It opens its own five-step workspace:
   - **Job details:** already filled in from the job.
   - **Photos & documents:** tap photos to tick them, **Add photos** from the phone, **Make cover**, and tick the electrical certificate.
   - **Your report:** **Let Bob write my report** (it uses the updates, photos, agreed extras and documents, and never invents work or certificates). Edit a line, or tap **Ask Bob to change this** and say "make it friendlier".
   - **Costs:** one switch, **Include financial summary in customer report**. It shows agreed price, the cedar step extra, payments and the £650 balance; never your own costs.
   - **Review & finish:** the PDF preview, then **Download PDF** (saves a numbered version), **Download full handover pack** (one ZIP with the report, photos and documents) and **Prepare email to customer** (opens in your own email app; Bob sends nothing).
   - **Save & exit** at any point; the job page then shows *In progress*, and coming back carries on at the same step.
7. **Money.**
   - The three headline figures: owed, overdue (part of owed) and received, with the dates shown.
   - Ask Bob: *"Prepare an invoice for the final balance on Sophie Mackay's Oak Road kitchen."* It saves a draft that hasn't been sent.
8. **Activity** (More → Activity): **Just me** shows Luke's changes; **Everyone** shows Ryan's too.

## 4. What's tested

| Check | Result |
|---|---|
| Unit and integration tests (`npx vitest run`) | 266 passed |
| Typecheck, lint, production build | clean |
| `scripts/e2e-demo-collab.cjs`: Luke and Ryan in separate sessions with individual sign-ins. Luke books and Ryan sees it; Ryan adds materials and Luke sees them; job and task updates both ways; names in Bob; permissions; no Cresaro access | 24/24 |
| `scripts/e2e-ux-tasks.cjs` at 375, 390, 820 and 1440 px: tomorrow's work, add a job, a customer's address, book a holiday, upload a photo, add materials, money owed, an invoice through Bob, desktop Ask Bob with page context. Also: the floating nav never covers the last control, no sideways scrolling, 44 px+ job actions | 63/63 |
| `scripts/e2e-pilot-flows.cjs` (updated to the current screens) | 104/104 |
| `scripts/e2e-team-flows.cjs` (updated to the current screens) | 68/68 |
| `scripts/e2e-pilot-upgrade.cjs` | 61/61 |
| `scripts/e2e-handover-report.cjs` | 26/26 |
| `scripts/e2e-ask-bob-invoice.cjs` | 14/14 |

Ask Bob's actions are tested against a scripted model (no API spend):

- creating and editing customers and jobs
- scheduling and rescheduling, and allocating employees and subcontractors
- booking holidays
- tasks for Luke or Ryan
- adding and amending materials
- invoice drafts and handover reports
- questions answered from across the workspace
- follow-ups that keep context
- workspace isolation and role permissions
- a cancelled preview that can't be approved later

## 5. Needs a manual check

- **The live Anthropic API.** Automated tests use a scripted model, so on the deployed site run a short rehearsal of the walkthrough's spoken and typed requests.
  - Confirm Bob answers with the full assistant: no "built-in assistant answered" note.
  - Check `/cresaro` shows the calls, cost and cache hit rate.
- **A real iPhone.**
  - Microphone permission and speech recognition (Safari).
  - Spoken replies.
  - Camera upload from **Upload photo**.
  - Add to Home Screen, and the keyboard pushing the text box up.
  - The floating bar clearing the home indicator.
- **Render settings.** Set the environment variables above, and check the Logs show both sign-ins set after deploy.
- **Photos.** Project pictures are still the drawn placeholders, labelled "Illustrative image".
  - To swap in Ninety3's own photographs, add them to `public/demo/photos/` with a `manifest.json` (see `src/server/db/demo-photos.ts`). They then show as "Demo photo" with no other change.

## Not changed

- Render plan: still free.
- No paid services were turned on.
- No real customer accounts were connected.
- Nothing was sent externally.
