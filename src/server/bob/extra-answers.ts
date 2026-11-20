import "server-only";
/**
 * More read-only questions Bob answers from the workspace's own records:
 *  - "What jobs still need quoting?"
 *  - "Who is on holiday next week?"
 *  - "Create a handover report for the recently completed extension" — Bob
 *    explains where that's done and opens the right job.
 * Permission-checked like everything else.
 */
import type { Chip } from "@/lib/bob/types";
import { can } from "@/lib/auth/permissions";
import { ABSENCE_LABEL } from "@/lib/leave";
import { addDays, formatDayLong, weekStart } from "@/lib/dates";
import { todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";
import { listEnquiries, listJobs } from "@/server/services/records";
import { listPeople } from "@/server/services/team";
import { listAbsences } from "@/server/services/absences";
import { listNames, plural } from "./compose";

type Answer = { text: string; chips?: Chip[] };

export const NEEDS_QUOTING = /\b(what|which|any|anything)\b[^?]*\b(need(s|ing)?|still need|waiting (for|on)|to)\b[^?]*\bquot(e|ing|ed)\b|\bjobs? to quote\b|\bstill to quote\b/i;
export const ON_HOLIDAY = /\b(who('?s| is| are)?|anyone|anybody|is anyone)\b[^?]*\b(on holiday|on leave|off|away|annual leave|unavailable)\b/i;
export const HANDOVER_REQUEST = /\b(create|make|do|generate|write|prepare|start|put together|draft)\b[^?]*\bhandover\b/i;

export function needsQuoting(ctx: Ctx): Answer {
  const waiting = listEnquiries(ctx).filter((e) => e.status === "quote_required");
  if (!waiting.length) return { text: "Nothing is waiting for a quote right now.", chips: [{ kind: "link", label: "Open jobs", href: "/jobs?view=to_quote" }] };
  const names = waiting.slice(0, 5).map((e) => `${e.customerName} — ${e.title.toLowerCase()} in ${e.location}`);
  return {
    text: `${plural(waiting.length, "enquiry", "enquiries")} still ${waiting.length === 1 ? "needs" : "need"} a quote: ${names.join("; ")}.${waiting.length > 5 ? ` And ${waiting.length - 5} more.` : ""}`,
    chips: [
      ...waiting.slice(0, 2).map((e) => ({ kind: "open" as const, label: `Open ${e.customerName.split(" ")[0]}'s enquiry`, record: "enquiry" as const, id: e.id })),
      { kind: "link", label: "All to quote", href: "/jobs?view=to_quote" },
    ],
  };
}

function period(lower: string): { from: string; to: string; label: string } {
  const today = todayKey();
  const ws = weekStart(today);
  if (/\bnext week\b/.test(lower)) return { from: addDays(ws, 7), to: addDays(ws, 13), label: "next week" };
  if (/\bthis week\b/.test(lower)) return { from: today, to: addDays(ws, 6), label: "this week" };
  if (/\btomorrow\b/.test(lower)) return { from: addDays(today, 1), to: addDays(today, 1), label: "tomorrow" };
  if (/\btoday\b/.test(lower)) return { from: today, to: today, label: "today" };
  return { from: today, to: addDays(today, 13), label: "in the next two weeks" };
}

export function onHoliday(ctx: Ctx, lower: string): Answer {
  if (!can(ctx.role, "schedule.read")) return { text: "Your account can't see the team's holidays." };
  const { from, to, label } = period(lower);
  const people = new Map(listPeople(ctx).map((p) => [p.id, p.name]));
  const off = listAbsences(ctx)
    .filter((a) => ["approved", "pending"].includes(a.status) && a.startDate <= to && a.endDate >= from && people.has(a.personId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const chips: Chip[] = [{ kind: "link", label: "Open holidays", href: "/team?view=holidays" }];
  if (!off.length) return { text: `Nobody is off ${label}.`, chips };
  const lines = off.map((a) => {
    const range = a.startDate === a.endDate ? formatDayLong(a.startDate) : `${formatDayLong(a.startDate)} to ${formatDayLong(a.endDate)}`;
    return `${people.get(a.personId)} — ${ABSENCE_LABEL[a.kind].toLowerCase()}, ${range}${a.status === "pending" ? " (waiting for approval)" : ""}`;
  });
  return { text: `${label[0].toUpperCase()}${label.slice(1)}: ${lines.join("; ")}.`, chips };
}

/** Handover reports are built on the job (photos chosen, summary checked) — open the right one. */
export function handoverHelp(ctx: Ctx, lower: string): Answer {
  if (ctx.role !== "owner" && ctx.role !== "office") return { text: "Handover reports are prepared by Luke or Ryan." };
  const jobs = listJobs(ctx);
  const done = jobs.filter((j) => j.status === "completed" || j.status === "snagging");
  const words = lower.replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["create", "make", "generate", "write", "prepare", "handover", "report", "recently", "completed", "finished", "the", "for"].includes(w));
  const match = done.filter((j) => words.some((w) => `${j.title} ${j.customerName} ${j.location} ${j.kind}`.toLowerCase().includes(w)));
  const target = match[0] ?? null;
  const how = "Handover reports are built on the job's Handover tab: Bob drafts the summary from the updates and photos, and you choose the photos and check every word before anything is shared.";
  if (target) {
    return {
      text: `${how} Open ${target.customerName}'s ${target.title.toLowerCase()} to start.`,
      chips: [{ kind: "link", label: `Open ${target.title} handover`, href: `/jobs/${target.id}?tab=handover` }],
    };
  }
  const names = done.slice(0, 3);
  return {
    text: words.length
      ? `I can't see a finished job matching that. ${names.length ? `Finished or snagging: ${listNames(names.map((j) => `${j.customerName}'s ${j.title.toLowerCase()}`), 3)}.` : "No jobs are marked finished yet."} ${how}`
      : `${how} ${names.length ? `Which job — ${listNames(names.map((j) => `${j.customerName}'s ${j.title.toLowerCase()}`), 3)}?` : "No jobs are marked finished yet."}`,
    chips: names.map((j) => ({ kind: "link" as const, label: `${j.title} handover`, href: `/jobs/${j.id}?tab=handover` })),
  };
}
