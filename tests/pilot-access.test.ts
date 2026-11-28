/**
 * Ninety3 live pilot: invitations (by email, with honest delivery status),
 * existing crew profiles, revoking access, what a subcontractor can and can't
 * reach, and backup/restore of records and files. Fictional people and emails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { freshDb } from "./helpers";
import { getDb } from "@/server/db";
import { provisionWorkspaces } from "@/server/db/provision";
import { backupTo, storageStatus, verifyBackup } from "@/server/db/backup";
import { contextFromToken } from "@/server/auth/session";
import { recipientAllowed } from "@/server/mail";
import * as R from "@/server/services/records";
import * as T from "@/server/services/team";
import * as F from "@/server/services/files";
import * as Inv from "@/server/services/invites";
import * as U from "@/server/services/updates";
import { buildSnapshot } from "@/server/services/snapshot";
import { handleTurn } from "@/server/bob/conversation";
import { addDays } from "@/lib/dates";
import { todayKey } from "@/lib/utils";
import type { Ctx } from "@/server/context";

const ORIGIN = "https://bob.test";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 9)]);

function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const session = (token: string): Ctx => {
  const c = contextFromToken(token);
  if (!c) throw new Error("no session");
  return c;
};
const tokenOf = (p: string) => p.split("/").pop()!;

function liveTeam() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-ws-")), "workspaces.json");
  fs.writeFileSync(file, JSON.stringify([{ slug: "pilot-test", name: "Pilot Test Carpentry", shortName: "Pilot Test", users: [{ name: "Luke", role: "owner", email: "luke@pilot-test.example" }, { name: "Ryan", role: "office", email: "ryan@pilot-test.example" }] }]));
  const r = provisionWorkspaces(getDb(), file);
  const link = (email: string) => tokenOf(r.invites.find((i) => i.email === email)!.path);
  const luke = session(ok(T.acceptInvite(link("luke@pilot-test.example"), { password: "luke-test-pass" })).token);
  const ryan = session(ok(T.acceptInvite(link("ryan@pilot-test.example"), { password: "ryan-test-pass" })).token);
  return { luke, ryan };
}

/** A stand-in for the email provider's HTTP API. */
function fakeMail(status = 200) {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push(body);
    return new Response(JSON.stringify(status === 200 ? { id: `msg_${sent.length}` } : { message: "Domain not verified" }), { status });
  }));
  return sent;
}

beforeEach(() => {
  freshDb();
  process.env.BOB_MAIL_TRANSPORT = "resend";
  process.env.RESEND_API_KEY = "test-key";
  process.env.BOB_MAIL_FROM = "Bob <invites@bob.test>";
  delete process.env.BOB_MAIL_ALLOWED_RECIPIENTS;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BOB_MAIL_TRANSPORT;
  delete process.env.RESEND_API_KEY;
  delete process.env.BOB_MAIL_FROM;
  delete process.env.BOB_MAIL_ALLOWED_RECIPIENTS;
});

