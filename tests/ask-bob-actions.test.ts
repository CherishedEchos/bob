/**
 * Ask Bob's write actions, run against the fictional demo workspace through
 * the real action engine (requestAction → preview → approveAction), and
 * checked in the records the rest of the app reads.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OWNER, N93_STAFF, RDG_OWNER } from "./helpers";
import { approveAction, requestAction } from "@/server/bob/actions";
import { setClaudeClientForTests } from "@/server/bob/claude";
import { buildSnapshot as getSnapshot } from "@/server/services/snapshot";
import * as R from "@/server/services/records";
import * as F from "@/server/services/finance";
import { listBookings, listMaterials, listPeople } from "@/server/services/team";
import { listAbsences } from "@/server/services/absences";
import { listVariations } from "@/server/services/variations";
import { listUpdates } from "@/server/services/updates";
import { listReports } from "@/server/services/handover-reports";
import { addDays, weekStart } from "@/lib/dates";
import { todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";

beforeEach(() => freshDb());
const nextMon = () => addDays(weekStart(todayKey()), 7);

async function propose(ctx: Ctx, tool: string, args: unknown) {
  const out = await requestAction(ctx, tool, args, { origin: "bob", conversationId: undefined });
  return out;
}
async function proposeAndApprove(ctx: Ctx, tool: string, args: unknown) {
  const out = await propose(ctx, tool, args);
  if (out.kind !== "action") throw new Error(`${tool}: ${out.kind} — ${out.message}`);
  expect(out.view.status).toBe("pending");
  const done = await approveAction(ctx, out.view.id);
  if (done.status !== "executed") throw new Error(`${tool} failed: ${done.error}`);
  return { preview: out.view, done };
}
const person = (ctx: Ctx, first: string) => listPeople(ctx).find((p) => p.name.startsWith(first))!;

describe("Customers", () => {
  it("create a customer, then correct the name, email, phone and address (before → after preview)", async () => {
    const ctx = ctxFor(N93_OWNER);
    const { done } = await proposeAndApprove(ctx, "create_customer", { name: "Gemma Price", phone: "07700 900 111", town: "Crawley" });
    const id = done.links!.find((l) => l.kind === "customer")!.id;
    const { preview } = await proposeAndApprove(ctx, "update_customer", { customerId: id, name: "Gemma Pryce", email: "gemma@example.com", address: "5 Elm Close" });
    expect(preview.lines.find((l) => l.label === "Name")?.value).toBe("Gemma Price → Gemma Pryce");
    expect(R.getCustomer(ctx, id)).toMatchObject({ name: "Gemma Pryce", email: "gemma@example.com", address: "5 Elm Close" });
    // Reflected everywhere the app reads customers.
    expect(getSnapshot(ctx).customers.find((c) => c.id === id)?.name).toBe("Gemma Pryce");
  });

  it("an invalid email gets a plain-English reply, not a validation code", async () => {
    const out = await propose(ctxFor(N93_OWNER), "update_customer", { customerId: "n93_cus_mackay", email: "not-an-email" });
    expect(out.kind).toBe("invalid");
    if (out.kind !== "action") expect(out.message).toMatch(/email address doesn't look right/);
    if (out.kind !== "action") expect(out.message).not.toMatch(/invalid|expected|zod/i);
  });
});

describe("Diary", () => {
  it("create, reschedule (keeps length), change times, reassign and cancel a booking — with Undo on cancel", async () => {
    const ctx = ctxFor(N93_OWNER);
    const day = addDays(nextMon(), 3);
    const { done } = await proposeAndApprove(ctx, "create_booking", { jobId: "n93_job_loft_eg", date: day, endDate: addDays(day, 1), startTime: "08:00", endTime: "16:00", people: ["Ellie"] });
    const b = listBookings(ctx).find((x) => x.jobId === "n93_job_loft_eg" && x.date === day)!;
    expect(b.personIds).toEqual([person(ctx, "Ellie").id]);
    expect(done.links?.some((l) => l.kind === "job")).toBe(true);
    await proposeAndApprove(ctx, "update_booking", { bookingId: b.id, date: addDays(day, 7) });
    let after = listBookings(ctx).find((x) => x.id === b.id)!;
    expect([after.date, after.endDate]).toEqual([addDays(day, 7), addDays(day, 8)]);
    const { preview } = await proposeAndApprove(ctx, "update_booking", { bookingId: b.id, startTime: "09:00", endTime: "13:00", addPeople: ["Callum"], removePeople: ["Ellie"] });
    expect(preview.lines.find((l) => l.label === "Who")?.value).toBe("Ellie Ward → Callum Price");
    after = listBookings(ctx).find((x) => x.id === b.id)!;
    expect([after.startTime, after.endTime, after.personIds]).toEqual(["09:00", "13:00", [person(ctx, "Callum").id]]);
    const cancel = await proposeAndApprove(ctx, "cancel_booking", { bookingId: b.id });
    expect(listBookings(ctx).some((x) => x.id === b.id)).toBe(false);
    await approveAction(ctx, cancel.preview.id); // approving twice is safe
    expect(listBookings(ctx).filter((x) => x.jobId === "n93_job_loft_eg" && x.date === addDays(day, 7)).length).toBe(0);
  });

  it("highlights a scheduling clash before confirming", async () => {
    const ctx = ctxFor(N93_OWNER);
    const busy = listBookings(ctx).find((b) => b.personIds.length && b.date >= todayKey())!;
    const who = listPeople(ctx).find((p) => p.id === busy.personIds[0])!;
    const out = await propose(ctx, "create_booking", { jobId: "n93_job_loft_eg", date: busy.date, startTime: busy.startTime ?? "08:00", endTime: busy.endTime ?? "16:00", people: [who.name.split(" ")[0]] });
    if (out.kind !== "action") throw new Error(out.message);
    expect(out.view.notices.some((n) => /Clash/.test(n.text) && n.text.includes(who.name))).toBe(true);
  });

  it("missing information → one short question, nothing changed", async () => {
    const out = await propose(ctxFor(N93_OWNER), "create_booking", { jobId: "n93_job_loft_eg", date: nextMon(), startTime: "08:00" });
    expect(out.kind).toBe("clarify");
    if (out.kind !== "action") expect(out.message).toMatch(/What time does it start and finish/);
  });

  it("the same booking twice is refused as a duplicate", async () => {
    const ctx = ctxFor(N93_OWNER);
    await proposeAndApprove(ctx, "create_booking", { jobId: "n93_job_loft_eg", date: nextMon(), people: ["Sam"] });
    const again = await propose(ctx, "create_booking", { jobId: "n93_job_loft_eg", date: nextMon(), people: ["Sam"] });
    expect(again.kind).toBe("blocked");
  });
});

describe("Team and holidays", () => {
  it("add a person; an ambiguous name then gets a question", async () => {
    const ctx = ctxFor(N93_OWNER);
    await proposeAndApprove(ctx, "add_person", { name: "Sam Carter", kind: "employee", trade: "Joiner" });
    const out = await propose(ctx, "create_booking", { jobId: "n93_job_loft_eg", date: nextMon(), people: ["Sam"] });
    expect(out.kind).toBe("clarify");
    if (out.kind !== "action") expect(out.message).toMatch(/more than one Sam — .*Sam Okoro|more than one Sam — .*Sam Carter/);
  });

  it("book, amend, cancel holiday; overlapping and duplicate leave are flagged; requests approved or declined", async () => {
    const ctx = ctxFor(N93_OWNER);
    const mon = nextMon();
    const { preview } = await proposeAndApprove(ctx, "book_holiday", { person: "Liam", startDate: mon, endDate: addDays(mon, 2) });
    expect(preview.lines.find((l) => l.label === "Dates")?.value).toMatch(/3 days/);
    const leave = listAbsences(ctx).find((a) => a.personId === person(ctx, "Liam").id && a.startDate === mon)!;
    expect(leave.status).toBe("approved");
    const dup = await propose(ctx, "book_holiday", { person: "Liam", startDate: mon, endDate: addDays(mon, 2) });
    expect(dup.kind).toBe("blocked");
    const overlap = await propose(ctx, "book_holiday", { person: "Liam", startDate: addDays(mon, 2), endDate: addDays(mon, 4) });
    if (overlap.kind !== "action") throw new Error(overlap.message);
    expect(overlap.view.notices.some((n) => /Overlaps leave already in/.test(n.text))).toBe(true);
    await proposeAndApprove(ctx, "amend_holiday", { absenceId: leave.id, endDate: addDays(mon, 3) });
    const amended = listAbsences(ctx).find((a) => a.personId === leave.personId && a.startDate === mon && a.status === "approved")!;
    expect(amended.endDate).toBe(addDays(mon, 3));
    await proposeAndApprove(ctx, "cancel_holiday", { absenceId: amended.id });
    expect(listAbsences(ctx).find((a) => a.id === amended.id)?.status).toBe("cancelled");
    const pending = listAbsences(ctx).find((a) => a.status === "pending")!;
    await proposeAndApprove(ctx, "decide_holiday_request", { absenceId: pending.id, decision: "approve" });
    expect(listAbsences(ctx).find((a) => a.id === pending.id)?.status).toBe("approved");
  });

  it("holiday that hits existing bookings says so before confirming", async () => {
    const ctx = ctxFor(N93_OWNER);
    const b = listBookings(ctx).find((x) => x.personIds.length && x.date > todayKey())!;
    const who = listPeople(ctx).find((p) => p.id === b.personIds[0])!;
    const out = await propose(ctx, "book_holiday", { person: who.name, startDate: b.date });
    if (out.kind !== "action") throw new Error(out.message);
    expect(out.view.notices.some((n) => /will need someone else/.test(n.text))).toBe(true);
  });
});

describe("Jobs", () => {
  it("edit address, what3words, status and price; record a variation; add a progress note", async () => {
    const ctx = ctxFor(N93_OWNER);
    const { preview } = await proposeAndApprove(ctx, "update_job", { jobId: "n93_job_loft_eg", siteAddress: "4 Orchard Rise, East Grinstead, RH19 1AB", what3words: "filled.count.soap", quotedValue: 29000, status: "scheduled" });
    expect(preview.lines.find((l) => l.label === "Price")?.value).toBe("£28,000 → £29,000");
    expect(R.getJob(ctx, "n93_job_loft_eg")).toMatchObject({ siteAddress: "4 Orchard Rise, East Grinstead, RH19 1AB", what3words: "filled.count.soap", quotedValue: 29000, status: "scheduled" });
    await proposeAndApprove(ctx, "record_variation", { jobId: "n93_job_loft_eg", description: "Extra Velux window", amount: 1200, approved: true });
    expect(listVariations(ctx).some((v) => v.jobId === "n93_job_loft_eg" && v.amount === 1200 && v.status === "approved" && v.amountsAre === "no_vat")).toBe(true);
    await proposeAndApprove(ctx, "add_progress_note", { jobId: "n93_job_loft_eg", note: "Steels delivered and stacked in the garage." });
    expect(listUpdates(ctx).some((u) => u.jobId === "n93_job_loft_eg" && /Steels delivered/.test(u.note ?? ""))).toBe(true);
  });

  it("a site account can't change prices or customers", async () => {
    const ctx = ctxFor(N93_STAFF);
    expect((await propose(ctx, "update_customer", { customerId: "n93_cus_mackay", name: "X Y" })).kind).toBe("forbidden");
    expect((await propose(ctx, "book_holiday", { person: "Liam", startDate: nextMon() })).kind).toBe("forbidden");
  });

  it("another workspace's records can't be touched", async () => {
    const out = await propose(ctxFor(RDG_OWNER), "update_job", { jobId: "n93_job_loft_eg", title: "Hijack" });
    expect(out.kind).toBe("not_found");
    expect(R.getJob(ctxFor(N93_OWNER), "n93_job_loft_eg")?.title).toBe("Loft conversion");
  });
});

describe("Materials and tasks", () => {
  it("add a material, amend quantity and date, assign a merchant, mark it ordered", async () => {
    const ctx = ctxFor(N93_OWNER);
    await proposeAndApprove(ctx, "add_material", { jobId: "n93_job_extension_copthorne", item: "plasterboard", quantity: "20", unit: "sheets" });
    const m = listMaterials(ctx).find((x) => x.item === "plasterboard")!;
    await proposeAndApprove(ctx, "update_material", { materialId: m.id, quantity: "25", neededBy: addDays(todayKey(), 3), merchant: "Sussex Builders" });
    await proposeAndApprove(ctx, "update_material", { materialId: m.id, status: "ordered", orderRef: "SBM-7781" });
    expect(listMaterials(ctx).find((x) => x.id === m.id)).toMatchObject({ quantity: "25", merchantId: "n93_mer_sbm", status: "ordered", orderRef: "SBM-7781" });
  });

  it("create and assign a task (to Ryan, high priority), amend it, complete it", async () => {
    const ctx = ctxFor(N93_OWNER);
    const due = addDays(todayKey(), 1);
    const { preview } = await proposeAndApprove(ctx, "create_task", { title: "Order plasterboard for the Fletcher extension", dueDate: due, assignee: "Ryan", priority: "high", jobId: "n93_job_extension_copthorne" });
    expect(preview.lines.find((l) => l.label === "For")?.value).toBe("Ryan");
    const t = R.listTasks(ctx).find((x) => x.title.startsWith("Order plasterboard"))!;
    expect(t.priority).toBe("high");
    expect(t.assignedUserId).toBe("usr_n93_office");
    await proposeAndApprove(ctx, "update_task", { taskId: t.id, dueDate: addDays(due, 1) });
    expect(R.listTasks(ctx).find((x) => x.id === t.id)?.dueDate).toBe(addDays(due, 1));
    const out = await propose(ctx, "complete_task", { taskId: t.id });
    expect(out.kind === "action" && out.view.status).toBe("executed");
    expect(R.listTasks(ctx).find((x) => x.id === t.id)?.done).toBe(true);
  });
});

describe("Money, enquiries, quotes and handover", () => {
  it("invoice draft preview uses company VAT and terms; amend the draft; record a payment", async () => {
    const ctx = ctxFor(N93_OWNER);
    const { preview, done } = await proposeAndApprove(ctx, "save_invoice_draft", { jobId: "n93_job_stairs_horley", basis: "final_balance" });
    expect(preview.lines.find((l) => l.label === "Amount")?.value).toBe("£4,340 (no VAT)");
    expect(preview.lines.find((l) => l.label === "Due")?.value).toMatch(/14-day terms/);
    const invId = done.links!.find((l) => l.kind === "invoice")!.id;
    await proposeAndApprove(ctx, "save_invoice_draft", { jobId: "n93_job_stairs_horley", basis: "amount", amount: 4000, invoiceId: invId });
    expect(F.getInvoice(ctx, invId)?.total).toBe(4000);
    await proposeAndApprove(ctx, "record_payment", { jobId: "n93_job_stairs_horley", amount: 500, type: "stage", method: "bank_transfer", receivedAt: todayKey() });
    expect(F.listPayments(ctx).some((p) => p.jobId === "n93_job_stairs_horley" && p.amount === 500)).toBe(true);
  });

  it("VAT not configured → the preview asks one question instead of guessing", async () => {
    const ctx = ctxFor(N93_OWNER);
    ctx.org.finance = { vatRegistered: null, vatRate: null, defaultPaymentTermsDays: null };
    const out = await propose(ctx, "save_invoice_draft", { jobId: "n93_job_stairs_horley", basis: "final_balance" });
    expect(out.kind).toBe("clarify");
    if (out.kind !== "action") expect(out.message).toMatch(/no VAT, plus VAT or including VAT.*when should it be due/);
  });

  it("create an enquiry, edit a quote, convert an accepted quote into a job (once)", async () => {
    const ctx = ctxFor(N93_OWNER);
    const { done } = await proposeAndApprove(ctx, "create_enquiry", { customerName: "Owen Hale", title: "Garden studio", location: "Horsham", phone: "07700 900 222" });
    expect(done.links?.[0].kind).toBe("enquiry");
    const q = R.listQuotes(ctx).find((x) => x.status === "sent")!;
    await proposeAndApprove(ctx, "update_quote", { quoteId: q.id, amount: q.amount + 250 });
    expect(R.listQuotes(ctx).find((x) => x.id === q.id)?.amount).toBe(q.amount + 250);
    const first = await proposeAndApprove(ctx, "convert_to_job", { quoteId: q.id });
    const jobId = first.done.links!.find((l) => l.kind === "job")!.id;
    expect(R.getJob(ctx, jobId)).toBeTruthy();
    const jobsBefore = R.listJobs(ctx).length;
    const second = await propose(ctx, "convert_to_job", { quoteId: q.id });
    expect(second.kind === "action" ? second.view.status : second.kind).not.toBe("executed");
    expect(R.listJobs(ctx).length).toBe(jobsBefore);
  });

  it("create a handover report (built-in draft when AI isn't available) and amend its summary", async () => {
    const ctx = ctxFor(N93_OWNER);
    await proposeAndApprove(ctx, "create_handover_report", { jobId: "n93_job_stairs_horley" });
    expect(listReports(ctx).some((r) => r.jobId === "n93_job_stairs_horley")).toBe(true);
    await proposeAndApprove(ctx, "amend_handover_summary", { jobId: "n93_job_stairs_horley", summary: "We fitted a new oak staircase with a glass balustrade and fixed the squeaky tread." });
    const rep = listReports(ctx).find((r) => r.jobId === "n93_job_stairs_horley")!;
    expect(rep.content.sections.find((s) => s.kind === "text")?.body).toMatch(/new oak staircase/);
  });
});

describe("The Sophie Mackay scenario", () => {
  const Q = "Prepare the final invoice for Sophie Mackay's Oak Road kitchen, and correct her surname to McKay.";

  it("built-in engine: identifies the job, previews both changes; approving both applies them", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = await new Chat(ctx).say(Q, "voice");
    const cards = c.last.filter((m) => m.action).map((m) => m.action!);
    expect(cards.map((a) => a.tool)).toEqual(["save_invoice_draft", "update_customer"]);
    const inv = cards[0];
    expect(inv.lines.find((l) => l.label === "Job")?.value).toBe("Oak Road kitchen");
    expect(inv.lines.find((l) => l.label === "Amount")?.value).toBe("£9,940 (no VAT)");
    expect(inv.lines.find((l) => l.label === "Due")?.value).toMatch(/\(14-day terms\)/);
    expect(cards[1].lines.find((l) => l.label === "Name")?.value).toBe("Sophie Mackay → Sophie McKay");
    expect(c.text).toMatch(/prepared the invoice draft and the name change to Sophie McKay/);
    expect(F.listInvoices(ctx).filter((i) => i.jobId === "n93_job_mackay_kitchen" && i.status === "draft")).toHaveLength(0);
    for (const a of cards) expect((await approveAction(ctx, a.id)).status).toBe("executed");
    expect(R.getCustomer(ctx, "n93_cus_mackay")?.name).toBe("Sophie McKay");
    const draft = F.listInvoices(ctx).find((i) => i.jobId === "n93_job_mackay_kitchen" && i.status === "draft")!;
    expect(draft).toMatchObject({ total: 9940, amountsAre: "no_vat", customerId: "n93_cus_mackay" });
    // The job and diary now show the corrected name.
    expect(getSnapshot(ctx).jobs.find((j) => j.id === "n93_job_mackay_kitchen")?.customerName).toBe("Sophie McKay");
  });
});

/* ---------------- Claude (simulated client): multiple related requests ---------------- */

