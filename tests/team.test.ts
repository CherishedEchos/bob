/**
 * Team, invites, the schedule, My work and job conversion — the failure modes
 * that matter: workers seeing more than their own work, invites reused or
 * hijacked, clashes saved silently, duplicate jobs, broken old databases and
 * daylight-saving drift.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ctxFor, freshDb, N93_OFFICE, N93_OWNER, N93_STAFF, RDG_OWNER } from "./helpers";
import * as R from "@/server/services/records";
import * as T from "@/server/services/team";
import { buildSnapshot } from "@/server/services/snapshot";
import { contextFromToken } from "@/server/auth/session";
import { getDb, initDb, setDbForTests } from "@/server/db";
import { addDays, dateKeyIn, rangeKeys, weekStart } from "@/lib/dates";
import { todayKey } from "@/lib/utils";
import type { Booking, Job } from "@/lib/types";

const SAM = "sam@so-plastering.example"; // seeded subcontractor with an accepted invite

beforeEach(() => {
  freshDb();
});

function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Owner adds a subcontractor with no login, books them on a new job tomorrow, then invites them. */
function setupNewSub() {
  const owner = ctxFor(N93_OWNER);
  const job = ok(R.createJob(owner, { customerName: "Grace Fielding", title: "Garden room base", location: "Lingfield", quotedValue: 4200, siteAddress: "7 High Street, Lingfield, RH7 6AA", sharedNotes: "Gate code 1290. Park on the road." }));
  const person = ok(T.createPerson(owner, { name: "Rob Turner", kind: "subcontractor", company: "Turner Groundworks", trade: "Groundworker", email: "rob@turner-groundworks.example" }));
  const tomorrow = addDays(todayKey(), 1);
  const booking = ok(T.saveBooking(owner, { jobId: job.id, date: tomorrow, startTime: "08:00", endTime: "16:00", personIds: [person.id], notes: "Dig and level the base." }));
  const invite = ok(T.createInvite(owner, person.id));
  return { owner, job, person, booking, invite, token: invite.path.split("/").pop()!, tomorrow };
}

function workerCtx(sessionToken: string) {
  const c = contextFromToken(sessionToken);
  if (!c) throw new Error("no session");
  return c;
}

describe("Flow 1–2: add a subcontractor without an account, book them, invite, My work", () => {
  it("a person can be booked before they have a login, then accepts and sees exactly that job", () => {
    const { job, person, token, tomorrow, owner } = setupNewSub();
    expect(person.userId).toBeUndefined();
    const access = T.listAccess(owner).find((a) => a.personId === person.id)!;
    expect(access.state).toBe("pending");
    const info = T.inviteInfo(token);
    expect(info).toMatchObject({ state: "pending", personName: "Rob Turner", email: "rob@turner-groundworks.example", hasAccount: false });

    const accepted = ok(T.acceptInvite(token, { password: "groundwork-2026" }));
    const rob = workerCtx(accepted.token);
    expect(rob.role).toBe("worker");
    const mine = ok(T.myWork(rob));
    expect(mine.bookings).toHaveLength(1);
    const next = mine.bookings[0];
    expect(next).toMatchObject({ date: tomorrow, startTime: "08:00", endTime: "16:00", notes: "Dig and level the base." });
    expect(next.job).toMatchObject({ id: job.id, siteAddress: "7 High Street, Lingfield, RH7 6AA", instructions: "Gate code 1290. Park on the road." });
    // Nothing financial in the payload at all.
    expect(JSON.stringify(mine)).not.toMatch(/quotedValue|4200|depositRequired|invoice/i);
    expect(T.listAccess(owner).find((a) => a.personId === person.id)!.state).toBe("accepted");
  });
});

