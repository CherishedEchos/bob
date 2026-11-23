# Ask Bob — capability matrix

Voice and text use the same handler and the same tools. Read-only questions are answered straight away. Every change is shown as a short preview (before → after) that the user approves or edits; it then runs through the app's own service functions (validation, permissions, workspace isolation, activity log with who and when). Repeating a request within 15 minutes returns the same pending/finished action instead of a second record. No tool accepts SQL or raw table writes.

Key: **Preview** = shown for approval first · **Undo** = runs at once with an Undo button · **External** = needs a connected service.

| Area | Action | Tool | Confirmation | Notes |
|---|---|---|---|---|
| Diary | Create booking | `create_booking` | Preview | Clashes with other bookings and leave shown first; duplicate bookings refused |
| Diary | Reschedule / change times / make all day | `update_booking` | Preview | Moving the start keeps the length unless an end date is given |
| Diary | Assign / reassign people | `update_booking` (people, addPeople, removePeople) | Preview | Ambiguous names get "which Sam?" |
| Diary | Cancel booking | `cancel_booking` | Preview | Cancellation; Undo puts it back |
| Team | Add employee or subcontractor | `add_person` | Preview | No login created; invites stay in Team |
| Holidays | Book holiday / unavailable / sick | `book_holiday` | Preview | Overlapping leave and affected bookings flagged; exact duplicates refused |
| Holidays | Amend dates or type | `amend_holiday` | Preview | |
| Holidays | Cancel leave | `cancel_holiday` | Preview | |
| Holidays | Approve / decline request | `decide_holiday_request` | Preview | Owners/admins |
| Holidays | Check availability and conflicts | `get_team_availability`, `get_schedule`, `list_holidays` | Read | |
| Jobs | Create job | `create_job` | Preview | Price must come from the user |
| Jobs | Edit title, description, address, town, what3words, start date, next step | `update_job` | Preview | |
| Jobs | Change status | `update_job` | Preview | Warns if money is still owed when completing |
| Jobs | Update price / deposit | `update_job` | Preview | Money access required |
| Jobs | Record variation | `record_variation` | Preview | VAT treatment from company settings |
| Jobs | Add progress note (timeline) | `add_progress_note` | Preview | Office notes: `add_note` (Undo) |
| Customers | Create customer | `create_customer` | Preview | Warns about a same-name customer |
| Customers | Correct name, email, phone, address | `update_customer` | Preview | Plain-English messages for invalid email etc. |
| Materials | Add to a job | `add_material` | Preview | Never orders from a merchant |
| Materials | Amend quantity, needed-by date | `update_material` | Preview | |
| Materials | Assign merchant | `update_material` (merchant) | Preview | Merchant matched by name |
| Materials | Update ordering / delivery status | `update_material` (status, orderRef, expectedDelivery) | Preview | |
| Tasks | Create and assign (incl. Ryan/Luke), priority, deadline | `create_task` | Preview | Duplicate reminders refused |
| Tasks | Amend | `update_task` | Preview | |
| Tasks | Mark complete / reopen | `complete_task` | Undo | |
| Money | Prepare invoice draft | `save_invoice_draft` | Preview | Amount from Bob's billing; VAT, rate and terms from Settings; asks only if not configured |
| Money | Amend draft invoice | `save_invoice_draft` (invoiceId) | Preview | |
| Money | Record confirmed payment | `record_payment` | Preview | Financial |
| Money | Prepare payment reminder | `draft_payment_reminder` (+ `send_email`) | Draft shown; sending is Preview + External | Sending needs Gmail/Outlook connected |
| Money | Send invoice | `send_invoice` | Preview + External | Needs Xero or QuickBooks |
| Enquiries | Create enquiry | `create_enquiry` | Preview | Duplicate open enquiries refused |
| Enquiries | Draft customer reply | `save_email_draft` | Preview | Sending: `send_email`, External |
| Enquiries | Update status | `set_enquiry_status` | Undo | |
| Quotes | Prepare quote | `create_quote` | Preview | |
| Quotes | Edit quote | `update_quote` | Preview | Not once accepted/declined |
| Quotes | Convert accepted quote to job | `convert_to_job` | Preview | Idempotent — never a second job |
| Handover | Generate report (AI draft from updates and photos) | `create_handover_report` | Preview | Built-in draft if AI is unavailable; checked in the editor before sharing |
| Handover | Amend summary | `amend_handover_summary` | Preview | |
| Handover | Choose photos / documents, export PDF | Handover tab | In the app | Bob opens the tab; photo picking stays visual |

Requires an external integration: sending invoices (Xero/QuickBooks), sending emails and payment reminders (Gmail/Outlook). Without them Bob saves drafts in Bob and says so.
