# Bob redesign: premium product and intelligent diary (Nov 2026)

A refinement of the existing product. Nothing was rebuilt from scratch: the same data, sign-in, workspaces, Ask Bob engine, ElevenLabs voice, usage limits, Cresaro admin and API routes.

## Before and after

`docs/screenshots/redesign/before/` and `docs/screenshots/redesign/after/` hold every major section at five widths: 1920 desktop, 1440 laptop, 1024 tablet, 390 phone and 375 phone. Each file is named `<before|after>-<size>-<page>.jpg`.

- Pages covered: Diary (Week, Team and Month), Ask Bob, Enquiries, Jobs, a job profile, the handover, Activity, Customers, Tasks, Team, Materials, Merchants, Money and Settings.
- `after/diary-*.jpg` come from `scripts/e2e-diary.cjs`: the week, team, month and phone views, and the clash check.

## Design system

**Type and colour**

- **Typeface:** Inter, self-hosted under the SIL Open Font License, with no external font requests. Tabular figures are used for money and times.
- **Background and text:** a warm off-white workspace (`#f7f6f3`), white surfaces, near-black text and muted grey secondary text.
- **Borders and elevation:** hairline warm borders. Shadows appear only on things that float.
- **Orange (`#F38735`):** reserved for key actions, the selected navigation marker and Bob's voice.
- **Status colours:** green for real success, red for overdue items and clashes, amber for warnings, and violet for holidays.

**Shapes and controls**

- **Corners:** tight radii (6/8/10/14 px).
- **Filter chips:** selected chips are near-black instead of orange.
- **Badges:** quiet, with a dot.
- **Tables:** sentence-case column headers.

**Desktop navigation**

- A light, collapsible sidebar with line icons and plain group headings.
- The workspace identity (Ninety3 with bob) sits at the top, with the account menu at the bottom.
- The selected item is a white row with a slim orange marker.
- Ask Bob's icon stays orange, so it is easy to find without being loud.

**Loading:** the loading screen is light and brief, so there is no dark flash before the workspace.

## Diary

- **Views:** Week, Month and Team. Each person's choice is remembered. A date picker, Previous, Today and Next, and a Weekends switch sit in the toolbar.
- **Summary line:** for example "4 active sites · 6 people scheduled · 1 person off · 1 needs someone · 1 clash".
- **Week view:**
  - Multi-day work is one continuous block. Each job keeps its colour.
  - Each block shows the job, customer, town, time and people.
  - Holidays sit above the work. Work with nobody assigned is hatched amber. Clashes are outlined red.
  - Each day lists who is free, and hovering a day shows "+ Add".
- **Team view:**
  - People are rows (staff, then subcontractors, including Luke and Ryan), with their role and a column per day.
  - Shows bookings, leave, "Free", "Free AM" or "Free PM", clashes, and a "Needs someone" row.
  - Drag along a row to move work, or onto another person to reassign it. The server checks for clashes first and nothing is saved until the planner confirms ("Book anyway" or "Leave it as it was"). Multi-person bookings stay as one booking.
- **Month view:** bookings and who is off, day by day. Clicking a day number opens that week.
- **Phone:** a day-grouped agenda starting today, with the earlier days of the week folded away.
  - Large cards show the customer, town, time, people, Directions and Open job.
  - Team filter chips and a prominent Schedule work button.

## Ask Bob scheduling

These requests are covered by tests in `tests/demo-ask-bob.test.ts`:

- "Where is everyone working tomorrow?"
- "Who's free next Tuesday?"
- "Move Liam onto the Copthorne kitchen on Friday." Bob books him there and takes him off that day's other job, as two previews.
- "Book Ryan on the staircase job next Monday."
- "Put Callum on holiday next Thursday."
- "Have I double-booked anyone this week?" This uses the new `find_double_bookings` tool, and there is a built-in answer that works without the AI model.

Every change still goes through a preview and approval, and the diary updates as soon as it is approved.

## Other screens

- **Jobs:** list view is the default, as a table. On wide screens it shows job, customer, location, stage, value, next visit, team and next action. Photo cards stay one click away.
- **Job profile:**
  - A compact header: photo thumbnail, status, customer, address, what3words, Directions, Call and More.
  - A facts strip: contract value, next visit, assigned team, next action and contact.
  - Quick actions underneath.
- **Financial position:** one connected strip showing value, received, outstanding, costs recorded and estimated profit, labelled as internal figures.
- **Money:** one connected strip for owed, overdue and received.
- **Team:** a desktop table showing today, next booking, free days this week, holiday and Bob access. Phones keep the cards.
- **Enquiries:** quiet channel marks; the gradient tiles are gone.
- **Ask Bob:** keeps the dark experience and the orange orb, with less glow and a clearer microphone.
- **Handover:** only one orange action at a time. Once the handover is finished, that action is "Send to customer".

## Demo data

The Ninety3 demo now schedules work two to four weeks ahead. It includes one double booking on each of this week and next, plus a visit that still needs someone, so the planner has something to show.

Luke and Ryan are bookable people, linked to their own accounts. The live workspace (`ninety3ltd`) is not touched.
