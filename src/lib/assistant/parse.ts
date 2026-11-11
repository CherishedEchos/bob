/**
 * Small, deterministic parsers used by the demo engine.
 * A real model replaces these, but they stay useful as validators for
 * model-proposed tool arguments.
 */
import type { AppData, Enquiry, Job } from "@/lib/types";
import { addDaysKey, toDateKey } from "@/lib/utils";

export const KNOWN_TOWNS = [
  "East Grinstead", "Haywards Heath", "Burgess Hill", "Crawley Down", "Crawley", "Horsham",
  "Copthorne", "Horley", "Lingfield", "Dorking", "Reigate", "Redhill", "Brighton", "Worthing",
  "Uckfield", "Cuckfield", "Lindfield", "Forest Row", "Edenbridge", "Oxted", "Godstone",
  "Billingshurst", "Henfield", "Hassocks", "Steyning", "Guildford", "Tunbridge Wells",
];

const WORK_TYPES: [RegExp, string][] = [
  [/kitchen (refit|renovation|fit(ting)?|install(ation)?)/i, ""],
  [/loft conversion/i, ""],
  [/(fitted|built[- ]in|alcove) wardrobes?/i, ""],
  [/single[- ]storey extension|rear extension|side extension|extension/i, ""],
  [/garden room|garden office|summer ?house/i, ""],
  [/(composite |raised |garden )?decking/i, ""],
  [/(oak )?staircase( refurbishment| makeover)?|stairs/i, ""],
  [/bathroom( refit| renovation)?/i, ""],
  [/(media|tv) wall/i, ""],
  [/(built[- ]in )?shelving|bookcases?|cabinets?/i, ""],
  [/(internal )?doors( and skirting)?|skirting|flooring|pergola|fencing|garage conversion|kitchen|wardrobes?|loft/i, ""],
];

export function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 && /^(of|in|at|to|and|&)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function sentenceCase(s: string): string {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : t;
}

/* ---------------------------- Money ---------------------------- */

export function parseAmount(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)\s*(k|grand)?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2]) n *= 1000;
  return Number.isFinite(n) ? n : null;
}

const AMOUNT = String.raw`£\s?[\d,]+(?:\.\d{1,2})?\s*(?:k|grand)?|[\d,]+(?:\.\d{1,2})?\s*(?:k|grand|pounds|quid)`;

export function findAmounts(text: string): number[] {
  const re = new RegExp(AMOUNT, "gi");
  return [...text.matchAll(re)].map((m) => parseAmount(m[0])).filter((n): n is number => n !== null && n > 0);
}

export function parseQuote(text: string): number | null {
  const m = text.match(new RegExp(String.raw`(?:quote[d]?|quoting|price[d]?|for)\s*(?:is|of|at|was|:)?\s*(${AMOUNT})`, "i"));
  if (m) return parseAmount(m[1]);
  return null;
}

export function parseDeposit(text: string): { amount: number; paid: boolean } | null {
  const before = text.match(new RegExp(String.raw`(${AMOUNT})\s*deposit`, "i"));
  const after = text.match(new RegExp(String.raw`deposit\s*(?:of|is|was|:)?\s*(${AMOUNT})`, "i"));
  const m = before ?? after;
  if (!m) return null;
  const amount = parseAmount(m[1]);
  if (amount === null) return null;
  const paid = /\b(paid|received|transferred|sent|put down|had)\b/i.test(text) && !/\b(due|owed|outstanding|needs? to pay|will pay)\b/i.test(text);
  return { amount, paid };
}

/* ---------------------------- Places & work ---------------------------- */

