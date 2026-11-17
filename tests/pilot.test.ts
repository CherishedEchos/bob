/**
 * Ninety3 pilot: calendar feeds, merchants, materials, bills, site access and
 * what3words — access control and the failure modes that matter.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_OWNER, N93_STAFF, RDG_OWNER } from "./helpers";
import * as R from "@/server/services/records";
import * as T from "@/server/services/team";
import * as M from "@/server/services/merchants";
import * as Cal from "@/server/services/calendar";
import { buildSnapshot } from "@/server/services/snapshot";
import { contextFromToken } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { normaliseW3w } from "@/lib/validation";
import { addDays } from "@/lib/dates";
import { todayKey } from "@/lib/utils";

const SAM = "sam@so-plastering.example";
beforeEach(() => {
  freshDb();
});
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const tokenOf = (path: string) => path.split("/").pop()!.replace(/\.ics$/, "");
const events = (ics: string) => ics.split("BEGIN:VEVENT").length - 1;

describe("Calendar feeds", () => {
  it("company feed: every booking, stable UIDs, no contact details, codes or private notes", () => {
    const owner = ctxFor(N93_OWNER);
    const feed = ok(Cal.createFeed(owner, "company"));
    const out = Cal.feedFor(tokenOf(feed.path), "bob.test")!;
    expect(out.ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(out.ics).toContain("BEGIN:VTIMEZONE");
    expect(out.ics).toContain("UID:n93_bk_smith_snag@bob.test");
    expect(out.ics).toMatch(/DTSTART;TZID=Europe\/London:\d{8}T130000/);
    // Site access note has a gate code, and customer phones exist — neither may leak.
    expect(out.ics).not.toMatch(/4471|07700|@example\.com|Side gate|Dust sheets/);
    expect(events(out.ics)).toBeGreaterThan(8);
  });
  it("a moved booking keeps its UID; a cancelled one disappears", () => {
    const owner = ctxFor(N93_OWNER);
    const token = tokenOf(ok(Cal.createFeed(owner, "company")).path);
    const b = T.listBookings(owner).find((x) => x.id === "n93_bk_smith_snag")!;
    const later = addDays(todayKey(), 40);
    ok(T.saveBooking(owner, { id: b.id, jobId: b.jobId, date: later, startTime: "09:00", endTime: "10:00", personIds: b.personIds }));
    let ics = Cal.feedFor(token, "bob.test")!.ics;
    expect(ics.match(/UID:n93_bk_smith_snag@bob\.test/g)).toHaveLength(1);
    expect(ics).toContain(`DTSTART;TZID=Europe/London:${later.replace(/-/g, "")}T090000`);
    ok(T.deleteBooking(owner, b.id));
    ics = Cal.feedFor(token, "bob.test")!.ics;
    expect(ics).not.toContain("n93_bk_smith_snag");
  });
  it("personal feed shows only their bookings and follows reassignment", () => {
    const owner = ctxFor(N93_OWNER);
    const sam = ctxFor(SAM);
    const token = tokenOf(ok(Cal.createFeed(sam, "person")).path);
    let ics = Cal.feedFor(token, "bob.test")!.ics;
    expect(ics).toContain("n93_bk_fletcher_plaster");
    expect(ics).not.toContain("n93_bk_sophie_fit");
    const b = T.listBookings(owner).find((x) => x.id === "n93_bk_fletcher_plaster")!;
    ok(T.saveBooking(owner, { id: b.id, jobId: b.jobId, date: b.date, startTime: b.startTime, endTime: b.endTime, personIds: ["n93_per_ellie"], confirmOverlap: true }));
    ics = Cal.feedFor(token, "bob.test")!.ics;
    expect(ics).not.toContain("n93_bk_fletcher_plaster");
  });
  it("revoked links, removed access and workers asking for the company feed all fail", () => {
    const owner = ctxFor(N93_OWNER);
    const sam = ctxFor(SAM);
    expect(Cal.createFeed(sam, "company")).toMatchObject({ ok: false, code: "forbidden" });
    const own = ok(Cal.createFeed(owner, "company"));
    ok(Cal.revokeFeed(owner, own.id));
    expect(Cal.feedFor(tokenOf(own.path), "bob.test")).toBeNull();
    const samFeed = ok(Cal.createFeed(sam, "person"));
    expect(Cal.feedFor(tokenOf(samFeed.path), "bob.test")).not.toBeNull();
    ok(T.revokeAccess(owner, "n93_per_sam"));
    expect(Cal.feedFor(tokenOf(samFeed.path), "bob.test")).toBeNull();
    expect(Cal.feedFor("x".repeat(43), "bob.test")).toBeNull();
    // Another company can't revoke or see Ninety3's links.
    expect(Cal.revokeFeed(ctxFor(RDG_OWNER), own.id)).toMatchObject({ ok: false });
  });
  it("all-day multi-day bookings use exclusive end dates; timed multi-day get one event per day", () => {
    const owner = ctxFor(N93_OWNER);
    ok(T.saveBooking(owner, { jobId: "n93_job_stairs_horley", date: "2027-03-26", endDate: "2027-03-29", startTime: "08:00", endTime: "16:00", personIds: ["n93_per_priya"] }));
    ok(T.saveBooking(owner, { jobId: "n93_job_stairs_horley", date: "2027-04-05", endDate: "2027-04-06", allDay: true, personIds: [] }));
    const ics = Cal.feedFor(tokenOf(ok(Cal.createFeed(owner, "company")).path), "bob.test")!.ics;
    // Across the clock change the wall-clock time stays 08:00 in Europe/London.
    expect(ics).toContain("DTSTART;TZID=Europe/London:20270326T080000");
    expect(ics).toContain("DTSTART;TZID=Europe/London:20270329T080000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270405");
    expect(ics).toContain("DTEND;VALUE=DATE:20270407");
  });
});

describe("Merchants", () => {
  it("restricted fields reach owners only; site team sees contact details; workers nothing", () => {
    const owner = buildSnapshot(ctxFor(N93_OWNER));
    const ct = owner.merchants.find((m) => m.name === "Crawley Timber Supplies")!;
    expect(ct.accountRef).toBe("N93-4471");
    expect(ct.passwordManagerUrl).toMatch(/^https:/);
    const staff = buildSnapshot(ctxFor(N93_STAFF)).merchants.find((m) => m.name === "Crawley Timber Supplies")!;
    expect(staff.phone).toBeTruthy();
    expect(staff).not.toHaveProperty("accountRef");
    expect(staff).not.toHaveProperty("passwordManagerUrl");
    expect(M.listMerchants(ctxFor(SAM))).toEqual([]);
    expect(JSON.stringify(T.myWork(ctxFor(SAM)))).not.toMatch(/N93-4471|vault\.example|merchantId/);
    expect(M.saveMerchant(ctxFor(N93_STAFF), undefined, { name: "X Ltd" })).toMatchObject({ ok: false, code: "forbidden" });
  });
  it("refuses passwords in notes or account fields", () => {
    const owner = ctxFor(N93_OWNER);
    expect(M.saveMerchant(owner, undefined, { name: "Jewson-ish", notes: "login password: hunter2" })).toMatchObject({ ok: false, code: "invalid" });
    expect(M.saveMerchant(owner, undefined, { name: "Jewson-ish", accountRef: "pwd=abc123" })).toMatchObject({ ok: false });
    expect(M.saveMerchant(owner, undefined, { name: "Jewson-ish", passwordManagerUrl: "not a link" })).toMatchObject({ ok: false });
  });
  it("archiving keeps materials and bills linked", () => {
    const owner = ctxFor(N93_OWNER);
    const before = T.listMaterials(owner).filter((m) => m.merchantId === "n93_mer_sbm").length;
    ok(M.archiveMerchant(owner, "n93_mer_sbm"));
    expect(T.listMaterials(owner).filter((m) => m.merchantId === "n93_mer_sbm").length).toBe(before);
    expect(M.listMerchants(owner).find((m) => m.id === "n93_mer_sbm")?.archivedAt).toBeTruthy();
    expect(M.openOrdersFor(owner, "n93_mer_sbm").length).toBeGreaterThan(0);
  });
  it("other companies can't touch Ninety3 merchants", () => {
    expect(M.saveMerchant(ctxFor(RDG_OWNER), "n93_mer_timber", { name: "Hijack" })).toMatchObject({ ok: false, code: "not_found" });
    expect(M.archiveMerchant(ctxFor(RDG_OWNER), "n93_mer_timber")).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("Materials and bills", () => {
  it("add from a job without a merchant, then assign one and mark ordered — one record", () => {
    const owner = ctxFor(N93_OWNER);
    const m = ok(T.saveMaterial(owner, { jobId: "n93_job_wardrobes_horsham", item: "Hinges, soft close", quantity: "12", unit: "pairs", neededBy: addDays(todayKey(), 5) }));
    expect(m.merchantId).toBeUndefined();
    const u = ok(T.saveMaterial(owner, { id: m.id, jobId: m.jobId, item: m.item, quantity: m.quantity, unit: "pairs", merchantId: "n93_mer_timber", status: "ordered", orderRef: "PO-881", expectedDelivery: addDays(todayKey(), 3) }));
    expect(u).toMatchObject({ id: m.id, merchantId: "n93_mer_timber", status: "ordered", orderRef: "PO-881" });
    expect(T.listMaterials(owner).filter((x) => x.item === "Hinges, soft close")).toHaveLength(1);
    expect(M.openOrdersFor(owner, "n93_mer_timber").some((x) => x.id === m.id)).toBe(true);
    expect(T.saveMaterial(owner, { jobId: m.jobId, item: "Bad", quantity: "1", merchantId: "rdg_mer_timber" })).toMatchObject({ ok: false, code: "not_found" });
  });
  it("records a bill payment with its date, once", () => {
    const owner = ctxFor(N93_OWNER);
    const paid = ok(T.setBillPaid(owner, "n93_bill_davies", true, { paidOn: todayKey(), paymentMethod: "bank_transfer" }));
    expect(paid).toMatchObject({ status: "paid", paidOn: todayKey(), paymentMethod: "bank_transfer" });
    expect(T.setBillPaid(owner, "n93_bill_davies", true, { paidOn: todayKey() })).toMatchObject({ ok: false, code: "conflict" });
    expect(T.setBillPaid(owner, "n93_bill_timber", true, { paidOn: "not-a-date" })).toMatchObject({ ok: false, code: "invalid" });
    expect(T.setBillPaid(ctxFor(N93_STAFF), "n93_bill_timber", true)).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("Site details", () => {
  it("what3words is accepted with or without ///, and bad formats are explained", () => {
    expect(normaliseW3w("///filled.count.soap")).toBe("filled.count.soap");
    expect(normaliseW3w("Filled.Count.Soap")).toBe("filled.count.soap");
    expect(normaliseW3w("https://what3words.com/filled.count.soap")).toBe("filled.count.soap");
    expect(normaliseW3w("filled count soap")).toBeNull();
    expect(normaliseW3w("filled.count")).toBeNull();
    const owner = ctxFor(N93_OWNER);
    expect(R.updateJob(owner, "n93_job_stairs_horley", { what3words: "two.words" })).toMatchObject({ ok: false, code: "invalid" });
    ok(R.updateJob(owner, "n93_job_stairs_horley", { what3words: "///lamp.stone.river", accessNote: "Use the side gate" }));
    expect(R.getJob(owner, "n93_job_stairs_horley")).toMatchObject({ what3words: "lamp.stone.river", accessNote: "Use the side gate" });
  });
  it("the assigned worker gets the access note and what3words; old jobs without them still load", () => {
    const sam = ctxFor(SAM);
    const b = ok(T.myWork(sam)).bookings[0];
    expect(b.job.accessNote).toMatch(/back garden entrance/);
    expect(b.job.what3words).toBe("ladder.frost.silent");
    const owner = ctxFor(N93_OWNER);
    getDb().prepare("UPDATE jobs SET site_address = NULL, what3words = NULL, access_note = NULL WHERE id = 'n93_job_stairs_horley'").run();
    expect(R.getJob(owner, "n93_job_stairs_horley")?.siteAddress).toBeUndefined();
    expect(() => buildSnapshot(owner)).not.toThrow();
  });
});

describe("Workers can't reach merchants or finance through ops", () => {
  it("refuses merchant and bill operations", () => {
    const sam = ctxFor(SAM);
    expect(M.saveMerchant(sam, undefined, { name: "X" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(T.createBill(sam, { supplier: "X", description: "Y", amount: 5, dueDate: todayKey() })).toMatchObject({ ok: false, code: "forbidden" });
    expect(contextFromToken("nope")).toBeNull();
  });
});
