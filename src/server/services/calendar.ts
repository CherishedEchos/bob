import "server-only";
/**
 * Calendar subscription feeds (iCalendar / .ics), one way: Bob → calendar.
 *
 *  - company feed: every booking (owners/office/site team with schedule.read);
 *  - person feed: only the bookings of the Team record linked to the user.
 * Links carry a random token (only its hash is stored), can be revoked, and
 * are re-checked on every fetch: if the user leaves the business, loses the
 * role, or their Team record is archived/unlinked, the feed stops working.
 * Feeds never include customer contact details, site access notes, entry
 * codes, instructions or private notes — just the job, town/site, times and
 * who's on it. Each booking keeps a stable UID so moves update the same event.
 */
import type { Booking, CalendarFeed, Job, Person } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { addDays, rangeKeys } from "@/lib/dates";
import type { Role } from "@/lib/types";
import { uid } from "@/lib/utils";
import { getDb, scoped } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { randomToken, sha256 } from "@/server/auth/password";
import { audit } from "./records";

const now = () => new Date().toISOString();

interface FeedRow {
  id: string;
  org_id: string;
  user_id: string;
  scope: "company" | "person";
  person_id: string | null;
  token_hash: string;
  created_at: string;
  revoked_at: string | null;
  last_fetched_at: string | null;
}

function myPersonId(ctx: Ctx): string | undefined {
  return scoped(ctx).list<Person>("people", { where: "user_id = ? AND archived_at IS NULL", params: [ctx.userId] })[0]?.id;
}

export function listMyFeeds(ctx: Ctx): CalendarFeed[] {
  const rows = getDb().prepare("SELECT * FROM calendar_feeds WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL ORDER BY created_at").all(ctx.orgId, ctx.userId) as unknown as FeedRow[];
  return rows.map((r) => ({ id: r.id, scope: r.scope, personId: r.person_id ?? undefined, createdAt: r.created_at, lastFetchedAt: r.last_fetched_at ?? undefined }));
}

/** Create (or replace) the user's feed of a scope. The link is returned once. */
export function createFeed(ctx: Ctx, scope: "company" | "person"): Result<{ id: string; path: string }> {
  if (scope === "company") {
    const no = denied(ctx, "schedule.read");
    if (no) return no;
  }
  const personId = scope === "person" ? myPersonId(ctx) : undefined;
  if (scope === "person" && !personId) return fail("invalid", "Your login isn't linked to a Team record yet, so there are no bookings of your own to show.");
  const token = randomToken();
  const id = uid("feed");
  const db = getDb();
  db.prepare("UPDATE calendar_feeds SET revoked_at = ? WHERE org_id = ? AND user_id = ? AND scope = ? AND revoked_at IS NULL").run(now(), ctx.orgId, ctx.userId, scope);
  db.prepare("INSERT INTO calendar_feeds (id, org_id, user_id, scope, person_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, ctx.orgId, ctx.userId, scope, personId ?? null, sha256(token), now());
  audit(ctx, "calendar.feed_created", `${scope === "company" ? "Company" : "Personal"} calendar link created`);
  return ok({ id, path: `/api/calendar/${token}.ics` });
}

export function revokeFeed(ctx: Ctx, id: string): Result<true> {
  const r = getDb().prepare("UPDATE calendar_feeds SET revoked_at = ? WHERE id = ? AND org_id = ? AND user_id = ? AND revoked_at IS NULL").run(now(), id, ctx.orgId, ctx.userId);
  if (Number(r.changes) !== 1) return fail("not_found", "Calendar link not found");
  audit(ctx, "calendar.feed_revoked", "Calendar link turned off");
  return ok(true);
}

/** Owners can switch off everyone's links for a person (e.g. when removing access). */
export function revokeFeedsForUser(orgId: string, userId: string) {
  getDb().prepare("UPDATE calendar_feeds SET revoked_at = ? WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL").run(now(), orgId, userId);
}

/* --------------------------------- Feed output --------------------------------- */

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
};
const ymd = (key: string) => key.replace(/-/g, "");
const hms = (t: string) => `${t.replace(":", "")}00`;
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");

