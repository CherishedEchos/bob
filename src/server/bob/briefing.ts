import "server-only";
import type { Ctx } from "@/server/context";
import * as Rep from "@/server/services/reports";
import { firstName } from "@/lib/utils";
import { greetingFor, listNames, plural } from "./compose";

export interface Briefing {
  date: string;
  /** Spoken and shown. Kept short enough for a single spoken reply. */
  text: string;
  /** The first thing to do, as a ready-made request for Bob. */
  suggestion?: { label: string; request: string };
}

const amountOf = (detail: string) => detail.match(/£[\d,]+/)?.[0];
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * "Morning briefing": the day in a few spoken sentences, built only from
 * Bob's records (the same priorities as Today). Never invents figures.
 */
export function morningBriefing(ctx: Ctx, now = new Date()): Briefing {
  const s = Rep.todaySummary(ctx);
  const name = /^(owner|office|site team)$/i.test(ctx.userName) ? "" : `, ${firstName(ctx.userName)}`;
  const parts: string[] = [`${greetingFor(now)}${name}. Here's your day.`];

  const replies = s.priorities.filter((p) => p.kind === "reply");
  if (replies.length) {
    parts.push(
      replies.length === 1
        ? `${replies[0].who} is waiting for a reply.`
        : `${plural(replies.length, "person is", "people are")} waiting for a reply — ${listNames(replies.map((r) => firstName(r.who)), 3)}.`,
    );
  }

  if (s.financeVisible) {
    const deposits = s.priorities.filter((p) => p.kind === "deposit");
    const invoices = s.priorities.filter((p) => p.kind === "invoice");
    const money: string[] = [];
    if (deposits[0]) {
      const amt = amountOf(deposits[0].detail);
      const late = deposits[0].title.includes("overdue");
      money.push(`${possessive(firstName(deposits[0].who))} ${amt ? `${amt} ` : ""}deposit is ${late ? "overdue" : "due soon"}`);
    }
    if (invoices[0]) {
      const amt = amountOf(invoices[0].detail);
      money.push(`${possessive(invoices[0].who)} ${amt ? `${amt} ` : ""}invoice is late`);
    }
    if (money.length) parts.push(`${money.join(", and ")}.`.replace(/^./, (c) => c.toUpperCase()));
  }

  const chase = s.priorities.filter((p) => p.kind === "followup" || p.kind === "quote");
  if (chase.length) parts.push(`${plural(chase.length, "enquiry needs", "enquiries need")} a follow-up.`);

  const today = s.tasksDue.filter((t) => t.dueDate === s.date).slice(0, 2);
  if (today.length) parts.push(`On your list today: ${listNames(today.map((t) => t.title.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())), 2)}.`);

  const jobs = [...s.startingToday, ...s.onSite.filter((j) => !s.startingToday.some((x) => x.id === j.id))];
  if (s.startingToday.length) parts.push(`Starting today: ${listNames(s.startingToday.map((j) => `${possessive(firstName(j.customerName))} ${j.title.toLowerCase()}`), 2)}.`);
  else if (jobs.length) parts.push(`${plural(jobs.length, "job is", "jobs are")} on the go.`);

  let suggestion: Briefing["suggestion"];
  const first = replies[0];
  if (first) {
    suggestion = { label: `Draft a reply to ${firstName(first.who)}`, request: `Draft a reply to ${first.who}` };
    parts.push(`Want me to start with ${possessive(firstName(first.who))} reply?`);
  } else if (parts.length === 1) {
    parts.push("Nothing urgent — have a good one.");
  }

  let text = parts.join(" ");
  if (text.length > 560) text = text.slice(0, 557).replace(/\s+\S*$/, "") + "…";
  return { date: s.date, text, suggestion };
}
