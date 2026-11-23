/** The example requests shown on Ask Bob's home screen all get a grounded answer (built-in engine). */
import { beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OWNER, N93_STAFF } from "./helpers";
import { listMaterials } from "@/server/services/team";

beforeEach(() => freshDb());
const ask = async (t: string, who = N93_OWNER) => (await new Chat(ctxFor(who)).say(t)).text;

describe("Ask Bob home examples", () => {
  it("where is everyone working → the schedule", async () => {
    expect(await ask("Where is everyone working today?")).toMatch(/booking|Nothing is booked/);
  });
  it("what still needs quoting → enquiries waiting for a quote", async () => {
    expect(await ask("What jobs still need quoting?")).toMatch(/needs? a quote|Nothing is waiting for a quote/);
  });
  it("who is on holiday next week → leave from the records", async () => {
    expect(await ask("Who is on holiday next week?")).toMatch(/^Next week: |Nobody is off next week/);
  });
  it("how much money are we owed → outstanding invoices and deposits", async () => {
    expect(await ask("How much money are we owed?")).toMatch(/You're owed £/);
  });
  it("handover report → explains where, opens the finished job", async () => {
    const c = await new Chat(ctxFor(N93_OWNER)).say("Create a handover report for the garden room");
    expect(c.text).toMatch(/Handover tab/);
    expect(c.last.flatMap((m) => m.chips ?? []).some((ch) => ch.kind === "link" && /tab=handover/.test(ch.href))).toBe(true);
  });
  it("add 20 sheets of plasterboard to the kitchen job → which job → approval → added", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = new Chat(ctx);
    await c.say("Add 20 sheets of plasterboard to the kitchen job");
    expect(c.text).toMatch(/Which job is the plasterboard for\?/);
    await c.say("the Patels one");
    expect(c.action?.tool).toBe("add_material");
    expect(listMaterials(ctx).some((m) => m.item === "plasterboard")).toBe(false);
    await c.approve();
    expect(listMaterials(ctx).some((m) => m.item === "plasterboard" && m.quantity === "20" && m.unit === "sheets" && m.status === "to_order")).toBe(true);
  });
  it("built-in fallback: availability, merchants, ready to invoice, outstanding on a job, someone's priorities", async () => {
    expect(await ask("Who is available next Thursday?")).toMatch(/^Free |^Nobody is completely free/);
    expect(await ask("Which merchants do I need to contact?")).toMatch(/merchants? to contact: .*Sussex Builders Merchants/);
    expect(await ask("Which jobs are ready to invoice?")).toMatch(/ready to invoice: .*Mark Smith's oak staircase — £4,340/);
    expect(await ask("What is outstanding on the Patels' kitchen?")).toMatch(/^On The Patels' kitchen renovation: .*£7,500 left to pay — £4,000 on invoices already sent and £3,500 not yet invoiced/);
    expect(await ask("What should Ryan prioritise today?")).toMatch(/office list/);
  });
  it("money questions stay private for a site account", async () => {
    expect(await ask("How much money are we owed?", N93_STAFF)).not.toMatch(/£\d/);
  });
});
