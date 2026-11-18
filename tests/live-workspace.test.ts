/**
 * A real, private customer workspace provisioned from BOB_WORKSPACES_FILE:
 * starts empty, owner + admin invites (and none until emails are given), both
 * share one diary, nobody reaches another company, subcontractors see only
 * their own work. All emails here are fictional.
 */
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ctxFor, freshDb, N93_OWNER } from "./helpers";
import { getDb } from "@/server/db";
import { provisionWorkspaces } from "@/server/db/provision";
import { contextFromToken, authenticate } from "@/server/auth/session";
import { can } from "@/lib/auth/permissions";
import * as R from "@/server/services/records";
import * as T from "@/server/services/team";
import { listMerchants } from "@/server/services/merchants";
import { buildSnapshot } from "@/server/services/snapshot";
import { addDays } from "@/lib/dates";
import { todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";

const LUKE = "luke@live-test.example";
const RYAN = "ryan@live-test.example";

function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function writeSpec(users: { name: string; role: "owner" | "office"; email?: string }[]) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-ws-")), "workspaces.json");
  fs.writeFileSync(file, JSON.stringify([{
    slug: "live-test", name: "Live Test Carpentry and Build Ltd", shortName: "Live Test", logoUrl: "/brand/ninety3-logo.png",
    timeZone: "Europe/London", contact: { email: "hello@live-test.example" }, users,
  }]));
  return file;
}

const session = (token: string): Ctx => {
  const c = contextFromToken(token);
  if (!c) throw new Error("no session");
  return c;
};

/** Provision with both emails and accept both invites. */
function liveTeam() {
  const r = provisionWorkspaces(getDb(), writeSpec([{ name: "Luke", role: "owner", email: LUKE }, { name: "Ryan", role: "office", email: RYAN }]));
  const link = (email: string) => r.invites.find((i) => i.email === email)!.path.split("/").pop()!;
  const luke = session(ok(T.acceptInvite(link(LUKE), { password: "luke-test-pass" })).token);
  const ryan = session(ok(T.acceptInvite(link(RYAN), { password: "ryan-test-pass" })).token);
  return { r, luke, ryan };
}

beforeEach(() => {
  freshDb();
});

