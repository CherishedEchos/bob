/**
 * Ask Bob invoicing, as conversations through the real entry point (handleTurn — the
 * same handler /api/bob/message uses for typed and voice input). Fictional demo data:
 * Sophie Mackay, 7 Oak Road, Copthorne — Oak Road kitchen (£14,200, £4,260 deposit
 * invoiced and paid) and fitted wardrobes (£3,800). No accounting system is connected,
 * so nothing can be sent externally.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OWNER, N93_OFFICE, N93_STAFF } from "./helpers";
import { getDb } from "@/server/db";
import * as F from "@/server/services/finance";
import { setClaudeClientForTests } from "@/server/bob/claude";
import { spokenAmount } from "@/server/bob/invoice-chat";
import type { Ctx } from "@/server/context";

const KITCHEN = "n93_job_mackay_kitchen";
const WARDROBES = "n93_job_mackay_wardrobes";
const chips = (c: Chat) => c.last.flatMap((m) => (m.chips ?? []).map((x) => x.label));
const drafts = (ctx: Ctx, jobId: string) => F.listInvoices(ctx).filter((i) => i.jobId === jobId && i.status === "draft");
/** Ninety3 with VAT status and terms set in Settings (not VAT registered, 14 days). */
const configured = (ctx: Ctx) => ((ctx.org.finance = { vatRegistered: false, vatRate: null, defaultPaymentTermsDays: 14 }), ctx);

beforeEach(() => freshDb());

describe("UK phrasing for amounts", () => {
  it("understands spoken amounts", () => {
    expect(spokenAmount("make that seven-fifty")).toBe(750);
    expect(spokenAmount("two grand")).toBe(2000);
    expect(spokenAmount("£1,250.50")).toBe(1250.5);
  });
});

describe("Sophie Mackay in Copthorne → the final balance → yeah, draft that", () => {
  it("settings unset: asks which job, the basis, then VAT and terms in one question; saves once", async () => {
    const ctx = ctxFor(N93_OWNER);
    ctx.org.finance = { vatRegistered: null, vatRate: null, defaultPaymentTermsDays: null };
    const c = new Chat(ctx);
    await c.say("Prepare me an invoice for Sophie Mackay in Copthorne", "voice");
    expect(c.text).toMatch(/Sophie Mackay has 2 jobs\. Which one\?/);
    await c.say("the kitchen one");
    expect(c.text).toContain("£9,940 is left to invoice (price £14,200, £4,260 already invoiced)");
    await c.say("the final balance");
    expect(c.text).toMatch(/no VAT, plus VAT or including VAT\?.*when's it due/);
    expect(chips(c)).toEqual(expect.arrayContaining(["No VAT", "14 days"]));
    expect(drafts(ctx, KITCHEN)).toHaveLength(0); // nothing saved while details are missing
    await c.say("no VAT, 14 days");
    expect(c.text).toMatch(/^Saved draft BOB-\d+: £9,940 for the final balance on Sophie Mackay's Oak Road kitchen.*It hasn't been sent\./);
    expect(chips(c)).toContain("Review invoice");
    await c.say("yeah, draft that");
    expect(c.text).toMatch(/already saved as draft .* haven't made a second one/);
    expect(drafts(ctx, KITCHEN)).toHaveLength(1);
    expect(drafts(ctx, KITCHEN)[0].total).toBe(9940);
  });

  it("settings set: saves as soon as customer, job and basis are clear", async () => {
    const ctx = configured(ctxFor(N93_OFFICE)); // Ryan (admin)
    const c = new Chat(ctx);
    await c.say("sort an invoice for Sophie Mackay's Oak Road kitchen, the final balance");
    expect(c.text).toMatch(/^Saved draft BOB-\d+: £9,940 .*No VAT, due/);
    expect(drafts(ctx, KITCHEN)).toHaveLength(1);
  });
});

describe("Misheard surnames and two jobs", () => {
  it("McKay / Mackey still find Sophie Mackay", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const c = new Chat(ctx);
    await c.say("put a bill together for Sophie McKay, Oak Road kitchen");
    expect(c.text).toContain("Sophie Mackay's Oak Road kitchen");
    const d = new Chat(ctx);
    await d.say("invoice Mrs Mackey for the wardrobes");
    expect(d.text).toContain("Sophie Mackay's fitted wardrobes");
  });

  it("two jobs → 'the wardrobes one' picks the right job", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const c = new Chat(ctx);
    await c.say("Prepare me an invoice for Sophie Mackay in Copthorne");
    expect(c.text).toMatch(/Which one\?/);
    await c.say("the wardrobes one");
    expect(c.text).toContain("£3,800 is left to invoice");
    await c.say("final balance");
    expect(drafts(ctx, WARDROBES)[0]?.total).toBe(3800);
    expect(drafts(ctx, KITCHEN)).toHaveLength(0);
  });

  it("switching job mid-conversation: 'no, the kitchen one'", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const c = new Chat(ctx);
    await c.say("invoice Sophie Mackay for the wardrobes");
    expect(c.text).toContain("fitted wardrobes");
    await c.say("no, the kitchen one");
    expect(c.text).toContain("Oak Road kitchen");
    expect(c.text).toContain("£9,940 is left to invoice");
    expect(F.listInvoices(ctx).filter((i) => i.status === "draft" && [KITCHEN, WARDROBES].includes(i.jobId!))).toHaveLength(0);
  });

  it("customer not in that town → refuses rather than picking another job", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const c = await new Chat(ctx).say("invoice Sophie Mackay in Horsham");
    expect(c.text).toMatch(/can't find a job for Sophie Mackay in Horsham/);
    expect(F.listInvoices(ctx).filter((i) => i.status === "draft")).toHaveLength(F.listInvoices(ctxFor(N93_OWNER)).filter((i) => i.status === "draft").length);
  });
});

