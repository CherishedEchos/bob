/**
 * Deterministic demo engine.
 *
 * Rule-based intent matching over the (fictional) business data. It never
 * invents customers or amounts: if something isn't in the data or the
 * user's words, it asks. Every data change is returned as a proposal that
 * must be confirmed by the user.
 */
import type { AppData } from "@/lib/types";
import {
  followUpDue,
  jobFinance,
  jobsAwaitingDeposit,
  jobsWithBalance,
  isActiveJob,
  needsReply,
  remindersDue,
  sortEnquiries,
  todaysPriorities,
} from "@/lib/derive";
import { gbp, firstName, hoursSince, addDaysKey, formatDateInline } from "@/lib/utils";
import type { AssistantContext, AssistantEngine, AssistantReply, Chip, ConversationMemory } from "./types";
import {
  detectMethod,
  findAmounts,
  findEnquiriesMentioned,
  findJobsMentioned,
  parseDeposit,
  parseDueDate,
  parseLocation,
  parseNewCustomerName,
  parseQuote,
  parseWorkTitle,
  stripDatePhrases,
  titleCase,
} from "./parse";


function plural(n: number, one: string, many = one + "s") {
  return `${n === 1 ? "one" : numberWord(n)} ${n === 1 ? one : many}`;
}
function numberWord(n: number) {
  return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}
function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const HELP_CHIPS: Chip[] = [
  { kind: "send", label: "What needs my attention?", text: "What needs my attention today?" },
  { kind: "send", label: "Who needs a reply?", text: "Who needs a reply?" },
  { kind: "send", label: "Jobs waiting for deposits", text: "What jobs are waiting for deposits?" },
  { kind: "send", label: "Remind me to…", text: "Remind me to call Dave tomorrow" },
];

/* =============================== Intents =============================== */

function attention(data: AppData, missed: boolean): AssistantReply {
  const replies = data.enquiries.filter(needsReply);
  const deposits = jobsAwaitingDeposit(data);
  const follow = data.enquiries.filter((e) => !needsReply(e) && followUpDue(e));
  const due = remindersDue(data.reminders);
  const calls = due.filter((r) => /\b(call|ring|phone)\b/i.test(r.title));
  const otherReminders = due.length - calls.length;

  const parts: string[] = [];
  if (replies.length) parts.push(`${plural(replies.length, "enquiry", "enquiries")} waiting for a reply`);
  if (deposits.length) parts.push(`${plural(deposits.length, "deposit")} outstanding`);
  if (calls.length) {
    const who = calls.map((c) => c.title.replace(/^(call|ring|phone)\s+/i, "").replace(/\s+(back|about).*/i, "")).slice(0, 2);
    parts.push(`${calls.length === 1 ? "a customer" : `${numberWord(calls.length)} customers`} expecting a call today (${listNames(who)})`);
  }
  if (follow.length) parts.push(`${plural(follow.length, "follow-up")} due`);
  if (otherReminders > 0) parts.push(`${plural(otherReminders, "other reminder")}`);

  let lead = "";
  if (missed) {
    const fresh = data.enquiries.filter((e) => hoursSince(e.receivedAt) < 24);
    lead = fresh.length
      ? `Since yesterday you've had ${plural(fresh.length, "new enquiry", "new enquiries")} (${listNames(fresh.map((e) => firstName(e.customerName)))}). `
      : "Nothing new has come in since yesterday. ";
  }

  if (!parts.length) {
    return {
      text: `${lead}You're all caught up — no replies waiting, no deposits outstanding and nothing due today. Nice one.`,
      chips: [{ kind: "link", label: "View jobs", href: "/jobs" }],
      memory: { lastIntent: "attention" },
    };
  }

  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return {
    text: `${lead}You've got ${sentence}. Want me to go through them?`,
    chips: [
      { kind: "send", label: "Go through them", text: "Go through them" },
      { kind: "send", label: "Who needs a reply?", text: "Who needs a reply?" },
      { kind: "send", label: "Deposits outstanding", text: "What jobs are waiting for deposits?" },
    ],
    memory: { lastIntent: "attention" },
  };
}

