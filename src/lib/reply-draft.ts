/**
 * Reply drafting rules shared by the enquiry screen and batch replies.
 * Pure (no storage, no AI). A draft never promises a price, date or
 * commitment the business hasn't confirmed: where the customer asks, the
 * draft says the team will confirm or asks for the next detail, and the
 * enquiry is flagged for a decision.
 */
import type { Enquiry, EnquiryMessage } from "@/lib/types";

export type FlagKind = "date" | "price" | "commitment";
export interface DraftFlag {
  kind: FlagKind;
  text: string;
}

const WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const MONTH = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const SPECIFIC_DATE = new RegExp(
  `\\b(?:(?:${WEEKDAY})\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+(?:${MONTH})\\b|\\b(?:${WEEKDAY})\\b(?:\\s+(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?)?|\\b(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
  "i",
);
const SEASON = /\b(?:before|by|for|in|after|over) (?:the )?(?:christmas|easter|new year|spring|summer|autumn|winter|end of (?:the )?(?:month|year)|half[- ]term|(?:next|this) (?:week|month))\b/i;
const TIMING_ASK = /\b(start|begin|finish|finished|done|complete|completed|ready|fit(?:ted)?|install(?:ed)?)\b|\bwhen (can|could|would) you\b|\bhow soon\b|\bavailab/i;
const PRICE_ASK = /\b(rough )?(price|cost|costs|how much|quote|ballpark|estimate|budget|ball park)\b/i;
const DRAFT_PRICE = /£\s?\d|\bprice\b|\bcost\b|\bquote\b/i;
const COMMITMENT_CORE = /\b(should work (?:well|fine)|will work (?:well|fine)|(?:can|could) definitely|no problem|guarantee\w*|we(?:'ll| will| can) (?:start|be there|have it (?:done|finished))|will be (?:done|finished|ready) by|fits? in (?:well|fine)|that'?s fine|easily (?:done|doable))\b/i;
const COMMITMENT = new RegExp(`[^.!?\\n]*${COMMITMENT_CORE.source}[^.!?\\n]*[.!?]?`, "i");

export function latestInbound(e: Enquiry): EnquiryMessage | undefined {
  return [...e.messages].reverse().find((m) => m.direction === "inbound");
}

/** "Could you start on Monday 1st December?" → "Monday 1st December". */
export function askedTiming(text: string): string | undefined {
  if (!TIMING_ASK.test(text)) return undefined;
  const date = text.match(SPECIFIC_DATE)?.[0];
  if (date) return date.trim().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/, (_, n: string, s: string) => n + s.toLowerCase());
  const season = text.match(SEASON)?.[0];
  return season?.trim().toLowerCase();
}

/** Add lines just before the sign-off (the last paragraph), after the thanks. */
function insertBeforeSignOff(body: string, extra: string[]): string {
  if (!extra.length) return body;
  const paras = body.split(/\n\n/);
  if (paras.length < 2) return [body, ...extra].join("\n\n");
  return [...paras.slice(0, -1), ...extra, paras[paras.length - 1]].join("\n\n");
}

/** "Hoping to start in the new year" → "Roughly when in the new year were you hoping to start?" */
function nextTimingQuestion(timing: string, inbound: string): string {
  const season = timing.replace(/^(before|by|for|in|after|over)\s+/i, "").replace(/^the\s+/i, "");
  const finish = /\b(finish|finished|done|complete|completed|ready)\b/i.test(inbound) && !/\bstart\b/i.test(inbound);
  if (/^(before|by)\b/i.test(timing)) return `Is ${timing.replace(/^(before|by)\s+/i, "").replace(/^the\s+/i, "the ")} a firm deadline, or is there some flexibility?`;
  return finish ? `When would you ideally need it finished?` : `Roughly when in the ${season.replace(/^the\s+/i, "")} were you hoping to start?`;
}

export function buildDraft(e: Enquiry): { draft: string; flags: DraftFlag[]; savedDraft: boolean } {
  const inbound = latestInbound(e)?.body ?? e.description;
  const savedDraft = !!e.draftReply?.trim();
  let draft = (savedDraft ? e.draftReply! : e.suggestedReply).trim();
  const flags: DraftFlag[] = [];
  const extra: string[] = [];
  const timing = askedTiming(inbound);
  const specific = !!timing && /\d|day\b/i.test(timing);

  let commitment = draft.match(COMMITMENT)?.[0]?.trim();
  if (commitment && !savedDraft) {
    // Bob's own suggestion promised something unconfirmed: take the promise out.
    // Cut only the clause that promises ("…sounds great, and a new-year start should work well.").
    const tail = commitment.match(/(?:,\s*(?:and|but|so)?\s*|\s+(?:and|but|so)\s+)[^,]*$/);
    if (tail && tail.index && COMMITMENT_CORE.test(tail[0])) draft = draft.replace(commitment, commitment.slice(0, tail.index).trimEnd().replace(/[.!?]?$/, "."));
    else draft = draft.replace(commitment, "").replace(/ {2,}/g, " ").replace(/[ \t]+\n/g, "\n");
    commitment = undefined;
  }
  if (commitment) {
    flags.push({ kind: "commitment", text: `Your draft says “${commitment.replace(/^(and|but|so)\s+/i, "")}” — check you can commit to that before sending.` });
  }

  if (timing && !commitment) {
    flags.push({
      kind: "date",
      text: specific
        ? `Asks to start ${timing}. Your diary isn't confirmed, so the draft doesn't promise it — decide before sending.`
        : `Wants it ${/\b(finish|done|complete|ready)\b/i.test(inbound) && !/\bstart\b/i.test(inbound) ? "done" : "to start"} ${timing}. The draft says you'll confirm dates — decide before sending.`,
    });
    if (!savedDraft) {
      extra.push(
        specific
          ? `On timing — we'll need to check the diary before we can confirm ${timing}. We'll come back to you with a firm start date once we've had a look at the job.`
          : `On timing — we'll confirm dates once we've seen the job and checked the diary. ${nextTimingQuestion(timing, inbound)}`,
      );
    }
  }

  if (PRICE_ASK.test(inbound)) {
    flags.push({ kind: "price", text: "Asks for a price. The draft doesn't give one — add a ballpark if you're happy to." });
    if (!savedDraft && !DRAFT_PRICE.test(draft)) {
      extra.push("We'll put a proper price together once we've seen the space — every job is a bit different, so we'd rather not guess.");
    }
  }

  if (!savedDraft) draft = insertBeforeSignOff(draft, extra);
  return { draft, flags, savedDraft };
}