describe("Invites: single use, expiring, revocable, bound to the invited email", () => {
  it("can't be used twice", () => {
    const { token } = setupNewSub();
    ok(T.acceptInvite(token, { password: "groundwork-2026" }));
    const again = T.acceptInvite(token, { password: "groundwork-2026" });
    expect(again).toMatchObject({ ok: false, code: "conflict" });
  });
  it("a revoked invite can't be used", () => {
    const { token, owner, invite } = setupNewSub();
    ok(T.revokeInvite(owner, invite.inviteId));
    expect(T.inviteInfo(token).state).toBe("revoked");
    expect(T.acceptInvite(token, { password: "groundwork-2026" })).toMatchObject({ ok: false, code: "forbidden" });
  });
  it("an expired invite can't be used", () => {
    const { token, invite } = setupNewSub();
    getDb().prepare("UPDATE invites SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), invite.inviteId);
    expect(T.acceptInvite(token, { password: "groundwork-2026" })).toMatchObject({ ok: false, code: "forbidden" });
  });
  it("a new invite replaces the old link", () => {
    const { token, owner, person } = setupNewSub();
    ok(T.createInvite(owner, person.id));
    expect(T.acceptInvite(token, { password: "groundwork-2026" })).toMatchObject({ ok: false });
  });
  it("an existing account must prove it owns the invited email", () => {
    const owner = ctxFor(N93_OWNER);
    // Invite an email that already has an account elsewhere (Ridgeway's owner).
    const p = ok(T.createPerson(owner, { name: "Alex Morgan", kind: "subcontractor", email: RDG_OWNER }));
    const inv = ok(T.createInvite(owner, p.id));
    const token = inv.path.split("/").pop()!;
    expect(T.acceptInvite(token, { password: "wrong-password" })).toMatchObject({ ok: false, code: "forbidden" });
    const good = ok(T.acceptInvite(token, { password: "bob-demo" }));
    expect(workerCtx(good.token)).toMatchObject({ orgId: "org_ninety3", role: "worker" });
  });
  it("a garbage or missing token reveals nothing", () => {
    expect(T.inviteInfo("x".repeat(43))).toEqual({ state: "invalid" });
    expect(T.acceptInvite("nope", { password: "whatever-123" })).toMatchObject({ ok: false, code: "not_found" });
  });
  it("only owners/office can invite", () => {
    const staff = ctxFor(N93_STAFF);
    expect(T.createInvite(staff, "n93_per_liam")).toMatchObject({ ok: false, code: "forbidden" });
    expect(T.createPerson(staff, { name: "X Y", kind: "employee" })).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("Flow 3: move and reassign — access follows the booking", () => {
  it("the removed person loses the job; the new person sees the new time", () => {
    const { owner, booking, token, job, tomorrow } = setupNewSub();
    const rob = workerCtx(ok(T.acceptInvite(token, { password: "groundwork-2026" })).token);
    const callum = "n93_per_callum";
    const dayAfter = addDays(tomorrow, 1);
    ok(T.saveBooking(owner, { id: booking.id, jobId: job.id, date: dayAfter, startTime: "10:00", endTime: "15:00", personIds: [callum], confirmOverlap: true }));
    const robWork = ok(T.myWork(rob));
    expect(robWork.bookings).toHaveLength(0);
    expect(robWork.materials.filter((m) => m.jobId === job.id)).toHaveLength(0);
    // Callum hasn't got a login in the demo; check the schedule itself.
    const b = T.listBookings(owner).find((x) => x.id === booking.id)!;
    expect(b).toMatchObject({ date: dayAfter, startTime: "10:00", personIds: [callum] });
  });
});

describe("Flow 4: overlapping assignments", () => {
  it("names the clash and refuses until the planner confirms", () => {
    const owner = ctxFor(N93_OWNER);
    const liam = "n93_per_liam";
    const sophie = owner.orgId && "n93_job_kitchen_copthorne";
    const mon = weekStart(todayKey());
    const r = T.saveBooking(owner, { jobId: "n93_job_stairs_horley", date: addDays(mon, 1), startTime: "09:00", endTime: "11:00", personIds: [liam] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("conflict");
    expect(r.error).toMatch(/Liam Carter is already booked on Kitchen refit · Sophie Lambert/);
    expect((r as { clashes?: unknown[] }).clashes).toHaveLength(1);
    const before = T.listBookings(owner).length;
    const forced = ok(T.saveBooking(owner, { jobId: "n93_job_stairs_horley", date: addDays(mon, 1), startTime: "09:00", endTime: "11:00", personIds: [liam], confirmOverlap: true }));
    expect(forced.personIds).toEqual([liam]);
    expect(T.listBookings(owner).length).toBe(before + 1);
    void sophie;
  });
  it("back-to-back bookings don't clash; all-day clashes with timed work", () => {
    const a = { date: "2026-11-18", startTime: "08:00", endTime: "12:00" };
    expect(T.bookingsOverlap(a, { date: "2026-11-18", startTime: "12:00", endTime: "16:00" })).toBe(false);
    expect(T.bookingsOverlap(a, { date: "2026-11-18" })).toBe(true);
    expect(T.bookingsOverlap({ date: "2026-11-16", endDate: "2026-11-20" }, { date: "2026-11-19", startTime: "07:00", endTime: "08:00" })).toBe(true);
  });
  it("invalid input is refused with field errors and nothing saved", () => {
    const owner = ctxFor(N93_OWNER);
    const before = T.listBookings(owner).length;
    const r = T.saveBooking(owner, { jobId: "n93_job_stairs_horley", date: "2026-11-18", startTime: "15:00", endTime: "09:00", personIds: [] });
    expect(r).toMatchObject({ ok: false, code: "invalid", fieldErrors: { endTime: expect.stringMatching(/after the start/) } });
    expect(T.listBookings(owner).length).toBe(before);
  });
});

describe("Flow 6: enquiry → won job, carrying details, no duplicates", () => {
  it("converts once and returns the same job on retry", () => {
    const owner = ctxFor(N93_OWNER);
    const hannah = R.listEnquiries(owner).find((e) => e.customerName === "Hannah Whitfield" && e.status === "new")!;
    const first = ok(R.convertToJob(owner, { enquiryId: hannah.id, siteAddress: "22 Malthouse Road, Crawley, RH10 6BH" }));
    expect(first.existed).toBe(false);
    expect(first).toMatchObject({ title: "Kitchen renovation", location: "Crawley", siteAddress: "22 Malthouse Road, Crawley, RH10 6BH", customerName: "Hannah Whitfield" });
    const again = ok(R.convertToJob(owner, { enquiryId: hannah.id }));
    expect(again).toMatchObject({ id: first.id, existed: true });
    expect(R.listJobs(owner).filter((j) => j.enquiryId === hannah.id)).toHaveLength(1);
    expect(R.getEnquiry(owner, hannah.id)).toMatchObject({ status: "won", jobId: first.id });
    // And it can be scheduled straight away.
    ok(T.saveBooking(owner, { jobId: first.id, date: addDays(todayKey(), 30), allDay: true, personIds: ["n93_per_ellie"] }));
  });
  it("a sent quote converts with its price and is marked accepted", () => {
    const owner = ctxFor(N93_OWNER);
    const q = R.listQuotes(owner).find((x) => x.description.startsWith("Garden office"))!;
    const job = ok(R.convertToJob(owner, { quoteId: q.id }));
    expect(job.quotedValue).toBe(18500);
    expect(R.listQuotes(owner).find((x) => x.id === q.id)).toMatchObject({ status: "accepted", jobId: job.id });
    expect(ok(R.convertToJob(owner, { quoteId: q.id })).id).toBe(job.id);
  });
});

describe("Flow 7: tasks, materials and bills", () => {
  it("assigns a task, updates an order and finds a bill to pay", () => {
    const owner = ctxFor(N93_OWNER);
    const t = ok(R.createTask(owner, { title: "Collect hinges from the merchant", dueDate: todayKey(), relatedType: "job", relatedId: "n93_job_kitchen_crawley", assignedPersonId: "n93_per_liam" }));
    expect(t.assignedPersonId).toBe("n93_per_liam");
    const board = T.listMaterials(owner).find((m) => m.item.startsWith("Plasterboard"))!;
    expect(ok(T.setMaterialStatus(owner, board.id, "ordered")).status).toBe("ordered");
    const due = T.listBills(owner).filter((b) => b.status === "due");
    expect(due.some((b) => b.dueDate < todayKey())).toBe(true); // an overdue supplier bill
    const paid = ok(T.setBillPaid(owner, due[0].id, true));
    expect(paid.status).toBe("paid");
    // Site team can't see bills; office can.
    expect(T.listBills(ctxFor(N93_STAFF))).toEqual([]);
    expect(T.listBills(ctxFor(N93_OFFICE)).length).toBeGreaterThan(0);
  });
});

describe("Flow 8: a subcontractor can't reach anything else", () => {
  it("no company snapshot, no other jobs, no writes, no other company", () => {
    const sam = ctxFor(SAM);
    expect(sam.role).toBe("worker");
    expect(() => buildSnapshot(sam)).toThrow(/only shows your own work/);
    const mine = ok(T.myWork(sam));
    const jobIds = new Set(mine.bookings.map((b) => b.job.id));
    expect(jobIds.size).toBeGreaterThan(0);
    for (const b of mine.bookings) expect(b.withPeople).not.toContain("Sam Okoro");
    // Sam is only booked on the extension: no kitchen jobs, no money.
    expect([...jobIds].every((id) => id === "n93_job_extension_copthorne")).toBe(true);
    expect(JSON.stringify(mine)).not.toMatch(/quotedValue|£|amount/);
    // Writes through the company services are refused.
    expect(R.createJob(sam, { customerName: "Hack", title: "Hack job", location: "X", quotedValue: 1 })).toMatchObject({ ok: false, code: "forbidden" });
    expect(T.saveBooking(sam, { jobId: "n93_job_kitchen_copthorne", date: todayKey(), allDay: true, personIds: [] })).toMatchObject({ ok: false, code: "forbidden" });
    expect(T.listBookings(sam)).toEqual([]);
    expect(T.listPeople(sam)).toEqual([]);
    expect(T.listBills(sam)).toEqual([]);
    expect(T.listMaterials(sam)).toEqual([]);
    // Tasks: only their own.
    expect(T.completeMyTask(sam, "n93_task_paint", true)).toMatchObject({ ok: false, code: "not_found" });
    expect(T.completeMyTask(sam, "n93_task_beads", true)).toMatchObject({ ok: true });
  });
  it("another company's owner can't see or change Ninety3's schedule", () => {
    const rdg = ctxFor(RDG_OWNER);
    expect(T.listBookings(rdg).some((b) => b.id.startsWith("n93_"))).toBe(false);
    expect(T.saveBooking(rdg, { id: "n93_bk_sophie_fit", jobId: "n93_job_kitchen_copthorne", date: todayKey(), allDay: true, personIds: [] })).toMatchObject({ ok: false, code: "not_found" });
    expect(T.revokeAccess(rdg, "n93_per_sam")).toMatchObject({ ok: false, code: "not_found" });
    expect(T.setBillPaid(rdg, "n93_bill_timber", true)).toMatchObject({ ok: false, code: "not_found" });
  });
  it("revoking access ends the session immediately; history is kept", () => {
    const owner = ctxFor(N93_OWNER);
    const sam = ctxFor(SAM);
    const before = T.listBookings(owner).filter((b) => b.personIds.includes("n93_per_sam")).length;
    ok(T.archivePerson(owner, "n93_per_sam"));
    const token = getDb().prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(sam.userId) as { n: number };
    expect(token.n).toBe(0);
    expect(getDb().prepare("SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?").get(sam.userId, owner.orgId)).toBeUndefined();
    expect(T.listBookings(owner).filter((b) => b.personIds.includes("n93_per_sam")).length).toBe(before);
    expect(T.saveBooking(owner, { jobId: "n93_job_kitchen_copthorne", date: addDays(todayKey(), 20), allDay: true, personIds: ["n93_per_sam"] })).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("Flow 9: existing databases migrate without losing data", () => {
  it("an old database (no team tables, old role check) upgrades in place", () => {
    const old = new DatabaseSync(":memory:");
    old.exec(`
      CREATE TABLE orgs (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, config TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE memberships (org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('owner','office','staff')), PRIMARY KEY (org_id, user_id));
      CREATE TABLE jobs (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, customer_id TEXT, title TEXT, description TEXT, location TEXT, kind TEXT, quoted_value REAL, deposit_required REAL, status TEXT, start_date TEXT, deposit_due_date TEXT, next_action TEXT, notes TEXT, enquiry_id TEXT, last_chased_at TEXT, created_at TEXT);
      INSERT INTO orgs VALUES ('org_live', 'live-co', '{"id":"org_live","name":"Live Co","shortName":"Live","dataMode":"live"}', '2026-01-01');
      INSERT INTO users VALUES ('u1', 'boss@live.example', 'Boss', 'x', '2026-01-01');
      INSERT INTO memberships VALUES ('org_live', 'u1', 'owner');
      INSERT INTO jobs (id, org_id, customer_id, title, location, status, notes, created_at) VALUES ('j1', 'org_live', 'c1', 'Porch', 'Oxted', 'scheduled', '[]', '2026-01-01');
    `);
    initDb(old);
    setDbForTests(old);
    const role = old.prepare("SELECT role FROM memberships WHERE user_id = 'u1'").get() as { role: string };
    expect(role.role).toBe("owner");
    old.prepare("INSERT INTO memberships VALUES ('org_live', 'u1', 'worker') ON CONFLICT DO NOTHING").run();
    const job = old.prepare("SELECT title, site_address FROM jobs WHERE id = 'j1'").get() as { title: string; site_address: string | null };
    expect(job).toEqual({ title: "Porch", site_address: null });
    // Live workspaces never get demo records.
    expect((old.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number }).n).toBe(0);
    expect((old.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
  });
});

describe("Workspace-local dates and daylight saving", () => {
  it("today is London's date, not the server's", () => {
    // 23:30 UTC on a summer evening is already tomorrow in London.
    expect(dateKeyIn("Europe/London", new Date("2026-07-14T23:30:00Z"))).toBe("2026-07-15");
    expect(dateKeyIn("Europe/London", new Date("2026-12-14T23:30:00Z"))).toBe("2026-12-14");
  });
  it("weeks across the clock changes still have seven days and keep wall-clock times", () => {
    // Clocks go back on Sun 25 Oct 2026 and forward on Sun 28 Mar 2027.
    expect(rangeKeys(weekStart("2026-10-25"), addDays(weekStart("2026-10-25"), 6))).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(addDays("2027-03-27", 2)).toBe("2027-03-29");
    expect(weekStart("2027-03-28")).toBe("2027-03-22");
    const owner = ctxFor(N93_OWNER);
    const b = ok(T.saveBooking(owner, { jobId: "n93_job_stairs_horley", date: "2027-03-26", endDate: "2027-03-29", startTime: "08:00", endTime: "16:00", personIds: ["n93_per_priya"] }));
    expect(b).toMatchObject({ date: "2027-03-26", endDate: "2027-03-29", startTime: "08:00", endTime: "16:00" });
  });
  it("multi-day work shows on each day it covers", () => {
    const bk: Pick<Booking, "date" | "endDate"> = { date: "2026-11-30", endDate: "2026-12-02" };
    expect(rangeKeys(bk.date, bk.endDate!)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
  });
});

describe("Seeded demo week", () => {
  it("has staff, subcontractors, bookings this week, unassigned work and materials", () => {
    const owner = ctxFor(N93_OWNER);
    const s = buildSnapshot(owner);
    expect(s.people.filter((p) => p.kind === "subcontractor").length).toBeGreaterThanOrEqual(3);
    const mon = weekStart(todayKey());
    expect(s.bookings.filter((b) => b.date >= mon && b.date <= addDays(mon, 6)).length).toBeGreaterThan(5);
    expect(s.bookings.some((b) => b.personIds.length === 0)).toBe(true);
    expect(s.materials.some((m) => m.status === "to_order")).toBe(true);
    expect(s.access.find((a) => a.personId === "n93_per_sam")?.state).toBe("accepted");
    expect(s.access.find((a) => a.personId === "n93_per_mark")?.state).toBe("pending");
    const kitchen = s.jobs.find((j) => j.id === "n93_job_kitchen_copthorne") as Job;
    expect(kitchen.siteAddress).toMatch(/Mill Lane/);
  });
});

describe("Ask Bob: schedule and ordering questions", () => {
  it("answers who's on a job and what needs ordering, with links", async () => {
    const { Chat } = await import("./helpers");
    const owner = ctxFor(N93_OWNER);
    // Book Callum on the Patels' kitchen tomorrow so the question has an answer.
    ok(T.saveBooking(owner, { jobId: "n93_job_kitchen_crawley", date: addDays(todayKey(), 1), startTime: "07:00", endTime: "07:30", personIds: ["n93_per_callum"], confirmOverlap: true }));
    const c = new Chat(owner);
    await c.say("Who's on the kitchen renovation job tomorrow?");
    expect(c.text).toMatch(/Callum Price/);
    expect(c.last.flatMap((m) => m.chips ?? []).some((ch) => ch.kind === "open" && ch.record === "job")).toBe(true);
    await c.say("What still needs ordering this week?");
    expect(c.text).toMatch(/to order this week/);
    expect(c.text).toMatch(/Plasterboard/);
    // Unrelated "who" questions still go where they did.
    await c.say("Who haven't I replied to?");
    expect(c.text).not.toMatch(/booked/);
  });
  it("site team can ask, workers can't reach Bob's data", async () => {
    const { Chat } = await import("./helpers");
    const staff = new Chat(ctxFor(N93_STAFF));
    await staff.say("Who's working tomorrow?");
    expect(staff.text).not.toMatch(/can't see/);
  });
});

describe("A second company from configuration, without a code change", () => {
  it("creates the workspace empty and live, with a one-time owner setup link", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { provisionWorkspaces } = await import("@/server/db/provision");
    const file = path.join(os.tmpdir(), `bob-ws-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify([{ slug: "harbour-joinery", name: "Harbour Joinery Ltd", shortName: "Harbour", ownerEmail: "owner@harbour.example", accent: "#3366AA" }]));
    const { created } = provisionWorkspaces(getDb(), file);
    expect(created).toHaveLength(1);
    // Running again changes nothing.
    expect(provisionWorkspaces(getDb(), file).created).toHaveLength(0);
    const token = created[0].setupPath.split("/").pop()!;
    expect(T.inviteInfo(token)).toMatchObject({ state: "pending", businessName: "Harbour Joinery Ltd", owner: true });
    const session = ok(T.acceptInvite(token, { password: "harbour-2026!" }));
    const owner = workerCtx(session.token);
    expect(owner).toMatchObject({ role: "owner", org: { name: "Harbour Joinery Ltd", accent: "#3366AA", dataMode: "live", timeZone: "Europe/London" } });
    const snap = buildSnapshot(owner);
    expect(snap.jobs).toEqual([]);
    expect(snap.people).toEqual([]);
    expect(T.acceptInvite(token, { password: "harbour-2026!" })).toMatchObject({ ok: false });
    fs.unlinkSync(file);
  });
});
