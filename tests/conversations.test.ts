/**
 * The five target conversations, end-to-end through the real engine,
 * services and (in-memory) database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OWNER, RDG_OWNER } from "./helpers";
import * as R from "@/server/services/records";
import * as F from "@/server/services/finance";
import * as Rep from "@/server/services/reports";
import { addDaysKey } from "@/lib/utils";

beforeEach(() => {
  freshDb();
});

describe("Conversation 1 — what needs sorting today", () => {
  it("summarises from records and attaches priorities", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = await new Chat(ctx).say("Bob, what needs sorting today?");
    const summary = Rep.todaySummary(ctx);
    const replies = summary.priorities.filter((p) => p.kind === "reply").length;
    expect(c.text).toContain(`${replies} enquiries waiting for a reply`);
    expect(c.text).toMatch(/overdue invoice/);
    expect(c.last[0].cards?.[0]).toMatchObject({ type: "priorities" });
  });
});

describe("Conversation 2 — enquiries in the last month", () => {
  it("returns the counts from the database with channel breakdown and coverage note", async () => {
    const ctx = ctxFor(N93_OWNER);
    const stats = Rep.enquiryStats(ctx, { kind: "last_days", days: 30 });
    const c = await new Chat(ctx).say("Bob, how many enquiries have I had in the last month?");
    expect(c.text).toContain(`You've had ${stats.total} enquiries over the last 30 days`);
    for (const s of stats.bySource) expect(c.text).toContain(String(s.count));
    expect(stats.total).toBe(stats.bySource.reduce((a, b) => a + b.count, 0));
    const card = c.last[0].cards?.find((x) => x.type === "stats");
    expect(card && "footnote" in card && card.footnote).toMatch(/only include enquiries recorded in Bob/);
  });

  it("counts change when a new enquiry is recorded (not hardcoded)", async () => {
    const ctx = ctxFor(N93_OWNER);
    const before = Rep.enquiryStats(ctx, { kind: "last_days", days: 30 }).total;
    R.createEnquiry(ctx, { customerName: "Test Person", phone: "07700 900999", source: "phone", title: "Shelving", location: "Crawley" });
    const c = await new Chat(ctx).say("how many enquiries have I had in the last 30 days");
    expect(c.text).toContain(`${before + 1} enquiries`);
  });
});

describe("Conversation 3 — remind me to call Dave tomorrow", () => {
  it("finds Dave, creates the reminder immediately with undo", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = await new Chat(ctx).say("Bob, remind me to call Dave tomorrow.");
    expect(c.action?.status).toBe("executed");
    expect(c.action?.canUndo).toBe(true);
    const task = R.listTasks(ctx).find((t) => t.title === "Call Dave Collins");
    expect(task).toBeDefined();
    expect(task!.dueDate).toBe(addDaysKey(1));
    expect(task!.customerId).toBe("n93_cus_dave");
    expect(c.text).toContain("Reminder set for tomorrow");
  });
});

describe("Conversation 4 — add a kitchen job for Sarah in Crawley for £12,000", () => {
  it("resolves the existing customer, proposes, and creates on approval", async () => {
    const ctx = ctxFor(N93_OWNER);
    const jobsBefore = R.listJobs(ctx).length;
    const c = await new Chat(ctx).say("Bob, add a new kitchen job for Sarah in Crawley for £12,000.");
    expect(c.action?.status).toBe("pending");
    expect(c.action?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Customer", value: "Sarah Mitchell" }), expect.objectContaining({ label: "Price", value: "£12,000" })]));
    expect(R.listJobs(ctx).length).toBe(jobsBefore); // nothing yet
    const done = await c.approve();
    expect(done.status).toBe("executed");
    const job = R.listJobs(ctx).find((j) => j.location === "Crawley" && j.customerName === "Sarah Mitchell");
    expect(job).toMatchObject({ title: "Kitchen", quotedValue: 12000 });
  });

  it("can switch to a new customer when it's a different Sarah", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = new Chat(ctx);
    await c.say("add a new kitchen job for Sarah in Crawley for £12,000");
    await c.say("No, it's a new customer");
    expect(c.text).toMatch(/who/i);
    await c.say("Sarah Jones");
    expect(c.action?.lines.find((l) => l.label === "Customer")?.value).toBe("Sarah Jones (new)");
  });
});

describe("Conversation 5 — invoice Sophie £7,500 for the Copthorne job", () => {
  it("Ninety3 (no accounting, VAT not configured): asks, then prepares a DRAFT that can't be sent", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = new Chat(ctx);
    await c.say("Bob, invoice Sophie £7,500 for the Copthorne job.");
    expect(c.text).toContain("Sophie Lambert's kitchen refit in Copthorne");
    expect(c.text).toMatch(/including VAT, plus VAT, or no VAT/);
    expect(c.text).toMatch(/when should it be due/);
    expect(c.action).toBeUndefined();
    await c.say("plus VAT, 14 days");
    expect(c.text).toMatch(/VAT rate/);
    await c.say("20%");
    expect(c.action?.status).toBe("pending");
    expect(c.action?.approveLabel).toBe("Save draft");
    expect(c.action?.notices.map((n) => n.text).join(" ")).toMatch(/DRAFT in Bob only/);
    expect(c.action?.preview).toMatchObject({ kind: "invoice", subtotal: 7500, vat: 1500, total: 9000 });
    const done = await c.approve();
    expect(done.status).toBe("executed");
    expect(done.resultMessage).toMatch(/has NOT been sent/);
    const inv = F.listInvoices(ctx).find((i) => i.jobId === "n93_job_kitchen_copthorne");
    expect(inv).toMatchObject({ status: "draft", total: 9000 });
    expect(inv!.number).toBeUndefined();
  });

  it("Ridgeway demo (VAT + terms configured, demo accounting): one question, then simulated send", async () => {
    const ctx = ctxFor(RDG_OWNER);
    const c = new Chat(ctx);
    await c.say("Invoice Sophie £7,500 for the Copthorne job");
    expect(c.text).toContain("Sophie Hart");
    expect(c.text).toMatch(/plus VAT/);
    await c.say("plus VAT");
    expect(c.action?.approveLabel).toBe("Approve & send (demo)");
    expect(c.action?.simulated).toBe(true);
    const done = await c.approve();
    expect(done.status).toBe("executed");
    expect(done.resultMessage).toMatch(/simulated — nothing was sent/);
    const inv = F.listInvoices(ctx).find((i) => i.jobId === "rdg_job_kitchen_copthorne")!;
    expect(inv.status).toBe("sent");
    expect(inv.number).toMatch(/^DEMO-/);
    expect(inv.provider).toBe("demo_accounting");
  });
});

describe("Other voice commands from the brief", () => {
  it("who's not paid their deposit / has James paid", async () => {
    const ctx = ctxFor(N93_OWNER);
    let c = await new Chat(ctx).say("Bob, who's not paid their deposit?");
    expect(c.text).toContain("Sarah Mitchell");
    expect(c.text).toContain("James Okafor");
    c = await new Chat(ctx).say("Has James paid his deposit?");
    expect(c.text).toMatch(/^Not yet\. James Okafor owes a £1,440 deposit/);
    expect(c.text).toMatch(/From Bob's own records/);
  });

  it("draft a reply to the customer who emailed about decking", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = await new Chat(ctx).say("Bob, draft a reply to the customer who emailed about decking.");
    expect(c.text).toContain("Laura Bishop");
    expect(c.action?.tool).toBe("save_email_draft"); // email not connected for Ninety3
    expect(c.text).toMatch(/Email isn't connected/);
  });

  it("how many quotes this month / outstanding invoices / overdue", async () => {
    const ctx = ctxFor(N93_OWNER);
    const q = Rep.quoteStats(ctx, { kind: "this_month" });
    let c = await new Chat(ctx).say("how many quotes have I sent this month?");
    expect(c.text).toContain(`${q.sentCount} quote`);
    c = await new Chat(ctx).say("what invoices are overdue?");
    expect(c.text).toContain("Robert & Anne Fletcher");
    expect(c.text).toContain("£12,000");
    c = await new Chat(ctx).say("how much am I owed?");
    const m = Rep.moneyOwed(ctx);
    expect(c.text).toContain(`£${m.invoicedTotal.toLocaleString("en-GB")}`);
  });

  it("add £450 of materials to the Copthorne job → asks which (two Copthorne jobs)", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = new Chat(ctx);
    await c.say("Bob, add £450 of materials to the Copthorne job.");
    expect(c.text).toMatch(/more than one Copthorne job/);
    await c.say("the kitchen one");
    expect(c.action?.tool).toBe("add_job_expense");
    expect(c.action?.lines[0].value).toContain("Sophie Lambert");
    await c.approve();
    expect(R.listExpenses(ctx).some((e) => e.amount === 450 && e.jobId === "n93_job_kitchen_copthorne")).toBe(true);
  });

  it("invoice the remaining balance on the Smith job", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = new Chat(ctx);
    await c.say("Bob, create an invoice for the remaining balance on the Smith job, no VAT, 7 days");
    expect(c.text).toContain("remaining balance is £4,340");
    expect(c.action?.preview).toMatchObject({ total: 4340 });
  });

  it("what's happening with that kitchen job in Copthorne", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = await new Chat(ctx).say("Bob, what's happening with that kitchen job in Copthorne?");
    expect(c.text).toMatch(/^Sophie Lambert's kitchen refit in Copthorne is in progress/);
  });

  it("jobs booked next week", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = await new Chat(ctx).say("how many jobs have I got booked next week?");
    expect(c.text).toContain("Nadia Hussain");
  });
});

describe("Ask Bob shortcuts", () => {
  it("'What needs my attention today?' gives the day's summary", async () => {
    const c = await new Chat(ctxFor(N93_OWNER)).say("What needs my attention today?");
    expect(c.text).toMatch(/waiting for a reply/);
  });

  it("'Follow up on enquiries' lists who needs chasing, from the same priorities as Today", async () => {
    const ctx = ctxFor(N93_OWNER);
    const due = Rep.todaySummary(ctx).priorities.filter((p) => p.kind === "followup" || p.kind === "quote");
    const c = await new Chat(ctx).say("Follow up on enquiries");
    expect(due.length).toBeGreaterThan(0);
    expect(c.text).toContain(`${due.length} enquiries need following up`);
    expect(c.text).toContain(due[0].who);
  });
});
