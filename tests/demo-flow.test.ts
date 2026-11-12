/**
 * First-demo behaviours: grouped priorities, the enquiry reply loop
 * (new enquiry → Bob → draft → persisted → marked replied), and asking which
 * enquiry when several match.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OWNER } from "./helpers";
import * as R from "@/server/services/records";
import { buildSnapshot } from "@/server/services/snapshot";
import { needsReply, todaysPriorities } from "@/lib/derive";

beforeEach(() => {
  freshDb();
});

describe("Today priorities", () => {
  it("an overdue deposit and the reminder to chase it appear once", () => {
    const snap = buildSnapshot(ctxFor(N93_OWNER));
    const items = todaysPriorities(snap);
    const loft = items.filter((i) => i.key === "job:n93_job_loft_eg");
    expect(loft).toHaveLength(1);
    expect(loft[0].kind).toBe("deposit");
    expect(loft[0].taskIds).toEqual(["n93_task_2"]);
    expect(items.some((i) => i.kind === "task" && i.taskId === "n93_task_2")).toBe(false);
    // The "call Dave back" reminder folds into replying to Dave's enquiry.
    expect(items.filter((i) => i.key === "enquiry:n93_enq_decking_phone")).toHaveLength(1);
    // Keys are unique — every item is a distinct issue.
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});

describe("Enquiry reply loop", () => {
  it("new enquiry → Bob lists it → drafts against it → draft persists → marking replied updates counts", async () => {
    const ctx = ctxFor(N93_OWNER);
    const created = R.createEnquiry(ctx, {
      customerName: "Gemma Fielding",
      email: "gemma.fielding@example.com",
      source: "email",
      title: "Oak floating shelves",
      description: "Hi, could you fit three oak floating shelves in our living room alcove? Thanks, Gemma",
      location: "Horley",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;
    const waitingBefore = R.listEnquiries(ctx).filter(needsReply).length;

    const chat = new Chat(ctx);
    await chat.say("Who needs a reply?");
    expect(chat.text).toContain("Gemma Fielding");

    await chat.say("Draft a reply to Gemma");
    expect(chat.action?.tool).toBe("save_email_draft");
    expect(chat.text).toContain("Gemma Fielding about the oak floating shelves");
    const edited = "Hi Gemma,\n\nYes, happy to help with the shelves. When suits for a quick visit?\n\nThanks,\nNinety3";
    const v = await chat.approve({ body: edited });
    expect(v.status).toBe("executed");

    // "Refresh": read straight from the database again.
    const after = R.getEnquiry(ctx, id)!;
    expect(after.draftReply).toBe(edited);
    expect(needsReply(after)).toBe(true); // a saved draft does NOT mark it replied

    expect(R.markEnquiryReplied(ctx, id).ok).toBe(true);
    const done = R.getEnquiry(ctx, id)!;
    expect(done.status).toBe("replied");
    expect(done.draftReply).toBe(edited);
    expect(R.listEnquiries(ctx).filter(needsReply).length).toBe(waitingBefore - 1);
    expect(todaysPriorities(buildSnapshot(ctx)).some((p) => p.key === `enquiry:${id}`)).toBe(false);
  });

  it("asks which enquiry when several match", async () => {
    const chat = new Chat(ctxFor(N93_OWNER));
    await chat.say("Draft a reply to the decking enquiry");
    expect(chat.text).toMatch(/Which enquiry\?/);
    expect(chat.text).toContain("Laura Bishop");
    expect(chat.text).toContain("Dave Collins");
    expect(chat.action).toBeUndefined();
    await chat.say("Laura");
    expect(chat.action?.tool).toBe("save_email_draft");
    expect(chat.text).toContain("Laura Bishop");
  });
});