export function parseLocation(text: string): string | null {
  const lower = text.toLowerCase();
  for (const town of KNOWN_TOWNS) {
    if (new RegExp(String.raw`\b${town.toLowerCase()}\b`).test(lower)) return town;
  }
  const m = text.match(/\b(?:in|at)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
  return m ? m[1] : null;
}

export function parseWorkTitle(text: string): string | null {
  for (const [re] of WORK_TYPES) {
    const m = text.match(re);
    if (m) return sentenceCase(m[0]);
  }
  return null;
}

/** "add a job for the Smiths, kitchen…" → "The Smiths". Only from explicit "for X" phrasing — never guessed. */
export function parseNewCustomerName(text: string): string | null {
  const m = text.match(
    /\bjob for\s+((?:the\s+)?[a-z][a-z'\-]*(?:\s+(?:and|&)\s+[a-z][a-z'\-]*)?(?:\s+[a-z][a-z'\-]*)?)(?=\s*(?:[,.;:!?]|\s-\s|\s+in\b|\s+at\b|\s+quote|\s+for\b|\s+who\b|\s+they\b|\s+kitchen|\s+loft|\s+fitted|\s+wardrobe|\s+extension|\s+decking|\s+garden|\s+stair|\s+bathroom|$))/i,
  );
  if (!m) return null;
  const name = m[1].trim();
  if (/^(a|an|someone|them|him|her|me)$/i.test(name)) return null;
  return titleCase(name.replace(/^the\s+/i, "the "));
}

/* ---------------------------- Dates ---------------------------- */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseDueDate(text: string): { date: string; phrase: string } | null {
  const t = text.toLowerCase();
  if (/\b(today|tonight|this (morning|afternoon|evening)|later)\b/.test(t)) return { date: addDaysKey(0), phrase: "today" };
  if (/\b(tomorrow|tmrw|in the morning)\b/.test(t)) return { date: addDaysKey(1), phrase: "tomorrow" };
  if (/\bnext week\b/.test(t)) return { date: addDaysKey(7), phrase: "next week" };
  const inDays = t.match(/\bin (\d+|a couple of|a few|two|three) days?\b/);
  if (inDays) {
    const map: Record<string, number> = { "a couple of": 2, "a few": 3, two: 2, three: 3 };
    const n = map[inDays[1]] ?? parseInt(inDays[1], 10);
    return { date: addDaysKey(n), phrase: `in ${n} days` };
  }
  for (let i = 0; i < 7; i++) {
    if (new RegExp(String.raw`\b(on |next |this )?${WEEKDAYS[i]}\b`).test(t)) {
      const d = new Date();
      let diff = (i - d.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      d.setDate(d.getDate() + diff);
      return { date: toDateKey(d), phrase: `on ${WEEKDAYS[i][0].toUpperCase()}${WEEKDAYS[i].slice(1)}` };
    }
  }
  return null;
}

export function stripDatePhrases(text: string): string {
  return text
    .replace(/\b(today|tonight|this (morning|afternoon|evening)|tomorrow|tmrw|in the morning|next week|later)\b/gi, "")
    .replace(/\bin (\d+|a couple of|a few|two|three) days?\b/gi, "")
    .replace(/\b(on |next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim()
    .replace(/[,.!?]+$/, "");
}

/* ---------------------------- People ---------------------------- */

const STOP = new Set(["the", "and", "mrs", "mr", "ms", "miss"]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z&\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .flatMap((w) => (w.endsWith("s") ? [w, w.slice(0, -1)] : [w]));
}

function mentions(text: string, name: string): boolean {
  const t = " " + text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ") + " ";
  return nameTokens(name).some((tok) => t.includes(` ${tok} `) || t.includes(` ${tok}s `));
}

export function findEnquiriesMentioned(text: string, data: AppData): Enquiry[] {
  return data.enquiries.filter((e) => mentions(text, e.customerName));
}

export function findJobsMentioned(text: string, data: AppData): Job[] {
  return data.jobs.filter((j) => mentions(text, j.customerName));
}

export function detectMethod(text: string): "bank_transfer" | "card" | "cash" | "cheque" {
  if (/\bcash\b/i.test(text)) return "cash";
  if (/\bcard\b/i.test(text)) return "card";
  if (/\bcheque|check\b/i.test(text)) return "cheque";
  return "bank_transfer";
}
