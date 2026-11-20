import "server-only";
/**
 * Conversational invoicing for Bob's built-in (rules) engine — the same
 * billing service the Claude tools use, so both give the same answers.
 *
 *   "Prepare me an invoice for Sophie Mackay in Copthorne"
 *   → finds the job (name, site, town and type of work together; tolerant of
 *     Mackay/McKay), says what's left to invoice and asks what it's for
 *   "the final balance" → saves the draft (asks one short question first only
 *     if VAT or payment terms aren't set up) and links Review invoice
 *   "make that seven-fifty" → amends the same draft
 *   "cancel that" → deletes the unsent draft it just made
 *   "send it" → a separate approval with recipient and amount
 *
 * Selected job and draft are kept in the conversation's state, which belongs
 * to the signed-in user and workspace only.
 */
import type { Chip } from "@/lib/bob/types";
import type { VatTreatment } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { formatDateInline, gbp } from "@/lib/utils";
import type { Ctx } from "@/server/context";
import { billingLookup, findBillingCandidates, jobBilling, saveDraftFromConversation, type BillingBasis, type JobBilling } from "@/server/services/billing";
import { deleteInvoiceDraft, getInvoice } from "@/server/services/finance";
import { getJob } from "@/server/services/records";
import { findAmounts, parseDueTerms, parseVat, parseVatRate } from "./nlu";
import { requestAction } from "./actions";

export type InvoiceFlow = {
  type: "invoice";
  text: string;
  jobId?: string;
  /** Picked from a "which Sophie?" question. */
  customerId?: string;
  basis?: BillingBasis;
  amount?: number;
  amountsAre?: VatTreatment;
  vatRate?: number;
  dueDate?: string;
  /** Waiting for: what it's for, the VAT/terms answer, or whether to update an existing draft. */
  stage?: "basis" | "details" | "replace";
  replaceId?: string;
};

/** What the conversation remembers between turns (part of BobState). */
export interface InvoiceMemory {
  draftInvoiceId?: string;
  /** Answers given once in this conversation, so Bob doesn't ask again. */
  amountsAre?: VatTreatment;
  dueInDays?: number;
}

export interface InvoiceIO {
  ctx: Ctx;
  conversationId: string;
  state: { flow?: unknown; focus?: { customerId?: string; jobId?: string; enquiryId?: string }; invoice?: InvoiceMemory; choice?: unknown };
  say(text: string, extra?: { chips?: Chip[]; actionId?: string }): void;
  ask(flow: InvoiceFlow, text: string, chips?: Chip[]): void;
  offerChoice(options: { id: string; label: string }[], flow: InvoiceFlow, question: string, kind?: "job" | "customer"): void;
  listCustomerJobs(customerId: string): { id: string; label: string; active: boolean }[];
  markChanged(): void;
}

/* ------------------------------ Understanding words ------------------------------ */

export const INVOICE_REQUEST = /\b(invoice|bill)\b/i;
const CREATE_VERB = /\b(prepare|draft|sort|sorting|put|make|raise|do|create|knock|get|need|needs|draw up|write|start|set up|send)\b|^\s*(an? )?(invoice|bill)\s+(for|to)\b/i;
const YES = /^(yes|yeah|yep|yup|aye|go on|go ahead|do it|please do|sounds good|ok(ay)?|sure|that'?s (right|fine|it)|correct|perfect|lovely|cheers|great)\b|\b(draft (it|that)|save (it|that)|yeah,? draft)\b/i;
const CANCEL = /^(no|nope|nah|cancel|stop|forget it|never ?mind|leave it|scrap (it|that)|bin (it|that))[\s.!]*$|\b(cancel|scrap|bin|delete|ditch) (that|it|the draft|that draft|the invoice|that invoice)\b/i;
const WHATS_LEFT = /\bwhat'?s left\b|\bhow much is left\b|\bleft (to pay|to invoice|on (it|that|the job))\b|\bwhat'?s (outstanding|owing)\b|\bremaining balance\b/i;
const SEND = /\bsend (it|that|the invoice|that invoice|the draft)\b|\bemail it (to|over)\b/i;

const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, a: 1 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * Amounts as people say them: "£750", "7.5k", "seven-fifty" (750), "seven
 * hundred and fifty", "two grand", "nine thousand nine hundred and forty".
 */
export function spokenAmount(text: string): number | undefined {
  const digits = findAmounts(text)[0];
  if (digits) return digits;
  const t = text
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/[£,]/g, " ")
    // "the kitchen one", "that one" — a pronoun, not £1
    .replace(/\bone\b(?!\s+(hundred|thousand|grand|k|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|pound|quid)\b)/g, " ");
  // "seven fifty" / "twelve fifty" → 750 / 1250 (pounds, the way trades say prices)
  const pair = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(one|two|three|four|five|six|seven|eight|nine))?\b(?!\s+(thousand|grand|hundred|k))/);
  if (pair && !/\bhundred|thousand|grand\b/.test(t)) return ONES[pair[1]] * 100 + TENS[pair[2]] + (pair[3] ? ONES[pair[3]] : 0);
  const words = t.split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w in ONES && w !== "a") {
      current += ONES[w];
      seen = true;
    } else if (w === "a" && seen === false) {
      current += 0;
    } else if (w in TENS) {
      current += TENS[w];
      seen = true;
    } else if (w === "hundred") {
      current = (current || 1) * 100;
      seen = true;
    } else if (w === "thousand" || w === "grand" || w === "k") {
      total += (current || 1) * 1000;
      current = 0;
      seen = true;
    } else if (seen && !/^(pounds?|quid)$/.test(w)) {
      if (total + current > 0) break;
    }
  }
  const n = total + current;
  return seen && n > 0 ? n : undefined;
}