describe("Existing invoices are never billed twice", () => {
  it("the deposit is already invoiced and paid → only the final balance is offered", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const c = await new Chat(ctx).say("invoice the deposit for Sophie Mackay's kitchen");
    expect(c.text).not.toMatch(/Saved draft .*deposit/);
    expect(drafts(ctx, KITCHEN)).toHaveLength(0);
  });

  it("a final invoice already sent → shows it instead of drafting another", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const c = new Chat(ctx);
    await c.say("invoice Sophie Mackay's kitchen for the final balance");
    const inv = drafts(ctx, KITCHEN)[0];
    expect(F.markInvoiceSentManually(ctx, inv.id).ok).toBe(true);
    const d = await new Chat(ctx).say("invoice Sophie Mackay's kitchen for the final balance");
    expect(d.text).toMatch(/already been invoiced|fully invoiced|nothing left/i);
    expect(chips(d).some((x) => x.startsWith("Open"))).toBe(true);
    expect(drafts(ctx, KITCHEN)).toHaveLength(0);
    // "what's left" distinguishes unpaid-on-invoice from remaining contract value
    const e = await new Chat(ctx).say("what's left to pay on Sophie Mackay's kitchen?");
    expect(e.text).toContain("£0 is left to invoice");
    expect(e.text).toContain("£9,940 is still unpaid on invoices already sent");
  });

  it("repeating the request (e.g. after a timeout) returns the same draft", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    await new Chat(ctx).say("invoice Sophie Mackay's kitchen for the final balance");
    const again = await new Chat(ctx).say("invoice Sophie Mackay's kitchen for the final balance");
    expect(again.text).toMatch(/already saved as draft/);
    expect(drafts(ctx, KITCHEN)).toHaveLength(1);
  });
});

