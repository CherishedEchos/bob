/** The handover workspace's server side: resume on the same step, step moves aren't edits, Bob sees agreed extras, status. */
import { beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_OWNER, N93_STAFF } from "./helpers";
import { createReport, reportFacts, saveReport } from "@/server/services/handover-reports";
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

  it("status: Not started → In progress → Ready → In progress after an edit", () => {
    const report = { updatedAt: "2026-11-20T10:00:00.000Z" } as HandoverReport;
    const v = (createdAt: string, version = 1) => ({ version, createdAt }) as ReportVersion;
    expect(handoverStatus(undefined, [])).toBe("not_started");
    expect(handoverStatus(report, [])).toBe("in_progress");
    expect(handoverStatus(report, [v("2026-11-20T10:05:00.000Z")])).toBe("ready");
    expect(handoverStatus({ ...report, updatedAt: "2026-11-21T09:00:00.000Z" }, [v("2026-11-20T10:05:00.000Z")])).toBe("in_progress");
  });
});
