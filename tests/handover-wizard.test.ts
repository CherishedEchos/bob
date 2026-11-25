/** The handover workspace's server side: resume on the same step, step moves aren't edits, Bob sees agreed extras, status. */
import { beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_OFFICE, N93_OWNER, N93_STAFF } from "./helpers";
import { createReport, finishReport, listReportVersions, listReports, markReportSent, reportFacts, reportPack, saveReport } from "@/server/services/handover-reports";
import { handoverStatus } from "@/components/reports/handover-wizard";
import type { HandoverReport, ReportVersion } from "@/lib/types";

beforeEach(() => freshDb());

describe("handover workspace", () => {
  it("remembers the step without counting it as an edit, and keeps it when content is saved", () => {
    const ctx = ctxFor(N93_OWNER);
    const r = createReport(ctx, { jobId: "n93_job_stairs_horley" });
    if (!r.ok) throw new Error(r.error);
    const moved = saveReport(ctx, { id: r.value.id, step: 3 });
    expect(moved.ok && moved.value.step).toBe(3);
    expect(moved.ok && moved.value.revision).toBe(r.value.revision); // no new revision, no conflict for the other person
    const edited = saveReport(ctx, { id: r.value.id, baseRevision: r.value.revision, content: { ...r.value.content, title: "Oak staircase and balustrade" }, step: 4 });
    expect(edited.ok && edited.value).toMatchObject({ step: 4, revision: r.value.revision + 1 });
    expect(edited.ok && edited.value.content.title).toBe("Oak staircase and balustrade");
    expect(saveReport(ctx, { id: r.value.id, step: 9 }).ok && (saveReport(ctx, { id: r.value.id, step: 9 }) as { value: HandoverReport }).value.step).toBe(4); // out of range ignored
  });

  it("an edit based on an old copy is still refused (Luke and Ryan don't overwrite each other)", () => {
    const ctx = ctxFor(N93_OWNER);
    const r = createReport(ctx, { jobId: "n93_job_stairs_horley" });
    if (!r.ok) throw new Error(r.error);
    saveReport(ctx, { id: r.value.id, baseRevision: r.value.revision, content: r.value.content });
    const stale = saveReport(ctx, { id: r.value.id, baseRevision: r.value.revision, content: r.value.content });
    expect(stale.ok).toBe(false);
  });

  it("Bob's draft is given the customer's approved extras (descriptions only, no money)", () => {
    const ctx = ctxFor(N93_OWNER);
    const r = createReport(ctx, { jobId: "n93_job_gardenroom_lingfield" });
    if (!r.ok) throw new Error(r.error);
    const facts = reportFacts(ctx, r.value);
    expect(facts.approvedVariations).toEqual(["Cedar step and door canopy"]);
    expect(JSON.stringify(facts)).not.toMatch(/£|650/);
  });

  it("only owners and admins can work on a handover", () => {
    expect(createReport(ctxFor(N93_STAFF), { jobId: "n93_job_stairs_horley" }).ok).toBe(false);
  });

  it("status: Not started → In progress → Completed → Sent → Unpublished changes", () => {
    const base = { id: "rep_1", revision: 3, updatedAt: "2026-11-20T10:00:00.000Z" } as HandoverReport;
    const v = (version: number, revision: number) => ({ reportId: "rep_1", version, revision, createdAt: "2026-11-20T10:05:00.000Z" }) as ReportVersion;
    expect(handoverStatus(undefined, [])).toBe("not_started");
    expect(handoverStatus(base, [v(1, 3)])).toBe("in_progress"); // a downloaded PDF alone isn't "finished"
    const done = { ...base, completedAt: "2026-11-20T10:06:00.000Z", completedBy: "Luke", completedRevision: 3 };
    expect(handoverStatus(done, [v(1, 3)])).toBe("completed");
    expect(handoverStatus({ ...done, sentAt: "2026-11-21T09:00:00.000Z", sentBy: "Ryan", sentVersion: 1 }, [v(1, 3)])).toBe("sent");
    expect(handoverStatus({ ...done, revision: 4 }, [v(1, 3)])).toBe("changes");
    expect(handoverStatus({ ...done, revision: 4, completedRevision: 4, sentAt: "2026-11-21T09:00:00.000Z", sentVersion: 1 }, [v(1, 3), v(2, 4)])).toBe("completed"); // version 2 not sent yet
  });

  it("Finish handover publishes a PDF once, records who and when, survives a reload, and is the same for Ryan", async () => {
    const luke = ctxFor(N93_OWNER);
    const r = createReport(luke, { jobId: "n93_job_stairs_horley" });
    if (!r.ok) throw new Error(r.error);
    const f = await finishReport(luke, { id: r.value.id });
    if (!f.ok) throw new Error(f.error);
    expect(f.value.version.version).toBe(1);
    expect(f.value.report).toMatchObject({ completedBy: "Luke", completedRevision: r.value.revision, step: 5 });
    const ryanView = listReports(ctxFor(N93_OFFICE)).find((x) => x.id === r.value.id)!;
    expect(handoverStatus(ryanView, listReportVersions(ctxFor(N93_OFFICE)))).toBe("completed");
    // Finishing again with nothing changed doesn't make another PDF.
    const again = await finishReport(luke, { id: r.value.id });
    expect(again.ok && again.value.version.version).toBe(1);
    expect(listReportVersions(luke).filter((v) => v.reportId === r.value.id)).toHaveLength(1);
  });

  it("editing after finishing shows unpublished changes; finishing again makes version 2 and keeps version 1", async () => {
    const ctx = ctxFor(N93_OWNER);
    const r = createReport(ctx, { jobId: "n93_job_stairs_horley" });
    if (!r.ok) throw new Error(r.error);
    await finishReport(ctx, { id: r.value.id });
    const cur = listReports(ctx).find((x) => x.id === r.value.id)!;
    saveReport(ctx, { id: cur.id, baseRevision: cur.revision, content: { ...cur.content, title: "Oak staircase, finished" } });
    const edited = listReports(ctx).find((x) => x.id === r.value.id)!;
    expect(handoverStatus(edited, listReportVersions(ctx))).toBe("changes");
    expect(markReportSent(ctx, { id: cur.id }).ok).toBe(false); // can't mark an out-of-date report as sent
    const f2 = await finishReport(ctx, { id: cur.id });
    expect(f2.ok && f2.value.version.version).toBe(2);
    expect(listReportVersions(ctx).filter((v) => v.reportId === cur.id).map((v) => v.version).sort()).toEqual([1, 2]);
    expect(handoverStatus(listReports(ctx).find((x) => x.id === cur.id), listReportVersions(ctx))).toBe("completed");
  });

  it("sent to customer is separate from completed, and the pack is built from the published version", async () => {
    const ctx = ctxFor(N93_OWNER);
    const r = createReport(ctx, { jobId: "n93_job_stairs_horley" });
    if (!r.ok) throw new Error(r.error);
    expect(markReportSent(ctx, { id: r.value.id }).ok).toBe(false); // not finished yet
    const f = await finishReport(ctx, { id: r.value.id });
    if (!f.ok) throw new Error(f.error);
    const sent = markReportSent(ctx, { id: r.value.id });
    expect(sent.ok && sent.value).toMatchObject({ sentBy: "Luke", sentVersion: 1 });
    expect(handoverStatus(sent.ok ? sent.value : undefined, listReportVersions(ctx))).toBe("sent");
    const pack = await reportPack(ctx, { id: r.value.id });
    if (!pack.ok) throw new Error(pack.error);
    expect(pack.value.items[0].fileId).toBe(f.value.version.fileId);
    const undo = markReportSent(ctx, { id: r.value.id, sent: false });
    expect(undo.ok && undo.value.sentAt).toBeFalsy();
  });
});
