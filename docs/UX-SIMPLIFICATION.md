# Usability pass

Before-and-after screenshots at phone (390 px), tablet (820 px) and desktop (1440 px) widths are in `docs/screenshots/ux-simplification/`.

## What changed

- **Navigation:**
  - The order is Diary, Ask Bob, Enquiries, Jobs, Customers, Tasks, Team, Materials, Merchants, Money, then Settings. The phone More sheet follows the same order.
  - On phones, job pages get a back link in the top bar.
  - The microphone glow is softer and stops pulsing when reduced motion is on.
  - Pages leave room at the bottom so the floating nav and Ask Bob button never cover the end of a page.
- **Ask Bob:**
  - The home screen is a greeting, the mic, a text box and three suggestions; the shortcut cards are gone.
  - On desktop, an Ask Bob button sits on every page and opens Bob in a side panel.
  - Bob knows which job or enquiry is on screen. On a job page, "add another £450 for the shelving" becomes a variation on that job. The client sends only the record's type and id; the server looks it up within the workspace.
  - Confirmation cards are smaller, with plain titles: Add customer, Save job, Move booking, Add task, Create invoice draft, Book holiday.
  - A cancelled request can't be approved; this is checked on the server.
  - Engine and voice details are shown only to Cresaro admins.
- **Jobs:**
  - The filters are To quote, Quoted, Active and Completed. Won, Unscheduled, In progress and All sit under "More stages".
- **Job page:**
  - Key facts: next visit, people, contact, what3words, plus Directions and Call buttons.
  - Quick actions: Add update, Upload photo, Schedule work, Add material, Create invoice.
  - Seven sections: Overview, Schedule, Updates & photos, Documents, Materials & tasks, Financials, Handover.
- **Team:**
  - Each person's card shows type (employee or sub), today's job, next booking, free days this week and any upcoming holiday, in plain words instead of coloured bars.
  - Tapping a person opens their schedule.
- **Money:**
  - Three headline figures:
    - Owed to you.
    - Overdue, labelled as part of what's owed.
    - Received, with a period choice and the date range shown.
  - Sections: Invoices (with status filters), Bills to pay, Deposits, and an optional Overview with the chart.
  - Create invoice and Record payment buttons sit at the top of the page.
- **Enquiries:** each enquiry has quick actions: Reply, Create quote, Book site visit, Follow up.
- **Tasks:**
  - Tabs for Today (including overdue), Upcoming and Completed.
  - Square checkboxes, and a filter by who the task is for.
- **Materials:** the statuses are To order, Ordered and Delivered.
- **Settings:**
  - Five groups: Your business, Connections, People & access, Bob preferences, Account.
  - Connection statuses use plain words, with short setup guidance.
  - Server variable names are no longer shown.
  - AI usage, model and API diagnostics live in the Cresaro admin area (`/cresaro`).
- **Getting started:**
  - Optional and skippable: business details, team, first job, diary, talking to Bob.
  - It shows only for new workspaces.
  - One-line first-use tips appear on Jobs, the job page and Money; each has a "Got it" button.
- **Accessibility:** reduced motion now also cuts transitions and smooth scrolling.

## Validation

- `node scripts/e2e-ux-tasks.cjs` runs at phone, tablet and desktop widths and passes 43/43 checks. It checks that a user can:
  - find tomorrow's work
  - add a job
  - find a customer's address
  - book a holiday
  - upload a photo
  - add materials
  - check money owed
  - create an invoice draft through Bob

  It also checks the desktop Ask Bob button, which opens with the job as context, and that there are no page errors.
- `node scripts/e2e-pilot-upgrade.cjs` passes 61/61.
- `node scripts/e2e-handover-report.cjs <photos>` passes 26/26.
- Unit tests pass 257/257, including page context, cross-workspace isolation and approving a cancelled request.
- `scripts/e2e-pilot-flows.cjs` and `scripts/e2e-team-flows.cjs` were already out of date before this pass. They expect the earlier "This week" screen and Team list, and need rewriting.
