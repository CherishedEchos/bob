import "server-only";
/**
 * Bob's rule-based conversation engine (demo mode / fallback when no LLM key
 * is configured).
 *
 * It understands common trade-admin requests with deterministic parsing and
 * then works exclusively through Bob's tools and the action engine — exactly
 * like the LLM engine. Every figure comes from the reporting functions; every
 * change goes through requestAction (permissions, validation, approvals).
 */
import type { ExpenseCategory, JobStatus, PaymentMethod, PaymentType, VatTreatment } from "@/lib/types";
import type { Card, Chip } from "@/lib/bob/types";
import { can } from "@/lib/auth/permissions";
import { ENQUIRY_STATUS_LABEL, JOB_STATUS_LABEL, SOURCE_LABEL, invoiceBalance, isActiveJob, isOpenEnquiry, jobFinance, needsReply, quoteNeedsFollowUp } from "@/lib/derive";
import { addDaysKey, firstName, formatDateInline, gbp, timeAgo, todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";
import * as R from "@/server/services/records";
import * as F from "@/server/services/finance";
import * as Rep from "@/server/services/reports";
import { morningBriefing } from "./briefing";
import { getAccountingProvider, getEmailProvider } from "@/server/integrations/registry";
import { detectInjection } from "@/server/integrations/safety";
import { syncInbox } from "@/server/integrations/inbox";
import { cancelAction } from "./actions";
import { requestAction } from "./actions";
import { runReadTool } from "./tools";
import { mentionScore, resolveCustomers, resolveEnquiries, resolveJobs } from "./resolve";
import {
  cleanUtterance, detectMethod, findAmounts, isAffirmative, parseDeposit, parseDueDate, parseDueTerms,
  normaliseSpokenNumbers, parseExpenseCategory, parseLocation, parsePeriod, parseVat, parseVatRate, parseWorkTitle, stripDatePhrases, titleCase,
} from "./nlu";
import {
  depositReminderDraft, enquiryFollowUpDraft, greetingFor, invoiceReminderDraft, listNames, plural, quoteFollowUpDraft, replyDraft, type Draft,
} from "./compose";

/* ---------------------------------- Types ---------------------------------- */

type InvoiceFlow = {
  type: "invoice";
  text: string;
  customerId?: string;
  jobId?: string;
  noJob?: boolean;
  amount?: number;
  balanceMode?: boolean;
  amountsAre?: VatTreatment;
  vatRate?: number;
  dueDate?: string;
  description?: string;
  send?: boolean;
};
type JobFlow = {
  type: "job";
  text: string;
  customerId?: string;
  customerQuery?: string;
  newCustomerName?: string;
  forceNewCustomer?: boolean;
  title?: string;
  location?: string;
  quotedValue?: number;
  depositRequired?: number;
  startDate?: string;
  status?: JobStatus;
};
type QuoteFlow = { type: "quote"; text: string; customerId?: string; customerQuery?: string; enquiryId?: string };
type ReminderFlow = { type: "reminder"; text: string; title?: string; dueDate?: string; customerId?: string; relatedType?: "enquiry" | "job"; relatedId?: string; resolvedPeople?: boolean };
type ExpenseFlow = { type: "expense"; text: string; jobId?: string; amount?: number; category?: ExpenseCategory; description?: string };
type PaymentFlow = { type: "payment"; text: string; jobId?: string; amount?: number; ptype?: PaymentType; method?: PaymentMethod; useDeposit?: boolean; useBalance?: boolean };
type DraftFlow = { type: "draft"; text: string; enquiryId?: string; customerId?: string; mode: "reply" | "follow_up" };
type LookupFlow = { type: "job_lookup"; text: string; jobId?: string };
type StatusFlow = { type: "job_status"; text: string; jobId?: string; status: JobStatus };
type DepositFlow = { type: "deposit_check"; text: string; jobId?: string };

export type Flow = InvoiceFlow | JobFlow | QuoteFlow | ReminderFlow | ExpenseFlow | PaymentFlow | DraftFlow | LookupFlow | StatusFlow | DepositFlow;

export interface BobState {
  flow?: Flow;
  choice?: { kind: "customer" | "job" | "enquiry"; options: { id: string; label: string }[]; flow: Flow };
  lastFlow?: Flow;
  lastActionId?: string;
  focus?: { customerId?: string; jobId?: string; enquiryId?: string };
}

export interface Reply {
  text: string;
  cards?: Card[];
  chips?: Chip[];
  actionId?: string;
}

export interface TurnOutput {
  replies: Reply[];
  state: BobState;
  changed: boolean;
}

interface Turn {
  ctx: Ctx;
  conversationId: string;
  state: BobState;
  replies: Reply[];
  changed: boolean;
}

const say = (t: Turn, text: string, extra: Omit<Reply, "text"> = {}) => {
  t.replies.push({ text, ...extra });
};

const financeDenied = (t: Turn) => {
  if (can(t.ctx.role, "finance.read")) return false;
  say(t, "Your account doesn't have access to money and invoice information. The owner or office can check that for you.");
  return true;
};

/* ------------------------------ Action helper ------------------------------ */

async function act(t: Turn, tool: string, args: unknown, lead: string, flow?: Flow) {
  const out = await requestAction(t.ctx, tool, args, { conversationId: t.conversationId, origin: "bob" });
  if (out.kind !== "action") {
    say(t, out.message);
    return;
  }
  const v = out.view;
  if (out.duplicate) {
    if (v.status === "pending") say(t, "That's already waiting for your OK — here it is again.", { actionId: v.id });
    else say(t, `I've already done that a few minutes ago, so I haven't done it twice.`, { actionId: v.id });
    return;
  }
  if (out.ranImmediately) {
    if (v.status === "executed") {
      t.changed = true;
      say(t, `${lead ? `${lead} ` : ""}${v.resultMessage ?? "Done."}`, { actionId: v.id });
    } else say(t, `I couldn't do that: ${v.error ?? "something went wrong"}. Nothing was changed.`, { actionId: v.id });
    return;
  }
  t.state.lastActionId = v.id;
  t.state.lastFlow = flow;
  say(t, lead, { actionId: v.id });
}

/* ------------------------------ Choice helper ------------------------------ */

function ask(t: Turn, flow: Flow, text: string, chips: Chip[] = []) {
  t.state.flow = flow;
  say(t, text, { chips });
}

function offerChoice(t: Turn, kind: "customer" | "job" | "enquiry", options: { id: string; label: string }[], flow: Flow, question: string) {
  t.state.choice = { kind, options, flow };
  t.state.flow = undefined;
  say(t, `${question} ${options.map((o, i) => `${i + 1}) ${o.label}`).join("; ")}.`, {
    chips: options.slice(0, 4).map((o) => ({ kind: "send" as const, label: o.label, text: o.label })),
  });
}

const ORDINALS: Record<string, number> = { first: 0, "1": 0, one: 0, second: 1, "2": 1, two: 1, third: 2, "3": 2, three: 2, fourth: 3, "4": 3, four: 3 };

function pickChoice(text: string, options: { id: string; label: string }[]): string | null {
  const t = text.toLowerCase().trim();
  const ord = t.match(/\b(first|second|third|fourth|one|two|three|four|[1-4])\b/);
  if (ord && (t.length < 20 || /\b(the|number|option)\b/.test(t))) {
    const idx = ORDINALS[ord[1]];
    if (options[idx]) return options[idx].id;
  }
  const exact = options.find((o) => o.label.toLowerCase() === t);
  if (exact) return exact.id;
  const scored = options.map((o) => ({ o, s: mentionScore(text, o.label) + overlap(text, o.label) })).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  if (scored.length && (scored.length === 1 || scored[0].s > scored[1].s)) return scored[0].o.id;
  return null;
}

function overlap(a: string, b: string) {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  return b
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && wa.has(w)).length;
}

const jobLabel = (j: { customerName: string; title: string; location: string }) => `${j.customerName} — ${j.title}, ${j.location}`;

/* ================================== Router ================================== */

export async function rulesTurn(ctx: Ctx, raw: string, state: BobState, conversationId: string): Promise<TurnOutput> {
  const t: Turn = { ctx, conversationId, state: { ...state }, replies: [], changed: false };
  const text = cleanUtterance(raw);
  const lower = text.toLowerCase();

  // 1) Answering a "which one?" question
  if (t.state.choice) {
    const choice = t.state.choice;
    if (isPureNegative(text)) {
      t.state.choice = undefined;
      say(t, "Okay, I've left it. Nothing was changed.");
      return done(t);
    }
    const picked = pickChoice(text, choice.options);
    if (picked) {
      t.state.choice = undefined;
      const flow = { ...choice.flow } as Flow;
      if (choice.kind === "customer") (flow as { customerId?: string }).customerId = picked;
      if (choice.kind === "job") (flow as { jobId?: string }).jobId = picked;
      if (choice.kind === "enquiry") (flow as { enquiryId?: string }).enquiryId = picked;
      await runFlow(t, flow);
      return done(t);
    }
    if (!looksLikeNewCommand(lower)) {
      say(t, `Sorry, which one did you mean? ${choice.options.map((o, i) => `${i + 1}) ${o.label}`).join("; ")}.`, {
        chips: choice.options.slice(0, 4).map((o) => ({ kind: "send" as const, label: o.label, text: o.label })),
      });
      return done(t);
    }
    t.state.choice = undefined;
  }

  // 2) Corrections: "no, I meant Sophie Reid"
  const correction = text.match(/^(?:no[,.!]?\s+)?(?:i meant|i mean|sorry,? i meant|not \w+,?\s+i meant)\s+(.+)$/i);
  if (correction && t.state.lastFlow) {
    if (t.state.lastActionId) {
      try {
        cancelAction(ctx, t.state.lastActionId);
      } catch {
        /* already gone */
      }
    }
    const flow = applyCorrection(t.state.lastFlow, correction[1]);
    say(t, "No problem — I've cancelled that one.");
    await runFlow(t, flow);
    return done(t);
  }

  // 3) Continuing a multi-step request
  if (t.state.flow) {
    if (isPureNegative(text)) {
      t.state.flow = undefined;
      if (t.state.lastActionId) cancelQuietly(ctx, t.state.lastActionId);
      say(t, "Okay, cancelled. Nothing was changed.");
      return done(t);
    }
    if (!looksLikeNewCommand(lower)) {
      const flow = fillFlow(t.state.flow, text);
      t.state.flow = undefined;
      // The request is being revised, so any card it already produced is withdrawn.
      if (t.state.lastActionId) cancelQuietly(ctx, t.state.lastActionId);
      await runFlow(t, flow);
      return done(t);
    }
    t.state.flow = undefined;
  }

  await route(t, text, lower);
  return done(t);
}