function goThrough(data: AppData): AssistantReply {
  const items = todaysPriorities(data);
  if (!items.length) return { text: "There's nothing on the list right now. You're up to date.", memory: { lastIntent: "priorities" } };
  const top = items[0];
  return {
    text: `Here's everything, most urgent first. I'd start with: ${top.title.charAt(0).toLowerCase() + top.title.slice(1)}. Tap any item to open it.`,
    cards: [{ type: "priorities", items }],
    chips: [
      { kind: "send", label: "Draft replies", text: "Who needs a reply?" },
      { kind: "link", label: "Open overview", href: "/overview" },
    ],
    memory: { lastIntent: "priorities" },
  };
}

function whoNeedsReply(data: AppData, includeFollowUps: boolean): AssistantReply {
  const waiting = sortEnquiries(data.enquiries.filter(needsReply));
  const follow = includeFollowUps ? data.enquiries.filter((e) => !needsReply(e) && followUpDue(e)) : [];
  if (!waiting.length && !follow.length) {
    return { text: "Nobody's waiting on a reply right now, and no follow-ups are due.", memory: { lastIntent: "replies" } };
  }
  const oldest = waiting.reduce<typeof waiting[number] | undefined>(
    (a, e) => (!a || new Date(e.receivedAt) < new Date(a.receivedAt) ? e : a),
    undefined,
  );
  let text = waiting.length
    ? `${listNames(waiting.map((e) => firstName(e.customerName)))} ${waiting.length === 1 ? "is" : "are"} waiting on a reply.`
    : "No one's waiting on a first reply.";
  if (oldest && hoursSince(oldest.receivedAt) > 24) {
    text += ` ${firstName(oldest.customerName)} has been waiting longest — about ${Math.round(hoursSince(oldest.receivedAt) / 24)} days.`;
  }
  if (follow.length) {
    text += ` ${follow.length === 1 ? "There's also a follow-up due" : `There are also ${numberWord(follow.length)} follow-ups due`} with ${listNames(follow.map((e) => firstName(e.customerName)))}.`;
  }
  const first = waiting[0] ?? follow[0];
  return {
    text,
    cards: [{ type: "enquiries", ids: [...waiting, ...follow].map((e) => e.id) }],
    chips: [
      { kind: "send", label: `Draft a reply to ${firstName(first.customerName)}`, text: `Draft a reply to ${first.customerName}` },
      { kind: "link", label: "Open enquiries", href: "/enquiries" },
    ],
    memory: { lastIntent: "replies", lastEnquiryId: first.id },
  };
}

function draftReply(text: string, ctx: AssistantContext): AssistantReply {
  const { data, memory } = ctx;
  const mentioned = findEnquiriesMentioned(text, data);
  let enquiry = mentioned.length === 1 ? mentioned[0] : undefined;
  if (!enquiry && mentioned.length === 0 && memory.lastEnquiryId) {
    enquiry = data.enquiries.find((e) => e.id === memory.lastEnquiryId);
  }
  if (!enquiry) {
    const waiting = sortEnquiries(data.enquiries.filter((e) => needsReply(e) || followUpDue(e)));
    const asking = /photo|picture|pic/i.test(text) ? " asking for photos" : "";
    return {
      text: mentioned.length > 1 ? "I found more than one match — who's the reply for?" : "Who's the reply for?",
      chips: (mentioned.length > 1 ? mentioned : waiting).slice(0, 4).map((e) => ({
        kind: "send" as const,
        label: e.customerName,
        text: `Draft a reply to ${e.customerName}${asking}`,
      })),
      memory: { lastIntent: "draft" },
    };
  }

  const first = firstName(enquiry.customerName);
  const work = enquiry.title.toLowerCase();
  let body: string;
  if (/photo|picture|pic/i.test(text)) {
    body = `Hi ${first},\n\nThanks for getting in touch about the ${work}. To help us give you an accurate idea of cost, could you send over a few photos of the space and any rough measurements you have?\n\nOnce we've had a look we'll come back to you with next steps.\n\nThanks,\nNinety3`;
  } else if (/visit|come (round|out|and look)|look at it|measure/i.test(text)) {
    body = `Hi ${first},\n\nThanks for your enquiry about the ${work}. We'd love to come out and take a look. Would any day next week suit you? Mornings tend to work best for us.\n\nThanks,\nNinety3`;
  } else if (/price|cost|ballpark|quote/i.test(text)) {
    body = `Hi ${first},\n\nThanks for getting in touch. Every ${work} is a bit different, so the best way to give you a reliable price is a quick look at the space. If you can send a few photos and measurements, we can give you a ballpark figure first.\n\nThanks,\nNinety3`;
  } else {
    body = enquiry.suggestedReply;
  }

  const channel =
    enquiry.source === "instagram" ? "Instagram" : enquiry.source === "email" ? "email" : "text or a call";
  return {
    text: `Here's a draft for ${first}. I can't send messages yet — copy it into ${channel}, then let me know once it's sent and I'll mark them as replied.`,
    cards: [{ type: "draft", enquiryId: enquiry.id, text: body }],
    chips: [
      { kind: "propose", label: "Save draft to enquiry", action: { type: "save_draft", enquiryId: enquiry.id, text: body } },
      { kind: "propose", label: "I've sent it — mark as replied", action: { type: "mark_replied", enquiryId: enquiry.id } },
    ],
    memory: { lastIntent: "draft", lastEnquiryId: enquiry.id },
  };
}