/** Europe/London rules, so calendars show the right local time either side of the clock change. */
const VTIMEZONE_LONDON = [
  "BEGIN:VTIMEZONE", "TZID:Europe/London",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:BST", "DTSTART:19700329T010000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

export function buildIcs(opts: { calendarName: string; tz: string; bookings: Booking[]; jobs: Map<string, Job>; people: Map<string, Person>; host: string }): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cresaro//Bob//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(opts.calendarName)}`, `X-WR-TIMEZONE:${opts.tz}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  if (opts.tz === "Europe/London") lines.push(...VTIMEZONE_LONDON);
  for (const b of opts.bookings) {
    const j = opts.jobs.get(b.jobId);
    if (!j) continue;
    const who = b.personIds.map((id) => opts.people.get(id)?.name).filter(Boolean) as string[];
    const summary = `${j.title} · ${j.location}`;
    // Site address only — no customer contact details, access notes, codes or private notes.
    const location = j.siteAddress || j.location;
    const description = `${who.length ? `On it: ${who.join(", ")}` : "Unassigned"}\nOpen Bob for site details and instructions.`;
    const seq = Math.floor(new Date(b.updatedAt).getTime() / 1000) % 2_000_000_000;
    const common = [`SUMMARY:${esc(summary)}`, `LOCATION:${esc(location)}`, `DESCRIPTION:${esc(description)}`, `DTSTAMP:${stamp(b.updatedAt)}`, `LAST-MODIFIED:${stamp(b.updatedAt)}`, `SEQUENCE:${seq}`, "TRANSP:OPAQUE"];
    if (!b.startTime || !b.endTime) {
      // All day (inclusive end date → exclusive DTEND).
      lines.push("BEGIN:VEVENT", `UID:${b.id}@${opts.host}`, `DTSTART;VALUE=DATE:${ymd(b.date)}`, `DTEND;VALUE=DATE:${ymd(addDays(b.endDate ?? b.date, 1))}`, ...common, "END:VEVENT");
    } else {
      // Timed: one event per day (same hours each day), each with its own stable UID.
      const days = rangeKeys(b.date, b.endDate ?? b.date);
      for (const d of days) {
        const uidPart = days.length > 1 ? `${b.id}-${ymd(d)}` : b.id;
        lines.push("BEGIN:VEVENT", `UID:${uidPart}@${opts.host}`, `DTSTART;TZID=${opts.tz}:${ymd(d)}T${hms(b.startTime)}`, `DTEND;TZID=${opts.tz}:${ymd(d)}T${hms(b.endTime)}`, ...common, "END:VEVENT");
      }
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Resolve a feed token into the events it may show right now. Returns null if
 * the link is unknown, revoked, or its owner no longer has access.
 */
export function feedFor(token: string, host: string): { ics: string; name: string } | null {
  if (!token || token.length < 20 || token.length > 200) return null;
  const db = getDb();
  const r = db.prepare("SELECT * FROM calendar_feeds WHERE token_hash = ?").get(sha256(token)) as FeedRow | undefined;
  if (!r || r.revoked_at) return null;
  const m = db.prepare("SELECT m.role, o.config FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.org_id = ? AND m.user_id = ?").get(r.org_id, r.user_id) as { role: Role; config: string } | undefined;
  if (!m) return null; // left the business or access removed
  const org = JSON.parse(m.config) as { name: string; shortName: string; timeZone?: string };
  const sc = scoped({ orgId: r.org_id });
  const jobs = new Map(sc.list<Job>("jobs").map((j) => [j.id, j]));
  const people = new Map(sc.list<Person>("people").map((p) => [p.id, p]));
  const from = addDays(new Date().toISOString().slice(0, 10), -30);
  let bookings = sc.list<Booking>("bookings", { where: "COALESCE(end_date, date) >= ?", params: [from], order: "date" });
  let name = `${org.shortName} — Bob diary`;
  if (r.scope === "company") {
    if (!can(m.role, "schedule.read")) return null;
  } else {
    const person = r.person_id ? people.get(r.person_id) : undefined;
    if (!person || person.archivedAt || person.userId !== r.user_id) return null; // unlinked or archived
    bookings = bookings.filter((b) => b.personIds.includes(person.id));
    name = `${org.shortName} — ${person.name.split(" ")[0]}'s work`;
  }
  db.prepare("UPDATE calendar_feeds SET last_fetched_at = ? WHERE id = ?").run(now(), r.id);
  return { ics: buildIcs({ calendarName: name, tz: org.timeZone ?? "Europe/London", bookings, jobs, people, host }), name };
}
