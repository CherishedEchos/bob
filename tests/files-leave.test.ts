import { beforeEach, describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { ctxFor, freshDb, N93_OFFICE, N93_OWNER, N93_STAFF, RDG_OWNER } from "./helpers";
import * as F from "@/server/services/files";
import * as H from "@/server/services/handover";
import * as A from "@/server/services/absences";
import * as T from "@/server/services/team";
import * as R from "@/server/services/records";
import { buildSnapshot } from "@/server/services/snapshot";
import { getDb } from "@/server/db";
import { addDays, weekStart } from "@/lib/dates";
import { todayKey } from "@/lib/utils";

const SAM = "sam@so-plastering.example"; // subcontractor, booked on the Copthorne extension this week
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n", "latin1");
const ok = <T,>(r: { ok: boolean; value?: T; error?: string }) => {
  if (!r.ok) throw new Error(`Expected ok, got: ${r.error}`);
  return r.value as T;
};

/** Read entries back out of a stored (uncompressed) ZIP. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const data = buf.subarray(p + 30 + nameLen + extra, p + 30 + nameLen + extra + size);
    out[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 30 + nameLen + extra + size;
  }
  return out;
}

beforeEach(() => {
  freshDb();
});

describe("Files & photos", () => {
  it("saves an upload with its bytes, survives a re-read, and a retry with the same client reference doesn't duplicate", () => {
    const owner = ctxFor(N93_OWNER);
    const a = ok(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", category: "progress", filename: "IMG_1.jpg", data: JPEG, clientRef: "ref-1", description: "Units in" }));
    expect(a).toMatchObject({ existed: false, mimeType: "image/jpeg", previewable: true, category: "progress", uploadedBy: "Luke" });
    const again = ok(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", category: "progress", filename: "IMG_1.jpg", data: JPEG, clientRef: "ref-1" }));
    expect(again).toMatchObject({ id: a.id, existed: true });
    expect(F.listFiles(owner).filter((f) => f.filename === "IMG_1.jpg")).toHaveLength(1);
    expect(F.readFile(owner, a.id, "original")!.data.equals(JPEG)).toBe(true);
    expect(buildSnapshot(owner).files.some((f) => f.id === a.id)).toBe(true);
  });

  it("refuses files whose content doesn't match, unsupported types and oversized files — with a useful message", () => {
    const owner = ctxFor(N93_OWNER);
    expect(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", filename: "plan.pdf", data: JPEG })).toMatchObject({ ok: false, code: "invalid", error: expect.stringMatching(/doesn't look like a real PDF/) });
    expect(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", filename: "evil.html", data: Buffer.from("<script>") })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't supported/) });
    expect(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", filename: "huge.jpg", data: Buffer.concat([JPEG, Buffer.alloc(F.MAX_FILE_BYTES)]) })).toMatchObject({ ok: false, error: expect.stringMatching(/limit is 25 MB/) });
    expect(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", filename: "notes.txt", data: Buffer.from("Gate password: hunter2"), description: "door code: 1234" })).toMatchObject({ ok: false });
    // An iPhone HEIC photo is kept as the original, but marked as not previewable in the browser.
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(100)]);
    expect(ok(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", filename: "IMG_2.HEIC", data: heic }))).toMatchObject({ mimeType: "image/heic", previewable: false });
  });

  it("keeps drawing revisions in one group; the newest is current and the history is kept", () => {
    const owner = ctxFor(N93_OWNER);
    const revA = ok(F.uploadFile(owner, { jobId: "n93_job_media_wall_reigate".replace("media_wall", "mediawall"), category: "drawing", filename: "Plan.pdf", data: PDF, revision: "Rev A" }));
    const revB = ok(F.uploadFile(owner, { jobId: revA.jobId, category: "drawing", filename: "Plan-B.pdf", data: PDF, revision: "Rev B", replacesId: revA.id }));
    expect(revB.groupId).toBe(revA.groupId);
    const group = F.listFiles(owner).filter((f) => f.groupId === revA.groupId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.revision ?? "").localeCompare(a.revision ?? ""));
    expect(group.map((f) => f.revision)).toEqual(["Rev B", "Rev A"]);
    // The site team can add a revision too (invited workers cannot — see below).
    expect(F.uploadFile(ctxFor(N93_STAFF), { jobId: revA.jobId, category: "drawing", filename: "x.pdf", data: PDF, replacesId: revA.id })).toMatchObject({ ok: true });
  });

  it("an assigned worker can upload a photo and see shared files only for jobs they're booked on", () => {
    const sam = ctxFor(SAM);
    const owner = ctxFor(N93_OWNER);
    const office = ok(F.uploadFile(owner, { jobId: "n93_job_extension_copthorne", filename: "internal.pdf", data: PDF, visibility: "office" }));
    const shared = ok(F.uploadFile(owner, { jobId: "n93_job_extension_copthorne", filename: "shared.pdf", data: PDF }));
    const mine = ok(F.uploadFile(sam, { jobId: "n93_job_extension_copthorne", category: "drawing", filename: "skim.jpg", data: JPEG, clientRef: "sam-1" }));
    expect(mine.category).toBe("other"); // workers don't add drawings
    const visible = F.listFiles(sam).map((f) => f.id);
    expect(visible).toContain(shared.id);
    expect(visible).toContain(mine.id);
    expect(visible).not.toContain(office.id);
    expect(F.readFile(sam, office.id, "original")).toBeNull();
    // Not booked on the Crawley kitchen: nothing there, and no upload.
    const other = ok(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", filename: "k.pdf", data: PDF }));
    expect(F.readFile(sam, other.id, "original")).toBeNull();
    expect(F.uploadFile(sam, { jobId: "n93_job_kitchen_crawley", filename: "x.jpg", data: JPEG })).toMatchObject({ ok: false, code: "not_found" });
    // Can delete their own upload, not the office's.
    expect(F.deleteFile(sam, shared.id)).toMatchObject({ ok: false, code: "forbidden" });
    expect(F.deleteFile(sam, mine.id)).toMatchObject({ ok: true });
  });

  it("removing a worker from the booking removes their access to its files", () => {
    const owner = ctxFor(N93_OWNER);
    const sam = ctxFor(SAM);
    const f = ok(F.uploadFile(owner, { jobId: "n93_job_extension_copthorne", filename: "shared.pdf", data: PDF }));
    expect(F.readFile(sam, f.id, "original")).not.toBeNull();
    for (const b of T.listBookings(owner).filter((x) => x.personIds.includes("n93_per_sam"))) {
      ok(T.saveBooking(owner, { id: b.id, jobId: b.jobId, date: b.date, endDate: b.endDate ?? "", allDay: !b.startTime, startTime: b.startTime ?? "", endTime: b.endTime ?? "", personIds: b.personIds.filter((p) => p !== "n93_per_sam"), confirmOverlap: true }));
    }
    expect(F.readFile(sam, f.id, "original")).toBeNull();
    expect(F.listFiles(sam)).toHaveLength(0);
  });

  it("another company can't read, change or delete Ninety3's files", () => {
    const owner = ctxFor(N93_OWNER);
    const rdg = ctxFor(RDG_OWNER);
    const f = ok(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", filename: "k.pdf", data: PDF }));
    expect(F.readFile(rdg, f.id, "original")).toBeNull();
    expect(F.listFiles(rdg).some((x) => x.id === f.id)).toBe(false);
    expect(F.deleteFile(rdg, f.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(F.updateFile(rdg, f.id, { title: "x" })).toMatchObject({ ok: false, code: "not_found" });
    expect(F.uploadFile(rdg, { jobId: "n93_job_kitchen_crawley", filename: "x.pdf", data: PDF })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("enquiry attachments come with the enquiry when it becomes a job", () => {
    const owner = ctxFor(N93_OWNER);
    const e = R.listEnquiries(owner).find((x) => !x.jobId && x.status !== "lost")!;
    const f = ok(F.uploadFile(owner, { enquiryId: e.id, filename: "site.jpg", data: JPEG }));
    const job = ok(R.convertToJob(owner, { enquiryId: e.id }));
    expect(F.listFiles(owner).find((x) => x.id === f.id)).toMatchObject({ jobId: job.id, enquiryId: e.id });
  });
});

describe("Customer handover", () => {
  it("contains exactly the selected originals plus an index — no notes, money or unselected files", () => {
    const owner = ctxFor(N93_OWNER);
    const job = "n93_job_kitchen_crawley";
    R.addJobNote(owner, job, "PRIVATE NOTE: margin is thin");
    const a = ok(F.uploadFile(owner, { jobId: job, category: "completion", filename: "Finished.jpg", data: JPEG, description: "Island done" }));
    const b = ok(F.uploadFile(owner, { jobId: job, category: "completion", filename: "Finished.jpg", data: Buffer.concat([JPEG, Buffer.from("b")]) }));
    const secret = ok(F.uploadFile(owner, { jobId: job, category: "other", filename: "Costing.pdf", data: PDF, visibility: "office" }));
    expect(H.createHandover(owner, { jobId: job, fileIds: [] })).toMatchObject({ ok: false, code: "invalid" });
    const h = ok(H.createHandover(owner, { jobId: job, fileIds: [a.id, b.id], completionDate: "2026-11-18" }));
    const zip = unzip(ok(H.buildHandoverZip(owner, h.id)).data);
    const names = Object.keys(zip).sort();
    expect(names).toEqual(["Completion photos/Finished (2).jpg", "Completion photos/Finished.jpg", "Start here - index.html", "logo.png"].sort());
    expect(zip["Completion photos/Finished.jpg"].equals(JPEG)).toBe(true);
    const index = zip["Start here - index.html"].toString("utf8");
    expect(index).toContain("Kitchen renovation");
    expect(index).toContain("Island done");
    expect(index).toContain("18 November 2026");
    expect(index).not.toContain("PRIVATE NOTE");
    expect(index).not.toContain("Costing");
    expect(index).not.toMatch(/£\s?\d/);
    expect(names.some((n) => n.includes("Costing"))).toBe(false);
    void secret;
  });

  it("is frozen: later uploads don't change it, and deleting an included file keeps its bytes for the handover", () => {
    const owner = ctxFor(N93_OWNER);
    const job = "n93_job_kitchen_crawley";
    const a = ok(F.uploadFile(owner, { jobId: job, category: "completion", filename: "A.jpg", data: JPEG }));
    const h = ok(H.createHandover(owner, { jobId: job, fileIds: [a.id] }));
    ok(F.uploadFile(owner, { jobId: job, category: "completion", filename: "Later.jpg", data: JPEG }));
    expect(ok(F.deleteFile(owner, a.id))).toMatchObject({ keptForHandover: true });
    expect(F.listFiles(owner).some((f) => f.id === a.id)).toBe(false);
    const zip = unzip(ok(H.buildHandoverZip(owner, h.id)).data);
    expect(Object.keys(zip).filter((n) => n.endsWith(".jpg"))).toEqual(["Completion photos/A.jpg"]);
  });

  it("only owners and admins can create or download one", () => {
    const owner = ctxFor(N93_OWNER);
    const a = ok(F.uploadFile(owner, { jobId: "n93_job_kitchen_crawley", category: "completion", filename: "A.jpg", data: JPEG }));
    const h = ok(H.createHandover(ctxFor(N93_OFFICE), { jobId: "n93_job_kitchen_crawley", fileIds: [a.id] }));
    expect(H.createHandover(ctxFor(N93_STAFF), { jobId: "n93_job_kitchen_crawley", fileIds: [a.id] })).toMatchObject({ ok: false });
    expect(H.buildHandoverZip(ctxFor(N93_STAFF), h.id)).toMatchObject({ ok: false, code: "forbidden" });
    expect(H.buildHandoverZip(ctxFor(RDG_OWNER), h.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(H.buildHandoverZip(ctxFor(SAM), h.id)).toMatchObject({ ok: false });
  });

  it("gives duplicate names unique paths", () => {
    expect(H.zipPaths([{ category: "drawing", filename: "plan.pdf" }, { category: "drawing", filename: "PLAN.pdf" }, { category: "other", filename: "plan.pdf" }])).toEqual(["Drawings/plan.pdf", "Drawings/PLAN (2).pdf", "Documents/plan.pdf"]);
  });
});

describe("Leave and availability", () => {
  const mon = () => weekStart(todayKey());

  it("an employee requests leave, a main user approves it, it warns on bookings, and it can be cancelled", () => {
    const owner = ctxFor(N93_OWNER);
    // Give Ellie a login so she can request her own leave.
    const inv = ok(T.createInvite(owner, "n93_per_ellie", "ellie@ninety3.example"));
    const token = inv.path.split("/").pop()!;
    ok(T.acceptInvite(token, { password: "a-good-password" }));
    const ellie = ctxFor("ellie@ninety3.example");
    const start = addDays(mon(), 28);
    const req = ok(A.addAbsence(ellie, { kind: "holiday", startDate: start, endDate: addDays(start, 2), reason: "Hospital appointment" }));
    expect(req.status).toBe("pending");
    // A pending request doesn't block booking; an approved one warns.
    const draft = { jobId: "n93_job_kitchen_crawley", date: addDays(start, 1), allDay: true, personIds: ["n93_per_ellie"] };
    expect(T.saveBooking(owner, { ...draft })).toMatchObject({ ok: true });
    const approved = ok(A.decideAbsence(owner, req.id, "approve"));
    expect(approved.status).toBe("approved");
    expect(approved.affected).toHaveLength(1);
    const clash = T.saveBooking(owner, { ...draft, date: addDays(start, 2) });
    expect(clash).toMatchObject({ ok: false, code: "conflict" });
    expect((clash as { clashes?: { kind: string }[] }).clashes?.[0].kind).toBe("absence");
    expect(T.saveBooking(owner, { ...draft, date: addDays(start, 2), confirmOverlap: true })).toMatchObject({ ok: true });
    // The private reason: requester and managers only.
    expect(A.listAbsences(ctxFor(N93_STAFF)).find((x) => x.id === req.id)?.reason).toBeUndefined();
    expect(A.listAbsences(owner).find((x) => x.id === req.id)?.reason).toBe("Hospital appointment");
    expect(A.myAbsences(ellie).find((x) => x.id === req.id)?.reason).toBe("Hospital appointment");
    // Cancel: the clash goes away.
    ok(A.cancelAbsence(ellie, req.id));
    expect(T.findClashes(owner, { ...draft, date: addDays(start, 2), endDate: undefined, startTime: undefined, endTime: undefined }).filter((c) => c.kind === "absence")).toHaveLength(0);
  });

  it("workers can't approve or touch anyone else's leave; another company can't see it", () => {
    const sam = ctxFor(SAM);
    const owner = ctxFor(N93_OWNER);
    const rec = ok(A.addAbsence(owner, { personId: "n93_per_callum", startDate: addDays(mon(), 30) }));
    expect(rec.status).toBe("approved");
    expect(A.decideAbsence(sam, rec.id, "approve")).toMatchObject({ ok: false, code: "forbidden" });
    expect(A.cancelAbsence(sam, rec.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(A.addAbsence(sam, { personId: "n93_per_callum", startDate: addDays(mon(), 30) })).toMatchObject({ ok: false, code: "forbidden" });
    expect(A.listAbsences(ctxFor(RDG_OWNER)).some((a) => a.id === rec.id)).toBe(false);
    // Subcontractors record availability directly.
    const unav = ok(A.addAbsence(sam, { startDate: addDays(mon(), 31), endDate: addDays(mon(), 32) }));
    expect(unav).toMatchObject({ kind: "unavailable", status: "approved", personId: "n93_per_sam" });
  });

  it("half days only clash with the matching part of the day; ranges are plain dates", () => {
    const am = { startDate: "2026-03-29", endDate: "2026-03-29", part: "am" as const };
    expect(A.absenceOverlapsBooking(am, { date: "2026-03-29", startTime: "08:00", endTime: "12:00" })).toBe(true);
    expect(A.absenceOverlapsBooking(am, { date: "2026-03-29", startTime: "13:00", endTime: "17:00" })).toBe(false);
    expect(A.absenceOverlapsBooking(am, { date: "2026-03-29" })).toBe(true);
    // Across the clock change (29 March 2026) a range keeps its days exactly.
    const range = { startDate: "2026-03-28", endDate: "2026-03-30" };
    expect(A.absenceOverlapsBooking(range, { date: "2026-03-30", startTime: "08:00", endTime: "09:00" })).toBe(true);
    expect(A.absenceOverlapsBooking(range, { date: "2026-03-31" })).toBe(false);
    const owner = ctxFor(N93_OWNER);
    expect(A.addAbsence(owner, { personId: "n93_per_liam", startDate: "2026-03-30", endDate: "2026-03-29" })).toMatchObject({ ok: false, fieldErrors: { endDate: expect.any(String) } });
    expect(A.addAbsence(owner, { personId: "n93_per_liam", startDate: "2026-03-28", endDate: "2026-03-29", part: "am" })).toMatchObject({ ok: false, fieldErrors: { part: expect.any(String) } });
    const saved = ok(A.addAbsence(owner, { personId: "n93_per_liam", startDate: "2026-03-28", endDate: "2026-03-30" }));
    expect(getDb().prepare("SELECT start_date, end_date FROM absences WHERE id = ?").get(saved.id)).toEqual({ start_date: "2026-03-28", end_date: "2026-03-30" });
  });

  it("the self-approval policy can be switched off", () => {
    const owner = ctxFor(N93_OWNER);
    owner.org = { ...owner.org, leavePolicy: { managersSelfApprove: false } };
    // Link Luke to a Team record first.
    const luke = ok(T.createPerson(owner, { name: "Luke", kind: "employee" }));
    getDb().prepare("UPDATE people SET user_id = ? WHERE id = ?").run(owner.userId, luke.id);
    const mine = ok(A.addAbsence(owner, { startDate: addDays(mon(), 40) }));
    expect(mine.status).toBe("pending");
    expect(A.decideAbsence(owner, mine.id, "approve")).toMatchObject({ ok: false, code: "forbidden" });
  });
});
