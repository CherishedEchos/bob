/**
 * Ask Bob's workspace data tools, checked against the records they read
 * (independently derived from the services), plus permissions, secrets, and
 * the Claude loop's routing, memory, cards and voice handling (simulated
 * client — no network).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, flatSystem, freshDb, N93_OFFICE, N93_OWNER, N93_STAFF } from "./helpers";
import { runReadTool } from "@/server/bob/tools";
import { claudeHealth, setClaudeClientForTests } from "@/server/bob/claude";
import { addDays, weekStart } from "@/lib/dates";
import { todayKey } from "@/lib/utils";
import { bookingsOnDay } from "@/lib/schedule";
import { listBookings, listMaterials, listPeople } from "@/server/services/team";
import { listAbsences } from "@/server/services/absences";
import * as Bill from "@/server/services/billing";
import type { Ctx } from "@/server/context";

beforeEach(() => freshDb());
const today = () => todayKey();
const ws = () => weekStart(today());
function tool<T = Record<string, unknown>>(ctx: Ctx, name: string, args: unknown): T {
  const r = runReadTool(ctx, name, args);
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
}

describe("Answers match the records", () => {
  it("where is everyone working tomorrow → every booking covering tomorrow, with the people on it", () => {
    const ctx = ctxFor(N93_OWNER);
    const day = addDays(today(), 1);
    const out = tool<{ days: { bookings: { booking_id: string; people: string[] }[] }[] }>(ctx, "get_schedule", { from: day });
    const names = new Map(listPeople(ctx).map((p) => [p.id, p.name]));
    const expected = bookingsOnDay(listBookings(ctx), day);
    expect(out.days[0].bookings.map((b) => b.booking_id).sort()).toEqual(expected.map((b) => b.id).sort());
    for (const b of out.days[0].bookings) expect(b.people.sort()).toEqual(expected.find((x) => x.id === b.booking_id)!.personIds.map((id) => names.get(id)).sort());
  });

  it("who is available next Thursday → booked / off / free per person, consistent with bookings and leave", () => {
    const ctx = ctxFor(N93_OWNER);
    const thu = addDays(ws(), 10);
    const out = tool<{ days: { people: { person_id: string; status: string }[] }[] }>(ctx, "get_team_availability", { from: thu });
    const bookings = listBookings(ctx);
    const leave = listAbsences(ctx).filter((a) => ["approved", "pending"].includes(a.status) && a.startDate <= thu && a.endDate >= thu);
    for (const p of out.days[0].people) {
      const booked = bookingsOnDay(bookings.filter((b) => b.personIds.includes(p.person_id)), thu).length > 0;
      const off = leave.find((a) => a.personId === p.person_id && !a.part);
      expect(p.status).toBe(off ? (off.status === "pending" ? "leave requested" : "off") : booked ? "booked" : p.status.startsWith("off ") ? p.status : "free");
    }
  });

  it("materials still to order this week → to-order items needed by Sunday (or undated), soonest first", () => {
    const ctx = ctxFor(N93_OWNER);
    const sunday = addDays(ws(), 6);
    const out = tool<{ items: { material_id: string }[] }>(ctx, "list_materials", { status: "to_order", needed_by_on_or_before: sunday, include_undated: true });
    const expected = listMaterials(ctx).filter((m) => m.status === "to_order" && (!m.neededBy || m.neededBy <= sunday));
    expect(out.items.map((i) => i.material_id).sort()).toEqual(expected.map((m) => m.id).sort());
    expect(out.items.length).toBeGreaterThan(0);
  });

  it("merchants to contact → only merchants with items to order, and never account numbers or vault links", () => {
    const ctx = ctxFor(N93_OWNER);
    const out = tool<{ merchants: { merchant_id: string; items_to_order: unknown[] }[] }>(ctx, "list_merchants", { only_with_items_to_order: true });
    const withItems = new Set(listMaterials(ctx).filter((m) => m.status === "to_order" && m.merchantId).map((m) => m.merchantId));
    expect(out.merchants.map((m) => m.merchant_id).sort()).toEqual([...withItems].sort());
    const json = JSON.stringify(tool(ctx, "list_merchants", {}));
    expect(json).not.toMatch(/N93-4471|SBM-20931|vault\.example|accountRef|passwordManager|accessManagedBy|Ask for Dean/);
  });

  it("what's outstanding on the Patels' kitchen → next step, tasks, materials, bookings and Bob's billing figures", () => {
    const ctx = ctxFor(N93_OWNER);
    const found = tool<{ id: string }[]>(ctx, "search_jobs", { query: "Patels kitchen" });
    expect(found.map((j) => j.id)).toEqual(["n93_job_kitchen_crawley"]);
    const p = tool<{ money: Record<string, number>; materials: { to_order: unknown[] }; open_tasks: unknown[]; upcoming_bookings: unknown[]; next_step: string }>(ctx, "get_job_profile", { job_id: "n93_job_kitchen_crawley" });
    const b = Bill.jobBilling(ctx, "n93_job_kitchen_crawley");
    if (!b.ok) throw new Error(b.error);
    expect(p.money.contract_value).toBe(b.value.contractValue);
    expect(p.money.received).toBe(b.value.paymentsTotal);
    expect(p.money.left_to_pay).toBe(b.value.leftToPay);
    expect(p.money.remaining_to_invoice).toBe(b.value.remainingToInvoice);
    expect(p.money.unpaid_on_invoices).toBe(b.value.unpaidOnInvoices);
    expect(p.materials.to_order.length).toBe(listMaterials(ctx).filter((m) => m.jobId === "n93_job_kitchen_crawley" && m.status === "to_order").length);
    expect(p.next_step).toBeTruthy();
  });

  it("jobs ready to invoice → finished/snagging jobs with money left to invoice, using billing figures", () => {
    const ctx = ctxFor(N93_OWNER);
    const out = tool<{ jobs: { job_id: string; remaining_to_invoice: number }[] }>(ctx, "list_jobs", { stage: "ready_to_invoice" });
    expect(out.jobs.length).toBeGreaterThan(0);
    for (const j of out.jobs) {
      const b = Bill.jobBilling(ctx, j.job_id);
      if (!b.ok) throw new Error(b.error);
      expect(j.remaining_to_invoice).toBe(b.value.remainingToInvoice);
      expect(j.remaining_to_invoice).toBeGreaterThan(0);
    }
  });

  it("who is on holiday next week → approved and pending leave overlapping next week", () => {
    const ctx = ctxFor(N93_OWNER);
    const from = addDays(ws(), 7);
    const to = addDays(ws(), 13);
    const out = tool<{ absences: { name: string }[] }>(ctx, "list_holidays", { from, to });
    const expected = listAbsences(ctx).filter((a) => ["approved", "pending"].includes(a.status) && a.startDate <= to && a.endDate >= from);
    expect(out.absences.length).toBe(expected.length);
  });

  it("morning briefing → the records-based briefing plus today's diary", () => {
    const ctx = ctxFor(N93_OWNER);
    const out = tool<{ briefing_text: string; today_diary: unknown[] }>(ctx, "get_morning_briefing", {});
    expect(out.briefing_text).toMatch(/Here's your day/);
    expect(out.today_diary.length).toBe(bookingsOnDay(listBookings(ctx), today()).length);
  });

  it("what should Ryan prioritise → his tasks plus the office priorities from the records", () => {
    const ctx = ctxFor(N93_OWNER);
    const out = tool<{ name: string; role: string; business_priorities: unknown[]; tasks: unknown[] }>(ctx, "get_person_priorities", { name: "Ryan" });
    expect(out.name).toBe("Ryan");
    expect(out.role).toBe("office");
    expect(out.business_priorities.length).toBeGreaterThan(0);
  });
});

describe("Permissions", () => {
  it("a site account gets the schedule and materials but no money in a job profile", () => {
    const ctx = ctxFor(N93_STAFF);
    const p = tool<Record<string, unknown>>(ctx, "get_job_profile", { job_id: "n93_job_kitchen_crawley" });
    expect(p.money).toBeUndefined();
    expect(p.recorded_costs).toBeUndefined();
    expect(p.handover_report).toBeUndefined();
    expect(tool(ctx, "list_jobs", { stage: "ready_to_invoice" })).toMatchObject({ error: expect.stringMatching(/money/) });
    expect(runReadTool(ctx, "list_quotes", { status: "all" }).ok).toBe(false);
  });

  it("leave reasons never reach the AI", () => {
    const ctx = ctxFor(N93_OWNER);
    const json = JSON.stringify(tool(ctx, "list_holidays", { from: addDays(today(), -60), to: addDays(today(), 60) }));
    expect(json).not.toMatch(/"reason"/);
  });
});

/* ---------------- Claude loop (simulated client) ---------------- */

