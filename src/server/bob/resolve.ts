import "server-only";
/**
 * Entity resolution: work out WHICH customer / job / enquiry the user means,
 * from structured records only. Returns all plausible matches so Bob can ask
 * when it's ambiguous — it never picks one at random.
 */
import type { Customer, Enquiry, Job } from "@/lib/types";
import { isActiveJob, isOpenEnquiry } from "@/lib/derive";
import type { Ctx } from "@/server/context";
import { listCustomers, listEnquiries, listJobs } from "@/server/services/records";
import { KNOWN_TOWNS, workKeywords } from "./nlu";

const STOP = new Set(["the", "and", "mrs", "mr", "ms", "miss", "dr"]);
/** First names that are also everyday words — only matched when capitalised. */
const WORDY_NAMES = new Set(["mark", "will", "bill", "jack", "grace", "rose", "frank", "bob", "sue", "pat", "april", "may", "june", "dawn", "joy", "hope", "faith", "summer", "ray", "nick", "drew", "chase", "art"]);

function words(text: string): string[] {
  return text.replace(/[’']s\b/g, "").replace(/[^A-Za-z\s&-]/g, " ").split(/\s+/).filter(Boolean);
}

/** Score how strongly `text` mentions `name` (0 = not at all). */
export function mentionScore(text: string, name: string): number {
  const raw = words(text);
  const lower = raw.map((w) => w.toLowerCase());
  const parts = name
    .toLowerCase()
    .replace(/[^a-z&\s-]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1 && !STOP.has(p) && p !== "&");
  if (!parts.length) return 0;
  const has = (p: string) => {
    const singular = p.replace(/s$/, "");
    return lower.some((w, i) => {
      const ws = w.replace(/s$/, "");
      if (!(w === p || ws === singular || w === `${p}s`)) return false;
      if (WORDY_NAMES.has(p) && raw[i][0] !== raw[i][0].toUpperCase()) return false;
      return true;
    });
  };
  const hits = parts.filter(has);
  if (!hits.length) return 0;
  if (hits.length === parts.length && parts.length > 1) return 3; // full name
  const isFirst = hits.includes(parts[0]) && parts.length > 1;
  return isFirst && hits.length === 1 ? 1 : 2; // surname (or single-word name) beats first name
}

export interface Matches<T> {
  items: T[];
  /** Top score; lets callers tell "Sophie" (1) from "Sophie Lambert" (3). */
  score: number;
}

export function resolveCustomers(ctx: Ctx, text: string): Matches<Customer> {
  const scored = listCustomers(ctx)
    .map((c) => ({ c, s: mentionScore(text, c.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { items: [], score: 0 };
  const top = scored[0].s;
  return { items: scored.filter((x) => x.s === top).map((x) => x.c), score: top };
}

export function mentionedTown(ctx: Ctx, text: string, extraPlaces: string[] = []): string | null {
  const lower = text.toLowerCase();
  const places = [...new Set([...extraPlaces, ...KNOWN_TOWNS])].sort((a, b) => b.length - a.length);
  return places.find((p) => new RegExp(String.raw`\b${p.toLowerCase()}\b`).test(lower)) ?? null;
}

export interface JobResolution {
  jobs: Job[];
  customers: Customer[];
  customerScore: number;
  town: string | null;
  keywords: string[];
  /** Which clues the user gave, for clarifying questions. */
  clues: string[];
}

/**
 * Narrow jobs using every clue the user gave: customer name, town and type of
 * work. Each clue must match — so "Sophie… Copthorne" picks Sophie's Copthorne
 * job even if there are two Sophies or two Copthorne jobs.
 */
export function resolveJobs(ctx: Ctx, text: string, opts: { includeClosed?: boolean } = {}): JobResolution {
  const all = listJobs(ctx);
  const customers = resolveCustomers(ctx, text);
  const town = mentionedTown(ctx, text, all.map((j) => j.location));
  const keywords = workKeywords(text);
  const clues: string[] = [];
  // Use all customers mentioned at any score so "Sophie" can still narrow to the Sophie with a Copthorne job.
  const anyCustomer = listCustomers(ctx).filter((c) => mentionScore(text, c.name) > 0);
  let jobs = opts.includeClosed ? all : all.filter(isActiveJob);
  if (anyCustomer.length) {
    clues.push("customer");
    const ids = new Set(anyCustomer.map((c) => c.id));
    const narrowed = jobs.filter((j) => ids.has(j.customerId));
    jobs = narrowed.length || opts.includeClosed ? narrowed : all.filter((j) => ids.has(j.customerId));
  }
  if (town) {
    clues.push("town");
    jobs = jobs.filter((j) => j.location.toLowerCase() === town.toLowerCase());
  }
  if (keywords.length) {
    // Title/type matches beat description matches ("kitchen refit" vs an extension with a "kitchen-diner").
    const byTitle = jobs.filter((j) => keywords.some((k) => `${j.title} ${j.kind}`.toLowerCase().includes(k)));
    const withKw = byTitle.length ? byTitle : jobs.filter((j) => keywords.some((k) => j.description.toLowerCase().includes(k)));
    if (withKw.length) {
      clues.push("work");
      jobs = withKw;
    }
  }
  if (!clues.length) jobs = [];
  // "Sophie" alone with two Sophies on file: don't let job data pick one of them.
  if (clues.length === 1 && clues[0] === "customer" && customers.items.length > 1) jobs = [];
  // If several customers share the first name, keep the best-scoring ones unless the job clues already narrowed it.
  if (jobs.length > 1 && customers.score >= 2) {
    const best = new Set(customers.items.map((c) => c.id));
    const strict = jobs.filter((j) => best.has(j.customerId));
    if (strict.length) jobs = strict;
  }
  return { jobs, customers: customers.items, customerScore: customers.score, town, keywords, clues };
}

export interface EnquiryResolution {
  enquiries: Enquiry[];
  clues: string[];
}

/** "the customer who emailed about decking", "the latest kitchen enquiry", "Tom's enquiry". */
export function resolveEnquiries(ctx: Ctx, text: string, opts: { openOnly?: boolean } = { openOnly: true }): EnquiryResolution {
  const t = text.toLowerCase();
  let list = listEnquiries(ctx);
  if (opts.openOnly) list = list.filter(isOpenEnquiry);
  const clues: string[] = [];
  const named = list.filter((e) => mentionScore(text, e.customerName) > 0);
  if (named.length) {
    clues.push("name");
    const top = Math.max(...named.map((e) => mentionScore(text, e.customerName)));
    list = named.filter((e) => mentionScore(text, e.customerName) === top);
  }
  if (/\bemail(ed)?\b/.test(t)) {
    clues.push("email");
    list = list.filter((e) => e.source === "email");
  } else if (/\binstagram|\binsta\b|\bdm\b/.test(t)) {
    clues.push("instagram");
    list = list.filter((e) => e.source === "instagram");
  } else if (/\bwebsite|web form|contact form\b/.test(t)) {
    clues.push("website");
    list = list.filter((e) => e.source === "website");
  } else if (/\b(rang|called|phoned|voicemail)\b/.test(t)) {
    clues.push("phone");
    list = list.filter((e) => e.source === "phone");
  }
  const kws = workKeywords(text);
  if (kws.length) {
    clues.push("work");
    list = list.filter((e) => kws.some((k) => `${e.title} ${e.description}`.toLowerCase().includes(k)));
  }
  const town = mentionedTown(ctx, text, list.map((e) => e.location));
  if (town) {
    clues.push("town");
    list = list.filter((e) => e.location.toLowerCase() === town.toLowerCase());
  }
  list.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  if (/\b(latest|newest|most recent|last)\b/.test(t) && list.length > 1) {
    clues.push("latest");
    list = [list[0]];
  }
  if (!clues.length) list = [];
  return { enquiries: list, clues };
}