function depositsWaiting(data: AppData): AssistantReply {
  const list = jobsAwaitingDeposit(data);
  if (!list.length) return { text: "No jobs are waiting on deposits. Everything's been paid up front.", memory: { lastIntent: "deposits" } };
  const total = list.reduce((s, d) => s + d.finance.depositOutstanding, 0);
  const overdue = list.filter((d) => d.finance.depositOverdue);
  let text = `${list.length === 1 ? "One job is" : `${titleCase(numberWord(list.length))} jobs are`} waiting on a deposit — ${gbp(total)} in total.`;
  if (overdue.length) {
    const o = overdue[0];
    const days = Math.abs(o.finance.depositDaysUntilDue ?? 0);
    text += ` ${o.job.customerName}'s is overdue by ${days} day${days === 1 ? "" : "s"}.`;
  }
  const lead = overdue[0] ?? list[0];
  return {
    text,
    cards: [{ type: "jobs", ids: list.map((d) => d.job.id), show: "deposit" }],
    chips: [
      { kind: "send", label: `Mark ${firstName(lead.job.customerName)}'s deposit as paid`, text: `Mark ${lead.job.customerName}'s deposit as paid` },
      { kind: "send", label: `Remind me to chase ${firstName(lead.job.customerName)}`, text: `Remind me to chase ${lead.job.customerName} for the deposit tomorrow` },
      { kind: "link", label: "Open payments", href: "/payments" },
    ],
    memory: { lastIntent: "deposits", lastJobId: lead.job.id },
  };
}

function moneyOwed(data: AppData): AssistantReply {
  const deposits = jobsAwaitingDeposit(data);
  const balances = jobsWithBalance(data).filter(({ job }) => job.status !== "quoted");
  const depTotal = deposits.reduce((s, d) => s + d.finance.depositOutstanding, 0);
  const balTotal = balances.reduce((s, d) => s + d.finance.balance, 0);
  const ready = balances.filter(({ job }) => job.status === "snagging" || job.status === "completed");
  let text = `There's ${gbp(depTotal)} in deposits outstanding and ${gbp(balTotal)} still to come on jobs that are underway.`;
  if (ready.length) text += ` ${listNames(ready.map((r) => r.job.customerName))} ${ready.length === 1 ? "is" : "are"} nearly done, so ${ready.length === 1 ? "that final invoice is" : "those final invoices are"} the next to chase.`;
  return {
    text,
    cards: [{ type: "jobs", ids: [...deposits.map((d) => d.job.id), ...balances.map((b) => b.job.id)], show: "balance" }],
    chips: [
      { kind: "link", label: "Open payments", href: "/payments" },
      { kind: "send", label: "Record a payment", text: "Record a payment" },
    ],
    memory: { lastIntent: "money" },
  };
}

function activeJobs(data: AppData): AssistantReply {
  const jobs = data.jobs.filter(isActiveJob);
  const inProgress = jobs.filter((j) => j.status === "in_progress");
  return {
    text: `You've got ${plural(jobs.length, "active job")}${inProgress.length ? `, ${numberWord(inProgress.length)} on site right now` : ""}.`,
    cards: [{ type: "jobs", ids: jobs.map((j) => j.id), show: "progress" }],
    chips: [{ kind: "link", label: "Open jobs", href: "/jobs" }],
    memory: { lastIntent: "jobs" },
  };
}

