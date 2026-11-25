/**
 * Customer follow-ups: thank-you email with the handover PDF and an honest
 * Google review request. Fictional Ninety3 demo data; nothing real is sent
 * (a fake provider captures what would have gone).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_OFFICE, N93_OWNER, N93_STAFF } from "./helpers";
import { getDb } from "@/server/db";
import { approveAction, requestAction } from "@/server/bob/actions";
import { getEmailProvider, overrideProvidersForTests } from "@/server/integrations/registry";
import type { EmailProvider, OutboundEmail } from "@/server/integrations/types";
import { createReport, finishReport, saveReport } from "@/server/services/handover-reports";
import * as FU from "@/server/services/followups";
import { getTool } from "@/server/bob/tools";
import { isGoogleReviewUrl, fillTemplate, DEFAULT_TEMPLATE } from "@/lib/followups";
import { listTasks } from "@/server/services/records";
import type { Ctx } from "@/server/context";

const GARDEN = "n93_job_gardenroom_lingfield";
const STAIRS = "n93_job_stairs_horley";
let outbox: OutboundEmail[] = [];
const fakeMail = (simulated = false): EmailProvider => ({
  id: "gmail",
  label: "Gmail",
  simulated,
  listRecent: async () => [],
  send: async (_ctx, msg) => {
    outbox.push(msg);
    return { ok: true, externalId: `x-${outbox.length}`, simulated };
  },
});

beforeEach(() => {
  freshDb();
  outbox = [];
});
afterEach(() => overrideProvidersForTests({ email: undefined, accounting: undefined }));

async function finished(ctx: Ctx, jobId: string) {
  const r = createReport(ctx, { jobId });
  if (!r.ok) throw new Error(r.error);
  const f = await finishReport(ctx, { id: r.value.id });
  if (!f.ok) throw new Error(f.error);
  return f.value;
}
const approve = async (ctx: Ctx, args: Record<string, unknown>) => {
  const a = await requestAction(ctx, "send_handover_email", args, { origin: "dashboard" });
  if (a.kind !== "action") throw new Error(`${a.kind}: ${"message" in a ? a.message : ""}`);
  return { preview: a.view, done: await approveAction(ctx, a.view.id) };
};

describe("the email", () => {
  it("matches the example: Claire, the garden room, the review link and Luke & Ryan's sign-off", async () => {
    const ctx = ctxFor(N93_OWNER);
    await finished(ctx, GARDEN);
    const c = FU.composeFollowUp(ctx, { jobId: GARDEN });
    if (!c.ok) throw new Error(c.error);
    expect(c.value.subject).toBe("Thank you for choosing Ninety3");
    expect(c.value.body).toMatch(/^Hi Claire,/);
    expect(c.value.body).toMatch(/pleasure working on your garden room/);
    expect(c.value.body).toMatch(/Please find your project handover report attached\./);
    expect(c.value.body).toMatch(/an honest Google review/);
    expect(c.value.body).toMatch(/Leave us a Google review: https:\/\/g\.page\/r\/ninety3-demo\/review/);
    expect(c.value.body).toMatch(/Thanks again,\nLuke & Ryan\nNinety3 Carpentry & Build/);
    expect(c.value.attachment?.filename).toMatch(/Handover v1\.pdf$/);
    expect(c.value.to).toBe("claire.dawson@example.com");
  });

  it("with review requests off, there's no review paragraph or link", () => {
    const body = fillTemplate(DEFAULT_TEMPLATE.body, { firstName: "Sam", customerName: "Sam Lee", job: "kitchen", business: "X", businessName: "X Ltd", team: "A & B", signOff: "", contact: "", reviewLink: "https://g.page/r/x/review" }, false);
    expect(body).not.toMatch(/review/i);
    expect(body).not.toMatch(/\{/);
  });

  it("only accepts Google review links", () => {
    expect(isGoogleReviewUrl("https://g.page/r/abc/review")).toBe(true);
    expect(isGoogleReviewUrl("https://search.google.com/local/writereview?placeid=abc")).toBe(true);
    expect(isGoogleReviewUrl("https://maps.app.goo.gl/abc")).toBe(true);
    expect(isGoogleReviewUrl("http://g.page/r/abc")).toBe(false);
    expect(isGoogleReviewUrl("https://trustpilot.com/review/x")).toBe(false);
    expect(isGoogleReviewUrl("https://evil.example/google.com")).toBe(false);
  });

  it("isn't offered until the handover is finished (and up to date)", async () => {
    const ctx = ctxFor(N93_OWNER);
    const r = createReport(ctx, { jobId: STAIRS });
    if (!r.ok) throw new Error(r.error);
    const c = FU.composeFollowUp(ctx, { jobId: STAIRS });
    expect(!c.ok && c.error).toMatch(/isn't finished yet/);
  });
});

describe("no email account connected (the Ninety3 demo)", () => {
  it("Bob saves an editable draft — nothing is sent — then 'I've sent it myself' records it with a reminder", async () => {
    const ctx = ctxFor(N93_OWNER);
    expect(getEmailProvider(ctx)).toBeNull();
    await finished(ctx, GARDEN);
    const { preview, done } = await approve(ctx, { jobId: GARDEN });
    expect(preview.title).toBe("Save thank-you email draft");
    expect(done.status).toBe("executed");
    expect(outbox).toHaveLength(0);
    const draft = FU.listFollowUps(ctx).find((f) => f.jobId === GARDEN)!;
    expect(draft).toMatchObject({ status: "draft", reviewRequested: true });
    const sent = FU.markFollowUpSent(ctx, { id: draft.id });
    expect(sent.ok && sent.value).toMatchObject({ status: "sent", sentVia: "manual", approvedBy: "Luke", reminderStatus: "scheduled" });
    expect(listTasks(ctx).some((t) => /Review reminder: Claire Dawson/.test(t.title))).toBe(true);
  });
});

describe("with a connected mailbox", () => {
  it("sends with the PDF attached, records who approved it, marks the handover sent and schedules one reminder", async () => {
    overrideProvidersForTests({ email: fakeMail() });
    const ctx = ctxFor(N93_OFFICE); // Ryan
    const fin = await finished(ctx, GARDEN);
    const { preview, done } = await approve(ctx, { jobId: GARDEN });
    expect(preview.title).toBe("Send handover email");
    expect(preview.category).toBe("external");
    expect(done.status).toBe("executed");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("claire.dawson@example.com");
    expect(outbox[0].attachments?.[0].filename).toBe(fin.version.filename);
    expect(outbox[0].attachments?.[0].data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(outbox[0].body).toMatch(/g\.page\/r\/ninety3-demo\/review/);
    const f = FU.listFollowUps(ctx).find((x) => x.jobId === GARDEN)!;
    expect(f).toMatchObject({ status: "sent", sentVia: "gmail", approvedBy: "Ryan", reviewRequested: true, reminderStatus: "scheduled", version: 1 });
    const rep = getDb().prepare("SELECT sent_by, sent_version FROM handover_reports WHERE job_id = ?").get(GARDEN) as { sent_by: string; sent_version: number };
    expect(rep).toEqual({ sent_by: "Ryan", sent_version: 1 });
    const act = getDb().prepare("SELECT summary FROM activity WHERE action = 'followup.sent'").get() as { summary: string };
    expect(act.summary).toMatch(/approved by Ryan/);
  });

  it("prevents duplicates: one review request per job, and the same PDF version isn't emailed twice", async () => {
    overrideProvidersForTests({ email: fakeMail() });
    const ctx = ctxFor(N93_OWNER);
    await finished(ctx, GARDEN);
    await approve(ctx, { jobId: GARDEN });
    const again = await requestAction(ctx, "send_handover_email", { jobId: GARDEN, includeReview: true }, { origin: "dashboard" });
    expect(again.kind).toBe("blocked");
    // A new version (edited and finished again) can be sent — without asking for a review a second time.
    const r = (await import("@/server/services/handover-reports")).listReports(ctx).find((x) => x.jobId === GARDEN)!;
    saveReport(ctx, { id: r.id, baseRevision: r.revision, content: { ...r.content, title: "Garden studio" } });
    await finishReport(ctx, { id: r.id });
    const c = FU.composeFollowUp(ctx, { jobId: GARDEN });
    expect(c.ok && c.value.reviewAvailable).toBe(false);
    expect(c.ok && c.value.body).not.toMatch(/g\.page/);
    const second = await approve(ctx, { jobId: GARDEN });
    expect(second.done.status).toBe("executed");
    expect(outbox).toHaveLength(2);
    expect(FU.listFollowUps(ctx).filter((f) => f.reviewRequested && f.status === "sent")).toHaveLength(1);
  });

  it("reminders can be sent once or cancelled (the task goes too)", async () => {
    overrideProvidersForTests({ email: fakeMail() });
    const ctx = ctxFor(N93_OWNER);
    await finished(ctx, GARDEN);
    await approve(ctx, { jobId: GARDEN });
    const f = FU.listFollowUps(ctx)[0];
    const c = FU.cancelFollowUpReminder(ctx, { id: f.id });
    expect(c.ok && c.value.reminderStatus).toBe("cancelled");
    expect(listTasks(ctx).some((t) => /Review reminder/.test(t.title))).toBe(false);
    expect(FU.cancelFollowUpReminder(ctx, { id: f.id }).ok).toBe(false);
    expect((await FU.sendFollowUpReminder(ctx, { id: f.id })).ok).toBe(false);
  });

  it("automatic mode: finishing the handover sends it; due reminders go when Bob is next opened", async () => {
    overrideProvidersForTests({ email: fakeMail() });
    const ctx = ctxFor(N93_OWNER);
    ctx.org.followUps = { ...ctx.org.followUps!, mode: "auto" };
    const fin = await finished(ctx, GARDEN);
    const auto = await FU.afterHandoverFinished(ctx, fin.report.jobId);
    expect(auto.sent?.approvedBy).toBe("Luke");
    expect(outbox).toHaveLength(1);
    // Make the reminder due and open Bob.
    getDb().prepare("UPDATE customer_followups SET reminder_due_at = '2000-01-01'").run();
    expect(await FU.processDueReminders(ctx)).toBe(1);
    expect(outbox[1].subject).toMatch(/A quick favour/);
    expect(outbox[1].attachments ?? []).toHaveLength(0);
    expect(FU.listFollowUps(ctx)[0].reminderStatus).toBe("sent");
    expect(await FU.processDueReminders(ctx)).toBe(0); // only once
  });
});

describe("safeguards", () => {
  it("a demo workspace never sends real email, even with a real mailbox connected", () => {
    const ctx = ctxFor(N93_OWNER);
    getDb().prepare("INSERT INTO connections (org_id, provider, kind, status, account_label) VALUES (?, 'gmail', 'email', 'connected', 'hello@ninety3.example')").run(ctx.orgId);
    const p = getEmailProvider(ctx);
    expect(p?.id).toBe("demo_inbox");
    expect(p?.simulated).toBe(true);
  });

  it("the site team can't email customers", async () => {
    const owner = ctxFor(N93_OWNER);
    await finished(owner, GARDEN);
    const r = await requestAction(ctxFor(N93_STAFF), "send_handover_email", { jobId: GARDEN }, { origin: "bob" });
    expect(r.kind).toBe("forbidden");
  });

  it("Ask Bob: who hasn't been asked for a review (and never claims a review was left)", async () => {
    overrideProvidersForTests({ email: fakeMail() });
    const ctx = ctxFor(N93_OWNER);
    await finished(ctx, GARDEN);
    await finished(ctx, STAIRS);
    await approve(ctx, { jobId: GARDEN });
    const tool = getTool("list_review_requests");
    if (!tool || tool.kind !== "read") throw new Error("missing tool");
    const out = (await tool.run(ctx, {})) as { data: { not_yet_asked: string[]; finished_handovers: { job: string; review_requested: string | null }[]; note: string } };
    expect(out.data.not_yet_asked.some((j) => /Oak staircase/.test(j))).toBe(true);
    expect(out.data.not_yet_asked.some((j) => /Garden room/.test(j))).toBe(false);
    expect(JSON.stringify(out.data)).not.toMatch(/review_received|left a review": true/);
  });

  it("Ask Bob: 'draft a thank-you email' saves a draft even when a mailbox is connected", async () => {
    overrideProvidersForTests({ email: fakeMail() });
    const ctx = ctxFor(N93_OWNER);
    await finished(ctx, GARDEN);
    const { preview, done } = await approve(ctx, { jobId: GARDEN, draftOnly: true });
    expect(preview.title).toBe("Save thank-you email draft");
    expect(done.status).toBe("executed");
    expect(outbox).toHaveLength(0);
  });
});
