/**
 * The Ask Bob requests in the Saturday demonstration script, through the
 * Claude engine with a scripted (fake) model: spoken request → tool call →
 * compact preview → approval → the record changes for everyone in the
 * workspace. Real-API behaviour still needs a live check (see docs/DEMO-28-NOV.md).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OFFICE, N93_OWNER } from "./helpers";
import { setClaudeClientForTests } from "@/server/bob/claude";
import { cancelAction, approveAction } from "@/server/bob/actions";
import { buildSnapshot } from "@/server/services/snapshot";
import { addDays, weekStart } from "@/lib/dates";
import { doubleBookings, whoIsAvailable } from "@/server/bob/extra-answers";
import { runReadTool } from "@/server/bob/tools";
import { todayKey } from "@/lib/utils";

type Step = () => unknown;
const call = (name: string, input: unknown): Step => () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `t_${name}_${Math.random()}`, name, input }] });
const say = (text: string): Step => () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
function script(steps: Step[]) {
  const seen: unknown[] = [];
  setClaudeClientForTests(() => ({ beta: { messages: { create: async (r: unknown) => (seen.push(r), { model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 10 }, ...(steps.shift() ?? say("Done."))() as object }) } } }) as never);
  return seen;
}
const saved = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  freshDb();
  process.env.ANTHROPIC_API_KEY = "test";
});
afterEach(() => {
  setClaudeClientForTests(null);
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved;
});

describe("Saturday demo: Ask Bob", () => {
  it("spoken: “new job for Grace Fielding in Lingfield, garden room base, four thousand two hundred” → Save job preview → approved; Ryan sees it", async () => {
    script([call("create_job", { newCustomerName: "Grace Fielding", title: "Garden room base", location: "Lingfield", quotedValue: 4200 }), say("I've set up Grace Fielding's garden room base in Lingfield at £4,200 — check and confirm.")]);
    const luke = new Chat(ctxFor(N93_OWNER));
    await luke.say("New job for Grace Fielding in Lingfield, garden room base, four thousand two hundred", "voice");
    expect(luke.action?.title).toBe("Save job");
    expect(luke.action?.status).toBe("pending");
    const v = await luke.approve();
    expect(v.status).toBe("executed");
    const ryan = buildSnapshot(ctxFor(N93_OFFICE));
    expect(ryan.jobs.some((j) => j.title === "Garden room base" && j.customerName === "Grace Fielding")).toBe(true);
  });

  it("books a subcontractor (Sam Okoro) onto a job and sets Luke a task, in one request", async () => {
    const day = addDays(todayKey(), 4);
    script([
      call("create_booking", { jobId: "n93_job_mediawall_reigate", date: day, startTime: "08:00", endTime: "16:00", people: ["Sam Okoro"] }),
      call("create_task", { title: "Check the plastering is dry before fixing", dueDate: addDays(todayKey(), 5), assignee: "Luke", jobId: "n93_job_mediawall_reigate" }),
      say("Two things ready to approve: Sam on the media wall and a task for Luke."),
    ]);
    const ryan = new Chat(ctxFor(N93_OFFICE));
    await ryan.say("Book Sam Okoro on the Reigate media wall on Friday, 8 till 4, and remind Luke to check the plastering is dry the day after");
    const cards = ryan.last.filter((m) => m.action).map((m) => m.action!);
    expect(cards.map((c) => c.title)).toEqual(["Book work", "Add task"]);
    for (const c of cards) expect((await approveAction(ryan.ctx, c.id)).status).toBe("executed");
    const s = buildSnapshot(ctxFor(N93_OWNER));
    expect(s.bookings.some((b) => b.date === day && b.personIds.includes("n93_per_sam"))).toBe(true);
    expect(s.tasks.some((t) => t.title.startsWith("Check the plastering") && t.assignedUserId === "usr_n93_owner")).toBe(true);
  });

  it("a cancelled preview can't be approved later, and nothing changes", async () => {
    script([call("create_task", { title: "Order more oak", dueDate: addDays(todayKey(), 1) }), say("Ready to confirm.")]);
    const luke = new Chat(ctxFor(N93_OWNER));
    await luke.say("remind me to order more oak tomorrow");
    const id = luke.action!.id;
    cancelAction(luke.ctx, id);
    expect((await approveAction(luke.ctx, id)).status).toBe("cancelled");
    expect(buildSnapshot(luke.ctx).tasks.some((t) => t.title === "Order more oak")).toBe(false);
  });

});

describe("Saturday demo: intelligent scheduling from the diary", () => {
  const mon = () => weekStart(todayKey());

  it("“Have I double-booked anyone this week?” finds Liam's Thursday clash; next week finds Callum's", () => {
    const luke = ctxFor(N93_OWNER);
    const thisWeek = doubleBookings(luke, "have i double-booked anyone this week?");
    expect(thisWeek.text).toMatch(/^One clash this week\. Liam Carter on /);
    expect(thisWeek.text).toMatch(/Kitchen refit .*Kitchen renovation|Kitchen renovation .*Kitchen refit/);
    const next = runReadTool(luke, "find_double_bookings", { from: addDays(mon(), 7), to: addDays(mon(), 13) });
    expect(next.ok).toBe(true);
    const clashes = (next.data as { clashes: { person: string; kind: string }[] }).clashes;
    expect(clashes.some((c) => c.person === "Callum Price" && c.kind === "booked on two jobs at once")).toBe(true);
    expect(clashes.some((c) => c.person === "Callum Price" && c.kind === "booked while on holiday")).toBe(true);
  });

  it("“Who's free next Tuesday?” answers from the diary (Luke and Ryan are bookable too)", () => {
    const a = whoIsAvailable(ctxFor(N93_OWNER), "who's free next tuesday?");
    expect(a.text).toMatch(/^Free /);
    expect(a.text).toContain("Ryan");
    expect(a.text).toMatch(/Booked: .*Callum Price/);
  });

  it("“Book Ryan on the staircase job next Monday” → Book work preview with Ryan → approved", async () => {
    const day = addDays(mon(), 7);
    script([call("create_booking", { jobId: "n93_job_stairs_horley", date: day, people: ["Ryan"] }), say("Ryan on the staircase next Monday — confirm?")]);
    const luke = new Chat(ctxFor(N93_OWNER));
    await luke.say("Book Ryan on the staircase job next Monday");
    expect(luke.action?.title).toBe("Book work");
    expect(JSON.stringify(luke.action)).toContain("Ryan");
    expect((await luke.approve()).status).toBe("executed");
    expect(buildSnapshot(ctxFor(N93_OFFICE)).bookings.some((b) => b.jobId === "n93_job_stairs_horley" && b.date === day && b.personIds.includes("n93_per_ryan"))).toBe(true);
  });

  it("“Move Liam onto the Copthorne kitchen on Friday” → book him there and take him off Friday's other job, both previewed", async () => {
    const fri = addDays(mon(), 11);
    script([
      call("create_booking", { jobId: "n93_job_kitchen_copthorne", date: fri, startTime: "08:00", endTime: "12:00", people: ["Liam"] }),
      call("update_booking", { bookingId: "n93_bk_patel_handover", removePeople: ["Liam"] }),
      say("Liam onto the Copthorne kitchen on Friday and off the Patels' handover — confirm both."),
    ]);
    const luke = new Chat(ctxFor(N93_OWNER));
    await luke.say("Move Liam onto the Copthorne kitchen next Friday");
    const cards = luke.last.filter((m) => m.action).map((m) => m.action!);
    expect(cards.map((c) => c.title)).toEqual(["Book work", "Move booking"]);
    expect(JSON.stringify(cards[1])).toMatch(/Liam Carter → nobody/);
    for (const c of cards) expect((await approveAction(luke.ctx, c.id)).status).toBe("executed");
    const s = buildSnapshot(ctxFor(N93_OFFICE));
    expect(s.bookings.some((b) => b.jobId === "n93_job_kitchen_copthorne" && b.date === fri && b.personIds.includes("n93_per_liam"))).toBe(true);
    expect(s.bookings.find((b) => b.id === "n93_bk_patel_handover")!.personIds).toEqual([]);
  });

  it("“Put Callum on holiday next Thursday” → Book holiday preview, which warns about his booking that day", async () => {
    const thu = addDays(mon(), 10);
    script([call("book_holiday", { person: "Callum", startDate: thu, endDate: thu }), say("Callum off next Thursday — confirm?")]);
    const luke = new Chat(ctxFor(N93_OWNER));
    await luke.say("Put Callum on holiday next Thursday");
    expect(luke.action?.status).toBe("pending");
    expect(JSON.stringify(luke.action)).toMatch(/Callum Price/);
    expect((await luke.approve()).status).toBe("executed");
    expect(buildSnapshot(ctxFor(N93_OFFICE)).absences.some((a) => a.personId === "n93_per_callum" && a.startDate === thu && a.status === "approved")).toBe(true);
  });
});