function isPureNegative(text: string) {
  return /^(no|nope|nah|cancel|stop|forget it|never ?mind|leave it|no thanks|cancel (it|that))[\s.!]*$/i.test(text.trim());
}

function cancelQuietly(ctx: Ctx, id: string) {
  try {
    cancelAction(ctx, id);
  } catch {
    /* already gone */
  }
}

function done(t: Turn): TurnOutput {
  return { replies: t.replies, state: t.state, changed: t.changed };
}

function looksLikeNewCommand(lower: string): boolean {
  return /^(how many|how much|what|who|which|whats|what's|show|list|remind|add|create|new|invoice|send|draft|reply|record|mark|find|any|has|have|did|check|help)\b/.test(lower);
}

function applyCorrection(flow: Flow, correction: string): Flow {
  const f = { ...flow, text: `${flow.text} ${correction}` } as Flow & Record<string, unknown>;
  delete f.customerId;
  delete f.jobId;
  delete f.enquiryId;
  if (f.type === "job") {
    (f as JobFlow).customerQuery = correction;
    (f as JobFlow).newCustomerName = undefined;
  }
  (f as { text: string }).text = correction;
  return f as Flow;
}

async function route(t: Turn, text: string, lower: string) {
  const { ctx } = t;

  if (/^(thanks|thank you|cheers|ta|nice one|brilliant|great|perfect)\b/.test(lower)) return say(t, "No problem. Shout if you need anything else.");
  if (/^(hi|hello|hey|morning|afternoon|evening|alright)\W*$/.test(lower) || lower === "") return summary(t, true);
  if (/\b(what can you do|help me|how do (i|you) use|what do you do)\b/.test(lower) || lower === "help") return help(t);

  // Today / priorities (not "what's happening with the kitchen job")
  if (/\b(morning |daily )?briefing\b|\bread me my day\b|\bbrief me\b|\bhow'?s my day( looking)?\b/.test(lower)) {
    const b = morningBriefing(t.ctx);
    return say(t, b.text, b.suggestion ? { chips: [{ kind: "send", label: b.suggestion.label, text: b.suggestion.request }] } : undefined);
  }
  if (!/\b(job|kitchen|extension|loft|wardrobes?|decking|staircase|stairs|bathroom|garden room|media wall)\b/.test(lower) && (/\b(what('?s| is| have i got| needs?)( got)? (on|sorting|doing|happening)( today)?|what needs (sorting|doing|my attention)|today'?s (priorities|summary|list)|my day|anything (urgent|i need to)|what should i (do|focus on)|priorities)\b/.test(lower) || /^(today|what'?s on)\??$/.test(lower)))
    return summary(t, false);

  // Analytics & lookups (read-only)
  if (/\bhow many\b.*\benquir/.test(lower) || /\benquir\w*\b.*\b(last|this|past)\b.*\b(month|week|days)\b/.test(lower)) return enquiryStats(t, text);
  if (/\b(any|got any|have i (got|had) any) new (enquir|leads?|messages)/.test(lower) || /\bnew enquiries\b/.test(lower)) return listEnquiries(t, "new");
  if (/\b(who|which) (haven'?t i|have i not|do i need to|still need to) (replied|reply|respond|got back)|\bunanswered\b|\bwaiting (on|for) (a |my )?repl|\b(who|which|what|anyone|anybody)\b.*\bneeds? (a |my )?(reply|replies|response|answer)|\bneeds? (a |my )?repl(y|ies)\b.*\?$/.test(lower)) return listEnquiries(t, "needs_reply");
  if (/^follow[- ]?up on (my )?enquir|\b(which|what) enquir\w*\b.*\b(follow|chas)|\b(who|what) (needs?|do i need to) (follow(ing)?[- ]?up|chas)|\bfollow[- ]?ups?\b.*\b(due|today)\b/.test(lower)) return followUps(t);
  if (/\bwhich quotes?\b.*\b(follow|chase)|\bquotes?\b.*\bneed(s)? (following|chasing)|\bchase\b.*\bquotes\b/.test(lower)) return quotesToChase(t);
  if (
    !/\b(chase|follow|how many|which|need)\b/.test(lower) &&
    (/^(?:(?:can|could) you |please )?(?:(?:draft|make|do|write|create|put together|record|start|price up)\s+)?(?:me\s+)?(?:a |an )?(?:new )?(?:draft )?quote\b(?!s)/.test(lower) ||
      /\b(?:draft|make|write|create|put together|price up)\b.*\bquote\b(?!s)/.test(lower))
  )
    return runFlow(t, { type: "quote", text });
  if (/\bhow many quotes\b|\bhow much (work )?(have i|did i|i've) quoted\b|\bquoted\b.*\b(this|last) (month|week)\b|\bvalue of (my )?quotes\b/.test(lower)) return quoteStatsReply(t, text);
  if (/\bhow many jobs\b.*\b(won|win)\b|\bjobs (have i|did i) won\b|\bhow many (jobs )?(have i|did i) win\b/.test(lower)) return jobsWon(t, text);
  if (/\b(jobs?|work)\b.*\b(booked|starting|lined up|on)\b.*\b(next week|this week|today|tomorrow)\b|\bwhat('?s| is) booked\b/.test(lower)) return jobsBooked(t, text);
  if (/\b(has|did|have)\b.*\bpaid\b.*\bdeposit\b|\bdeposit\b.*\b(paid|in)\b\??$/.test(lower) && !/\bwho\b/.test(lower)) return runFlow(t, { type: "deposit_check", text });
  if (/\bwho('?s| has| hasn'?t| is)?\b.*\b(not|n'?t)\b.*\bpaid\b.*\bdeposit|\bdeposits? (outstanding|owed|due|waiting)|\bwaiting (on|for) deposits?\b/.test(lower)) return depositsOwed(t);
  if (/\boverdue\b.*\binvoice|\binvoices?\b.*\boverdue\b/.test(lower)) return invoicesReply(t, true);
  if (/\b(who('?s| has| hasn'?t| is)? (not |n'?t )?paid( me)?|who owes|how much (am i|is) owed|how much (money )?is outstanding|money (owed|outstanding)|outstanding (invoices|money|payments)|show (me )?(my )?(outstanding )?invoices|unpaid invoices)\b/.test(lower))
    return invoicesReply(t, false);
  if (/\b(check|sync|look at|any new) (my )?(e-?mails?|inbox)\b/.test(lower)) return checkInbox(t);

  // Actions
  if (/\bremind me\b|\bset (a |me a )?reminder\b|\badd (a )?(task|reminder)\b|\bdon'?t let me forget\b/.test(lower)) return runFlow(t, { type: "reminder", text });
  if (/\binvoice\b/.test(lower) && /\b(send|create|make|raise|do|prepare|draft|invoice (?!for|from))\b/.test(lower) || /^invoice\b/.test(lower)) return runFlow(t, invoiceFlowFrom(t, text));
  if (/\b(add|log|record|put)\b.*£?\d.*\b(materials?|costs?|expenses?|skip|labour|hire|timber|supplies)\b.*\b(to|on|for|against)\b/.test(lower) || /\b(add|log|record)\b.*\b(expense|cost)\b/.test(lower))
    return runFlow(t, { type: "expense", text });
  if (/\b(add|create|new|book in|set up)\b.*\bjob\b|\bnew job\b/.test(lower)) return runFlow(t, { type: "job", text });
  if (/\b(draft|write|send|prepare)\b.*\b(reply|response|answer)\b|\breply to\b/.test(lower)) return runFlow(t, { type: "draft", text, mode: "reply" });
  if (/\b(draft|write|send|prepare)\b.*\b(follow[- ]?up|chaser|reminder email|nudge)\b|\bfollow up with\b|\bchase\b/.test(lower)) return runFlow(t, { type: "draft", text, mode: "follow_up" });
  if (/\b(paid|payment|received|transferred)\b.*(£\s?\d|\bdeposit\b|\bbalance\b|\bin full\b)/.test(lower) && /\b(record|log|has paid|have paid|paid|received)\b/.test(lower)) return runFlow(t, { type: "payment", text });
  const statusMatch = lower.match(/\bmark\b.*\bjob\b.*\bas\b\s+(complete|completed|finished|done|in progress|started|snagging|booked|scheduled|lost)|\bjob\b.*\b(is|has) (finished|complete|completed|started|done)\b/);
  if (statusMatch) {
    const word = statusMatch[1] ?? statusMatch[3];
    const status: JobStatus = /complete|finished|done/.test(word) ? "completed" : /progress|started/.test(word) ? "in_progress" : /snag/.test(word) ? "snagging" : /lost/.test(word) ? "lost" : "scheduled";
    return runFlow(t, { type: "job_status", text, status });
  }

  // Lookups
  if (/\b(what'?s happening|how'?s|how is|how are things|update on|status of|tell me about|show me|where are we|what'?s the latest)\b.*\b(job|kitchen|extension|loft|wardrobes?|decking|staircase|stairs|bathroom|garden room|media wall)\b/.test(lower) || /\b(the )?\w+ job\b\??$/.test(lower))
    return runFlow(t, { type: "job_lookup", text });
  if (/\b(number|phone|email|address|contact details?|details) (for|of)\b|\bwhat'?s \w+'?s (number|phone|email|address)\b|\bfind (customer )?\b|\bwho is\b|\blook up\b/.test(lower)) return customerLookup(t, text);
  if (/\b(jobs?|what am i working on|active jobs|on site)\b/.test(lower) && /\b(what|which|show|list|how many)\b/.test(lower)) return activeJobs(t);
  if (/\btasks?|reminders?\b/.test(lower) && /\b(what|show|list|any|my)\b/.test(lower)) return tasksReply(t);
  if (/\benquir/.test(lower)) return listEnquiries(t, "open");

  // A bare name: "Sophie Lambert?" — try a customer lookup
  if (resolveCustomers(ctx, text).items.length && text.split(/\s+/).length <= 4) return customerLookup(t, text);

  say(
    t,
    "I'm not sure how to help with that yet. I can check enquiries, jobs and money, set reminders, add jobs and costs, draft replies and prepare invoices.",
    { chips: defaultChips(ctx) },
  );
}

function defaultChips(ctx: Ctx): Chip[] {
  const chips: Chip[] = [
    { kind: "send", label: "What needs sorting today?", text: "What needs sorting today?" },
    { kind: "send", label: "Enquiries in the last month", text: "How many enquiries have I had in the last month?" },
  ];
  if (can(ctx.role, "finance.read")) chips.push({ kind: "send", label: "Who hasn't paid?", text: "Who's not paid me?" });
  chips.push({ kind: "send", label: "Who needs a reply?", text: "Who haven't I replied to?" });
  return chips;
}

/* ============================== Read replies ============================== */

function summary(t: Turn, greetingOnly: boolean) {
  const r = runReadTool(t.ctx, "get_todays_summary", {});
  const s = r.data as Rep.TodaySummary;
  const name = /^(owner|office|site team)$/i.test(t.ctx.userName) ? "" : ` ${firstName(t.ctx.userName)}`;
  const hello = `${greetingFor()}${name}.`;
  const parts: string[] = [];
  const replies = s.priorities.filter((p) => p.kind === "reply");
  const follow = s.priorities.filter((p) => p.kind === "followup" || p.kind === "quote");
  const deposits = s.priorities.filter((p) => p.kind === "deposit");
  const invoices = s.priorities.filter((p) => p.kind === "invoice");
  if (replies.length) parts.push(`${plural(replies.length, "enquiry", "enquiries")} waiting for a reply`);
  if (follow.length) parts.push(`${plural(follow.length, "follow-up")} due`);
  if (s.financeVisible && invoices.length) parts.push(`${plural(invoices.length, "overdue invoice")}`);
  if (s.financeVisible && deposits.length) parts.push(`${plural(deposits.length, "deposit")} overdue or due soon`);
  if (s.tasksDue.length) parts.push(`${plural(s.tasksDue.length, "reminder")} due`);
  if (!parts.length) {
    say(t, `${hello} Nothing urgent on the list today — you're up to date.${s.onSite.length ? ` You've got ${plural(s.onSite.length, "job")} on the go.` : ""}`, { chips: defaultChips(t.ctx) });
    return;
  }
  const top = s.priorities[0];
  let text = `${hello} ${greetingOnly ? "Here's what needs sorting:" : "Today you've got"} ${listNames(parts, 5)}.`;
  if (top) text += ` I'd start with: ${top.title.charAt(0).toLowerCase() + top.title.slice(1)} (${top.detail}).`;
  if (s.onSite.length) text += ` ${plural(s.onSite.length, "job")} on site.`;
  say(t, text, {
    cards: r.cards,
    chips: [
      ...(replies.length ? [{ kind: "send" as const, label: "Who needs a reply?", text: "Who haven't I replied to?" }] : []),
      ...(s.financeVisible ? [{ kind: "send" as const, label: "Who hasn't paid?", text: "Who's not paid me?" }] : []),
      { kind: "link", label: "Open tasks", href: "/tasks" },
    ],
  });
}

function help(t: Turn) {
  say(t, "Talk to me like you would someone in the office. For example:", {
    chips: [
      { kind: "send", label: "What needs sorting today?", text: "What needs sorting today?" },
      { kind: "send", label: "Remind me to call Dave tomorrow", text: "Remind me to call Dave tomorrow" },
      { kind: "send", label: "How many enquiries last month?", text: "How many enquiries have I had in the last month?" },
      { kind: "send", label: "Draft a follow-up to James", text: "Draft a follow-up to James" },
    ],
  });
}

function enquiryStats(t: Turn, text: string) {
  const spec = parsePeriod(text) ?? { kind: "last_days" as const, days: 30 };
  const r = runReadTool(t.ctx, "get_enquiry_statistics", { period: spec });
  const s = r.data as Rep.EnquiryStats & { period: string };
  if (s.total === 0) {
    say(t, `You've had no enquiries recorded in ${s.period}. ${s.coverage}`, { cards: r.cards });
    return;
  }
  const via: Record<string, string> = { email: "came by email", website: "through your website", instagram: "on Instagram", phone: "by phone", manual: "were added manually" };
  const channels = s.bySource.map((b) => `${b.count} ${via[b.source] ?? `via ${b.label}`}`);
  const action = s.needsAction ? ` ${s.needsAction === 1 ? "One still needs" : `${s.needsAction} still need`} a reply or follow-up.` : " They've all been dealt with.";
  say(t, `You've had ${plural(s.total, "enquiry", "enquiries")} over ${s.period}. ${capital(listNames(channels, 6))}.${action}${s.won ? ` ${s.won} turned into work.` : ""}`, {
    cards: r.cards,
    chips: s.needsAction ? [{ kind: "send", label: "Who needs a reply?", text: "Who haven't I replied to?" }] : [],
  });
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function listEnquiries(t: Turn, filter: "new" | "needs_reply" | "open") {
  const r = runReadTool(t.ctx, "list_enquiries", { filter });
  const list = r.data as { id: string; customerName: string; title: string; location: string; source: string; receivedAt: string; status: string }[];
  if (!list.length) {
    say(t, filter === "new" ? "No new enquiries right now." : filter === "needs_reply" ? "You're all caught up — nobody's waiting on a reply." : "There are no open enquiries.");
    return;
  }
  const first = list[0];
  const lead =
    filter === "new"
      ? `You've got ${plural(list.length, "new enquiry", "new enquiries")}. The latest is ${first.customerName} — ${first.title.toLowerCase()} in ${first.location}, ${timeAgo(first.receivedAt)}.`
      : filter === "needs_reply"
        ? `${plural(list.length, "person is", "people are")} waiting for a reply: ${listNames(list.map((e) => e.customerName), 4)}.`
        : `${plural(list.length, "open enquiry", "open enquiries")}.`;
  t.state.focus = { ...t.state.focus, enquiryId: first.id };
  say(t, lead, { cards: r.cards, chips: [{ kind: "send", label: `Draft a reply to ${firstName(first.customerName)}`, text: `Draft a reply to ${first.customerName}` }] });
}

/** Enquiries with a follow-up due and quotes waiting on an answer — from the same list as Today. */
function followUps(t: Turn) {
  const r = runReadTool(t.ctx, "get_todays_summary", {});
  const s = r.data as Rep.TodaySummary;
  const due = s.priorities.filter((p) => p.kind === "followup" || p.kind === "quote") as Extract<Rep.TodaySummary["priorities"][number], { kind: "followup" | "quote" }>[];
  if (!due.length) {
    say(t, "Nothing needs following up today. Nobody's waiting on a chase and no quotes are due a nudge.");
    return;
  }
  const names = due.map((p) => p.who);
  const ids = due.map((p) => p.enquiryId).filter(Boolean) as string[];
  const first = due[0];
  say(t, `${plural(due.length, "enquiry needs", "enquiries need")} following up: ${listNames(names, 4)}.`, {
    cards: ids.length ? [{ type: "enquiries", ids }] : undefined,
    chips: [{ kind: "send", label: `Draft a follow-up to ${firstName(first.who)}`, text: `Draft a follow-up to ${first.who}` }],
  });
}

function quotesToChase(t: Turn) {
  if (financeDenied(t)) return;
  const s = Rep.quoteStats(t.ctx, { kind: "this_month" });
  if (!s.needFollowUp.length) {
    say(t, `No quotes need chasing right now. ${s.awaiting ? `${plural(s.awaiting, "quote is", "quotes are")} still awaiting a reply, but none are due a follow-up yet.` : ""}`.trim());
    return;
  }
  const items = s.needFollowUp.map((q) => `${q.customerName} (${q.description.toLowerCase()}, ${gbp(q.amount)}, sent ${q.sentAt ? timeAgo(q.sentAt) : "a while ago"})`);
  const ids = s.needFollowUp.map((q) => q.enquiryId).filter(Boolean) as string[];
  say(t, `${plural(s.needFollowUp.length, "quote needs", "quotes need")} following up: ${listNames(items, 4)}.`, {
    cards: ids.length ? [{ type: "enquiries", ids }] : undefined,
    chips: [{ kind: "send", label: `Draft a follow-up to ${firstName(s.needFollowUp[0].customerName)}`, text: `Draft a follow-up to ${s.needFollowUp[0].customerName}` }],
  });
}

function quoteStatsReply(t: Turn, text: string) {
  if (financeDenied(t)) return;
  const spec = parsePeriod(text) ?? { kind: "this_month" as const };
  const r = runReadTool(t.ctx, "get_quote_statistics", { period: spec });
  const s = r.data as Rep.QuoteStats & { period: string };
  const value = /how much/i.test(text);
  const lead = value
    ? `You've quoted ${gbp(s.sentValue)} of work over ${s.period}, across ${plural(s.sentCount, "quote")}.`
    : `You've sent ${plural(s.sentCount, "quote")} over ${s.period}, worth ${gbp(s.sentValue)}.`;
  say(t, `${lead} ${s.accepted ? `${s.accepted} accepted (${gbp(s.acceptedValue)}).` : "None accepted yet."}${s.needFollowUp.length ? ` ${plural(s.needFollowUp.length, "quote needs", "quotes need")} chasing.` : ""}`, {
    cards: r.cards,
    chips: s.needFollowUp.length ? [{ kind: "send", label: "Which quotes need chasing?", text: "Which quotes need following up?" }] : [],
  });
}

function jobsWon(t: Turn, text: string) {
  const spec = parsePeriod(text) ?? { kind: "last_days" as const, days: 30 };
  const r = runReadTool(t.ctx, "get_job_statistics", { period: spec });
  const s = r.data as Rep.JobStats & { period: string };
  const value = can(t.ctx.role, "finance.read") && s.won ? `, worth ${gbp(s.wonValue)}` : "";
  say(t, `You've won ${plural(s.won, "job")} over ${s.period}${value}. You've got ${plural(s.active, "active job")} in total.`, { cards: r.cards });
}

function jobsBooked(t: Turn, text: string) {
  const spec = parsePeriod(text) ?? { kind: "next_week" as const };
  const r = runReadTool(t.ctx, "get_job_statistics", { period: spec });
  const s = r.data as Rep.JobStats & { period: string };
  if (!s.booked.length) {
    say(t, `Nothing is booked to start ${s.period}.${s.active ? ` You've got ${plural(s.active, "active job")} carrying on.` : ""}`);
    return;
  }
  say(t, `${plural(s.booked.length, "job starts", "jobs start")} ${s.period}: ${listNames(s.booked.map((b) => `${b.customerName}'s ${b.title.toLowerCase()} in ${b.location} (${formatDateInline(b.startDate)})`), 4)}.`, { cards: r.cards });
}

function depositsOwed(t: Turn) {
  if (financeDenied(t)) return;
  const m = Rep.moneyOwed(t.ctx);
  if (!m.depositsAwaited.length) {
    say(t, "Everyone's paid their deposit. Nothing outstanding.");
    return;
  }
  const overdue = m.depositsAwaited.filter((d) => d.overdue);
  const items = m.depositsAwaited.map((d) => `${d.customerName} (${gbp(d.amount)}${d.dueDate ? `, ${d.overdue ? "was due" : "due"} ${formatDateInline(d.dueDate)}` : ""})`);
  say(t, `${plural(m.depositsAwaited.length, "deposit is", "deposits are")} still to come in, ${gbp(m.depositsTotal)} in total: ${listNames(items, 4)}.${overdue.length ? ` ${overdue.length === 1 ? "One is" : `${overdue.length} are`} overdue.` : ""} (${sourceNote(m)})`, {
    cards: [{ type: "jobs", ids: m.depositsAwaited.map((d) => d.jobId), show: "deposit" }],
    chips: [{ kind: "send", label: `Draft a follow-up to ${firstName(m.depositsAwaited[0].customerName)}`, text: `Draft a follow-up to ${m.depositsAwaited[0].customerName}` }],
  });
}

function sourceNote(m: Rep.MoneyOwed) {
  return `From ${m.source}${m.lastUpdated ? `, last updated ${timeAgo(m.lastUpdated)}` : ""}`;
}

function invoicesReply(t: Turn, overdueOnly: boolean) {
  if (financeDenied(t)) return;
  const m = Rep.moneyOwed(t.ctx);
  const list = overdueOnly ? m.invoicesOutstanding.filter((i) => i.overdue) : m.invoicesOutstanding;
  const cards: Card[] = list.length ? [{ type: "invoices", ids: list.map((i) => i.id) }] : [];
  if (overdueOnly) {
    if (!list.length) say(t, `No invoices are overdue. (${sourceNote(m)})`);
    else say(t, `${plural(list.length, "invoice is", "invoices are")} overdue, ${gbp(m.overdueTotal)} in total: ${listNames(list.map((i) => `${i.customerName} (${gbp(i.balance)}, due ${formatDateInline(i.dueDate!)})`))}. (${sourceNote(m)})`, { cards });
    return;
  }
  const bits: string[] = [];
  if (list.length) bits.push(`${gbp(m.invoicedTotal)} on ${plural(list.length, "unpaid invoice")}${m.overdueCount ? ` (${gbp(m.overdueTotal)} overdue)` : ""}`);
  if (m.depositsAwaited.length) bits.push(`${gbp(m.depositsTotal)} in deposits not yet paid`);
  if (!bits.length) {
    say(t, `Nobody owes you anything on record right now. (${sourceNote(m)})${m.draftsCount ? ` You've got ${plural(m.draftsCount, "draft invoice")} not sent yet.` : ""}`);
    return;
  }
  const who = [...new Set([...list.map((i) => i.customerName), ...m.depositsAwaited.map((d) => d.customerName)])];
  say(t, `You're owed ${listNames(bits)}. That's from ${listNames(who, 4)}. (${sourceNote(m)})${m.draftsCount ? ` ${plural(m.draftsCount, "draft invoice hasn't", "draft invoices haven't")} been sent yet, so ${m.draftsCount === 1 ? "isn't" : "aren't"} counted.` : ""}`, {
    cards: [...cards, ...(m.depositsAwaited.length ? [{ type: "jobs" as const, ids: m.depositsAwaited.map((d) => d.jobId), show: "deposit" as const }] : [])],
  });
}

function activeJobs(t: Turn) {
  const jobs = R.listJobs(t.ctx).filter(isActiveJob);
  if (!jobs.length) return say(t, "You haven't got any active jobs at the moment.");
  const onSite = jobs.filter((j) => j.status === "in_progress" || j.status === "snagging");
  say(t, `${plural(jobs.length, "active job")}${onSite.length ? `, ${onSite.length} on site now: ${listNames(onSite.map((j) => `${j.customerName} (${j.location})`))}` : ""}.`, {
    cards: [{ type: "jobs", ids: jobs.map((j) => j.id), show: "progress" }],
  });
}

function tasksReply(t: Turn) {
  const r = runReadTool(t.ctx, "list_tasks", { due: "all_open" });
  const list = r.data as { id: string; title: string; dueDate: string }[];
  if (!list.length) return say(t, "You haven't got any reminders set.", { chips: [{ kind: "send", label: "Set a reminder", text: "Remind me to " }] });
  const due = list.filter((x) => x.dueDate <= todayKey());
  say(t, `${plural(list.length, "reminder")} set${due.length ? `, ${due.length} due today or overdue` : ""}.`, { cards: r.cards });
}

function customerLookup(t: Turn, text: string) {
  const query = text.replace(/\b(number|phone|email|address|contact details?|details|for|of|find|customer|who is|look up|what'?s|the)\b/gi, " ").trim();
  const m = resolveCustomers(t.ctx, query || text);
  if (!m.items.length) return say(t, `I couldn't find a customer matching "${(query || text).trim()}".`);
  if (m.items.length > 1) return say(t, `I found ${m.items.length}: ${listNames(m.items.map((c) => `${c.name}${c.town ? ` (${c.town})` : ""}`), 5)}. Which one?`, { cards: [{ type: "customers", ids: m.items.map((c) => c.id) }] });
  const c = m.items[0];
  const jobs = R.listJobs(t.ctx).filter((j) => j.customerId === c.id);
  const bits = [c.phone && `phone ${c.phone}`, c.email && `email ${c.email}`, c.address && `address ${c.address}`].filter(Boolean);
  t.state.focus = { customerId: c.id };
  say(t, `${c.name}${c.town ? ` in ${c.town}` : ""}: ${bits.length ? listNames(bits as string[], 3) : "no contact details recorded"}.${jobs.length ? ` ${plural(jobs.length, "job")} on record: ${listNames(jobs.map((j) => `${j.title} (${JOB_STATUS_LABEL[j.status].toLowerCase()})`))}.` : ""}`, {
    cards: [{ type: "customers", ids: [c.id] }],
    chips: [{ kind: "open", label: "Open customer", record: "customer", id: c.id }],
  });
}

async function checkInbox(t: Turn) {
  const provider = getEmailProvider(t.ctx);
  if (!provider) return say(t, "Email isn't connected yet, so I can't check your inbox. The owner can connect Gmail or Outlook in Settings.");
  const r = await syncInbox(t.ctx);
  if (!r.ok) return say(t, `I couldn't check the inbox: ${r.error}`);
  if (r.value.created.length) t.changed = true;
  const flagged = r.value.flagged;
  say(
    t,
    `${provider.simulated ? "Checked the demo inbox. " : ""}${r.value.created.length ? `${plural(r.value.created.length, "new enquiry", "new enquiries")} added: ${listNames(r.value.created.map((e) => e.customerName))}.` : "No new enquiries."}${r.value.skipped ? ` Skipped ${plural(r.value.skipped, "message")} that didn't look like enquiries.` : ""}${r.value.duplicates ? ` ${plural(r.value.duplicates, "message was", "messages were")} already imported.` : ""}`,
    {
      cards: [
        ...(r.value.created.length ? [{ type: "enquiries" as const, ids: r.value.created.map((e) => e.id) }] : []),
        ...flagged.map((f) => ({ type: "warning" as const, text: `${f.customerName}'s message contains text aimed at an assistant (${f.reasons.join("; ")}). I've treated it as plain text and ignored those instructions.` })),
      ],
    },
  );
}

/* ================================== Flows ================================== */

async function runFlow(t: Turn, flow: Flow): Promise<void> {
  switch (flow.type) {
    case "reminder":
      return reminderFlow(t, flow);
    case "job":
      return jobFlow(t, flow);
    case "quote":
      return quoteFlow(t, flow);
    case "invoice":
      return invoiceFlow(t, flow);
    case "expense":
      return expenseFlow(t, flow);
    case "payment":
      return paymentFlow(t, flow);
    case "draft":
      return draftFlow(t, flow);
    case "job_lookup":
      return jobLookupFlow(t, flow);
    case "job_status":
      return jobStatusFlow(t, flow);
    case "deposit_check":
      return depositCheckFlow(t, flow);
  }
}

/** Fill a waiting flow with the user's answer. */
function fillFlow(flow: Flow, text: string): Flow {
  switch (flow.type) {
    case "invoice": {
      const f = { ...flow };
      if (f.amount === undefined && !f.balanceMode) {
        const a = findAmounts(text)[0] ?? (/^\s*\d[\d,]*(\.\d+)?\s*$/.test(text) ? parseFloat(text.replace(/,/g, "")) : undefined);
        if (a) f.amount = a;
        if (/\b(balance|what'?s left|remaining|outstanding)\b/i.test(text)) f.balanceMode = true;
      }
      f.amountsAre = parseVat(text) ?? f.amountsAre;
      f.vatRate = parseVatRate(text) ?? f.vatRate;
      const due = parseDueTerms(text) ?? (/^\s*\d{1,2}\s*$/.test(text) ? { date: addDaysKey(parseInt(text, 10)), phrase: "" } : null);
      if (due) f.dueDate = due.date;
      if (/\bno job\b|\bnot for a job\b/i.test(text)) f.noJob = true;
      f.text = `${flow.text} ${text}`;
      return f;
    }
    case "job": {
      const f = { ...flow };
      const amounts = findAmounts(text);
      const dep = parseDeposit(text);
      if (dep !== null) f.depositRequired = dep;
      if (f.quotedValue === undefined) {
        const price = amounts.find((a) => a !== dep) ?? (/^\s*\d[\d,]*\s*$/.test(text) ? parseFloat(text.replace(/,/g, "")) : undefined);
        if (price) f.quotedValue = price;
      }
      if (!f.location) f.location = parseLocation(text) ?? (text.trim().split(/\s+/).length <= 3 && !amounts.length ? titleCase(text.replace(/[^A-Za-z\s-]/g, "")) : undefined);
      if (!f.title) f.title = parseWorkTitle(text) ?? undefined;
      if (/\bnew customer\b|\bdifferent\b/i.test(text)) {
        f.forceNewCustomer = true;
        f.customerId = undefined;
        const n = text.match(/\b(?:called|named)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)/i);
        if (n) f.newCustomerName = titleCase(n[1]);
      } else if (f.forceNewCustomer && !f.newCustomerName && text.trim().split(/\s+/).length <= 3 && !amounts.length) {
        f.newCustomerName = titleCase(text.replace(/[^A-Za-z\s'-]/g, ""));
      }
      const start = text.match(/\bstart(?:ing|s)?\b(.*)$/i);
      if (start) f.startDate = parseDueDate(start[1])?.date ?? f.startDate;
      f.text = `${flow.text} ${text}`;
      return f;
    }
    case "quote": {
      const f = { ...flow, text: `${flow.text}, ${text}` };
      if (!f.customerId && text.trim().split(/\s+/).length <= 4 && !/\d/.test(text)) f.customerQuery = text.replace(/[^A-Za-z\s'&-]/g, "").trim();
      return f;
    }
    case "reminder": {
      const due = parseDueDate(text);
      return { ...flow, dueDate: due?.date ?? flow.dueDate, title: flow.title ?? (stripDatePhrases(text) || undefined) };
    }
    case "expense": {
      const f = { ...flow, text: `${flow.text} ${text}` };
      if (f.amount === undefined) f.amount = findAmounts(text)[0] ?? (/^\s*\d[\d,.]*\s*$/.test(text) ? parseFloat(text.replace(/,/g, "")) : undefined);
      return f;
    }
    case "payment": {
      const f = { ...flow, text: `${flow.text} ${text}` };
      if (f.amount === undefined) f.amount = findAmounts(text)[0];
      return f;
    }
    default:
      return { ...flow, text: `${flow.text} ${text}` } as Flow;
  }
}

/* -------------------------------- Reminder -------------------------------- */

async function reminderFlow(t: Turn, f: ReminderFlow) {
  const ctx = t.ctx;
  if (!f.title) {
    const m = f.text.match(/(?:remind me|reminder|task|forget)\s*(?:to|that|about)?\s+(.+)/i);
    const raw = m ? m[1] : "";
    f.title = stripDatePhrases(raw).replace(/^(to|that|about)\s+/i, "").trim() || undefined;
  }
  if (!f.dueDate) f.dueDate = parseDueDate(f.text)?.date;
  if (!f.title || f.title.length < 3) return ask(t, f, "What should I remind you about?");

  if (!f.resolvedPeople && !f.customerId) {
    const people = resolveCustomers(ctx, f.title);
    if (people.items.length > 1) {
      return offerChoice(t, "customer", people.items.map((c) => ({ id: c.id, label: `${c.name}${c.town ? ` (${c.town})` : ""}` })), { ...f, resolvedPeople: true }, `Which ${firstName(people.items[0].name)}?`);
    }
    if (people.items.length === 1) f.customerId = people.items[0].id;
    f.resolvedPeople = true;
  }
  if (!f.dueDate) return ask(t, f, `When should I remind you to ${lowerFirst(f.title)}?`, [
    { kind: "send", label: "Today", text: "today" },
    { kind: "send", label: "Tomorrow", text: "tomorrow" },
    { kind: "send", label: "Next week", text: "next week" },
  ]);

  let title = capital(f.title);
  if (f.customerId) {
    const c = R.getCustomer(ctx, f.customerId)!;
    // Use the full name ("call Dave" → "Call Dave Collins") so the reminder is unambiguous.
    const first = firstName(c.name);
    if (!new RegExp(c.name, "i").test(title) && new RegExp(`\\b${first}\\b`, "i").test(title)) title = title.replace(new RegExp(`\\b${first}\\b`, "i"), c.name);
    const enquiry = R.listEnquiries(ctx).find((e) => e.customerId === c.id && isOpenEnquiry(e));
    const job = R.listJobs(ctx).find((j) => j.customerId === c.id && isActiveJob(j));
    if (enquiry) [f.relatedType, f.relatedId] = ["enquiry", enquiry.id];
    else if (job) [f.relatedType, f.relatedId] = ["job", job.id];
  }
  const c = f.customerId ? R.getCustomer(ctx, f.customerId) : undefined;
  await act(t, "create_follow_up", { title, dueDate: f.dueDate, customerId: f.customerId, relatedType: f.relatedType, relatedId: f.relatedId }, c?.phone ? `(${c.name}: ${c.phone})` : "");
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/* ---------------------------------- Job ---------------------------------- */

/* -------------------------------- Quote (voice-to-quote) -------------------------------- */

const OPEN_FOR_QUOTE = new Set(["new", "awaiting_reply", "replied", "quote_required"]);

/**
 * "Quote for a kitchen, four metres, shaker style, island, about twelve grand"
 * → a draft quote to check. The price must come from the user; Bob never guesses it.
 */
async function quoteFlow(t: Turn, f: QuoteFlow) {
  const ctx = t.ctx;
  const raw = normaliseSpokenNumbers(f.text);

  // Who is it for? An explicit name, the answer to "who's it for?", or the enquiry being discussed.
  if (!f.customerId) {
    const named =
      f.customerQuery ??
      raw.match(/\bquote\s+(?:for|to)\s+(?!a\b|an\b|the\b|my\b)([A-Z][A-Za-z'-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'-]+)?(?:\s+[A-Z][A-Za-z'-]+)?)/)?.[1] ??
      raw.match(/\bfor\s+(?!a\b|an\b|the\b|about\b|around\b)([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?)(?:'s)?\b/)?.[1];
    if (named) {
      const name = named.replace(/'s$/, "").trim();
      const matches = resolveCustomers(ctx, name);
      if (matches.items.length > 1)
        return offerChoice(t, "customer", matches.items.map((c) => ({ id: c.id, label: `${c.name}${c.town ? ` (${c.town})` : ""}` })), { ...f, customerQuery: undefined }, `Which ${firstName(matches.items[0].name)} is the quote for?`);
      if (matches.items.length === 1) f.customerId = matches.items[0].id;
      else {
        // Not a saved customer yet? They may have just enquired.
        const enq = resolveEnquiries(ctx, name).enquiries.filter((e) => OPEN_FOR_QUOTE.has(e.status));
        if (enq.length > 1)
          return offerChoice(t, "enquiry", enq.map((e) => ({ id: e.id, label: `${e.customerName} — ${e.title}` })), { ...f, customerQuery: undefined }, `Which enquiry is the quote for?`);
        if (enq.length === 1) {
          f.enquiryId = enq[0].id;
          f.customerId = enq[0].customerId;
        } else {
          f.customerQuery = undefined;
          return ask(t, f, `I can't find ${titleCase(name)} in your customers or enquiries. Who's the quote for?`);
        }
      }
    } else if (t.state.focus?.enquiryId) {
      const e = R.getEnquiry(ctx, t.state.focus.enquiryId);
      if (e) {
        f.enquiryId = e.id;
        f.customerId = e.customerId;
      }
    } else if (t.state.focus?.customerId) f.customerId = t.state.focus.customerId;
  }
  if (f.enquiryId && !f.customerId) f.customerId = R.getEnquiry(ctx, f.enquiryId)?.customerId;
  if (!f.customerId && !f.enquiryId) {
    const open = R.listEnquiries(ctx).filter((e) => OPEN_FOR_QUOTE.has(e.status)).slice(0, 3);
    t.state.flow = f;
    return say(t, "Who's the quote for?", { chips: open.map((e) => ({ kind: "send" as const, label: e.customerName, text: e.customerName })) });
  }

  // Link it to their open enquiry about the same work, if there is one.
  const title = parseWorkTitle(raw);
  if (!f.enquiryId && f.customerId) {
    const theirs = R.listEnquiries(ctx).filter((e) => e.customerId === f.customerId && OPEN_FOR_QUOTE.has(e.status));
    const kw = title?.toLowerCase().split(/\s+/)[0];
    const match = (kw && theirs.find((e) => e.title.toLowerCase().includes(kw))) || (theirs.length === 1 ? theirs[0] : undefined);
    if (match) f.enquiryId = match.id;
  }
  const enquiry = f.enquiryId ? R.getEnquiry(ctx, f.enquiryId) : undefined;
  const customer = { name: (f.customerId ? R.getCustomer(ctx, f.customerId)?.name : undefined) ?? enquiry?.customerName ?? "them" };

  // The price: £/k/grand amounts, or a bare figure of £100+.
  const amount = findAmounts(raw)[0] ?? (() => {
    const m = raw.match(/\b(\d{3,7}(?:\.\d{1,2})?)\b(?!\s*(?:mm|cm|m\b|metres?|meters?|sq))/i);
    return m ? parseFloat(m[1]) : undefined;
  })();
  const approximate = /\b(about|around|roughly|approx\w*|ish|ballpark)\b/i.test(raw);

  // What's included: the comma-separated bits that aren't the price or the customer.
  const workTitle = title ?? enquiry?.title;
  const firstWord = workTitle?.toLowerCase().split(/\s+/)[0];
  const details = raw
    .replace(/^.*?\bquote\b\s*(?:for|to)?\s*(?:an?\s+|the\s+)?/i, "")
    .split(/,|;|\bwith\b|\bplus\b/i)
    .map((p) =>
      p
        .replace(/\b(?:about|around|roughly|approx\w*|ish|ballpark|at|for)\b/gi, " ")
        .replace(/£\s?[\d,.]+\s*(?:k|grand)?|\b[\d,.]+\s*(?:k|grand|pounds|quid)\b|\b\d{3,7}(?:\.\d{1,2})?\b(?!\s*(?:mm|cm|m\b|metres?|meters?))/gi, " ")
        .replace(new RegExp(`\\b${customer.name.split(/\s+/)[0]}(?:'s)?\\b`, "gi"), " ")
        .replace(/\b(\d+(?:\.\d+)?)\s*(?:metres?|meters?)\b/gi, "$1 m")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((p) => p.length > 1 && !/^(and|a|an|the)$/i.test(p) && (!firstWord || p.toLowerCase() !== firstWord))
    .map((p) => p.replace(/^(and|a|an)\s+/i, ""));
  const extras = details.filter((d) => !workTitle || !workTitle.toLowerCase().includes(d.toLowerCase()));

  if (!workTitle && !extras.length) return ask(t, f, `What's the work for ${firstName(customer.name)} — kitchen, loft, decking…?`);
  if (amount === undefined) return ask(t, f, `What's your price for ${firstName(customer.name)}'s ${(workTitle ?? "job").toLowerCase()}? I won't guess it.`);

  const description = `${workTitle ?? "Work"}${extras.length ? `: ${extras.join(", ")}` : ""}`.slice(0, 200);
  await act(
    t,
    "create_quote",
    { customerId: f.customerId, enquiryId: f.enquiryId, description, amount, approximate },
    `Here's a draft quote for ${customer.name}${enquiry ? ` (their ${enquiry.title.toLowerCase()} enquiry)` : ""} — check it and I'll save it.`,
    f,
  );
}

async function jobFlow(t: Turn, f: JobFlow) {
  const ctx = t.ctx;
  const text = f.text;
  if (f.forceNewCustomer && !f.newCustomerName) return ask(t, f, "Okay, a new customer. Who is it — what's their full name?");
  if (!f.customerId && !f.newCustomerName) {
    const m = (f.customerQuery ?? text).match(/\b(?:job|work)\s+for\s+((?:the\s+)?[A-Za-z][A-Za-z'-]*(?:\s+(?:and|&)\s+[A-Za-z][A-Za-z'-]*)?(?:\s+[A-Z][A-Za-z'-]*)?)/i) ??
      (f.customerQuery ? [f.customerQuery, f.customerQuery] : null);
    const name = m?.[1]?.replace(/\s+(in|at|for|on|quote|starting)\b.*$/i, "").trim();
    if (name && !/^(a|an|someone|them|him|her|me)$/i.test(name)) {
      const matches = f.forceNewCustomer ? { items: [], score: 0 } : resolveCustomers(ctx, name);
      if (matches.items.length > 1)
        return offerChoice(t, "customer", [...matches.items.map((c) => ({ id: c.id, label: `${c.name}${c.town ? ` (${c.town})` : ""}` }))], { ...f, customerQuery: undefined }, `Which ${firstName(matches.items[0].name)} is it for?`);
      if (matches.items.length === 1) f.customerId = matches.items[0].id;
      else f.newCustomerName = titleCase(name);
    }
  }
  if (!f.title) f.title = parseWorkTitle(text) ?? undefined;
  if (!f.location) f.location = parseLocation(text) ?? undefined;
  const dep = parseDeposit(text);
  if (dep !== null && f.depositRequired === undefined) f.depositRequired = dep;
  if (f.quotedValue === undefined) f.quotedValue = findAmounts(text).find((a) => a !== f.depositRequired);
  if (!f.startDate) {
    const s = text.match(/\bstart(?:ing|s)?\b(.*)$/i);
    if (s) f.startDate = parseDueDate(s[1])?.date;
  }
  if (/\bquot(e|ed|ing)\b/i.test(text) && !/\bfor £/i.test(text) && !f.status) f.status = "quoted";

  if (!f.customerId && !f.newCustomerName) return ask(t, f, "Who's the job for?");
  if (!f.title) return ask(t, f, "What's the job — kitchen, extension, loft…?");
  if (!f.location) return ask(t, f, "Where is it?");
  if (f.quotedValue === undefined) return ask(t, f, `What's the price for the ${f.title.toLowerCase()}? I won't guess it.`);

  const customer = f.customerId ? R.getCustomer(ctx, f.customerId) : undefined;
  const chips: Chip[] = [];
  let lead = "Here's the job — check it and I'll add it.";
  if (customer && mentionScore(text, customer.name) === 1) {
    lead = `I've matched that to ${customer.name}${customer.town ? ` from ${customer.town}` : ""}, your existing customer. Check it and I'll add it.`;
    chips.push({ kind: "send", label: `It's a different ${firstName(customer.name)}`, text: `No, it's a new customer` });
  }
  await act(
    t,
    "create_job",
    {
      customerId: f.customerId,
      newCustomerName: f.customerId ? undefined : f.newCustomerName,
      title: f.title,
      location: f.location,
      quotedValue: f.quotedValue,
      depositRequired: f.depositRequired,
      status: f.status,
      startDate: f.startDate,
    },
    lead,
    f,
  );
  if (chips.length) {
    const last = t.replies[t.replies.length - 1];
    last.chips = chips;
    // "No, it's a new customer" re-runs this flow as a new customer.
    t.state.flow = { ...f, customerId: undefined, forceNewCustomer: false };
    t.state.lastFlow = f;
  }
}

/* -------------------------------- Invoice -------------------------------- */

function invoiceFlowFrom(t: Turn, text: string): InvoiceFlow {
  return {
    type: "invoice",
    text,
    amountsAre: parseVat(text) ?? undefined,
    vatRate: parseVatRate(text) ?? undefined,
    dueDate: parseDueTerms(text)?.date,
    balanceMode: /\b(remaining|outstanding|the) balance\b|\bwhat'?s left\b|\bfinal invoice\b|\brest of\b/i.test(text),
    amount: findAmounts(text)[0],
    send: /\bsend\b/i.test(text),
  };
}

async function invoiceFlow(t: Turn, f: InvoiceFlow) {
  const ctx = t.ctx;
  if (!can(ctx.role, "invoices.draft")) return say(t, "Your account doesn't have permission to prepare invoices.");

  // 1) Customer + job
  if (!f.jobId && !f.noJob) {
    const r = resolveJobs(ctx, f.text, { includeClosed: true });
    const active = r.jobs.filter((j) => j.status !== "lost");
    if (active.length === 1) {
      f.jobId = active[0].id;
      f.customerId = active[0].customerId;
    } else if (active.length > 1 && (r.town || r.keywords.length || r.customers.length)) {
      return offerChoice(t, "job", active.slice(0, 4).map((j) => ({ id: j.id, label: jobLabel(j) })), f, "Which job is it for?");
    } else if (!f.customerId) {
      const people = resolveCustomers(ctx, f.text);
      if (people.items.length > 1) return offerChoice(t, "customer", people.items.map((c) => ({ id: c.id, label: `${c.name}${c.town ? ` (${c.town})` : ""}` })), f, `Which ${firstName(people.items[0].name)}?`);
      if (people.items.length === 1) f.customerId = people.items[0].id;
    }
    if (!f.jobId && f.customerId) {
      const theirs = R.listJobs(ctx).filter((j) => j.customerId === f.customerId && j.status !== "lost");
      if (r.town && !theirs.some((j) => j.location.toLowerCase() === r.town!.toLowerCase())) {
        const c = R.getCustomer(ctx, f.customerId)!;
        return say(t, `I can't find a job for ${c.name} in ${r.town}. ${theirs.length ? `Their jobs: ${listNames(theirs.map((j) => `${j.title} (${j.location})`))}.` : "They don't have any jobs on record."} I haven't created anything.`);
      }
      const activeTheirs = theirs.filter(isActiveJob);
      const pool = activeTheirs.length ? activeTheirs : theirs;
      if (pool.length === 1) f.jobId = pool[0].id;
      else if (pool.length > 1) return offerChoice(t, "job", pool.map((j) => ({ id: j.id, label: jobLabel(j) })), f, "Which of their jobs is it for?");
    }
  }
  if (!f.customerId) {
    const r = resolveJobs(ctx, f.text, { includeClosed: true });
    if (r.clues.includes("customer") === false && !resolveCustomers(ctx, f.text).items.length)
      return ask(t, f, "Who's the invoice for? Tell me the customer and the job.");
    return say(t, "I couldn't find that customer in your records, so I haven't created anything. Check the name, or add them as a customer first.");
  }
  const customer = R.getCustomer(ctx, f.customerId)!;
  const job = f.jobId ? R.getJob(ctx, f.jobId) : undefined;
  t.state.focus = { customerId: customer.id, jobId: job?.id };

  // 2) Amount
  let balanceNote = "";
  if (f.balanceMode && job) {
    const fin = jobFinance(job, F.listPayments(ctx));
    const invoicedOpen = F.listInvoices(ctx).filter((i) => i.jobId === job.id && (i.status === "sent" || i.status === "draft")).reduce((s, i) => s + (i.status === "draft" ? i.subtotal : invoiceBalance(i)), 0);
    const left = Math.max(0, Math.round((fin.balance - invoicedOpen) * 100) / 100);
    if (left <= 0) return say(t, `There's nothing left to invoice on ${customer.name}'s ${job.title.toLowerCase()} — it's either paid or already invoiced.`);
    f.amount = left;
    balanceNote = ` The remaining balance is ${gbp(left)} (price ${gbp(job.quotedValue)}, ${gbp(fin.totalPaid)} paid${invoicedOpen ? `, ${gbp(invoicedOpen)} already invoiced` : ""}).`;
  }
  if (!f.amount) return ask(t, f, `How much should the invoice to ${customer.name} be for?`);

  // 3) VAT — from settings when they settle it, otherwise ask. Never assumed.
  if (ctx.org.finance.vatRegistered === false) f.amountsAre = "no_vat";
  const existing = job ? F.listInvoices(ctx).filter((i) => i.jobId === job.id && i.status !== "void") : [];
  const existingNote = job
    ? existing.length
      ? ` There ${existing.length === 1 ? "is" : "are"} already ${listNames(existing.map((i) => `${i.number ?? i.draftRef} (${gbp(i.total)}, ${i.status})`))} on this job.`
      : " There are no other invoices on this job."
    : "";
  const found = job ? `I've found ${customer.name}'s ${job.title.toLowerCase()} in ${job.location}.` : `This is for ${customer.name}.`;
  const missing: string[] = [];
  const chips: Chip[] = [];
  if (!f.amountsAre) {
    missing.push(`is ${gbp(f.amount)} including VAT, plus VAT, or no VAT?${ctx.org.finance.vatRegistered === null ? " (VAT isn't set up for your business yet — you can set it in Settings.)" : ""}`);
  } else if (f.amountsAre !== "no_vat" && f.vatRate === undefined && ctx.org.finance.vatRate == null) {
    missing.push("which VAT rate should I use — the standard 20%?");
    chips.push({ kind: "send", label: "20%", text: "20%" });
  }
  if (!f.dueDate) {
    const terms = ctx.org.finance.defaultPaymentTermsDays;
    if (terms) f.dueDate = addDaysKey(terms);
    else missing.push("when should it be due — 7, 14 or 30 days?");
  }
  if (missing.length) {
    if (!f.amountsAre) chips.push(...(ctx.org.finance.vatRegistered === null ? [{ kind: "send" as const, label: "No VAT", text: "No VAT" }] : []), { kind: "send", label: "Plus VAT", text: "Plus VAT" }, { kind: "send", label: "Including VAT", text: "Including VAT" });
    if (!f.dueDate) chips.push({ kind: "send", label: "14 days", text: "14 days" }, { kind: "send", label: "30 days", text: "30 days" });
    const q = missing.length === 1 ? capital(missing[0]) : `Before I draft ${gbp(f.amount)}: ${missing.map((m, i) => `${i + 1}) ${m}`).join(" ")}`;
    return ask(t, f, `${found}${balanceNote}${existingNote} ${q}`, chips.slice(0, 5));
  }

  const provider = getAccountingProvider(ctx);
  const description = f.description ?? (job ? `${job.title}, ${job.location}${f.balanceMode ? " — remaining balance" : ""}` : "Building work");
  const sendable = !!provider && can(ctx.role, "invoices.send");
  const lead = sendable
    ? `${found}${balanceNote}${existingNote} Here's the invoice — approve it and I'll send it through ${provider!.label}${provider!.simulated ? " (demo — simulated, nothing really sent)" : ""}.`
    : `${found}${balanceNote}${existingNote} Here's a draft. ${provider ? "" : "No accounting system is connected, so I can only save it as a draft in Bob — it can't be sent yet."}`.trim();
  await act(
    t,
    "create_invoice",
    { customerId: customer.id, jobId: job?.id, description, amount: f.amount, amountsAre: f.amountsAre, vatRate: f.vatRate, dueDate: f.dueDate, send: sendable },
    lead,
    f,
  );
}

/* -------------------------------- Expense -------------------------------- */

async function expenseFlow(t: Turn, f: ExpenseFlow) {
  const ctx = t.ctx;
  if (f.amount === undefined) f.amount = findAmounts(f.text)[0];
  if (!f.category) f.category = parseExpenseCategory(f.text);
  if (!f.description) {
    const m = f.text.match(/£?\s?[\d,.]+k?\s*(?:of|for|on|worth of)?\s+(.+?)\s+(?:to|on|for|against)\s+(?:the\s+)?/i);
    f.description = m ? capital(m[1].replace(/\b(the|some)\b/gi, "").trim()) : capital(f.category === "other" ? "Job cost" : f.category.replace("_", " "));
  }
  if (!f.jobId) {
    const target = f.text.replace(/^.*?\b(?:to|on|for|against)\s+(?:the\s+)?/i, "");
    const r = resolveJobs(ctx, target);
    if (r.jobs.length > 1) return offerChoice(t, "job", r.jobs.slice(0, 4).map((j) => ({ id: j.id, label: jobLabel(j) })), f, `There's more than one ${r.town ?? "matching"} job. Which one?`);
    if (r.jobs.length === 1) f.jobId = r.jobs[0].id;
    else return ask(t, f, "Which job should I add that to?");
  }
  if (!f.amount) return ask(t, f, "How much was it?");
  await act(t, "add_job_expense", { jobId: f.jobId, amount: f.amount, category: f.category, description: f.description, incurredOn: todayKey() }, "Check this and I'll add it to the job costs.", f);
}

/* -------------------------------- Payment -------------------------------- */

async function paymentFlow(t: Turn, f: PaymentFlow) {
  const ctx = t.ctx;
  if (!can(ctx.role, "payments.record")) return say(t, "Your account doesn't have permission to record payments.");
  if (!f.jobId) {
    const r = resolveJobs(ctx, f.text);
    if (r.jobs.length > 1) return offerChoice(t, "job", r.jobs.slice(0, 4).map((j) => ({ id: j.id, label: jobLabel(j) })), f, "Which job is the payment for?");
    if (!r.jobs.length) return ask(t, f, "Which customer or job is the payment for?");
    f.jobId = r.jobs[0].id;
  }
  const job = R.getJob(ctx, f.jobId)!;
  const fin = jobFinance(job, F.listPayments(ctx));
  const lower = f.text.toLowerCase();
  if (f.amount === undefined) f.amount = findAmounts(f.text)[0];
  if (!f.ptype) f.ptype = /\bdeposit\b/.test(lower) ? "deposit" : /\b(final|balance|in full|rest)\b/.test(lower) ? "final" : "stage";
  if (f.amount === undefined && f.ptype === "deposit" && fin.depositOutstanding > 0) f.amount = fin.depositOutstanding;
  if (f.amount === undefined && f.ptype === "final" && fin.balance > 0) f.amount = fin.balance;
  if (f.amount === undefined) return ask(t, f, `How much did ${job.customerName} pay?`);
  const method = f.method ?? detectMethod(f.text) ?? "bank_transfer";
  const receivedAt = /\byesterday\b/.test(lower) ? addDaysKey(-1) : todayKey();
  await act(t, "record_payment", { jobId: job.id, amount: f.amount, type: f.ptype, method, receivedAt }, `Just to check before I record it${detectMethod(f.text) ? "" : " (I've put bank transfer — change it on the job if not)"}:`, f);
}

/* --------------------------------- Drafts --------------------------------- */

async function draftFlow(t: Turn, f: DraftFlow) {
  const ctx = t.ctx;
  const org = ctx.org;
  let draft: Draft | null = null;
  let enquiryId: string | undefined = f.enquiryId;
  let jobId: string | undefined;
  let customerId: string | undefined = f.customerId;
  let about = "";
  const cards: Card[] = [];

  if (!enquiryId && !customerId) {
    // Prefer an enquiry match ("the customer who emailed about decking"), then a customer.
    const er = resolveEnquiries(ctx, f.text, { openOnly: true });
    const people = resolveCustomers(ctx, f.text);
    if (er.enquiries.length === 1 && (f.mode === "reply" || !people.items.length)) enquiryId = er.enquiries[0].id;
    else if (er.enquiries.length > 1 && f.mode === "reply")
      return offerChoice(t, "enquiry", er.enquiries.slice(0, 4).map((e) => ({ id: e.id, label: `${e.customerName} — ${e.title} (${SOURCE_LABEL[e.source]})` })), f, "Which enquiry?");
    else if (people.items.length > 1) return offerChoice(t, "customer", people.items.map((c) => ({ id: c.id, label: `${c.name}${c.town ? ` (${c.town})` : ""}` })), f, `Which ${firstName(people.items[0].name)}?`);
    else if (people.items.length === 1) customerId = people.items[0].id;
    else if (f.mode === "reply" && t.state.focus?.enquiryId && /\b(them|that|this|it)\b/i.test(f.text)) enquiryId = t.state.focus.enquiryId;
    else return say(t, "I couldn't work out who that's for. Tell me the customer's name, or which enquiry (e.g. \"the decking email\").");
  }

  if (enquiryId) {
    const e = R.getEnquiry(ctx, enquiryId);
    if (!e) return say(t, "I couldn't find that enquiry.");
    draft = f.mode === "reply" || needsReply(e) ? replyDraft(org, e) : enquiryFollowUpDraft(org, e);
    customerId = e.customerId;
    about = `${e.customerName} about the ${e.title.toLowerCase()}`;
    const inbound = e.messages.filter((m) => m.direction === "inbound").map((m) => m.body).join("\n");
    const inj = detectInjection(inbound);
    if (inj.suspicious) cards.push({ type: "warning", text: `${firstName(e.customerName)}'s message contains text aimed at an assistant (${inj.reasons.join("; ")}). I've ignored it — I only follow your instructions.` });
    t.state.focus = { ...t.state.focus, enquiryId: e.id };
  } else if (customerId) {
    const c = R.getCustomer(ctx, customerId)!;
    const finance = can(ctx.role, "finance.read");
    const quote = R.listQuotes(ctx).find((q) => q.customerId === c.id && quoteNeedsFollowUp(q)) ?? R.listQuotes(ctx).find((q) => q.customerId === c.id && q.status === "sent");
    const jobs = R.listJobs(ctx).filter((j) => j.customerId === c.id && isActiveJob(j));
    const depositJob = finance ? jobs.find((j) => jobFinance(j, F.listPayments(ctx)).depositOutstanding > 0) : undefined;
    const overdue = finance ? F.listInvoices(ctx).find((i) => i.customerId === c.id && i.status === "sent" && invoiceBalance(i) > 0 && i.dueDate && i.dueDate < todayKey()) : undefined;
    const openEnquiry = R.listEnquiries(ctx).find((e) => e.customerId === c.id && isOpenEnquiry(e));
    if (overdue) {
      draft = invoiceReminderDraft(org, c, overdue, invoiceBalance(overdue));
      jobId = overdue.jobId;
      about = `${c.name} about overdue invoice ${overdue.number ?? overdue.draftRef}`;
    } else if (depositJob) {
      const amt = jobFinance(depositJob, F.listPayments(ctx)).depositOutstanding;
      draft = depositReminderDraft(org, c, depositJob, amt);
      jobId = depositJob.id;
      about = `${c.name} about the ${gbp(amt)} deposit for the ${depositJob.title.toLowerCase()}`;
    } else if (quote) {
      draft = quoteFollowUpDraft(org, c, quote);
      enquiryId = quote.enquiryId;
      about = `${c.name} about their ${quote.description.toLowerCase()} quote`;
    } else if (openEnquiry) {
      draft = enquiryFollowUpDraft(org, openEnquiry);
      enquiryId = openEnquiry.id;
      about = `${c.name} about the ${openEnquiry.title.toLowerCase()}`;
    } else {
      return say(t, `I can't see anything open with ${c.name} to follow up on — no open enquiry, quote, deposit or unpaid invoice. Tell me what it's about and I'll draft it.`);
    }
    t.state.focus = { customerId: c.id, jobId, enquiryId };
  }
  if (!draft) return say(t, "I couldn't put a draft together for that.");

  const customer = customerId ? R.getCustomer(ctx, customerId) : undefined;
  const to = draft.to || customer?.email || "";
  const provider = getEmailProvider(ctx);
  if (provider && to && can(ctx.role, "email.send")) {
    return act(t, "send_email", { to, subject: draft.subject, body: draft.body, enquiryId, customerId, jobId, purpose: draft.purpose }, `Here's a draft to ${about}. You can edit it, then approve to send${provider.simulated ? " (demo inbox — nothing actually leaves Bob)" : ""}.`, f).then(() => {
      if (cards.length) t.replies[t.replies.length - 1].cards = cards;
    });
  }
  const reason = !provider ? "Email isn't connected yet, so I can't send it" : !to ? "There's no email address on record" : "Your account can't send emails";
  if (enquiryId && can(ctx.role, "enquiries.write")) {
    await act(t, "save_email_draft", { enquiryId, body: draft.body }, `Here's a draft to ${about}. ${reason} — copy it, or save it on the enquiry.`, f);
    if (cards.length) t.replies[t.replies.length - 1].cards = cards;
    return;
  }
  say(t, `Here's a draft to ${about}. ${reason}, so copy it and send it yourself.`, { cards: [...cards, { type: "draft", to: to || customer?.phone || "", subject: draft.subject, body: draft.body, note: "Not sent — copy and send it yourself." }] });
}

/* --------------------------------- Lookups --------------------------------- */

function pickJob(t: Turn, f: LookupFlow | StatusFlow | DepositFlow, question: string, opts: { includeClosed?: boolean } = {}): string | null {
  if (f.jobId) return f.jobId;
  const r = resolveJobs(t.ctx, f.text, { includeClosed: opts.includeClosed ?? true });
  if (r.jobs.length === 1) return r.jobs[0].id;
  if (r.jobs.length > 1) {
    offerChoice(t, "job", r.jobs.slice(0, 4).map((j) => ({ id: j.id, label: jobLabel(j) })), f, question);
    return null;
  }
  if (!r.clues.length && t.state.focus?.jobId && /\b(it|that|this)\b/i.test(f.text)) return t.state.focus.jobId;
  say(t, r.clues.length ? "I couldn't find a job matching that. Try the customer's name or the town." : "Which job do you mean? Tell me the customer or the town.");
  return null;
}

async function jobLookupFlow(t: Turn, f: LookupFlow) {
  const id = pickJob(t, f, "I found more than one. Which job?");
  if (!id) return;
  const j = R.getJob(t.ctx, id)!;
  t.state.focus = { customerId: j.customerId, jobId: j.id };
  const bits = [`${j.customerName}'s ${j.title.toLowerCase()} in ${j.location} is ${JOB_STATUS_LABEL[j.status].toLowerCase()}`];
  if (j.startDate) bits.push(`${j.startDate <= todayKey() ? "started" : "starts"} ${formatDateInline(j.startDate)}`);
  let text = `${bits.join(", ")}.`;
  if (j.nextAction) text += ` Next: ${lowerFirst(j.nextAction)}.`;
  if (j.notes[0]) text += ` Latest note: "${j.notes[0].text}"`;
  if (can(t.ctx.role, "finance.read")) {
    const fin = jobFinance(j, F.listPayments(t.ctx), R.listExpenses(t.ctx));
    text += ` Money: ${gbp(fin.totalPaid)} of ${gbp(j.quotedValue)} paid${fin.depositOutstanding ? `, deposit of ${gbp(fin.depositOutstanding)} still due` : ""}${fin.expenses ? `; ${gbp(fin.expenses)} of costs recorded` : ""}.`;
  }
  say(t, text, { cards: [{ type: "job_detail", jobId: j.id }], chips: [{ kind: "open", label: "Open job", record: "job", id: j.id }] });
}

async function jobStatusFlow(t: Turn, f: StatusFlow) {
  const id = pickJob(t, f, "Which job?", { includeClosed: false });
  if (!id) return;
  f.jobId = id;
  await act(t, "update_job", { jobId: id, status: f.status }, "Check this and I'll update it.", f);
}

async function depositCheckFlow(t: Turn, f: DepositFlow) {
  if (financeDenied(t)) return;
  const id = pickJob(t, f, "Which job's deposit?", { includeClosed: true });
  if (!id) return;
  const j = R.getJob(t.ctx, id)!;
  const pays = F.listPayments(t.ctx);
  const fin = jobFinance(j, pays);
  const depositPays = pays.filter((p) => p.jobId === j.id && p.type === "deposit");
  const m = Rep.moneyOwed(t.ctx);
  let text: string;
  if (j.depositRequired === 0) text = `No deposit was set on ${j.customerName}'s ${j.title.toLowerCase()}.`;
  else if (fin.depositOutstanding === 0)
    text = `Yes — ${j.customerName} has paid the ${gbp(j.depositRequired)} deposit for the ${j.title.toLowerCase()}${depositPays[0] ? ` (recorded ${formatDateInline(depositPays[0].receivedAt)})` : ""}.`;
  else
    text = `Not yet. ${j.customerName} owes a ${gbp(fin.depositOutstanding)} deposit for the ${j.title.toLowerCase()}${j.depositDueDate ? `, ${fin.depositOverdue ? "which was due" : "due"} ${formatDateInline(j.depositDueDate)}` : ""}.`;
  say(t, `${text} (${sourceNote(m)})`, {
    cards: [{ type: "jobs", ids: [j.id], show: "deposit" }],
    chips: fin.depositOutstanding ? [{ kind: "send", label: `Draft a reminder to ${firstName(j.customerName)}`, text: `Draft a follow-up to ${j.customerName}` }] : [],
  });
}

export { ENQUIRY_STATUS_LABEL, isAffirmative };
