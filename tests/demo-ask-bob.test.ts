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
import { addDays } from "@/lib/dates";
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
