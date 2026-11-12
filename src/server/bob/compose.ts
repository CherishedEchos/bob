import "server-only";
import { buildDraft } from "@/lib/reply-draft";
/** Wording helpers for Bob's replies and customer email drafts (filled from records). */
import type { Customer, Enquiry, Invoice, Job, OrgConfig, Quote } from "@/lib/types";
import { firstName, formatDateInline, gbp } from "@/lib/utils";

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function numberWord(n: number) {
  return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}

export function listNames(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  if (extra > 0) shown.push(`${extra} more`);
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export function greetingFor(date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }).format(date));
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

export interface Draft {
  to: string;
  subject: string;
  body: string;
  purpose: "reply" | "follow_up" | "deposit_reminder" | "quote_follow_up" | "invoice_reminder";
}

export function replyDraft(org: OrgConfig, e: Enquiry): Draft {
  return {
    to: e.email ?? "",
    subject: `Re: ${e.title}`,
    // Same rules as the enquiry screen: no unconfirmed dates, prices or promises.
    body: buildDraft(e).draft,
    purpose: "reply",
  };
}

export function quoteFollowUpDraft(org: OrgConfig, c: Customer, q: Quote): Draft {
  return {
    to: c.email ?? "",
    subject: `Your quote: ${q.description}`,
    body: `Hi ${firstName(c.name)},\n\nI just wanted to check you received our quote for the ${q.description.toLowerCase()} and see if you had any questions. Happy to talk through any options or adjust anything.\n\n${org.assistant.signOff}`,
    purpose: "quote_follow_up",
  };
}

export function enquiryFollowUpDraft(org: OrgConfig, e: Enquiry): Draft {
  return {
    to: e.email ?? "",
    subject: `Following up: ${e.title}`,
    body: `Hi ${firstName(e.customerName)},\n\nJust following up on the ${e.title.toLowerCase()}. Let me know if you have any questions, or if you'd like to arrange a time for us to come out.\n\n${org.assistant.signOff}`,
    purpose: "follow_up",
  };
}

export function depositReminderDraft(org: OrgConfig, c: Customer, j: Job, amount: number): Draft {
  const due = j.depositDueDate ? ` (due ${formatDateInline(j.depositDueDate)})` : "";
  const start = j.startDate ? ` Once it's in, we'll confirm your start date of ${formatDateInline(j.startDate)}.` : " Once it's in, we'll confirm your start date.";
  return {
    to: c.email ?? "",
    subject: `Deposit for your ${j.title.toLowerCase()}`,
    body: `Hi ${firstName(c.name)},\n\nJust a friendly reminder about the ${gbp(amount)} deposit for your ${j.title.toLowerCase()}${due}.${start}\n\nAny questions, just let me know.\n\n${org.assistant.signOff}`,
    purpose: "deposit_reminder",
  };
}

export function invoiceReminderDraft(org: OrgConfig, c: Customer, inv: Invoice, balance: number): Draft {
  const ref = inv.number ?? inv.draftRef;
  return {
    to: c.email ?? "",
    subject: `Invoice ${ref}`,
    body: `Hi ${firstName(c.name)},\n\nA quick reminder that invoice ${ref} for ${gbp(balance)} was due ${inv.dueDate ? formatDateInline(inv.dueDate) : "recently"}. If you've already paid, thank you — please ignore this.\n\n${org.assistant.signOff}`,
    purpose: "invoice_reminder",
  };
}