describe("Provisioning a live workspace", () => {
  it("creates an empty, live, UK workspace and waits for emails before issuing invites", () => {
    const r = provisionWorkspaces(getDb(), writeSpec([{ name: "Luke", role: "owner" }, { name: "Ryan", role: "office", email: "" }]));
    expect(r.workspaces).toEqual(["live-test"]);
    expect(r.invites).toHaveLength(0);
    expect(r.waitingForEmail.map((w) => w.name)).toEqual(["Luke", "Ryan"]);
    const org = getDb().prepare("SELECT id, config FROM orgs WHERE slug = 'live-test'").get() as { id: string; config: string };
    const cfg = JSON.parse(org.config);
    expect(cfg).toMatchObject({ name: "Live Test Carpentry and Build Ltd", dataMode: "live", isDemo: false, timeZone: "Europe/London", logoUrl: "/brand/ninety3-logo.png", contact: { email: "hello@live-test.example" } });
    for (const t of ["jobs", "customers", "enquiries", "merchants", "materials", "bills", "invoices", "payments", "quotes", "expenses", "bookings", "tasks"]) {
      expect((getDb().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE org_id = ?`).get(org.id) as { n: number }).n, t).toBe(0);
    }
    // No mailbox or accounting connection: the contact address isn't a login and isn't connected.
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM connections WHERE org_id = ?").get(org.id) as { n: number }).n).toBe(0);
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'hello@live-test.example'").get() as { n: number }).n).toBe(0);
    // Team records exist so Luke and Ryan can be booked.
    expect((getDb().prepare("SELECT name FROM people WHERE org_id = ? ORDER BY name").all(org.id) as { name: string }[]).map((p) => p.name)).toEqual(["Luke", "Ryan"]);
    // The demo is untouched and still separate.
    expect(getDb().prepare("SELECT 1 FROM orgs WHERE slug = 'ninety3'").get()).toBeTruthy();
  });

  it("issues invites once emails are added, keeps unexpired links across restarts, and never duplicates people", () => {
    const db = getDb();
    provisionWorkspaces(db, writeSpec([{ name: "Luke", role: "owner" }, { name: "Ryan", role: "office" }]));
    const second = provisionWorkspaces(db, writeSpec([{ name: "Luke", role: "owner", email: LUKE }, { name: "Ryan", role: "office", email: RYAN }]));
    expect(second.invites.map((i) => [i.name, i.role])).toEqual([["Luke", "owner"], ["Ryan", "office"]]);
    const restart = provisionWorkspaces(db, writeSpec([{ name: "Luke", role: "owner", email: LUKE }, { name: "Ryan", role: "office", email: RYAN }]));
    expect(restart.invites).toHaveLength(0);
    const orgId = (db.prepare("SELECT id FROM orgs WHERE slug = 'live-test'").get() as { id: string }).id;
    expect((db.prepare("SELECT COUNT(*) AS n FROM people WHERE org_id = ?").get(orgId) as { n: number }).n).toBe(2);
    // Only token hashes are stored.
    const tok = second.invites[0].path.split("/").pop()!;
    expect(db.prepare("SELECT 1 FROM invites WHERE token_hash = ?").get(tok)).toBeUndefined();
    // Invite page shows the right role, without an account yet.
    expect(T.inviteInfo(tok)).toMatchObject({ state: "pending", personName: "Luke", owner: true, hasAccount: false });
    expect(T.inviteInfo(second.invites[1].path.split("/").pop()!)).toMatchObject({ personName: "Ryan", role: "office", owner: false });
  });

  it("Luke becomes owner and Ryan admin, linked to their Team records; both sign in to the live workspace", () => {
    const { luke, ryan } = liveTeam();
    expect(luke.role).toBe("owner");
    expect(ryan.role).toBe("office");
    expect(luke.orgId).toBe(ryan.orgId);
    expect(luke.org.slug).toBe("live-test");
    const people = T.listPeople(luke);
    expect(people.find((p) => p.name === "Luke")!.userId).toBe(luke.userId);
    expect(people.find((p) => p.name === "Ryan")!.userId).toBe(ryan.userId);
    const access = T.listAccess(luke);
    expect(access.find((a) => a.personId === people.find((p) => p.name === "Ryan")!.id)).toMatchObject({ state: "accepted", role: "office" });
    // Signing in with a password lands in the same workspace.
    const s = authenticate(RYAN, "ryan-test-pass");
    expect(s.ok && session(s.token).orgId).toBe(luke.orgId);
    // Invites are single use.
    provisionWorkspaces(getDb(), writeSpec([{ name: "Luke", role: "owner", email: LUKE }, { name: "Ryan", role: "office", email: RYAN }]));
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM invites WHERE email IN (?, ?) AND accepted_at IS NULL AND revoked_at IS NULL").get(LUKE, RYAN) as { n: number }).n).toBe(0);
  });
});

describe("Owner (Luke) and Admin (Ryan) capabilities", () => {
  const areas = ["records.read", "finance.read", "jobs.write", "customers.write", "enquiries.write", "tasks.write", "materials.write", "merchants.manage", "schedule.manage", "schedule.read", "team.manage", "payments.record", "invoices.draft"] as const;
  it("both can use every area the brief lists, including scheduling and inviting", () => {
    for (const p of areas) {
      expect(can("owner", p), p).toBe(true);
      expect(can("office", p), p).toBe(true);
    }
  });
  it("differences: only the owner manages Settings, connected accounts and data deletion", () => {
    for (const p of ["settings.manage", "integrations.manage", "data.delete"] as const) {
      expect(can("owner", p)).toBe(true);
      expect(can("office", p)).toBe(false);
    }
  });
  it("Ryan can add and invite a subcontractor, but can't make anyone an admin or remove Luke", () => {
    const { luke, ryan } = liveTeam();
    const sub = ok(T.createPerson(ryan, { name: "Dan Price", kind: "subcontractor", trade: "Electrician", email: "dan@sparks-test.example" }));
    expect(ok(T.createInvite(ryan, sub.id)).role).toBe("worker");
    const temp = ok(T.createPerson(ryan, { name: "Office Temp", kind: "employee", email: "temp@live-test.example" }));
    expect(T.createInvite(ryan, temp.id, undefined, "office")).toMatchObject({ ok: false, code: "forbidden" });
    expect(ok(T.createInvite(luke, temp.id, undefined, "office")).role).toBe("office");
    const lukePerson = T.listPeople(ryan).find((p) => p.name === "Luke")!;
    expect(T.revokeAccess(ryan, lukePerson.id)).toMatchObject({ ok: false });
    const ryanPerson = T.listPeople(ryan).find((p) => p.name === "Ryan")!;
    expect(T.revokeAccess(luke, lukePerson.id)).toMatchObject({ ok: false });
    // The owner can remove an admin login.
    expect(T.revokeAccess(luke, ryanPerson.id).ok).toBe(true);
    expect(getDb().prepare("SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?").get(luke.orgId, ryan.userId)).toBeUndefined();
    expect(getDb().prepare("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?").get(luke.orgId, luke.userId)).toMatchObject({ role: "owner" });
  });
});

describe("One shared diary", () => {
  it("a booking Luke adds, Ryan sees; Ryan's edit, Luke sees", () => {
    const { luke, ryan } = liveTeam();
    const job = ok(R.createJob(luke, { customerName: "Test Customer", title: "Loft boarding", location: "Crawley", quotedValue: 2400, siteAddress: "1 Test Road, Crawley" }));
    const sub = ok(T.createPerson(luke, { name: "Dan Price", kind: "subcontractor", trade: "Electrician" }));
    const day = addDays(todayKey(), 2);
    const b = ok(T.saveBooking(luke, { jobId: job.id, date: day, startTime: "08:00", endTime: "12:00", personIds: [sub.id] }));

    const seen = buildSnapshot(ryan).bookings.find((x) => x.id === b.id)!;
    expect(seen).toMatchObject({ date: day, startTime: "08:00", personIds: [sub.id] });

    const ryanPerson = T.listPeople(ryan).find((p) => p.name === "Ryan")!;
    ok(T.saveBooking(ryan, { id: b.id, jobId: job.id, date: day, startTime: "09:00", endTime: "15:00", personIds: [sub.id, ryanPerson.id] }));
    const after = buildSnapshot(luke).bookings.find((x) => x.id === b.id)!;
    expect(after).toMatchObject({ startTime: "09:00", endTime: "15:00", personIds: [sub.id, ryanPerson.id] });
    // Both appear on the same company calendar.
    expect(buildSnapshot(luke).bookings.map((x) => x.id)).toEqual(buildSnapshot(ryan).bookings.map((x) => x.id));
  });
});

describe("Privacy between companies", () => {
  it("neither Luke nor Ryan can open another company's records, and the demo can't open theirs", () => {
    const { luke, ryan } = liveTeam();
    const demo = ctxFor(N93_OWNER);
    const demoJob = R.listJobs(demo)[0];
    const demoCustomer = R.listCustomers(demo)[0];
    const demoBooking = T.listBookings(demo)[0];
    for (const c of [luke, ryan]) {
      expect(R.listJobs(c)).toHaveLength(0);
      expect(R.listCustomers(c)).toHaveLength(0);
      expect(listMerchants(c)).toHaveLength(0);
      expect(T.listBills(c)).toHaveLength(0);
      expect(R.getJob(c, demoJob.id)).toBeUndefined();
      expect(R.getCustomer(c, demoCustomer.id)).toBeUndefined();
      // Can't book onto, or move, another company's job/booking.
      expect(T.saveBooking(c, { jobId: demoJob.id, date: addDays(todayKey(), 1), allDay: true })).toMatchObject({ ok: false, code: "not_found" });
      expect(T.saveBooking(c, { id: demoBooking.id, jobId: demoJob.id, date: addDays(todayKey(), 1), allDay: true }).ok).toBe(false);
      expect(T.deleteBooking(c, demoBooking.id).ok).toBe(false);
    }
    const liveJob = ok(R.createJob(luke, { customerName: "Private Customer", title: "Private job", location: "Horley", quotedValue: 1800 }));
    expect(R.getJob(demo, liveJob.id)).toBeUndefined();
    expect(R.listCustomers(demo).some((c) => c.name === "Private Customer")).toBe(false);
    // A live login can't be switched into the demo (no membership).
    expect(authenticate(LUKE, "luke-test-pass", demo.orgId)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("Subcontractors only see their own work", () => {
  it("an invited subcontractor sees the job they're booked on and nothing else", () => {
    const { luke, ryan } = liveTeam();
    const mine = ok(R.createJob(luke, { customerName: "Customer A", title: "Garden room", location: "Lingfield", quotedValue: 9000 }));
    const other = ok(R.createJob(luke, { customerName: "Customer B", title: "Kitchen fit", location: "Crawley", quotedValue: 15000 }));
    const sub = ok(T.createPerson(ryan, { name: "Dan Price", kind: "subcontractor", trade: "Electrician", email: "dan@sparks-test.example" }));
    const day = addDays(todayKey(), 1);
    ok(T.saveBooking(ryan, { jobId: mine.id, date: day, startTime: "08:00", endTime: "16:00", personIds: [sub.id] }));
    ok(T.saveBooking(ryan, { jobId: other.id, date: day, startTime: "08:00", endTime: "16:00", personIds: [] }));
    const link = ok(T.createInvite(ryan, sub.id)).path.split("/").pop()!;
    const dan = session(ok(T.acceptInvite(link, { password: "dan-test-pass" })).token);
    expect(dan.role).toBe("worker");
    const work = ok(T.myWork(dan));
    expect(work.bookings.map((b) => b.job.title)).toEqual(["Garden room"]);
    expect(JSON.stringify(work)).not.toContain("Kitchen fit");
    expect(JSON.stringify(work)).not.toContain("9000");
    expect(() => buildSnapshot(dan)).toThrow();
    expect(R.listJobs(dan).length === 0 || !can(dan.role, "records.read")).toBe(true);
    expect(T.listBookings(dan)).toHaveLength(0);
    expect(T.listPeople(dan)).toHaveLength(0);
    expect(T.saveBooking(dan, { jobId: mine.id, date: day, allDay: true }).ok).toBe(false);
  });
});

describe("Replacing a lost link", () => {
  it('"newLink": true cancels the unused link and prints a new one', () => {
    const db = getDb();
    const first = provisionWorkspaces(db, writeSpec([{ name: "Luke", role: "owner", email: LUKE }]));
    const old = first.invites[0].path.split("/").pop()!;
    const again = provisionWorkspaces(db, writeSpec([{ name: "Luke", role: "owner", email: LUKE, newLink: true } as never]));
    expect(again.invites).toHaveLength(1);
    expect(T.inviteInfo(old).state).toBe("revoked");
    expect(T.inviteInfo(again.invites[0].path.split("/").pop()!).state).toBe("pending");
  });
});
