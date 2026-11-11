/**
 * Deterministic language helpers for Bob's rule engine (demo mode, and as a
 * fallback). They parse ONLY the user's own words — never customer emails.
 */
import type { ExpenseCategory, VatTreatment } from "@/lib/types";
import type { PeriodSpec } from "@/server/services/reports";
import { addDaysKey, toDateKey } from "@/lib/utils";

export const KNOWN_TOWNS = [
  "East Grinstead", "Haywards Heath", "Burgess Hill", "Crawley Down", "Crawley", "Horsham", "Copthorne", "Horley",
  "Lingfield", "Dorking", "Reigate", "Redhill", "Brighton", "Worthing", "Uckfield", "Cuckfield", "Lindfield",
  "Forest Row", "Edenbridge", "Oxted", "Godstone", "Billingshurst", "Henfield", "Hassocks", "Steyning", "Guildford",
  "Tunbridge Wells", "Burgess Hill",
];

/** Strip wake words and filler so "Morning Bob, can you…" parses cleanly. */
export function cleanUtterance(raw: string): string {
  return raw
    .replace(/[‘’]/g, "'")
    .replace(/^\s*(hey|hi|ok(ay)?|morning|good morning|afternoon|alright|right|so)?[\s,]*bob\b[\s,.:!-]*/i, "")
    .replace(/^\s*(please|can you|could you|would you|will you|i need you to|i want you to)\s+/i, "")
    .replace(/^\s*(please|can you|could you)\s+/i, "")
    .trim();
}

