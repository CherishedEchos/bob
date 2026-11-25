import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { Ctx } from "@/server/context";
import type { OrgConfig } from "@/lib/types";
import { createReport, finishReport, saveReport } from "@/server/services/handover-reports";

/**
 * A finished customer handover report in the Ninety3 demonstration workspace:
 * Claire Dawson's garden room (fictional), written up, with selected photos
 * and the cost summary, finished and published as a Ninety3-branded PDF (v1). Runs
 * once per database (and again after "Reset sample data"), so it comes back
 * after the free plan wipes the disk.
 */
const JOB = "n93_job_gardenroom_lingfield";

export function demoReportCtx(db: DatabaseSync): Ctx | null {
  const row = db.prepare("SELECT o.config, u.id AS uid, u.name FROM orgs o JOIN memberships m ON m.org_id = o.id AND m.role = 'owner' JOIN users u ON u.id = m.user_id WHERE o.id = 'org_ninety3'").get() as { config: string; uid: string; name: string } | undefined;
  if (!row) return null;
  const org = JSON.parse(row.config) as OrgConfig;
  if (org.dataMode !== "sample") return null;
  return { orgId: "org_ninety3", userId: row.uid, userName: row.name, role: "owner", org, via: "system" };
}

export async function ensureDemoHandoverReport(db: DatabaseSync): Promise<void> {
  const ctx = demoReportCtx(db);
  if (!ctx) return;
  if (!db.prepare("SELECT 1 FROM jobs WHERE org_id = ? AND id = ?").get(ctx.orgId, JOB)) return;
  if (db.prepare("SELECT 1 FROM handover_reports WHERE org_id = ? AND job_id = ?").get(ctx.orgId, JOB)) return;
  const created = createReport(ctx, { jobId: JOB });
  if (!created.ok) return;
  const r = created.value;
  const sections = r.content.sections.map((s) => {
    switch (s.id) {
      case "overview":
        return {
          ...s,
          body:
            "Thank you for choosing Ninety3 for your new garden studio. Over six weeks we built a fully insulated timber-framed room at the end of your garden, on a ground-screw base, clad in western red cedar with a cedar step and door canopy. Inside there's an oak floor, a cedar-lined ceiling and lighting and sockets installed and certified by Davies Electrical. This report brings together the work, photos and care notes for your records.",
        };
      case "work":
        return {
          ...s,
          items: [
            "Site cleared and levelled; ground-screw base installed",
            "Insulated timber frame, breather membrane and EPDM roof",
            "Western red cedar cladding on all four sides",
            "Engineered oak floor and oiled cedar ceiling",
            "Lighting and sockets installed and tested (certificate included)",
            "Cedar step and door canopy (agreed variation)",
          ],
        };
      case "aftercare":
        return { ...s, hidden: false, items: ["Re-oil the cedar cladding every 12–18 months to keep its colour (or leave it to silver naturally).", "Keep gutters and the roof outlet clear of leaves each autumn.", "Wipe the oak floor with a damp mop only; avoid steam cleaners."] };
      default:
        return s;
    }
  });
  const saved = saveReport(ctx, {
    id: r.id,
    baseRevision: r.revision,
    selection: { ...r.selection, includeCosts: true },
    content: { ...r.content, sections, photos: r.content.photos.map((p) => ({ ...p, caption: p.caption || "Finished garden studio" })) },
  });
  if (!saved.ok) return;
  // Finished: the PDF is published (version 1) and the handover shows as Completed.
  await finishReport(ctx, { id: saved.value.id });
}
