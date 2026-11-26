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

---

# Round 2: premium, approachable and unmistakably Bob

The first redesign leaned too corporate. This pass brings back warmth, contrast and Bob's character, and keeps the improved structure. Before and after screenshots at five widths are in `docs/screenshots/redesign-2/`. The "before" set is round 1's "after" set.

## Type and colour

**Type sizes**

| Element | Size |
|---|---|
| Page titles | 32px (28px on phones) |
| Section headings | 18px |
| Body and list text | 15–16px |
| Supporting text | 13.5–14.5px |
| Headline money figures | 32px |

- Small text was lifted across every screen (11–14.5px became 12–15px). The Diary was tuned by hand.

**Controls**

- Primary buttons are solid orange, 44px high and semibold.
- Inputs and dropdowns are 44px high.
- Segmented tabs are 40px high and wrap onto a second line instead of being cut off.

**Colour**

- Warm greys with stronger contrast and warmer borders.
- Selected chips, tabs and the date picker use a soft orange tint instead of black.

## Sidebar

- 244px wide, with the full Ninety3 wordmark and "with bob." underneath.
- Navigation labels are 15px with 20px icons.
- The selected page has a warm orange background and a strong orange marker. Enquiries and Tasks show orange counts.
- **Ask Bob** is a dark charcoal button with Bob's orange microphone. It opens Bob beside the page, so Bob knows which job or enquiry is on screen. It replaces the floating button, which covered page actions.
- The signed-in person shows their name, role and business at the bottom.

## Diary

- **Ask Bob strip:** a dark strip with Bob's microphone, examples to try ("Move Liam onto the Copthorne kitchen tomorrow", "Book Ryan in for a site visit on Friday") and one-tap questions.
  - Changes still come back as previews with clash checks.
  - On phones it's a compact strip that opens the microphone.
- **Toolbar controls** are 44px: Today, Previous and Next, date picker, Week, Month and Team, person filter and Weekends. Schedule work stays the orange page action, with Holidays beside it.
- **Bookings:** larger names (14.5px), customer and town at 13px, and clearer times.
  - Today's date is an orange circle.
  - Day headers say "3 on site".
  - Team rows show bigger names and roles, and "Free" in green.
- **Phone:** today is an orange pill, the person chips use the warm selected style, and the cards are larger.

## Enquiries

- **Clipping:** the heading and filter tabs are no longer clipped. Tabs wrap as rounded chips instead of scrolling sideways.
- **Layout:** side by side only from 1280px, with a 340–400px list and a reading pane capped at about 1000px. Below that width it's inbox first, then the message, which fixes the cramped 1024px layout.
- **Reading pane:** the message column is left-aligned with a sensible width, so it no longer floats in empty space.
- **Reply actions:** Copy reply, Save draft and I've replied are full-size buttons in the sticky reply bar, with nothing covering them.

## Other screens

- **Jobs:** the job name is the strongest element (16px bold) with a larger photo thumbnail. The table shows customer, location, stage, value, next visit and team; the dense "Next action" column was dropped. The Add job button is prominent and the filter chips are warm.
- **Money:** the tab is now **Bills to pay**, so it can't be confused with money owed to you. Headline figures are 32px.
- **Team:** larger avatars.
- **Tasks:** larger checkboxes.
- **Materials:** the status tabs fit on a 375px phone.
- **Ask Bob:** a warm, personal greeting, for example "Morning, Luke. What are we sorting today?" or "Evening, Ryan. What do you need a hand with?"
