/**
 * Ninety3 pilot features on the fictional demo data: Jobs to price (enquiry →
 * pricing → one job), Extras (proposed vs approved, counted exactly once),
 * time-off history arithmetic and the rough estimate's deterministic sums.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_OFFICE, N93_OWNER } from "./helpers";
import { getDb } from "@/server/db";
import * as R from "@/server/services/records";
import * as F from "@/server/services/files";
import * as Pr from "@/server/services/pricing";
import * as Est from "@/server/services/estimates";
import * as V from "@/server/services/variations";
import { jobBilling } from "@/server/services/billing";
import { buildSnapshot } from "@/server/services/snapshot";
import { jobFinancials } from "@/lib/job-financials";
import { reportCostSummary } from "@/lib/report-costs";
import { extrasSummary } from "@/components/jobs/variations";
import { bookedDaysInRange, lastMonthRange, leaveDaysInRange, thisMonthRange } from "@/lib/leave";
import { estimateTotals, suggestFittedFurniture } from "@/lib/estimate";
import type { OrgConfig, RateCard } from "@/lib/types";

const ok = <T,>(r: { ok: boolean; value?: T; error?: string }) => {
  if (!r.ok) throw new Error(`Expected ok, got: ${r.error}`);
  return r.value as T;
};
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 5)]);
// A minimal MP4 header ("ftyp" box, brand isom) — enough for type checks.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(4000, 1)]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  ", "latin1"), Buffer.alloc(4000, 2)]);

beforeEach(() => {
  freshDb();
});

describe("Jobs to price", () => {
  it("enquiry → pricing (photo, video, measurements, private note) → quote recorded as sent → accepted creates exactly one job carrying the right things", () => {
    const luke = ctxFor(N93_OWNER);
    const customersBefore = R.listCustomers(luke).length;
    const enq = ok(R.createEnquiry(luke, { customerName: "Hattie Fictional", phone: "07700 954321", source: "phone", title: "Alcove units", location: "Horley", description: "Both alcoves in the lounge" }));

    const added = ok(Pr.addToPricing(luke, enq.id));
    expect(added.pricingAt).toBeTruthy();
    expect(ok(Pr.addToPricing(luke, enq.id)).pricingAt).toBe(added.pricingAt); // a second tap changes nothing
    expect(Pr.pricingStage(added, [])).toBe("to_visit");

    ok(Pr.updatePricing(luke, enq.id, { siteAddress: "4 Fictional Close, Horley, RH6 7AA" }));
    const photo = ok(F.uploadFile(luke, { enquiryId: enq.id, filename: "alcove.jpg", data: JPEG, clientRef: "p1" }));
    const video = ok(F.uploadFile(luke, { enquiryId: enq.id, filename: "walkround.mp4", data: MP4, clientRef: "v1" }));
    const mov = ok(F.uploadFile(luke, { enquiryId: enq.id, filename: "IMG_0001.MOV", data: MOV, clientRef: "v2" }));
    expect([photo.visibility, video.visibility, mov.visibility]).toEqual(["office", "office", "office"]); // private by default
    expect(video).toMatchObject({ mimeType: "video/mp4", previewable: true });
    expect(mov.mimeType).toBe("video/quicktime");
    // A retried upload doesn't duplicate.
    expect(ok(F.uploadFile(luke, { enquiryId: enq.id, filename: "walkround.mp4", data: MP4, clientRef: "v1" }))).toMatchObject({ id: video.id, existed: true });
    ok(Pr.updatePricing(luke, enq.id, { measurements: [{ label: "Left alcove width", value: "1020 mm" }, { label: "Height to picture rail", value: "2210 mm" }] }));
    ok(R.addEnquiryNote(luke, enq.id, "Chimney breast isn't square — scribe the backs. Allow extra day."));

    // Leave and come back: everything is still on the same record.
    const back = R.getEnquiry(luke, enq.id)!;
    expect(back.measurements?.map((m) => m.value)).toEqual(["1020 mm", "2210 mm"]);
    expect(back.siteAddress).toBe("4 Fictional Close, Horley, RH6 7AA");
    expect(F.listFiles(luke).filter((f) => f.enquiryId === enq.id)).toHaveLength(3);

    ok(Pr.updatePricing(luke, enq.id, { stage: "to_price" }));
    expect(Pr.pricingStage(R.getEnquiry(luke, enq.id)!, R.listQuotes(luke))).toBe("to_price");
    // Preparing a quote is a draft: the stage doesn't move to "Quote sent".
    const q = ok(Pr.preparePricingQuote(luke, enq.id, { amount: 2850 }));
    expect(q.status).toBe("draft");
    expect(Pr.pricingStage(R.getEnquiry(luke, enq.id)!, R.listQuotes(luke))).toBe("to_price");
    expect(Pr.markPricingQuoteSent(luke, enq.id, q.id, false)).toMatchObject({ ok: false });
    ok(Pr.markPricingQuoteSent(luke, enq.id, q.id, true));
    expect(Pr.pricingStage(R.getEnquiry(luke, enq.id)!, R.listQuotes(luke))).toBe("quote_sent");

    // Accepted, tapped twice: one job.
    const job = ok(Pr.acceptPricing(luke, enq.id));
    const again = ok(Pr.acceptPricing(luke, enq.id));
    expect(again).toMatchObject({ id: job.id, existed: true });
    expect(R.listJobs(luke).filter((j) => j.enquiryId === enq.id)).toHaveLength(1);
    expect(job).toMatchObject({ title: "Alcove units", siteAddress: "4 Fictional Close, Horley, RH6 7AA", quotedValue: 2850 });
    expect(R.listCustomers(luke).length).toBe(customersBefore + 1); // one customer, made once
    const moved = F.listFiles(luke).filter((f) => f.jobId === job.id && [photo.id, video.id, mov.id].includes(f.id));
    expect(moved.map((f) => f.visibility)).toEqual(["office", "office", "office"]);
    const notes = R.getJob(luke, job.id)!.notes.map((n) => n.text).join("\n");
    expect(notes).toContain("Left alcove width: 1020 mm");
    expect(notes).toContain("scribe the backs");
    expect(R.listQuotes(luke).find((x) => x.id === q.id)?.status).toBe("accepted");
    expect(R.getEnquiry(luke, enq.id)).toMatchObject({ status: "won", jobId: job.id });
    expect(Pr.onPricingList(R.getEnquiry(luke, enq.id)!)).toBe(false);
  });

  it("a phone call straight into Jobs to price reuses the existing customer and their address", () => {
    const ryan = ctxFor(N93_OFFICE);
    const c = R.listCustomers(ryan)[0];
    const before = R.listCustomers(ryan).length;
    const e = ok(Pr.createPricing(ryan, { customerId: c.id, title: "Fitted wardrobes", siteAddress: "9 Example Road, Crawley, RH10 1AA", how: "phone" }));
    expect(e).toMatchObject({ customerId: c.id, status: "site_visit", siteAddress: "9 Example Road, Crawley, RH10 1AA", location: "Crawley" });
    expect(R.listCustomers(ryan).length).toBe(before);
    expect(Pr.createPricing(ryan, { customerName: "No Contact", title: "Shelves" })).toMatchObject({ ok: false, fieldErrors: { phone: expect.any(String) } });
  });

  it("refuses videos over the size limit with a plain message; photos keep the 25 MB limit", () => {
    const luke = ctxFor(N93_OWNER);
    const enq = ok(Pr.createPricing(luke, { customerName: "Big File", phone: "07700 900222", title: "Wardrobe" }));
    const big = Buffer.concat([MP4, Buffer.alloc(F.MAX_VIDEO_BYTES)]);
    expect(F.uploadFile(luke, { enquiryId: enq.id, filename: "long.mp4", data: big })).toMatchObject({ ok: false, error: expect.stringMatching(/limit is 60 MB per video/) });
  });
});

describe("Extras", () => {
  it("a proposed £450 extra stays out of the total; once approved the revised total rises by exactly £450 everywhere, with who recorded it and how", () => {
    const ryan = ctxFor(N93_OFFICE);
    const job = R.listJobs(ryan).find((j) => j.quotedValue > 0 && j.status !== "completed")!;
    const snap = () => buildSnapshot(ryan);
    const before = jobFinancials(job, snap());
    const billBefore = ok(jobBilling(ryan, job.id));
    const reportBefore = reportCostSummary(job, snap());

    const extra = ok(V.saveVariation(ryan, { jobId: job.id, description: "Additional oak shelving", amount: 450, amountsAre: "no_vat", status: "proposed", note: "Three shelves, oiled" }));
    expect(jobFinancials(job, snap()).contractValue).toBe(before.contractValue);
    expect(extrasSummary(job, snap().variations)).toMatchObject({ original: job.quotedValue, proposed: 450 + before.approvedVariations * 0 + snap().variations.filter((v) => v.jobId === job.id && v.status === "proposed" && v.id !== extra.id).reduce((s, v) => s + v.amount, 0) });

    const approved = ok(V.decideVariation(ryan, extra.id, { status: "approved", approvalVia: "phone", decisionNote: "Sophie agreed on the phone" }));
    expect(approved).toMatchObject({ status: "approved", decidedBy: "Ryan", approvalVia: "phone", decisionNote: "Sophie agreed on the phone" });
    expect(approved.decidedAt).toBeTruthy();
    const after = jobFinancials(job, snap());
    expect(after.contractValue).toBe(before.contractValue + 450);
    expect(extrasSummary(job, snap().variations).revised).toBe(after.contractValue);
    expect(ok(jobBilling(ryan, job.id)).remainingToInvoice).toBeCloseTo(billBefore.remainingToInvoice + 450, 2);
    const total = (r: ReturnType<typeof reportCostSummary>) => r.lines.find((l) => l.key === "total")?.amount ?? job.quotedValue;
    expect(total(reportCostSummary(job, snap()))).toBe(total(reportBefore) + 450);
    // Approving again changes nothing (counted once).
    ok(V.decideVariation(ryan, extra.id, { status: "approved", approvalVia: "phone" }));
    expect(jobFinancials(job, snap()).contractValue).toBe(before.contractValue + 450);
    // No invoice or email came from it.
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM invoices WHERE job_id = ? AND created_at > ?").get(job.id, extra.createdAt)).toMatchObject({ n: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM outbox").get()).toMatchObject({ n: 0 });
  });

  it("the site team and subcontractors never see extras or their prices", async () => {
    const { N93_STAFF } = await import("./helpers");
    const staff = ctxFor(N93_STAFF);
    const luke = ctxFor(N93_OWNER);
    const job = R.listJobs(luke)[0];
    ok(V.saveVariation(luke, { jobId: job.id, description: "Secret extra", amount: 999, amountsAre: "no_vat", status: "approved" }));
    expect(V.listVariations(staff)).toHaveLength(0);
    expect(JSON.stringify(buildSnapshot(staff).variations)).not.toContain("Secret extra");
    expect(V.saveVariation(staff, { jobId: job.id, description: "Try", amount: 1, amountsAre: "no_vat" })).toMatchObject({ ok: false });
  });
});

describe("Time off history arithmetic", () => {
  it("counts only the part of a leave period inside the range, half days as 0.5, and finds last month", () => {
    // 28 Oct (Tue) – 7 Nov (Fri) 2025: 3 working days in October, 5 in November.
    const a = { startDate: "2025-10-28", endDate: "2025-11-07" };
    expect(leaveDaysInRange(a, "2025-10-01", "2025-10-31")).toBe(4); // Tue 28, Wed 29, Thu 30, Fri 31
    expect(leaveDaysInRange(a, "2025-11-01", "2025-11-30")).toBe(5);
    expect(leaveDaysInRange({ startDate: "2025-11-12", endDate: "2025-11-12", part: "am" }, "2025-11-01", "2025-11-30")).toBe(0.5);
    expect(leaveDaysInRange({ startDate: "2025-12-01", endDate: "2025-12-05" }, "2025-11-01", "2025-11-30")).toBe(0);
    expect(lastMonthRange("2026-01-15")).toEqual(["2025-12-01", "2025-12-31"]);
    expect(lastMonthRange("2026-03-31")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(thisMonthRange("2026-02-10")).toEqual(["2026-02-01", "2026-02-28"]);
  });

  it("lists booked days inside the range only (a booking isn't attendance)", () => {
    const bookings = [
      { id: "b1", jobId: "j1", date: "2025-10-30", endDate: "2025-11-03", personIds: ["p1"], startTime: "08:00", endTime: "16:00" },
      { id: "b2", jobId: "j2", date: "2025-11-10", personIds: ["p2"] },
      { id: "b3", jobId: "j3", date: "2025-12-01", personIds: ["p1"] },
    ];
    expect(bookedDaysInRange(bookings, "p1", "2025-11-01", "2025-11-30").map((d) => d.date)).toEqual(["2025-11-01", "2025-11-02", "2025-11-03"]);
  });
});

describe("Rough estimates", () => {
  const card: RateCard = { labourDayRate: 280, items: [{ id: "r1", name: "18mm MDF sheet", unit: "sheet", price: 42 }, { id: "r2", name: "Shaker door", unit: "each", price: 65 }] };
  const input = { units: 2, widthMm: 1000, heightMm: 2200, depthMm: 350, shelvesPerUnit: 3, doorsPerUnit: 2, days: 4, people: 1, finish: "painted" };
  const exVat: OrgConfig["finance"] = { vatRegistered: true, vatRate: 20, defaultPaymentTermsDays: 14, pricesAre: "exclusive" };

  it("suggests lines from the price list, flags missing prices and leaves them out of the total; editing a quantity updates the total", () => {
    const s = suggestFittedFurniture(input, card);
    const byLabel = Object.fromEntries(s.lines.map((l) => [l.label, l]));
    // Board: 2 × (2·2.2·0.35 + 2·1·0.35 + 1·2.2 + 3·1·0.35) = 2 × 5.49 = 10.98 m² ÷ 2.9768 → 4 sheets.
    expect(byLabel["Sheet material (carcasses, shelves, backs)"]).toMatchObject({ qty: 4, rate: 42, source: "rate_card" });
    expect(byLabel["Doors"]).toMatchObject({ qty: 4, rate: 65 });
    expect(byLabel["Labour (making and fitting)"]).toMatchObject({ qty: 4, rate: 280, source: "rate_card" });
    expect(byLabel["Hinges, handles and fixings"]).toMatchObject({ rate: null, source: "missing" });
    expect(s.questions.join(" ")).toMatch(/hinges/i);
    const t = estimateTotals({ lines: s.lines, rangePercent: 10 }, exVat);
    expect(t.pricedSubtotal).toBe(4 * 42 + 4 * 65 + 4 * 280); // 1548 — missing lines excluded
    expect(t.missing.map((l) => l.label)).toEqual(["Hinges, handles and fixings", "Finish (painted)"]);
    expect(t.range).toBeNull(); // no defensible range while lines are unpriced
    expect(t.rangeNote).toMatch(/every line/);
    expect(t.vat).toBe(309.6);
    expect(t.gross).toBe(1857.6);

    // Correct a quantity (5 days, not 4) and price the missing lines.
    const edited = s.lines.map((l) => (l.label.startsWith("Labour") ? { ...l, qty: 5 } : l.rate === null ? { ...l, rate: 30, source: "entered" as const } : l));
    const t2 = estimateTotals({ lines: edited, rangePercent: 10 }, exVat);
    expect(t2.pricedSubtotal).toBe(4 * 42 + 4 * 65 + 5 * 280 + 2 * 30 + 2 * 30);
    expect(t2.complete).toBe(true);
    expect(t2.range).toEqual({ low: Math.round(t2.gross * 0.9 * 100) / 100, high: Math.round(t2.gross * 1.1 * 100) / 100, percent: 10 });
  });

  it("no price list and no measurements: nothing invented — every line unpriced, short questions asked", () => {
    const s = suggestFittedFurniture({ ...input, widthMm: 0, heightMm: 0, depthMm: 0, days: 0 }, undefined);
    expect(s.lines.every((l) => l.rate === null)).toBe(true);
    expect(estimateTotals({ lines: s.lines }, exVat).pricedSubtotal).toBe(0);
    expect(s.questions.join(" ")).toMatch(/width, height and depth/);
    expect(s.questions.join(" ")).toMatch(/day rate/);
  });

  it("VAT follows the workspace: not registered adds none; unknown says so", () => {
    const lines = [{ id: "a", label: "Labour", qty: 2, unit: "day", rate: 250, source: "entered" as const }];
    expect(estimateTotals({ lines }, { vatRegistered: false, vatRate: null, defaultPaymentTermsDays: 14 })).toMatchObject({ gross: 500, vat: 0, vatNote: expect.stringMatching(/not VAT registered/) });
    expect(estimateTotals({ lines }, { vatRegistered: null, vatRate: null, defaultPaymentTermsDays: null })).toMatchObject({ gross: 500, vatKnown: false, vatNote: expect.stringMatching(/isn't set up/) });
    expect(estimateTotals({ lines }, { ...exVat, pricesAre: "inclusive" })).toMatchObject({ gross: 500, net: 416.67, vat: 83.33 });
  });

  it("saving needs the pilot switched on; a quote draft only once every line is priced; nothing is sent", () => {
    const luke = ctxFor(N93_OWNER);
    const enq = ok(Pr.createPricing(luke, { customerName: "Est Fictional", phone: "07700 900333", title: "Alcove units" }));
    const s = suggestFittedFurniture(input, card);
    expect(Est.saveEstimate(luke, enq.id, { description: "Oak alcoves", lines: s.lines })).toMatchObject({ ok: false, code: "forbidden" });
    ok(Est.setPilotFeature(luke, "roughEstimates", true));
    expect(Est.setPilotFeature(ctxFor(N93_OFFICE), "roughEstimates", false)).toMatchObject({ ok: false });
    ok(Est.saveEstimate(luke, enq.id, { description: "Oak alcoves", lines: s.lines }));
    expect(Est.estimateToQuote(luke, enq.id)).toMatchObject({ ok: false, error: expect.stringMatching(/Price every line/) });
    const priced = s.lines.map((l) => (l.rate === null ? { ...l, rate: 25 } : l));
    const saved = ok(Est.saveEstimate(luke, enq.id, { description: "Oak alcoves", lines: priced }));
    expect(saved.estimate?.lines.filter((l) => l.source === "entered")).toHaveLength(2);
    const q = ok(Est.estimateToQuote(luke, enq.id));
    expect(q).toMatchObject({ status: "draft", enquiryId: enq.id });
    expect(Pr.pricingStage(R.getEnquiry(luke, enq.id)!, R.listQuotes(luke))).toBe("to_visit");
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM outbox").get()).toMatchObject({ n: 0 });
  });

  it("owners/admins keep the price list; the site team can't change it", async () => {
    const { N93_STAFF } = await import("./helpers");
    const ryan = ctxFor(N93_OFFICE);
    const saved = ok(Est.saveRateCard(ryan, { labourDayRate: 300, items: [{ name: "Shaker door", unit: "each", price: 70 }] }));
    expect(saved.items[0]).toMatchObject({ name: "Shaker door", price: 70 });
    expect(Est.saveRateCard(ctxFor(N93_STAFF), { items: [] })).toMatchObject({ ok: false });
  });
});