describe("Amend, ask, cancel", () => {
  it("'make that seven-fifty' amends the same draft; 'what's left on that job?'; 'cancel that' deletes it", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const c = new Chat(ctx);
    await c.say("invoice Sophie Mackay's kitchen for the final balance");
    const id = drafts(ctx, KITCHEN)[0].id;
    await c.say("make that seven-fifty");
    expect(c.text).toMatch(/is now £750/);
    expect(drafts(ctx, KITCHEN).map((i) => [i.id, i.total])).toEqual([[id, 750]]);
    await c.say("what's left on that job?");
    expect(c.text).toMatch(/£9,940 is left to invoice.*\(£750\) hasn't been sent/);
    await c.say("cancel that");
    expect(c.text).toMatch(/Deleted draft .* Nothing was sent/);
    expect(drafts(ctx, KITCHEN)).toHaveLength(0);
  });

  it("cancel while Bob is still asking saves nothing", async () => {
    const ctx = ctxFor(N93_OWNER);
    const c = new Chat(ctx);
    await c.say("Prepare me an invoice for Sophie Mackay in Copthorne");
    await c.say("cancel");
    expect(c.text).toMatch(/Nothing was (saved|changed)/);
    expect(drafts(ctx, KITCHEN)).toHaveLength(0);
  });

  it("'send it' is a separate step and is blocked while no delivery service is connected", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const c = new Chat(ctx);
    await c.say("invoice Sophie Mackay's kitchen for the final balance");
    await c.say("send it");
    expect(c.text).toMatch(/can't send invoices yet/);
    expect(drafts(ctx, KITCHEN)).toHaveLength(1);
    expect(F.listInvoices(ctx).filter((i) => i.jobId === KITCHEN && i.status === "sent")).toHaveLength(0);
  });

  it("ordinary chat is answered without starting an invoice", async () => {
    const c = await new Chat(ctxFor(N93_OWNER)).say("thanks Bob");
    expect(c.text).not.toMatch(/invoice/i);
  });
});

describe("Permissions come from the session", () => {
  it("a site account can't see balances or draft invoices", async () => {
    const ctx = ctxFor(N93_STAFF);
    const c = new Chat(ctx);
    await c.say("what's left to pay on Sophie Mackay's kitchen?");
    expect(c.text).toMatch(/doesn't have access to prices or balances/);
    expect(c.text).not.toMatch(/£/);
    await c.say("invoice Sophie Mackay for the final balance");
    expect(c.text).toMatch(/doesn't have access to invoices/);
    expect(drafts(ctxFor(N93_OWNER), KITCHEN)).toHaveLength(0);
  });
});

/* ---------------- Claude engine with a simulated client (no network) ---------------- */

type Req = { tools: { name: string }[]; system: string; messages: { role: string; content: unknown }[] };
function fakeClaude(script: ((req: Req) => unknown)[], seen: Req[]) {
  process.env.ANTHROPIC_API_KEY = "test-key";
  setClaudeClientForTests(() => ({
    beta: {
      messages: {
        create: async (req: Req) => {
          seen.push(JSON.parse(JSON.stringify(req)));
          const next = script.shift();
          if (!next) throw new Error("script exhausted");
          return next(req);
        },
      },
    },
  }) as never);
}
const tool = (name: string, input: unknown) => () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `t_${name}_${Math.random()}`, name, input }] });
const say = (text: string) => () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const lastToolResult = (req: Req) => {
  const m = req.messages[req.messages.length - 1];
  return JSON.parse((m.content as { content: string }[])[0].content);
};