export function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (/^(of|in|at|to|and|&)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function sentenceCase(s: string): string {
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

const AMOUNT = String.raw`£\s?[\d,]+(?:\.\d{1,2})?\s*(?:k\b|grand)?|\b[\d,]+(?:\.\d{1,2})?\s*(?:k\b|grand|pounds|quid)`;

export function findAmounts(text: string): number[] {
  return [...text.matchAll(new RegExp(AMOUNT, "gi"))]
    .map((m) => parseAmount(m[0]))
    .filter((n): n is number => n !== null && n > 0);
}

export function parseDeposit(text: string): number | null {
  const m =
    text.match(new RegExp(String.raw`(${AMOUNT})\s*deposit`, "i")) ??
    text.match(new RegExp(String.raw`deposit\s*(?:of|is|was|:)?\s*(${AMOUNT})`, "i"));
  return m ? parseAmount(m[1]) : null;
}

/** Explicit VAT treatment in the user's words. Returns null if not stated — never assumed. */
export function parseVat(text: string): VatTreatment | null {
  const t = text.toLowerCase();
  if (/\b(no|without|zero|excluding no)\s*vat\b|\bnot vat registered\b|\bvat[- ]?free\b|\bno tax\b/.test(t)) return "no_vat";
  if (/\b(plus|\+|excluding|exclusive of|ex\.?|exc\.?|before)\s*vat\b|\bvat on top\b|\bnet\b/.test(t)) return "exclusive";
  if (/\b(including|inc\.?|incl\.?|inclusive of|with)\s*vat\b|\bvat included\b|\bgross\b/.test(t)) return "inclusive";
  return null;
}

export function parseVatRate(text: string): number | null {
  const m = text.match(/\b(20|5|0)\s*(%|percent|per cent)/i);
  if (m) return parseInt(m[1], 10);
  if (/\bstandard rate\b/i.test(text)) return 20;
  return null;
}

/** "14 days", "30 day terms", "due on Friday", "due next week" → YYYY-MM-DD */
export function parseDueTerms(text: string): { date: string; phrase: string } | null {
  const days = text.match(/\b(\d{1,2})\s*(?:-|\s)?days?\b(?!\s+ago)/i);
  if (days) {
    const n = parseInt(days[1], 10);
    if (n > 0 && n <= 90) return { date: addDaysKey(n), phrase: `${n} days` };
  }
  if (/\b(on receipt|immediately|straight away|today)\b/i.test(text)) return { date: addDaysKey(0), phrase: "on receipt" };
  const due = text.match(/\bdue\b(.*)$/i);
  if (due) {
    const d = parseDueDate(due[1]);
    if (d) return d;
  }
  return null;
}

/* ---------------------------- Periods ---------------------------- */

export function parsePeriod(text: string): PeriodSpec | null {
  const t = text.toLowerCase();
  if (/\b(last|past|previous)\s+(30|thirty)\s+days\b|\b(last|past) month\b(?!\s*\()/.test(t)) {
    // "last month" in everyday speech usually means the last 30 days; "in October"/"last calendar month" handled below.
    if (/\blast calendar month\b/.test(t)) return { kind: "last_month" };
    return { kind: "last_days", days: 30 };
  }
  const nDays = t.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days\b/);
  if (nDays) return { kind: "last_days", days: Math.min(365, parseInt(nDays[1], 10)) };
  const nWeeks = t.match(/\b(?:last|past|previous)\s+(\d{1,2}|two|three|four)\s+weeks\b/);
  if (nWeeks) {
    const map: Record<string, number> = { two: 2, three: 3, four: 4 };
    return { kind: "last_days", days: (map[nWeeks[1]] ?? parseInt(nWeeks[1], 10)) * 7 };
  }
  if (/\bthis month\b|\bso far this month\b/.test(t)) return { kind: "this_month" };
  if (/\bnext week\b/.test(t)) return { kind: "next_week" };
  if (/\blast week\b/.test(t)) return { kind: "last_week" };
  if (/\bthis week\b/.test(t)) return { kind: "this_week" };
  if (/\btoday\b/.test(t)) return { kind: "today" };
  if (/\bthis year\b/.test(t)) return { kind: "this_year" };
  if (/\b(ever|all time|in total|altogether)\b/.test(t)) return { kind: "all_time" };
  return null;
}

/* ---------------------------- Places & work ---------------------------- */

export function parseLocation(text: string): string | null {
  const lower = text.toLowerCase();
  for (const town of [...KNOWN_TOWNS].sort((a, b) => b.length - a.length)) {
    if (new RegExp(String.raw`\b${town.toLowerCase()}\b`).test(lower)) return town;
  }
  const m = text.match(/\b(?:in|at)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
  return m ? m[1] : null;
}

const WORK_TYPES: RegExp[] = [
  /kitchen (refit|renovation|fit(ting)?|install(ation)?|extension)/i,
  /loft conversion/i,
  /(fitted|built[- ]in|alcove) wardrobes?/i,
  /single[- ]storey extension|rear extension|side extension|extension/i,
  /garden room|garden office|summer ?house/i,
  /(composite |raised |garden )?decking/i,
  /(oak )?staircase( refurbishment| makeover)?|stairs/i,
  /bathroom( refit| renovation)?/i,
  /(media|tv) wall/i,
  /(built[- ]in )?shelving|bookcases?/i,
  /(internal )?doors( and skirting)?|skirting|flooring|pergola|fencing|garage conversion|porch|kitchen|wardrobes?|loft/i,
];

export function parseWorkTitle(text: string): string | null {
  for (const re of WORK_TYPES) {
    const m = text.match(re);
    if (m) return sentenceCase(m[0]);
  }
  return null;
}

/** Keywords that describe a job, used to narrow job matches ("the kitchen job"). */
export function workKeywords(text: string): string[] {
  const t = text.toLowerCase();
  return ["kitchen", "loft", "wardrobe", "extension", "decking", "deck", "stair", "bathroom", "garden room", "media wall", "porch", "shelving", "garage"].filter((k) =>
    t.includes(k),
  );
}

/* ---------------------------- Dates ---------------------------- */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseDueDate(text: string): { date: string; phrase: string } | null {
  const t = text.toLowerCase();
  if (/\b(today|tonight|this (morning|afternoon|evening)|later)\b/.test(t)) return { date: addDaysKey(0), phrase: "today" };
  if (/\b(tomorrow|tmrw|tomoz)\b/.test(t)) return { date: addDaysKey(1), phrase: "tomorrow" };
  if (/\bnext week\b/.test(t)) return { date: addDaysKey(7), phrase: "next week" };
  if (/\bnext month\b/.test(t)) return { date: addDaysKey(30), phrase: "next month" };
  const inDays = t.match(/\bin (\d+|a couple of|a few|two|three|four|five) days?\b/);
  if (inDays) {
    const map: Record<string, number> = { "a couple of": 2, "a few": 3, two: 2, three: 3, four: 4, five: 5 };
    const n = map[inDays[1]] ?? parseInt(inDays[1], 10);
    return { date: addDaysKey(n), phrase: `in ${n} days` };
  }
  const inWeeks = t.match(/\bin (\d+|a|two|three) weeks?\b/);
  if (inWeeks) {
    const map: Record<string, number> = { a: 1, two: 2, three: 3 };
    const n = map[inWeeks[1]] ?? parseInt(inWeeks[1], 10);
    return { date: addDaysKey(n * 7), phrase: `in ${n} week${n > 1 ? "s" : ""}` };
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
    .replace(/\b(today|tonight|this (morning|afternoon|evening)|tomorrow|tmrw|tomoz|next week|next month|later)\b/gi, "")
    .replace(/\bin (\d+|a couple of|a few|two|three|four|five) days?\b/gi, "")
    .replace(/\bin (\d+|a|two|three) weeks?\b/gi, "")
    .replace(/\b(on |next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim()
    .replace(/[,.!?]+$/, "");
}

/* ---------------------------- Misc ---------------------------- */

export function parseExpenseCategory(text: string): ExpenseCategory {
  const t = text.toLowerCase();
  if (/\bskip|waste|tip\b/.test(t)) return "waste";
  if (/\bhire|digger|scaffold|mixer\b/.test(t)) return "plant_hire";
  if (/\bsub-?contract|electrician|plumber|plasterer\b/.test(t)) return "subcontractor";
  if (/\blabour|wages|day rate\b/.test(t)) return "labour";
  if (/\bmaterials?|timber|wood|screws|plaster|tiles|units|worktop|paint|supplies\b/.test(t)) return "materials";
  return "other";
}

export function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|yup|go on|go ahead|do it|ok(ay)?|sure|please do|confirm|correct|that's right|right)\b/i.test(text.trim());
}

export function isNegative(text: string): boolean {
  return /^(no|nope|nah|cancel|stop|forget it|never ?mind|don't|leave it)\b/i.test(text.trim());
}

export function detectMethod(text: string): "bank_transfer" | "card" | "cash" | "cheque" | null {
  if (/\bcash\b/i.test(text)) return "cash";
  if (/\bcard\b/i.test(text)) return "card";
  if (/\bcheque\b/i.test(text)) return "cheque";
  if (/\b(bank|transfer|bacs|online)\b/i.test(text)) return "bank_transfer";
  return null;
}