describe("Invite someone", () => {
  it("invites an existing crew member from their profile, keeps their bookings, and emails an invite naming the business and the inviter", async () => {
    const { luke, ryan } = liveTeam();
    const sent = fakeMail();
    const job = ok(R.createJob(luke, { customerName: "Customer A", title: "Oak Road kitchen", location: "Copthorne", quotedValue: 18000 }));
    const sam = ok(T.createPerson(ryan, { name: "Sam Test", kind: "subcontractor", trade: "Plasterer" }));
    const friday = addDays(todayKey(), 3);
    const booking = ok(T.saveBooking(ryan, { jobId: job.id, date: friday, startTime: "08:00", endTime: "16:00", personIds: [sam.id] }));

    const inv = ok(await Inv.inviteSomeone(luke, { personId: sam.id, name: "Sam Test", email: "Sam@Sam-Test.example", kind: "subcontractor", origin: ORIGIN }));
    expect(inv).toMatchObject({ personId: sam.id, createdPerson: false, emailStatus: "sent", email: "sam@sam-test.example", role: "worker" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Luke has invited you to Pilot Test Carpentry on Bob");
    expect(sent[0].text).toContain(`${ORIGIN}${inv.path}`);
    // The stored copy never holds the link (it's a credential).
    const stored = getDb().prepare("SELECT body, status FROM outbox WHERE ref_id = ?").get(inv.inviteId) as { body: string; status: string };
    expect(stored.status).toBe("sent");
    expect(stored.body).not.toContain(tokenOf(inv.path));
    expect(T.listAccess(luke).find((a) => a.personId === sam.id)).toMatchObject({ state: "pending", invitedBy: "Luke", emailStatus: "sent" });

    // Same email typed again for a new name → their existing profile, not a duplicate.
    const again = ok(await Inv.inviteSomeone(ryan, { name: "Samuel", email: "sam@sam-test.example", kind: "subcontractor", origin: ORIGIN }));
    expect(again).toMatchObject({ personId: sam.id, createdPerson: false });
    expect(T.inviteInfo(tokenOf(inv.path)).state).toBe("revoked"); // the older link stopped working
    expect(T.listPeople(luke).filter((p) => p.name.startsWith("Sam"))).toHaveLength(1);

    // They accept on their phone: My work shows the Friday booking that was already theirs.
    const samCtx = session(ok(T.acceptInvite(tokenOf(again.path), { password: "sam-test-pass" })).token);
    expect(samCtx.role).toBe("worker");
    const work = ok(T.myWork(samCtx));
    expect(work.bookings.map((b) => ({ id: b.id, date: b.date }))).toEqual([{ id: booking.id, date: friday }]);
    expect(T.listAccess(luke).find((a) => a.personId === sam.id)?.state).toBe("accepted");
    // A used link can't be used again.
    expect(T.acceptInvite(tokenOf(again.path), { password: "sam-test-pass" })).toMatchObject({ ok: false, error: expect.stringMatching(/already been used/) });
  });

  it("adds a new subcontractor and invites them in one step; refuses an email that belongs to someone else", async () => {
    const { luke } = liveTeam();
    fakeMail();
    const a = ok(await Inv.inviteSomeone(luke, { name: "Dan Spark", email: "dan@spark-test.example", kind: "subcontractor", origin: ORIGIN }));
    expect(a.createdPerson).toBe(true);
    expect(T.listPeople(luke).find((p) => p.id === a.personId)).toMatchObject({ name: "Dan Spark", kind: "subcontractor", email: "dan@spark-test.example" });
    const other = ok(T.createPerson(luke, { name: "Priya Pipe", kind: "subcontractor" }));
    expect(await Inv.inviteSomeone(luke, { personId: other.id, name: "Priya Pipe", email: "dan@spark-test.example", origin: ORIGIN })).toMatchObject({ ok: false, code: "conflict" });
    expect(await Inv.inviteSomeone(luke, { name: "No Email", email: "nope", origin: ORIGIN })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("a failed email is recorded as failed (never as sent), and Resend issues a fresh link that works while the old one doesn't", async () => {
    const { luke } = liveTeam();
    fakeMail(422);
    const first = ok(await Inv.inviteSomeone(luke, { name: "Mia Test", email: "mia@mia-test.example", kind: "subcontractor", origin: ORIGIN }));
    expect(first).toMatchObject({ emailStatus: "failed", emailError: expect.stringMatching(/refused it \(422: Domain not verified\)/) });
    expect(T.listAccess(luke).find((a) => a.personId === first.personId)).toMatchObject({ state: "pending", emailStatus: "failed" });
    const sent = fakeMail(200);
    const retry = ok(await Inv.resendInvite(luke, { personId: first.personId, origin: ORIGIN }));
    expect(retry.emailStatus).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(T.inviteInfo(tokenOf(first.path)).state).toBe("revoked");
    expect(T.inviteInfo(tokenOf(retry.path)).state).toBe("pending");
  });

  it("an unreachable email service is a failure with a retry; no email setup means the link is shared by hand", async () => {
    const { luke } = liveTeam();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const a = ok(await Inv.inviteSomeone(luke, { name: "Net Down", email: "net@down-test.example", kind: "employee", origin: ORIGIN }));
    expect(a).toMatchObject({ emailStatus: "failed", emailError: expect.stringMatching(/Couldn't reach/) });
    delete process.env.BOB_MAIL_TRANSPORT;
    const b = ok(await Inv.resendInvite(luke, { personId: a.personId, origin: ORIGIN }));
    expect(b).toMatchObject({ emailStatus: "not_configured" });
    expect(b.path).toMatch(/^\/invite\//);
  });

  it("test-recipient list: anything else is refused and recorded as failed", async () => {
    const { luke } = liveTeam();
    const sent = fakeMail();
    process.env.BOB_MAIL_ALLOWED_RECIPIENTS = "@pilot-test.example, tester@elsewhere.example";
    expect(recipientAllowed("someone@pilot-test.example")).toBe(true);
    expect(recipientAllowed("tester@elsewhere.example")).toBe(true);
    expect(recipientAllowed("real.person@gmail.com")).toBe(false);
    const a = ok(await Inv.inviteSomeone(luke, { name: "Real Person", email: "real.person@gmail.com", kind: "subcontractor", origin: ORIGIN }));
    expect(a).toMatchObject({ emailStatus: "failed", emailError: expect.stringMatching(/only emails its test recipients/) });
    expect(sent).toHaveLength(0);
  });

  it("the sample demo workspace never sends email", async () => {
    freshDb();
    const sent = fakeMail();
    const { ctxFor, N93_OWNER } = await import("./helpers");
    const owner = ctxFor(N93_OWNER);
    const a = ok(await Inv.inviteSomeone(owner, { name: "Demo Person", email: "demo.person@example.com", kind: "subcontractor", origin: ORIGIN }));
    expect(a.emailStatus).toBe("not_configured");
    expect(sent).toHaveLength(0);
  });

  it("an expired link is refused with a clear message", async () => {
    const { luke } = liveTeam();
    fakeMail();
    const a = ok(await Inv.inviteSomeone(luke, { name: "Late Test", email: "late@late-test.example", kind: "subcontractor", origin: ORIGIN }));
    getDb().prepare("UPDATE invites SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), a.inviteId);
    expect(T.inviteInfo(tokenOf(a.path)).state).toBe("expired");
    expect(T.acceptInvite(tokenOf(a.path), { password: "late-test-pass" })).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(T.listAccess(luke).find((x) => x.personId === a.personId)?.state).toBe("expired");
  });

  it("someone who already has a Bob login (e.g. from another business) accepts with their own password — no second account", async () => {
    const { luke } = liveTeam();
    fakeMail();
    // site@ninety3.example already has a login (the demo's site team, password "bob-demo").
    const inv = ok(await Inv.inviteSomeone(luke, { name: "Site Person", email: "site@ninety3.example", kind: "employee", origin: ORIGIN }));
    expect(T.inviteInfo(tokenOf(inv.path))).toMatchObject({ state: "pending", hasAccount: true });
    const usersBefore = (getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    expect(T.acceptInvite(tokenOf(inv.path), { password: "not-their-password" })).toMatchObject({ ok: false, error: expect.stringMatching(/password for site@ninety3.example/) });
    const joined = session(ok(T.acceptInvite(tokenOf(inv.path), { password: "bob-demo" })).token);
    expect(joined).toMatchObject({ role: "worker", org: { slug: "pilot-test" } });
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(usersBefore);
  });
});

describe("A subcontractor's view, and removing access", () => {
  it("sees only their booked job's shared details; the booking move shows; another subcontractor can't open the job or its files; revoking ends their session", async () => {
    const { luke, ryan } = liveTeam();
    fakeMail();
    const oak = ok(R.createJob(luke, { customerName: "Customer A", title: "Oak Road kitchen", location: "Copthorne", quotedValue: 18000, siteAddress: "12 Oak Road, Copthorne" }));
    ok(R.updateJob(luke, oak.id, { sharedNotes: "Dust sheets down in the hall.", accessNote: "Side gate." }));
    ok(R.addJobNote(luke, oak.id, "PRIVATE: margin is tight, price the oak at cost"));
    const other = ok(R.createJob(luke, { customerName: "Customer B", title: "Garden room", location: "Lingfield", quotedValue: 9000 }));
    const sam = ok(T.createPerson(ryan, { name: "Sam Test", kind: "subcontractor" }));
    const dan = ok(T.createPerson(ryan, { name: "Dan Test", kind: "subcontractor" }));
    const day = addDays(todayKey(), 2);
    const b = ok(T.saveBooking(ryan, { jobId: oak.id, date: day, startTime: "08:00", endTime: "16:00", personIds: [sam.id] }));
    ok(T.saveBooking(ryan, { jobId: other.id, date: day, startTime: "08:00", endTime: "16:00", personIds: [dan.id] }));
    const office = ok(F.uploadFile(luke, { jobId: oak.id, filename: "costing.pdf", data: Buffer.from("%PDF-1.4\n%%EOF\n", "latin1"), visibility: "office" }));
    const shared = ok(F.uploadFile(luke, { jobId: oak.id, filename: "drawing.jpg", data: JPEG, category: "drawing" }));

    const samInv = ok(await Inv.inviteSomeone(luke, { personId: sam.id, email: "sam@sam-test.example", origin: ORIGIN }));
    const samToken = ok(T.acceptInvite(tokenOf(samInv.path), { password: "sam-test-pass" })).token;
    const samCtx = session(samToken);
    const danInv = ok(await Inv.inviteSomeone(luke, { personId: dan.id, email: "dan@dan-test.example", origin: ORIGIN }));
    const danCtx = session(ok(T.acceptInvite(tokenOf(danInv.path), { password: "dan-test-pass" })).token);

    const work = ok(T.myWork(samCtx));
    expect(work.bookings[0]).toMatchObject({ startTime: "08:00", job: { title: "Oak Road kitchen", siteAddress: "12 Oak Road, Copthorne", instructions: "Dust sheets down in the hall.", accessNote: "Side gate." } });
    const json = JSON.stringify(work);
    expect(json).not.toMatch(/18000|PRIVATE|margin|Garden room/);
    expect(F.listFiles(samCtx).map((f) => f.filename)).toEqual(["drawing.jpg"]);
    expect(F.readFile(samCtx, office.id, "original")).toBeNull();
    expect(F.readFile(samCtx, shared.id, "original")).not.toBeNull();
    expect(() => buildSnapshot(samCtx)).toThrow();

    // Ryan moves the booking: Sam sees the new time.
    ok(T.saveBooking(ryan, { id: b.id, jobId: oak.id, date: day, startTime: "10:30", endTime: "15:00", personIds: [sam.id] }));
    expect(ok(T.myWork(samCtx)).bookings[0]).toMatchObject({ startTime: "10:30", endTime: "15:00" });

    // Dan can't reach Oak Road: not in My work, not its files, not its updates.
    expect(JSON.stringify(ok(T.myWork(danCtx)))).not.toContain("Oak Road");
    expect(F.readFile(danCtx, shared.id, "original")).toBeNull();
    expect(F.listFiles(danCtx).some((f) => f.jobId === oak.id)).toBe(false);
    expect(U.listUpdates(danCtx).some((u) => u.jobId === oak.id)).toBe(false);
    expect(F.uploadFile(danCtx, { jobId: oak.id, filename: "x.jpg", data: JPEG })).toMatchObject({ ok: false });

    // Ask Bob is not available to subcontractors at all (it reads company records).
    await expect(handleTurn(samCtx, { text: "What's the price of the Oak Road kitchen?", via: "text" })).rejects.toThrow();

    // Removing access: the existing session stops working immediately; bookings stay.
    ok(T.revokeAccess(luke, sam.id));
    expect(contextFromToken(samToken)).toBeNull();
    expect(T.listBookings(luke).find((x) => x.id === b.id)?.personIds).toEqual([sam.id]);
    expect(T.listAccess(luke).find((a) => a.personId === sam.id)?.state).toBe("revoked");
  });
});

describe("Storage and backups", () => {
  it("a live workspace without declared persistent storage is flagged; declaring it clears the flag", () => {
    liveTeam();
    const saved = { p: process.env.BOB_PERSISTENT_STORAGE, d: process.env.BOB_DB_PATH };
    try {
      delete process.env.BOB_PERSISTENT_STORAGE;
      expect(storageStatus()).toMatchObject({ liveWorkspaces: 1, persistent: false, atRisk: true });
      process.env.BOB_PERSISTENT_STORAGE = "true";
      process.env.BOB_DB_PATH ??= "/var/data/bob.sqlite";
      expect(storageStatus()).toMatchObject({ persistent: true, atRisk: false });
    } finally {
      if (saved.p === undefined) delete process.env.BOB_PERSISTENT_STORAGE;
      else process.env.BOB_PERSISTENT_STORAGE = saved.p;
      if (saved.d === undefined) delete process.env.BOB_DB_PATH;
      else process.env.BOB_DB_PATH = saved.d;
    }
  });

  it("a backup holds every record and every file's bytes, and a restored copy opens with the same data (tested restore)", () => {
    const { luke } = liveTeam();
    const job = ok(R.createJob(luke, { customerName: "Backup Customer", title: "Wardrobes", location: "Crawley", quotedValue: 4200 }));
    const f = ok(F.uploadFile(luke, { jobId: job.id, filename: "site.jpg", data: JPEG }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bob-backup-"));
    const backup = backupTo(path.join(dir, "bob.sqlite"));
    expect(backup).toMatchObject({ integrity: "ok" });
    expect(backup.files).toBeGreaterThan(0);

    // Restore = put the backup file where the database lives, then open it.
    const restoredPath = path.join(dir, "restored.sqlite");
    fs.copyFileSync(backup.path, restoredPath);
    expect(verifyBackup(restoredPath).integrity).toBe("ok");
    const db = new DatabaseSync(restoredPath, { readOnly: true });
    const row = db.prepare("SELECT title FROM jobs WHERE id = ?").get(job.id) as { title: string };
    const blob = db.prepare("SELECT data FROM file_blobs WHERE file_id = ? AND kind = 'original'").get(f.id) as { data: Uint8Array };
    const users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%pilot-test.example'").get() as { n: number };
    db.close();
    expect(row.title).toBe("Wardrobes");
    expect(Buffer.from(blob.data).equals(JPEG)).toBe(true);
    expect(Number(users.n)).toBe(2);
  });
});