type Req = { system: string; messages: { role: string; content: unknown }[] };
function fakeClaude(script: ((req: Req) => unknown)[], seen: Req[]) {
  process.env.ANTHROPIC_API_KEY = "test-key";
  setClaudeClientForTests(() => ({ beta: { messages: { create: async (req: Req) => { seen.push(JSON.parse(JSON.stringify(req))); const n = script.shift(); if (!n) throw new Error("script exhausted"); return n(req); } } } }) as never);
}
const calls = (...uses: [string, unknown][]) => () => ({ stop_reason: "tool_use", content: uses.map(([name, input], i) => ({ type: "tool_use", id: `t${i}_${name}_${Math.random()}`, name, input })) });
const say = (text: string) => () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

describe("Claude engine: multiple requests and follow-ups", () => {
  afterEach(() => {
    setClaudeClientForTests(null);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("“Change Sophie's surname to McKay and prepare her final invoice” → two previews in one turn", async () => {
    const ctx = ctxFor(N93_OWNER);
    const seen: Req[] = [];
    fakeClaude([
      calls(["search_jobs", { query: "Sophie Mackay Oak Road kitchen" }]),
      calls(["update_customer", { customerId: "n93_cus_mackay", name: "Sophie McKay" }], ["save_invoice_draft", { jobId: "n93_job_mackay_kitchen", basis: "final_balance" }]),
      say("I've got the name change and a £9,940 invoice draft ready — have a look and approve."),
    ], seen);
    const c = await new Chat(ctx).say("Change Sophie's surname to McKay and prepare her final invoice", "voice");
    const cards = c.last.filter((m) => m.action).map((m) => m.action!);
    expect(cards.map((a) => a.tool).sort()).toEqual(["save_invoice_draft", "update_customer"]);
    expect(cards.every((a) => a.status === "pending")).toBe(true);
    expect(seen[0].system).toMatch(/Several requests in one message/);
  });

  it("“Put Liam on holiday Monday to Wednesday next week” then “move him onto the Copthorne kitchen when he gets back”", async () => {
    const ctx = ctxFor(N93_OWNER);
    const mon = nextMon();
    const seen: Req[] = [];
    fakeClaude([
      calls(["book_holiday", { person: "Liam", startDate: mon, endDate: addDays(mon, 2) }]),
      say("Holiday for Liam Monday to Wednesday is ready to approve."),
      calls(["create_booking", { jobId: "n93_job_kitchen_copthorne", date: addDays(mon, 3), startTime: "08:00", endTime: "16:30", people: ["Liam"] }]),
      say("I've lined Liam up on the Copthorne kitchen from Thursday — approve when ready."),
    ], seen);
    const c = new Chat(ctx);
    await c.say("Put Liam on holiday from Monday to Wednesday next week");
    await c.approve();
    await c.say("Move him onto the Copthorne kitchen when he gets back");
    expect(seen[2].system).toMatch(/Person last discussed: Liam/);
    const card = c.action!;
    expect(card.tool).toBe("create_booking");
    await c.approve();
    expect(listBookings(ctx).some((b) => b.jobId === "n93_job_kitchen_copthorne" && b.date === addDays(mon, 3) && b.personIds.includes(person(ctx, "Liam").id))).toBe(true);
  });

  it("“Add 20 sheets of plasterboard to the Fletcher extension and remind Ryan to order them tomorrow” → material + task previews", async () => {
    const ctx = ctxFor(N93_OWNER);
    const seen: Req[] = [];
    fakeClaude([
      calls(["add_material", { jobId: "n93_job_extension_copthorne", item: "plasterboard", quantity: "20", unit: "sheets" }], ["create_task", { title: "Order 20 sheets of plasterboard for the Fletcher extension", dueDate: addDays(todayKey(), 1), assignee: "Ryan", jobId: "n93_job_extension_copthorne" }]),
      say("Both ready to approve."),
    ], seen);
    const c = await new Chat(ctx).say("Add 20 sheets of plasterboard to the Fletcher extension and remind Ryan to order them tomorrow");
    const cards = c.last.filter((m) => m.action).map((m) => m.action!);
    expect(cards.map((a) => a.tool)).toEqual(["add_material", "create_task"]);
    for (const a of cards) await approveAction(ctx, a.id);
    expect(listMaterials(ctx).some((m) => m.item === "plasterboard" && m.jobId === "n93_job_extension_copthorne")).toBe(true);
    expect(R.listTasks(ctx).some((t) => t.assignedUserId === "usr_n93_office" && /plasterboard/.test(t.title))).toBe(true);
  });

  it("a failed action is explained in plain English, never with codes", async () => {
    const ctx = ctxFor(N93_OWNER);
    const seen: Req[] = [];
    fakeClaude([calls(["update_customer", { customerId: "n93_cus_mackay", email: "nope" }]), say("That email doesn't look right — what's the correct one?")], seen);
    const c = await new Chat(ctx).say("Update Sophie's email to nope");
    expect(JSON.stringify(seen[1].messages.at(-1))).toMatch(/email address doesn't look right/);
    expect(c.text).not.toMatch(/invalid|expected|zod|MISSING|DRAFT_EXISTS/i);
  });
});