function reminderList(data: AppData): AssistantReply {
  const open = data.reminders.filter((r) => !r.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (!open.length) return { text: "You don't have any reminders set.", chips: [{ kind: "send", label: "Set a reminder", text: "Remind me to…" }] };
  return {
    text: `You've got ${plural(open.length, "reminder")}. The next one is "${open[0].title}" — ${formatDateInline(open[0].dueDate)}.`,
    cards: [{ type: "reminders", ids: open.map((r) => r.id) }],
    chips: [{ kind: "link", label: "Open reminders", href: "/reminders" }],
    memory: { lastIntent: "reminders" },
  };
}

function setReminder(text: string, data: AppData): AssistantReply {
  const due = parseDueDate(text);
  const m = text.match(/remind me (?:to |about |that )?(.+)/i);
  const raw = m ? m[1] : text.replace(/^(set|add|create) (a )?reminder( to| for)?/i, "");
  const title = stripDatePhrases(raw).replace(/^to\s+/i, "");
  if (!title || title.length < 3 || /^…$/.test(title)) {
    return {
      text: "Sure — what do you want reminding about, and when? For example: \"Remind me to call Dave tomorrow.\"",
      chips: [{ kind: "form", label: "Open reminder form", prefill: { form: "reminder" } }],
    };
  }
  const niceTitle = title[0].toUpperCase() + title.slice(1);
  const jobs = findJobsMentioned(title, data);
  const enquiries = findEnquiriesMentioned(title, data);
  const related =
    jobs.length === 1 && enquiries.length === 0
      ? { relatedType: "job" as const, relatedId: jobs[0].id }
      : enquiries.length === 1 && jobs.length === 0
        ? { relatedType: "enquiry" as const, relatedId: enquiries[0].id }
        : {};

  const date = due?.date ?? addDaysKey(1);
  const alt: Chip[] = [
    { kind: "propose", label: "Make it today", action: { type: "create_reminder", title: niceTitle, dueDate: addDaysKey(0), ...related } },
    { kind: "propose", label: "Make it next week", action: { type: "create_reminder", title: niceTitle, dueDate: addDaysKey(7), ...related } },
  ];
  return {
    text: due
      ? `I'll set that reminder for ${formatDateInline(date)}. Confirm and it's on your list.`
      : `You didn't say when, so I've pencilled in tomorrow — change it if you need to.`,
    proposal: { type: "create_reminder", title: niceTitle, dueDate: date, ...related },
    chips: alt,
    memory: { lastIntent: "reminder" },
  };
}

function recordPayment(text: string, ctx: AssistantContext): AssistantReply {
  const { data, memory } = ctx;
  let jobs = findJobsMentioned(text, data).filter((j) => jobFinance(j, data.payments).balance > 0);
  if (!jobs.length && memory.lastJobId && /\b(their|that|it|the deposit)\b/i.test(text)) {
    const j = data.jobs.find((x) => x.id === memory.lastJobId);
    if (j) jobs = [j];
  }
  const anyMentioned = findJobsMentioned(text, data);

  if (jobs.length !== 1) {
    if (anyMentioned.length === 1 && jobs.length === 0) {
      const j = anyMentioned[0];
      return { text: `${j.customerName}'s ${j.title.toLowerCase()} is already paid in full — nothing left to record.`, memory: { lastJobId: j.id } };
    }
    const candidates = (jobs.length > 1 ? jobs : data.jobs.filter((j) => j.status !== "completed" && jobFinance(j, data.payments).balance > 0)).slice(0, 5);
    const nameTried = text.match(/mark ([a-z]+)'?s?/i)?.[1];
    const notFound =
      nameTried && !/^(a|the|as|it)$/i.test(nameTried) && jobs.length === 0 && !/record a payment/i.test(text)
        ? `I can't find a job for ${titleCase(nameTried)}. `
        : "";
    return {
      text: `${notFound}${jobs.length > 1 ? "There's more than one match — which" : "Which"} job is the payment for?`,
      chips: candidates.map((j) => ({ kind: "send" as const, label: `${j.customerName} · ${j.title}`, text: `Record a payment for ${j.customerName}` })),
      memory: { lastIntent: "payment" },
    };
  }

  const job = jobs[0];
  const fin = jobFinance(job, data.payments);
  const amounts = findAmounts(text);
  const method = detectMethod(text);
  const wantsDeposit = /deposit/i.test(text);
  const wantsBalance = /\b(balance|in full|final|everything|the rest)\b/i.test(text);

  let amount: number | null = amounts[0] ?? null;
  if (amount === null && wantsDeposit) {
    if (fin.depositOutstanding === 0) {
      return {
        text: `${job.customerName}'s deposit is already paid. There's ${gbp(fin.balance)} left on the job — do you want to record something towards that?`,
        chips: [
          { kind: "propose", label: `Record full balance ${gbp(fin.balance)}`, action: { type: "record_payment", jobId: job.id, amount: fin.balance, paymentType: "final", method } },
          { kind: "form", label: "Different amount", prefill: { form: "payment", jobId: job.id } },
        ],
        memory: { lastJobId: job.id },
      };
    }
    amount = fin.depositOutstanding;
  }
  if (amount === null && wantsBalance) amount = fin.balance;

  if (amount === null) {
    const chips: Chip[] = [];
    if (fin.depositOutstanding > 0)
      chips.push({ kind: "propose", label: `Deposit ${gbp(fin.depositOutstanding)}`, action: { type: "record_payment", jobId: job.id, amount: fin.depositOutstanding, paymentType: "deposit", method } });
    chips.push({ kind: "propose", label: `Full balance ${gbp(fin.balance)}`, action: { type: "record_payment", jobId: job.id, amount: fin.balance, paymentType: "final", method } });
    chips.push({ kind: "form", label: "Other amount", prefill: { form: "payment", jobId: job.id } });
    return {
      text: `How much did ${firstName(job.customerName)} pay? There's ${gbp(fin.balance)} left on the ${job.title.toLowerCase()}${fin.depositOutstanding > 0 ? `, including the ${gbp(fin.depositOutstanding)} deposit` : ""}.`,
      chips,
      memory: { lastIntent: "payment", lastJobId: job.id },
    };
  }

  if (amount > fin.balance) {
    return {
      text: `That's more than the ${gbp(fin.balance)} left on ${job.customerName}'s ${job.title.toLowerCase()}, so I haven't set it up. What amount did they pay?`,
      chips: [{ kind: "form", label: "Record payment", prefill: { form: "payment", jobId: job.id } }],
      memory: { lastJobId: job.id },
    };
  }

  const paymentType = fin.depositOutstanding > 0 && (wantsDeposit || amount <= fin.depositOutstanding) ? "deposit" : amount === fin.balance ? "final" : "stage";
  return {
    text: `Just to check before I record it — ${gbp(amount)} from ${job.customerName} for the ${job.title.toLowerCase()}:`,
    proposal: { type: "record_payment", jobId: job.id, amount, paymentType, method },
    memory: { lastIntent: "payment", lastJobId: job.id },
  };
}

/* ---------------------------- Job creation (slot filling) ---------------------------- */

function addJob(text: string, ctx: AssistantContext, continuing: boolean): AssistantReply {
  const pending = continuing ? (ctx.memory.pendingJob ?? {}) : {};
  const draft = { ...pending };
  const name = parseNewCustomerName(text);
  if (name) draft.customerName = name;
  const title = parseWorkTitle(text);
  if (title) draft.title = title;
  const location = parseLocation(text);
  if (location) draft.location = location;
  const deposit = parseDeposit(text);
  if (deposit) {
    draft.depositRequired = deposit.amount;
    if (deposit.paid) draft.depositPaid = deposit.amount;
  }
  let quote = parseQuote(text);
  if (quote === null) {
    const amounts = findAmounts(text).filter((a) => a !== deposit?.amount);
    if (amounts.length === 1 && (continuing || /£|k\b|grand/i.test(text))) quote = amounts[0];
  }
  if (quote !== null) draft.quotedValue = quote;

  // Continuing: a bare name answer like "It's for Laura Price"
  if (continuing && !draft.customerName) {
    const m = text.match(/(?:it'?s for|for|customer is|name is)\s+([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)?)/i);
    if (m) draft.customerName = titleCase(m[1]);
  }

  const missing: string[] = [];
  if (!draft.customerName) missing.push("who it's for");
  if (!draft.title) missing.push("what the job is");
  if (!draft.location) missing.push("where it is");
  if (draft.quotedValue === undefined) missing.push("the quote");

  const formChip: Chip = {
    kind: "form",
    label: "Fill it in on the form",
    prefill: {
      form: "job",
      values: {
        customerName: draft.customerName ?? "",
        title: draft.title ?? "",
        location: draft.location ?? "",
        quotedValue: draft.quotedValue !== undefined ? String(draft.quotedValue) : "",
        depositRequired: draft.depositRequired !== undefined ? String(draft.depositRequired) : "",
      },
    },
  };

  if (missing.length) {
    const got: string[] = [];
    if (draft.customerName) got.push(`for ${draft.customerName}`);
    if (draft.title) got.push(draft.title.toLowerCase());
    if (draft.location) got.push(`in ${draft.location}`);
    if (draft.quotedValue !== undefined) got.push(`quoted at ${gbp(draft.quotedValue)}`);
    const ask = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
    return {
      text: got.length
        ? `Okay, a new job ${got.join(", ")}. I just need ${ask}.`
        : `Sure. Tell me who it's for, what the job is, where, and the quote — e.g. "Kitchen refit for James in Crawley, quote £9,500."`,
      chips: [formChip, { kind: "send", label: "Cancel", text: "Cancel" }],
      memory: { lastIntent: "add_job", pendingJob: draft },
    };
  }

  const depositRequired = draft.depositRequired ?? 0;
  const status = draft.depositPaid ? "scheduled" : depositRequired > 0 ? "awaiting_deposit" : "quoted";
  return {
    text: "Here's the job — confirm and I'll add it.",
    proposal: {
      type: "create_job",
      job: {
        customerName: draft.customerName!,
        title: draft.title!,
        location: draft.location!,
        quotedValue: draft.quotedValue!,
        depositRequired: Math.min(depositRequired, draft.quotedValue!),
        status,
      },
      depositPaid: draft.depositPaid,
    },
    chips: [formChip],
    memory: { lastIntent: "add_job", pendingJob: undefined },
  };
}

/* =============================== Router =============================== */

const RE = {
  attention: /(attention|sort out|to do today|what('?s| is) on (today|my plate)|what have i got|what do i need to|today'?s priorities|anything urgent|catch me up|rundown)/i,
  missed: /(what (have|did) i miss|missed)/i,
  goThrough: /^(yes|yeah|yep|go on|go through( them)?|ok(ay)?|sure|please|go ahead|let'?s do it|run me through( them)?)\b/i,
  replies: /(who needs a reply|need(s)? (a )?repl|unanswered|waiting (on|for) (a )?repl|who('?s| is) waiting|who haven'?t i (replied|got back))/i,
  followUp: /follow[- ]?up/i,
  draft: /(draft|write|prepare|compose).*(reply|message|response|email|text)|reply to\b/i,
  deposits: /(waiting (on|for) (a )?deposit|deposits? (due|outstanding|owed|waiting)|which jobs.*deposit|who owes.*deposit|outstanding deposits?)/i,
  money: /(who owes|money owed|outstanding (balance|payment)s?|payments? (due|outstanding)|balances?)/i,
  addJob: /(add|create|new|log|set up)\b.*\bjob\b|job for\b/i,
  payment: /(mark .*(deposit|paid)|record (a )?payment|(has |have )?paid\b|payment (from|for)|received .*£|took .*£)/i,
  reminder: /(remind me|set (a )?reminder|add (a )?reminder|don'?t let me forget)/i,
  reminderList: /(my reminders|what reminders|reminder list|what('?s| is) on my list)/i,
  jobs: /(active jobs|my jobs|what jobs|jobs (on|running|in progress)|what('?s| is) on site|how are the jobs)/i,
  greeting: /^(hi|hey|hello|morning|good (morning|afternoon|evening)|alright|evening)[!. ]*$/i,
  thanks: /^(thanks|thank you|cheers|ta|nice one|great)[!. ]*$/i,
  no: /^(no|nope|that'?s (all|it)|nothing( else)?|all good)[!. ]*$/i,
  cancel: /^(cancel|never ?mind|forget it|stop)[!. ]*$/i,
  help: /(help|what can you do|how does this work)/i,
};

export class DemoAssistantEngine implements AssistantEngine {
  readonly id = "demo-rules";
  readonly label = "Demo assistant (rule-based)";

  async respond(input: string, ctx: AssistantContext): Promise<AssistantReply> {
    const text = input.trim();
    const { data, memory } = ctx;
    const keep = (r: AssistantReply): AssistantReply => ({ ...r, memory: { ...memory, pendingJob: undefined, ...(r.memory ?? {}) } as ConversationMemory });

    if (RE.cancel.test(text)) {
      return { text: "No problem, I've dropped that. Nothing was changed.", memory: { ...memory, pendingJob: undefined, lastIntent: undefined } };
    }

    // Order matters: most specific intents first.
    if (RE.reminder.test(text)) return keep(setReminder(text, data));
    if (RE.draft.test(text)) return keep(draftReply(text, ctx));
    if (RE.payment.test(text) && !RE.addJob.test(text)) return keep(recordPayment(text, ctx));
    if (RE.addJob.test(text)) {
      const r = addJob(text, ctx, false);
      return { ...r, memory: { ...memory, ...r.memory } };
    }
    if (RE.deposits.test(text)) return keep(depositsWaiting(data));
    if (RE.replies.test(text)) return keep(whoNeedsReply(data, false));
    if (RE.followUp.test(text) && /enquir|customer|people|who/i.test(text)) return keep(whoNeedsReply(data, true));
    if (RE.missed.test(text)) return keep(attention(data, true));
    if (RE.attention.test(text)) return keep(attention(data, false));
    if (RE.money.test(text)) return keep(moneyOwed(data));
    if (RE.reminderList.test(text)) return keep(reminderList(data));
    if (RE.jobs.test(text)) return keep(activeJobs(data));

    // Follow-ups that depend on conversation state
    if (memory.pendingJob) {
      const r = addJob(text, ctx, true);
      return { ...r, memory: { ...memory, ...r.memory } };
    }
    if (RE.goThrough.test(text)) {
      if (memory.lastIntent === "attention") return keep(goThrough(data));
      if (memory.lastIntent === "replies") return keep(draftReply("draft a reply", ctx));
      return keep(goThrough(data));
    }
    if (RE.no.test(text)) return keep({ text: "No worries. Shout if you need anything." });
    if (RE.thanks.test(text)) return keep({ text: "Any time." , chips: [{ kind: "send", label: "Anything else today?", text: "What needs my attention today?" }] });
    if (RE.greeting.test(text)) {
      return keep({
        text: `${/evening/i.test(text) ? "Evening" : /afternoon/i.test(text) ? "Afternoon" : "Morning"}! Want a quick rundown of what needs sorting today?`,
        chips: [{ kind: "send", label: "Yes please", text: "What needs my attention today?" }],
        memory: { lastIntent: "greeting" },
      });
    }
    if (RE.help.test(text)) {
      return keep({
        text: "I can tell you what needs doing, who's waiting on a reply, which deposits are outstanding, draft replies, add jobs, record payments and set reminders. Anything that changes your records, I'll check with you first.",
        chips: HELP_CHIPS,
      });
    }

    // Someone's name on its own → show what we know
    const enq = findEnquiriesMentioned(text, data);
    const jobs = findJobsMentioned(text, data);
    if (enq.length + jobs.length > 0 && text.split(/\s+/).length <= 6) {
      const cards = [] as NonNullable<AssistantReply["cards"]>;
      if (enq.length) cards.push({ type: "enquiries", ids: enq.map((e) => e.id) });
      if (jobs.length) cards.push({ type: "jobs", ids: jobs.map((j) => j.id), show: "balance" });
      return keep({
        text: "Here's what I've got on that:",
        cards,
        memory: { lastEnquiryId: enq[0]?.id, lastJobId: jobs[0]?.id },
      });
    }

    return keep({
      text: "Sorry, I didn't quite follow that. This demo understands everyday requests like these:",
      chips: HELP_CHIPS,
    });
  }
}