const basisFrom = (text: string): BillingBasis | undefined =>
  /\b(final|remaining|outstanding|rest|balance|what'?s left|everything left|the lot)\b/i.test(text) ? "final_balance" : /\bdeposit\b/i.test(text) ? "deposit" : undefined;

const vatPhrase = (a?: VatTreatment) => (a === "no_vat" ? "no VAT" : a === "exclusive" ? "plus VAT" : a === "inclusive" ? "including VAT" : "");
const basisPhrase = (b?: BillingBasis) => (b === "final_balance" ? "the final balance" : b === "deposit" ? "the deposit" : "");
const reviewChip = (id: string): Chip => ({ kind: "open", label: "Review invoice", record: "invoice", id });

export const isInvoiceRequest = (text: string) => INVOICE_REQUEST.test(text) && (CREATE_VERB.test(text) || /^\s*invoice\b/i.test(text)) && !/\b(paid|overdue|owe|owed|outstanding invoices|unpaid)\b/i.test(text);

/** A short, factual position for the job — the numbers come from the billing service. */
function position(b: JobBilling): string {
  const bits = [`price ${gbp(b.price)}`];
  if (b.approvedVariations.length) bits.push(`${gbp(b.approvedVariations.reduce((s, v) => s + v.amount, 0))} of approved variations`);
  if (b.invoicedTotal) bits.push(`${gbp(b.invoicedTotal)} already invoiced`);
  if (b.paymentsWithoutInvoice) bits.push(`${gbp(b.paymentsWithoutInvoice)}${b.depositPaid && b.paymentsWithoutInvoice <= b.depositPaid + 0.01 ? " deposit" : ""} paid`);
  return `${gbp(b.remainingToInvoice)} is left to invoice (${bits.join(", ")}).${b.unpaidOnInvoices ? ` Separately, ${gbp(b.unpaidOnInvoices)} is still unpaid on invoices already sent${b.invoices.some((i) => i.overdue) ? ", some of it overdue" : ""}.` : ""}`;
}

/** "Sophie Mackay's fitted wardrobes", but keep "Oak Road kitchen" as named. */
const jobName = (b: JobBilling) => {
  const t = b.job.title;
  const properStart = /^[A-Z][a-z]+ [A-Z]/.test(t);
  return `${b.customer.name}'s ${properStart ? t : t.replace(/^./, (c) => c.toLowerCase())} (${b.job.site})`;
};
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/* ------------------------------ The flow ------------------------------ */

export function startInvoice(io: InvoiceIO, text: string) {
  return runInvoice(io, {
    type: "invoice",
    text,
    basis: basisFrom(text) ?? (spokenAmount(text) ? "amount" : undefined),
    amount: spokenAmount(text),
    amountsAre: parseVat(text) ?? undefined,
    vatRate: parseVatRate(text) ?? undefined,
    dueDate: parseDueTerms(text)?.date,
  });
}

/** The user answered a question Bob asked about this invoice. */
export function continueInvoice(io: InvoiceIO, flow: InvoiceFlow, text: string) {
  const f: InvoiceFlow = { ...flow };
  if (f.stage === "replace") {
    if (YES.test(text) || /\b(update|change|replace|amend) (it|that|the draft)|that one\b/i.test(text)) return runInvoice(io, { ...f, stage: undefined }, f.replaceId);
    return io.say("Okay, I've left the existing draft as it is. Nothing new was made.");
  }
  const basis = basisFrom(text);
  const amount = spokenAmount(text);
  if (basis) f.basis = basis;
  if (amount && !(basis && basis !== "amount" && !/£|\bpounds?\b|\bquid\b/.test(text))) {
    f.amount = amount;
    f.basis = basis ?? "amount";
  }
  f.amountsAre = parseVat(text) ?? f.amountsAre;
  f.vatRate = parseVatRate(text) ?? f.vatRate;
  const due = parseDueTerms(text) ?? (/^\s*(7|14|21|28|30)\s*$/.test(text) ? { date: "", phrase: "" } : null);
  if (due?.date) f.dueDate = due.date;
  else if (/^\s*(7|14|21|28|30)\s*$/.test(text)) f.dueDate = parseDueTerms(`${text.trim()} days`)?.date;
  f.text = `${flow.text} ${text}`;
  return runInvoice(io, f);
}

export async function runInvoice(io: InvoiceIO, f: InvoiceFlow, replaceId?: string) {
  const { ctx } = io;
  if (!can(ctx.role, "invoices.draft") || !can(ctx.role, "finance.read")) return io.say("Your account doesn't have access to invoices or prices — Luke or Ryan can sort that one.");
  const mem = (io.state.invoice ??= {});

  // 1) Which job
  if (!f.jobId && f.customerId) {
    const theirs = io.listCustomerJobs(f.customerId);
    const pool = theirs.some((j) => j.active) ? theirs.filter((j) => j.active) : theirs;
    if (!pool.length) return io.say("They don't have a job on record, so there's nothing to invoice against. Add the job first, then ask me again. I haven't created anything.");
    if (pool.length === 1) f.jobId = pool[0].id;
    else return io.offerChoice(pool.slice(0, 4).map((j) => ({ id: j.id, label: j.label })), f, "Which of their jobs is it for?");
  }
  if (!f.jobId) {
    const look = billingLookup(ctx, f.text);
    if (look.ambiguousCustomers) {
      const first = look.ambiguousCustomers[0].name.split(" ")[0];
      return io.offerChoice(look.ambiguousCustomers.slice(0, 4).map((c) => ({ id: c.id, label: `${c.name}${c.town ? ` (${c.town})` : ""}` })), f, `Which ${first}?`, "customer");
    }
    if (look.townMiss) {
      const m = look.townMiss;
      return io.say(`I can't find a job for ${m.customer} in ${m.town}. ${m.theirJobs.length ? `Their jobs: ${m.theirJobs.join(", ")}.` : "They don't have any jobs on record."} I haven't created anything.`);
    }
    const cands = look.candidates;
    if (!cands.length) {
      if (io.state.focus?.jobId && !/\b[A-Z][a-z]+\b/.test(f.text.replace(/^\w/, ""))) f.jobId = io.state.focus.jobId;
      else return io.say("I couldn't find a job that matches that. Who's it for — the customer's name, or the town or street?", { chips: [] });
    } else if (cands.length === 1 || cands[0].score >= cands[1].score + 3) f.jobId = cands[0].jobId;
    else
      return io.offerChoice(
        cands.slice(0, 4).map((c) => ({ id: c.jobId, label: `${c.customerName} — ${c.title}, ${c.site}` })),
        f,
        cands.every((c) => c.customerId === cands[0].customerId) ? `${cands[0].customerName} has ${cands.length} jobs. Which one?` : "I found more than one that fits. Which is it?",
      );
  }
  const bill = jobBilling(ctx, f.jobId!);
  if (!bill.ok) return io.say(bill.error);
  const b = bill.value;
  io.state.focus = { customerId: b.customer.id, jobId: b.job.id };

  // 2) Already invoiced? Show what's there instead of billing twice.
  if (!replaceId && b.fullyInvoiced && f.basis !== "amount") {
    const list = b.invoices.map((i) => `${i.ref} (${gbp(i.total)}, ${i.status}${i.balance > 0 ? `, ${gbp(i.balance)} unpaid${i.overdue ? " and overdue" : ""}` : ""})`).join("; ");
    return io.say(`Everything on ${jobName(b)} has already been invoiced: ${list}. I haven't made another. Do you want to open it, or chase the unpaid amount?`, {
      chips: b.invoices.slice(0, 2).map((i) => ({ kind: "open" as const, label: `Open ${i.ref}`, record: "invoice" as const, id: i.id })),
    });
  }

  // 3) What it's for
  if (!f.basis) {
    const opts = b.options;
    const draftNote = b.drafts.length ? ` There's already a draft ${b.drafts[0].ref} for ${gbp(b.drafts[0].total)} on it.` : "";
    const q = opts.length ? `Is it for ${opts.map((o) => o.label).join(", or ")} — or a different amount?` : "How much should it be for?";
    return io.ask({ ...f, stage: "basis" }, `I've found ${jobName(b)}. ${position(b)}${draftNote} ${q}`, [
      ...opts.map((o) => ({ kind: "send" as const, label: o.basis === "final_balance" ? `Final balance ${gbp(o.amount)}` : `Deposit ${gbp(o.amount)}`, text: o.basis === "final_balance" ? "the final balance" : "the deposit" })),
      ...(b.drafts.length ? [reviewChip(b.drafts[0].id)] : []),
    ]);
  }
  if (f.basis === "amount" && !f.amount) return io.ask({ ...f, stage: "basis" }, "How much should it be for?");

  // 4) VAT and terms — from Settings, or one short question (remembered for this conversation).
  const amountsAre = ctx.org.finance.vatRegistered === false ? "no_vat" : (f.amountsAre ?? mem.amountsAre);
  const dueDate = f.dueDate ?? (mem.dueInDays ? parseDueTerms(`${mem.dueInDays} days`)?.date : undefined);
  const amount = f.basis === "final_balance" ? (f.amount ?? b.remainingToInvoice) : f.basis === "deposit" ? (f.amount ?? b.options.find((o) => o.basis === "deposit")?.amount) : f.amount;
  const out = saveDraftFromConversation(ctx, { jobId: b.job.id, basis: f.basis, amount, amountsAre, vatRate: f.vatRate, dueDate, invoiceId: replaceId });
  if (!out.ok) {
    if (out.code === "missing") {
      const needVat = out.missing.includes("vat");
      const needDue = out.missing.includes("due");
      if (out.missing.includes("vat_rate") && !needVat)
        return io.ask({ ...f, amount, amountsAre, stage: "details" }, `Which VAT rate should I use — the standard 20%?${needDue ? " And when's it due — 7, 14 or 30 days?" : ""}`, [{ kind: "send", label: "20%", text: "20%" }, ...(needDue ? [{ kind: "send" as const, label: "14 days", text: "14 days" }] : [])]);
      const what = `${amount ? gbp(amount) : "That"}${f.basis !== "amount" ? ` for ${basisPhrase(f.basis)}` : ""}`;
      const q = needVat && needDue ? `${what} — is that no VAT, plus VAT or including VAT? And when's it due — 7, 14 or 30 days?` : needVat ? `${what} — is that no VAT, plus VAT or including VAT?` : `${what} — when's it due: 7, 14 or 30 days?`;
      const settingsHint = ctx.org.finance.vatRegistered === null && needVat ? " (Set your VAT status and payment terms in Settings and I won't need to ask.)" : "";
      const repeat = f.stage === "details" ? "I just need this before I save it: " : "";
      return io.ask({ ...f, amount, stage: "details" }, `${repeat}${q}${f.stage === "details" ? "" : settingsHint}`, [
        ...(needVat ? [{ kind: "send" as const, label: "No VAT", text: "No VAT" }, { kind: "send" as const, label: "Plus VAT", text: "Plus VAT" }, { kind: "send" as const, label: "Including VAT", text: "Including VAT" }] : []),
        ...(needDue ? [{ kind: "send" as const, label: "14 days", text: "14 days" }, { kind: "send" as const, label: "30 days", text: "30 days" }] : []),
      ].slice(0, 5));
    }
    if (out.code === "draft_exists") return io.ask({ ...f, amount, amountsAre, dueDate, stage: "replace", replaceId: out.draft.id }, `${out.message} Shall I change that draft to ${gbp(amount ?? 0)}${f.basis !== "amount" ? ` (${basisPhrase(f.basis)})` : ""}?`, [
      { kind: "send", label: "Update that draft", text: "Yes, update that draft" },
      reviewChip(out.draft.id),
    ]);
    return io.say(`${out.message} I haven't saved anything.`);
  }
  // Remember answers for the rest of this conversation.
  if (amountsAre) mem.amountsAre = amountsAre;
  if (f.dueDate) {
    const m = /\b(\d{1,2})\s*days?\b/i.exec(f.text);
    if (m) mem.dueInDays = parseInt(m[1], 10);
  }
  mem.draftInvoiceId = out.invoice.id;
  io.state.flow = undefined;
  if (out.outcome !== "existing") io.markChanged();
  const inv = out.invoice;
  const head =
    out.outcome === "existing"
      ? `That's already saved as draft ${inv.draftRef} — I haven't made a second one.`
      : out.outcome === "updated"
        ? `Updated draft ${inv.draftRef} to ${gbp(inv.total)}.`
        : `Saved draft ${inv.draftRef}: ${gbp(inv.total)}${f.basis !== "amount" ? ` for ${basisPhrase(f.basis)}` : ""} on ${jobName(b)}.`;
  const detail = ` ${cap(vatPhrase(inv.amountsAre))}${inv.vat ? ` (${gbp(inv.subtotal)} + ${gbp(inv.vat)} VAT)` : ""}, due ${formatDateInline(inv.dueDate!)}. It hasn't been sent.`;
  return io.say(`${head}${detail}${out.notes.length ? ` ${out.notes.join(" ")}` : ""}`.replace(/\s+/g, " ").trim(), { chips: [reviewChip(inv.id)] });
}

/**
 * Follow-ups about the invoice in focus: "make that seven-fifty", "what's left
 * on that job?", "yeah, draft that", "cancel that", "send it", "the wardrobes
 * one". Returns true when it handled the message.
 */
export async function invoiceFollowUp(io: InvoiceIO, text: string): Promise<boolean> {
  const { ctx } = io;
  const mem = io.state.invoice;
  const draft = mem?.draftInvoiceId ? getInvoice(ctx, mem.draftInvoiceId) : undefined;
  const liveDraft = draft && draft.status === "draft" ? draft : undefined;
  const flow = io.state.flow as InvoiceFlow | undefined;
  const invoiceFlow = flow?.type === "invoice" ? flow : undefined;

  // A brand-new invoice request always starts again (no swallowing it into the old question).
  if (isInvoiceRequest(text) && findBillingCandidates(ctx, text).length) {
    io.state.flow = undefined;
    await startInvoice(io, text);
    return true;
  }
  // A fresh "what's left on Sophie Mackay's kitchen?" names the job itself.
  if (WHATS_LEFT.test(text) && !/\b(that|this|it)\b/i.test(text)) {
    const look = billingLookup(ctx, text);
    if (look.candidates.length || look.townMiss || look.ambiguousCustomers) {
      if (!can(ctx.role, "finance.read")) {
        io.say("Your account doesn't have access to prices or balances — Luke or Ryan can tell you that one.");
        return true;
      }
      io.state.flow = undefined;
      if (look.townMiss) io.say(`I can't find a job for ${look.townMiss.customer} in ${look.townMiss.town}.`);
      else if (look.ambiguousCustomers || look.candidates.length > 1) {
        const opts = look.ambiguousCustomers
          ? look.ambiguousCustomers.map((c) => `${c.name}${c.town ? ` (${c.town})` : ""}`)
          : look.candidates.map((c) => `${c.customerName} — ${c.title}, ${c.town || c.site}`);
        io.say(`That could be more than one: ${opts.slice(0, 4).join("; ")}. Which one?`);
      } else {
        const b = jobBilling(ctx, look.candidates[0].jobId);
        if (!b.ok) io.say(b.error);
        else {
          io.state.focus = { ...io.state.focus, customerId: b.value.customer.id, jobId: b.value.job.id };
          io.say(`On ${jobName(b.value)}: ${position(b.value)}${b.value.drafts.length ? ` Draft ${b.value.drafts[0].ref} (${gbp(b.value.drafts[0].total)}) hasn't been sent yet.` : ""}`);
        }
      }
      return true;
    }
  }
  if (CANCEL.test(text.trim())) {
    if (invoiceFlow) {
      io.state.flow = undefined;
      io.say("Okay, cancelled. Nothing was saved.");
      return true;
    }
    if (liveDraft && /\b(cancel|scrap|bin|delete|ditch|forget)\b/i.test(text)) {
      const r = deleteInvoiceDraft(ctx, liveDraft.id);
      if (!r.ok) {
        io.say(`I couldn't delete it: ${r.error}`);
        return true;
      }
      mem!.draftInvoiceId = undefined;
      io.markChanged();
      io.say(`Deleted draft ${liveDraft.draftRef}. Nothing was sent.`);
      return true;
    }
    return false;
  }
  // Switching job for the same customer: "no, the wardrobes one" — also mid-question.
  const switchTo = text.match(/\b(?:no,?\s*)?(?:the|actually the|i meant the)\s+([a-z ]{3,30}?)\s+(?:one|job)\b/i);
  const currentJobId = invoiceFlow?.jobId ?? io.state.focus?.jobId;
  const currentCustomer = currentJobId ? getJob(ctx, currentJobId)?.customerId : io.state.focus?.customerId;
  if (switchTo && currentCustomer) {
    const cands = findBillingCandidates(ctx, `${switchTo[1]}`).filter((c) => c.customerId === currentCustomer && c.jobId !== currentJobId);
    if (cands.length === 1) {
      if (liveDraft && liveDraft.jobId !== cands[0].jobId) {
        deleteInvoiceDraft(ctx, liveDraft.id);
        mem!.draftInvoiceId = undefined;
        io.markChanged();
        io.say(`Okay — I've removed draft ${liveDraft.draftRef} from the other job.`);
      }
      io.state.flow = undefined;
      await runInvoice(io, { type: "invoice", text, jobId: cands[0].jobId, basis: invoiceFlow?.basis, amount: invoiceFlow?.amount, amountsAre: invoiceFlow?.amountsAre });
      return true;
    }
  }
  if (invoiceFlow) {
    // "yeah, draft that" while Bob is still waiting on VAT or terms: ask just that, briefly.
    await continueInvoice(io, invoiceFlow, text);
    return true;
  }
  if (!io.state.focus?.jobId && !liveDraft) return false;

  // Amend the draft: "make that seven-fifty", "change it to £800", "actually 900 plus VAT"
  if (liveDraft && /\b(make (that|it)|change (that|it)( to)?|actually|instead|should be|knock it (down|up) to|put it (down|up)? ?(to|at))\b/i.test(text)) {
    const amount = spokenAmount(text);
    const vat = parseVat(text);
    const due = parseDueTerms(text)?.date;
    if (!amount && !vat && !due) return false;
    const out = saveDraftFromConversation(ctx, {
      jobId: liveDraft.jobId!,
      basis: "amount",
      amount: amount ?? liveDraft.lines[0]?.unitAmount,
      amountsAre: vat ?? liveDraft.amountsAre,
      dueDate: due ?? liveDraft.dueDate,
      description: liveDraft.lines[0]?.description,
      invoiceId: liveDraft.id,
    });
    if (!out.ok) io.say(`I couldn't change it: ${out.message} The draft is unchanged.`);
    else {
      io.markChanged();
      io.say(`Done — draft ${out.invoice.draftRef} is now ${gbp(out.invoice.total)} (${vatPhrase(out.invoice.amountsAre)}, due ${formatDateInline(out.invoice.dueDate!)}). Still not sent.`, { chips: [reviewChip(out.invoice.id)] });
    }
    return true;
  }
  if (YES.test(text) && liveDraft) {
    io.say(`That's already saved as draft ${liveDraft.draftRef} for ${gbp(liveDraft.total)} — I haven't made a second one.`, { chips: [reviewChip(liveDraft.id)] });
    return true;
  }
  if (WHATS_LEFT.test(text) && io.state.focus?.jobId) {
    const b = jobBilling(ctx, io.state.focus.jobId);
    if (!b.ok) io.say(b.error);
    else io.say(`On ${jobName(b.value)}: ${position(b.value)}${b.value.drafts.length ? ` Draft ${b.value.drafts[0].ref} (${gbp(b.value.drafts[0].total)}) hasn't been sent yet.` : ""}`);
    return true;
  }
  if (SEND.test(text) && liveDraft) {
    const out = await requestAction(ctx, "send_invoice", { invoiceId: liveDraft.id }, { conversationId: io.conversationId, origin: "bob" });
    if (out.kind !== "action") io.say(`${out.message} The draft is saved in Bob — open it with Review invoice and send it from your accounting system or by email.`, { chips: [reviewChip(liveDraft.id)] });
    else io.say("Check the recipient and amount, then approve it if you want it sent.", { actionId: out.view.id });
    return true;
  }
  return false;
}