describe("Claude tool use (simulated client)", () => {
  afterEach(() => {
    setClaudeClientForTests(null);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("find → billing → save draft over three turns, with real tools and remembered state", async () => {
    const ctx = configured(ctxFor(N93_OWNER));
    const seen: Req[] = [];
    let found: { job_id: string }[] = [];
    let billing: { remaining_to_invoice: number } = { remaining_to_invoice: 0 };
    fakeClaude([
      tool("find_jobs_to_bill", { query: "Sophie Mackay Copthorne" }),
      (req) => ((found = lastToolResult(req)), say("Sophie Mackay has two jobs in Copthorne — the Oak Road kitchen or the fitted wardrobes?")()),
      tool("get_job_billing", { job_id: KITCHEN }),
      (req) => ((billing = lastToolResult(req)), say("£9,940 is left on the Oak Road kitchen. Draft the final balance?")()),
      tool("save_invoice_draft", { jobId: KITCHEN, basis: "final_balance" }),
      say("Saved the draft — it hasn't been sent."),
      say("It's draft for £9,940."),
    ], seen);
    const c = new Chat(ctx);
    await c.say("Prepare me an invoice for Sophie Mackay in Copthorne", "voice");
    expect(found.map((f) => f.job_id).sort()).toEqual([KITCHEN, WARDROBES].sort());
    expect(seen[0].tools.map((t) => t.name)).toEqual(expect.arrayContaining(["find_jobs_to_bill", "get_job_billing", "save_invoice_draft", "delete_invoice_draft"]));
    expect(seen[0].tools.map((t) => t.name)).not.toContain("create_invoice");
    await c.say("the kitchen one");
    expect(billing.remaining_to_invoice).toBe(9940);
    await c.say("yeah, draft that");
    // Drafts are previewed first: the card shows the amount and settings-based VAT/terms, then the user approves.
    expect(drafts(ctx, KITCHEN)).toHaveLength(0);
    const card = c.last.find((m) => m.action)!.action!;
    expect(card.status).toBe("pending");
    expect(card.lines.find((l) => l.label === "Amount")?.value).toBe("£9,940 (no VAT)");
    const approved = await c.approve();
    const d = drafts(ctx, KITCHEN);
    expect(d).toHaveLength(1);
    expect(d[0].total).toBe(9940);
    // The executed action carries the Review invoice link (shown on the action card).
    expect(approved.links?.some((l) => l.kind === "invoice" && l.id === d[0].id)).toBe(true);
    // Next turn, the system prompt carries the remembered job and draft.
    await c.say("what was that again?");
    expect(seen[seen.length - 1].system).toContain(d[0].draftRef);
  });

  it("a site account doesn't get billing tools", async () => {
    const seen: Req[] = [];
    fakeClaude([say("Luke or Ryan can tell you that.")], seen);
    await new Chat(ctxFor(N93_STAFF)).say("what's Sophie Mackay still owe?");
    const names = seen[0].tools.map((t) => t.name);
    expect(names).not.toContain("get_job_billing");
    expect(names).not.toContain("save_invoice_draft");
  });

  it("tool calls per turn are bounded", async () => {
    const seen: Req[] = [];
    fakeClaude(Array.from({ length: 20 }, () => tool("find_jobs_to_bill", { query: "Mackay" })), seen);
    const c = await new Chat(ctxFor(N93_OWNER)).say("invoice Sophie Mackay");
    expect(seen.length).toBe(6);
    expect(c.text).toMatch(/more steps than I allow/);
  });

  it("Claude unavailable / timed out → the built-in assistant answers and says so", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    setClaudeClientForTests(() => ({ beta: { messages: { create: async () => { throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }); } } } }) as never);
    const ctx = configured(ctxFor(N93_OWNER));
    const c = await new Chat(ctx).say("invoice Sophie Mackay's kitchen for the final balance");
    expect(c.text).toMatch(/Saved draft BOB-\d+: £9,940/);
    expect(c.text).toMatch(/AI service didn't respond in time/);
    // Asking again after the timeout doesn't make a second draft.
    await new Chat(ctx).say("invoice Sophie Mackay's kitchen for the final balance");
    expect(drafts(ctx, KITCHEN)).toHaveLength(1);
  });

  it("a draft that fails to save is reported as not saved", async () => {
    const seen: Req[] = [];
    let result: { status: string; error?: string; message?: string } = { status: "" };
    fakeClaude([
      tool("save_invoice_draft", { jobId: "n93_job_does_not_exist", basis: "final_balance" }),
      (req) => ((result = lastToolResult(req)), say("I couldn't save that draft, so nothing was created.")()),
    ], seen);
    const ctx = configured(ctxFor(N93_OWNER));
    const c = await new Chat(ctx).say("draft that");
    expect(result.status).not.toBe("executed");
    expect(c.text).toMatch(/couldn't save/);
    expect(getDb().prepare("SELECT COUNT(*) n FROM invoices WHERE job_id = 'n93_job_does_not_exist'").get()).toEqual({ n: 0 });
  });
});