type Req = { tools: { name: string }[]; system: string; messages: { role: string; content: unknown }[] };
function fakeClaude(script: ((req: Req) => unknown)[], seen: Req[]) {
  process.env.ANTHROPIC_API_KEY = "test-key";
  setClaudeClientForTests(() => ({ beta: { messages: { create: async (req: Req) => { seen.push(flatSystem(JSON.parse(JSON.stringify(req)))); const n = script.shift(); if (!n) throw new Error("script exhausted"); return n(req); } } } }) as never);
}
const call = (name: string, input: unknown) => () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `t_${name}_${Math.random()}`, name, input }] });
const say = (text: string) => () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

describe("Claude engine", () => {
  afterEach(() => {
    setClaudeClientForTests(null);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("schedule and ordering questions go to Claude (not silently to the built-in engine), with the workspace tools and a calendar", async () => {
    const seen: Req[] = [];
    const before = claudeHealth.ok;
    fakeClaude([call("get_schedule", { from: addDays(today(), 1) }), say("Tomorrow: Liam and Callum at Copthorne; Ellie in Horley.")], seen);
    const c = await new Chat(ctxFor(N93_OWNER)).say("Where is everyone working tomorrow?");
    expect(seen.length).toBe(2);
    expect(c.last[0].engine).toBe("claude");
    const names = seen[0].tools.map((t) => t.name);
    for (const n of ["get_schedule", "get_team_availability", "list_holidays", "list_materials", "list_merchants", "get_job_profile", "list_jobs", "get_morning_briefing", "get_person_priorities", "list_tasks_detailed"]) expect(names).toContain(n);
    expect(seen[0].system).toContain(`${addDays(today(), 1)} `);
    expect(seen[0].system).toMatch(/Next week: \d{4}-/);
    expect(claudeHealth.ok).toBe(before + 1);
  });

  it("voice requests ask for a short spoken first paragraph; typed ones don't", async () => {
    const seen: Req[] = [];
    fakeClaude([say("Four things to order this week.\n\n• Plasterboard…"), say("ok")], seen);
    await new Chat(ctxFor(N93_OWNER)).say("What materials still need ordering this week?", "voice");
    expect(seen[0].system).toMatch(/This request was SPOKEN/);
    await new Chat(ctxFor(N93_OWNER)).say("What materials still need ordering this week?");
    expect(seen[1].system).not.toMatch(/This request was SPOKEN/);
  });

  it("remembers the job and person discussed for follow-ups", async () => {
    const seen: Req[] = [];
    fakeClaude([
      call("search_jobs", { query: "Patels kitchen" }),
      call("get_job_profile", { job_id: "n93_job_kitchen_crawley" }),
      say("£7,500 left to pay."),
      call("get_person_priorities", { name: "Ryan" }),
      say("Ryan should start with replies."),
      say("Liam is on it on Thursday."),
    ], seen);
    const c = new Chat(ctxFor(N93_OWNER));
    await c.say("What is outstanding on the Patels' kitchen?");
    await c.say("What should Ryan prioritise today?");
    await c.say("And who's on that job this week?");
    const sys = seen[seen.length - 1].system;
    expect(sys).toMatch(/Job in focus: The Patels — Kitchen renovation/);
    expect(sys).toMatch(/Person last discussed: Ryan/);
  });

  it("shows at most two cards, from the lookups the answer used — not every search along the way", async () => {
    const seen: Req[] = [];
    fakeClaude([call("search_jobs", { query: "kitchen" }), call("get_job_profile", { job_id: "n93_job_kitchen_crawley" }), say("Here's the Patels' kitchen.")], seen);
    const c = await new Chat(ctxFor(N93_OWNER)).say("How's the Patels' kitchen going?");
    const cards = c.last.flatMap((m) => m.cards ?? []);
    expect(cards.length).toBeLessThanOrEqual(2);
    expect(cards).toEqual([{ type: "job_detail", jobId: "n93_job_kitchen_crawley" }]);
  });

  it("a site account's Claude tools exclude money tools", async () => {
    const seen: Req[] = [];
    fakeClaude([say("ok")], seen);
    await new Chat(ctxFor(N93_STAFF)).say("What's booked tomorrow?");
    const names = seen[0].tools.map((t) => t.name);
    expect(names).toContain("get_schedule");
    expect(names).not.toContain("list_quotes");
    expect(names).not.toContain("get_job_billing");
  });

  it("an API failure is counted and labelled — never a silent fallback", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    setClaudeClientForTests(() => ({ beta: { messages: { create: async () => { throw Object.assign(new Error("Overloaded"), { status: 529 }); } } } }) as never);
    const failed = claudeHealth.failed;
    const c = await new Chat(ctxFor(N93_OFFICE)).say("Who is on holiday next week?");
    expect(claudeHealth.failed).toBe(failed + 1);
    expect(claudeHealth.lastError).toMatch(/529/);
    expect(c.text).toMatch(/wasn't available just now, so Bob's built-in assistant answered/);
    expect(c.last[0].engine).toBe("rules");
  });
});
