import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Chat, ctxFor, freshDb, N93_OWNER, N93_STAFF, RDG_OWNER } from "./helpers";
import * as R from "@/server/services/records";
import { needsReply } from "@/lib/derive";
import { askedTiming, outstandingIds, prepareBatch, sendBatchItem } from "@/server/services/batch-replies";
import { overrideProvidersForTests } from "@/server/integrations/registry";
import type { EmailProvider } from "@/server/integrations/types";
import type { Ctx } from "@/server/context";
import { scoped } from "@/server/db";

beforeEach(() => freshDb());
afterEach(() => overrideProvidersForTests({ email: undefined, accounting: undefined }));

const waiting = (ctx: Ctx) => R.listEnquiries(ctx).filter(needsReply);
const itemsFor = (ctx: Ctx) => {
  const r = prepareBatch(ctx);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const byName = (b: ReturnType<typeof itemsFor>, first: string) => b.items.find((i) => i.customerName.startsWith(first))!;

/** A fake inbox that records what it sends, and can be told to fail. */
function fakeInbox(failFor: string[] = []) {
  const sent: { to: string; body: string; key: string }[] = [];
  const provider: EmailProvider = {
    id: "gmail",
    label: "Gmail",
    simulated: false,
    listRecent: async () => [],
    send: async (_ctx, msg, key) => {
      if (failFor.includes(msg.to)) return { ok: false, error: "Gmail timed out", retryable: true };
      sent.push({ to: msg.to, body: msg.body, key });
      return { ok: true, externalId: `gm_${sent.length}`, simulated: false };
    },
  };
  return { provider, sent, failFor };
}

describe("Batch replies — drafting", () => {
  it("drafts one reply per unanswered enquiry: six sample enquiries, same list and order as the workspace", () => {
    const ctx = ctxFor(N93_OWNER);
    const b = itemsFor(ctx);
    expect(waiting(ctx)).toHaveLength(6);
    expect(b.items.map((i) => i.enquiryId)).toEqual(outstandingIds(ctx));
    expect(b.items).toHaveLength(6);
    // Each draft stays attached to its own enquiry and customer.
    for (const i of b.items) {
      const e = R.getEnquiry(ctx, i.enquiryId)!;
      expect(i.customerName).toBe(e.customerName);
      expect(i.draft).toContain(`Hi ${e.customerName.split(" ")[0]}`);
      expect(i.original.body).toBe(e.messages.at(-1)!.body);
    }
    // No inbox connected in the Ninety3 sample workspace → simulate, clearly.
    expect(b.mode).toBe("simulate");
  });

  it("flags the unconfirmed start date and doesn't promise it", () => {
    const b = itemsFor(ctxFor(N93_OWNER));
    const chris = byName(b, "Chris");
    expect(chris.original.body).toMatch(/Monday 1st December/);
    expect(chris.flags.map((f) => f.kind)).toContain("date");
    expect(chris.flags[0].text).toMatch(/Monday 1st December/);
    expect(chris.draft).toMatch(/check the diary before we can confirm Monday 1st December/);
    expect(chris.draft).not.toMatch(/\b(yes|we can start|no problem)\b/i);
  });

  it("flags price questions and promises already in a draft", () => {
    const b = itemsFor(ctxFor(N93_OWNER));
    const tom = byName(b, "Tom");
    expect(tom.flags.map((f) => f.kind)).toEqual(["price"]);
    expect(tom.draft).not.toMatch(/£/);
    expect(tom.channel).toBe("instagram");
    expect(tom.sendable).toBe(false);
    const hannah = byName(b, "Hannah");
    expect(hannah.flags[0]).toMatchObject({ kind: "commitment" });
    expect(hannah.flags[0].text).toMatch(/new-year start should work well/);
    const laura = byName(b, "Laura");
    expect(laura.flags.map((f) => f.kind).sort()).toEqual(["date", "price"]);
    const emma = byName(b, "Emma");
    expect(emma.flags).toEqual([]);
    const dave = byName(b, "Dave");
    expect(dave.channel).toBe("phone");
  });

  it("reads the date out of everyday wording", () => {
    expect(askedTiming("Could you start on Monday 1st December?")).toBe("Monday 1st December");
    expect(askedTiming("Ideally done before the spring.")).toBe("before the spring");
    expect(askedTiming("Do you do staircase makeovers?")).toBeUndefined();
  });

  it("uses the user's own saved draft as-is", () => {
    const ctx = ctxFor(N93_OWNER);
    const emma = waiting(ctx).find((e) => e.customerName.startsWith("Emma"))!;
    R.saveDraftReply(ctx, emma.id, "Hi Emma, yes we do — glass and oak looks great.");
    const i = byName(itemsFor(ctx), "Emma");
    expect(i.savedDraft).toBe(true);
    expect(i.draft).toBe("Hi Emma, yes we do — glass and oak looks great.");
  });

  it("keeps each business to its own enquiries and needs enquiry access", () => {
    const n93 = ctxFor(N93_OWNER);
    const someId = outstandingIds(n93)[0];
    const other = prepareBatch(ctxFor(RDG_OWNER), [someId]);
    expect(other.ok && other.value.items).toEqual([]);
    expect(prepareBatch(ctxFor(N93_STAFF)).ok).toBe(false);
  });
});

describe("Batch replies — sending", () => {
  it("marks replied only when the provider confirms, and a failure keeps the draft for a retry of just that one", async () => {
    const ctx = ctxFor(N93_OWNER);
    const inbox = fakeInbox();
    overrideProvidersForTests({ email: inbox.provider });
    const b = itemsFor(ctx);
    expect(b.mode).toBe("send");
    const emailItems = b.items.filter((i) => i.sendable);
    expect(emailItems.map((i) => i.customerName.split(" ")[0]).sort()).toEqual(["Chris", "Hannah", "Laura"]);
    const [first, second, third] = emailItems;
    inbox.failFor.push(second.to!);

    const results = [];
    for (const i of emailItems) results.push(await sendBatchItem(ctx, { enquiryId: i.enquiryId, body: `${i.draft}\n(edited)`, subject: i.subject, mode: "send" }));
    expect(results.map((r) => r.ok && r.value.status)).toEqual(["sent", "failed", "sent"]);
    expect(inbox.sent.map((s) => s.to)).toEqual([first.to, third.to]);
    // Sent ones: outbound message recorded, status replied, draft cleared.
    const e1 = R.getEnquiry(ctx, first.enquiryId)!;
    expect(e1.status).toBe("replied");
    expect(e1.messages.at(-1)).toMatchObject({ direction: "outbound", channel: "gmail", body: `${first.draft}\n(edited)` });
    // Failed one: still waiting, approved words kept as the draft.
    const e2 = R.getEnquiry(ctx, second.enquiryId)!;
    expect(needsReply(e2)).toBe(true);
    expect(e2.draftReply).toBe(`${second.draft}\n(edited)`);

    // Retry only the failed one — the others aren't resent.
    inbox.failFor.length = 0;
    const retry = await sendBatchItem(ctx, { enquiryId: second.enquiryId, body: e2.draftReply, mode: "send" });
    expect(retry.ok && retry.value.status).toBe("sent");
    expect(inbox.sent.map((s) => s.to)).toEqual([first.to, third.to, second.to]);
    expect(waiting(ctx)).toHaveLength(3);
  });

  it("checks each enquiry is still waiting before sending", async () => {
    const ctx = ctxFor(N93_OWNER);
    const inbox = fakeInbox();
    overrideProvidersForTests({ email: inbox.provider });
    const hannah = byName(itemsFor(ctx), "Hannah");
    R.markEnquiryReplied(ctx, hannah.enquiryId); // answered elsewhere in the meantime
    const r = await sendBatchItem(ctx, { enquiryId: hannah.enquiryId, body: hannah.draft, mode: "send" });
    expect(r.ok && r.value.status).toBe("already_replied");
    expect(inbox.sent).toHaveLength(0);
    // Sending the same item twice never sends twice.
    const laura = byName(itemsFor(ctx), "Laura");
    await sendBatchItem(ctx, { enquiryId: laura.enquiryId, body: laura.draft, mode: "send" });
    const again = await sendBatchItem(ctx, { enquiryId: laura.enquiryId, body: laura.draft, mode: "send" });
    expect(again.ok && again.value.status).toBe("already_replied");
    expect(inbox.sent).toHaveLength(1);
  });

  it("simulates only in a sample workspace with no inbox, and labels it", async () => {
    const ctx = ctxFor(N93_OWNER);
    const chris = byName(itemsFor(ctx), "Chris");
    const r = await sendBatchItem(ctx, { enquiryId: chris.enquiryId, body: chris.draft, mode: "simulate" });
    expect(r.ok && r.value.status).toBe("simulated");
    const e = R.getEnquiry(ctx, chris.enquiryId)!;
    expect(e.status).toBe("replied");
    expect(e.messages.at(-1)?.channel).toBe("simulated");
    const activity = scoped(ctx).list<{ summary: string }>("activity");
    expect(activity.some((a) => /Simulated reply to Chris Walker \(demo — nothing was sent\)/.test(a.summary))).toBe(true);

    // With a real inbox connected, a "simulate" request is refused.
    overrideProvidersForTests({ email: fakeInbox().provider });
    const laura = byName(itemsFor(ctx), "Laura");
    expect((await sendBatchItem(ctx, { enquiryId: laura.enquiryId, body: laura.draft, mode: "simulate" })).ok).toBe(false);
    // And with live data and no inbox, there's no simulate — copy only.
    overrideProvidersForTests({ email: null });
    const live = { ...ctx, org: { ...ctx.org, dataMode: "live" as const } };
    expect(itemsFor(live).mode).toBe("copy");
    expect((await sendBatchItem(live, { enquiryId: laura.enquiryId, body: laura.draft, mode: "simulate" })).ok).toBe(false);
  });

  it("Instagram and phone replies are copied and marked by the user, never 'sent' by Bob", async () => {
    const ctx = ctxFor(N93_OWNER);
    const tom = byName(itemsFor(ctx), "Tom");
    expect((await sendBatchItem(ctx, { enquiryId: tom.enquiryId, body: tom.draft, mode: "simulate" })).ok).toBe(false);
    const r = await sendBatchItem(ctx, { enquiryId: tom.enquiryId, body: tom.draft, mode: "replied_elsewhere" });
    expect(r.ok && r.value.status).toBe("marked");
    expect(R.getEnquiry(ctx, tom.enquiryId)!.status).toBe("replied");
  });

  it("the site team can't send", async () => {
    const owner = ctxFor(N93_OWNER);
    const chris = byName(itemsFor(owner), "Chris");
    const r = await sendBatchItem(ctxFor(N93_STAFF), { enquiryId: chris.enquiryId, body: chris.draft, mode: "simulate" });
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("Batch replies — asking Bob", () => {
  it("'Bob, reply to all outstanding enquiries' drafts them and links to the review screen", async () => {
    const chat = new Chat(ctxFor(N93_OWNER));
    await chat.say("Bob, reply to all outstanding enquiries", "voice");
    expect(chat.text).toMatch(/I've drafted 6 replies/);
    expect(chat.text).toMatch(/Chris \(date\)/);
    expect(chat.text).toMatch(/Nothing is sent until you approve/);
    const chip = chat.last.flatMap((m) => m.chips ?? []).find((c) => c.kind === "link");
    expect(chip).toMatchObject({ label: "Review 6 drafts" });
    expect(chip && "href" in chip && chip.href.split("ids=")[1].split(",")).toHaveLength(6);
    // Drafting alone sends nothing.
    expect(waiting(chat.ctx)).toHaveLength(6);
  });

  it("'reply to all of them' uses the list in context", async () => {
    const chat = new Chat(ctxFor(N93_OWNER));
    await chat.say("Any new enquiries?");
    const newCount = R.listEnquiries(chat.ctx).filter((e) => e.status === "new").length;
    await chat.say("Reply to all of them");
    expect(chat.text).toMatch(new RegExp(`I've drafted ${newCount} replies`));
  });

  it("asks which list when it isn't clear", async () => {
    const chat = new Chat(ctxFor(N93_OWNER));
    await chat.say("Reply to all of them");
    expect(chat.text).toMatch(/Which ones do you mean\?/);
    const chip = chat.last.flatMap((m) => m.chips ?? [])[0];
    expect(chip).toMatchObject({ label: "The 6 waiting for a reply" });
    await chat.say("Follow up on enquiries");
    await chat.say("Reply to all of those");
    expect(chat.text).toMatch(/Just checking — do you mean the \d follow-ups?/);
  });
});
