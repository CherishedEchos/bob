/** The finished handover report in the Ninety3 demo: written up, photos selected, costs on, exported PDF v1 — with no internal notes. */
import { beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_OWNER } from "./helpers";
import { getDb } from "@/server/db";
import { ensureDemoHandoverReport } from "@/server/db/demo-report";
import { listReports, listReportVersions } from "@/server/services/handover-reports";

beforeEach(() => freshDb());

describe("demo handover report", () => {
  it("is created once with a summary, aftercare, photos, costs and a v1 PDF", async () => {
    await ensureDemoHandoverReport(getDb());
    await ensureDemoHandoverReport(getDb());
    const ctx = ctxFor(N93_OWNER);
    const reports = listReports(ctx);
    expect(reports).toHaveLength(1);
    const r = reports[0];
    expect(r.jobId).toBe("n93_job_gardenroom_lingfield");
    expect(r.content.sections.find((s) => s.id === "overview")?.body).toMatch(/garden studio/);
    expect(r.content.sections.find((s) => s.id === "aftercare")?.hidden).toBe(false);
    expect(r.selection.includeCosts).toBe(true);
    expect(r.content.photos.filter((p) => p.include).length).toBeGreaterThan(1);
    const versions = listReportVersions(ctx);
    expect(versions).toHaveLength(1);
    const pdf = getDb().prepare("SELECT data FROM file_blobs WHERE file_id = ?").get(versions[0].fileId) as { data: Uint8Array };
    const text = Buffer.from(pdf.data).toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    // Internal-only material never goes into the customer's report.
    const json = JSON.stringify(r.content);
    expect(json).not.toMatch(/access note|internal|profit|margin|key safe/i);
  });
});
