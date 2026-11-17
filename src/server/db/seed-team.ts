/**
 * FICTIONAL SAMPLE DATA — the team, the week's schedule, job materials and
 * bills to pay. Every name, phone number (Ofcom drama range) and email
 * (reserved example domains) is invented.
 *
 * The week is laid out relative to the current week in the workspace's time
 * zone, so the demo always shows a believable "this week".
 */
import type { DatabaseSync } from "node:sqlite";
import type { Bill, Booking, Job, Material, Person, Task } from "@/lib/types";
import { DEFAULT_TIME_ZONE, addDays, dateKeyIn, weekStart } from "@/lib/dates";
import { hashPassword, randomToken, sha256 } from "@/server/auth/password";
import type { TableName } from "./index";

type InsertFn = (db: DatabaseSync, table: TableName, orgId: string, obj: { id: string }) => void;

interface TeamCast {
  key: string;
  domain: string;
  people: { key: string; name: string; kind: Person["kind"]; trade: string; company?: string; email?: string }[];
  /** The fictional subcontractor who has accepted an invite (demo login for My work). */
  workerLogin?: { personKey: string; email: string };
  /** Someone invited but not yet accepted. */
  pendingInvite?: { personKey: string };
  sites: Record<string, { siteAddress: string; what3words?: string; sharedNotes?: string }>;
}

export const TEAM_CASTS: Record<string, TeamCast> = {
  org_ninety3: {
    key: "n93",
    domain: "ninety3.example",
    people: [
      { key: "liam", name: "Liam Carter", kind: "employee", trade: "Lead carpenter" },
      { key: "callum", name: "Callum Price", kind: "employee", trade: "Carpenter" },
      { key: "ellie", name: "Ellie Ward", kind: "employee", trade: "Apprentice joiner" },
      { key: "sam", name: "Sam Okoro", kind: "subcontractor", trade: "Plasterer", company: "SO Plastering", email: "sam@so-plastering.example" },
      { key: "mark", name: "Mark Davies", kind: "subcontractor", trade: "Electrician", company: "Davies Electrical", email: "mark@davies-electrical.example" },
      { key: "priya", name: "Priya Nair", kind: "subcontractor", trade: "Plumber", company: "Nair Plumbing & Heating" },
    ],
    workerLogin: { personKey: "sam", email: "sam@so-plastering.example" },
    pendingInvite: { personKey: "mark" },
    sites: {
      kitchen_copthorne: { siteAddress: "12 Mill Lane, Copthorne, RH10 3HQ", what3words: "lifted.copper.marble", sharedNotes: "Park on the drive, not the lane. Side gate code 4471. Dust sheets down in the hallway every day." },
      extension_copthorne: { siteAddress: "Orchard House, Brookside, Copthorne, RH10 3JN", what3words: "ladder.frost.silent", sharedNotes: "Skip is on the front drive. Toilet in the garage. No work before 8am — neighbours." },
      kitchen_crawley: { siteAddress: "41 Ifield Avenue, Crawley, RH11 7AY", what3words: "rapid.pocket.sunset", sharedNotes: "Customer works from home in the front room — keep noise down 10–11am for calls." },
      loft_eg: { siteAddress: "4 Orchard Rise, East Grinstead, RH19 3PL" },
      wardrobes_horsham: { siteAddress: "9 Denne Road, Horsham, RH12 1JE", sharedNotes: "Paint finish: customer choosing colour — check before spraying." },
      mediawall_reigate: { siteAddress: "18 Somers Road, Reigate, RH2 9DU", what3words: "velvet.anchor.timber", sharedNotes: "TV is 65 inch. Socket heights marked on the wall in pencil." },
      stairs_horley: { siteAddress: "27 Station Road, Horley, RH6 9HL", sharedNotes: "Squeaky third tread from the bottom." },
    },
  },
  org_ridgeway_demo: {
    key: "rdg",
    domain: "ridgeway.example",
    people: [
      { key: "liam", name: "Tom Hale", kind: "employee", trade: "Site manager" },
      { key: "callum", name: "Jack Moss", kind: "employee", trade: "Carpenter" },
      { key: "ellie", name: "Amira Khan", kind: "employee", trade: "Apprentice" },
      { key: "sam", name: "Dan Price", kind: "subcontractor", trade: "Plasterer", company: "Price Plastering", email: "dan@price-plastering.example" },
      { key: "mark", name: "Lee Wright", kind: "subcontractor", trade: "Electrician", company: "Wright Electrics", email: "lee@wright-electrics.example" },
      { key: "priya", name: "Hannah Cole", kind: "subcontractor", trade: "Plumber", company: "Cole Heating" },
    ],
    workerLogin: { personKey: "sam", email: "dan@price-plastering.example" },
    pendingInvite: { personKey: "mark" },
    sites: {
      kitchen_copthorne: { siteAddress: "3 Church Road, Copthorne, RH10 3RA", what3words: "orange.window.brick", sharedNotes: "Side gate is unlocked during working hours." },
      extension_copthorne: { siteAddress: "The Willows, Copthorne Bank, RH10 3QX", sharedNotes: "Skip on the drive." },
      kitchen_crawley: { siteAddress: "22 Gossops Drive, Crawley, RH11 8LD" },
      loft_eg: { siteAddress: "15 Lewes Road, East Grinstead, RH19 3TA" },
      wardrobes_horsham: { siteAddress: "6 Kings Road, Horsham, RH13 5PP" },
      mediawall_reigate: { siteAddress: "40 Croydon Road, Reigate, RH2 0NH" },
      stairs_horley: { siteAddress: "11 Victoria Road, Horley, RH6 7PZ" },
    },
  },
};

const DEMO_PASSWORD = process.env.BOB_DEMO_PASSWORD || "bob-demo";

export function buildTeamScenario(orgId: string, timeZone = DEFAULT_TIME_ZONE) {
  const cast = TEAM_CASTS[orgId];
  if (!cast) return null;
  const k = cast.key;
  const now = new Date().toISOString();
  const today = dateKeyIn(timeZone);
  const mon = weekStart(today);
  const day = (offset: number) => addDays(mon, offset);
  const job = (key: string) => `${k}_job_${key}`;
  const pid = (key: string) => `${k}_per_${key}`;
  let phoneN = 700;
  const people: Person[] = cast.people.map((p) => ({
    id: pid(p.key),
    name: p.name,
    kind: p.kind,
    trade: p.trade,
    company: p.company,
    email: p.email ?? `${p.name.split(" ")[0].toLowerCase()}@${cast.domain}`,
    phone: `07700 900${String(phoneN++ % 1000).padStart(3, "0")}`,
    createdAt: now,
  }));

  const b = (key: string, jobKey: string, start: number, end: number | null, times: [string, string] | null, who: string[], notes?: string): Booking => ({
    id: `${k}_bk_${key}`,
    jobId: job(jobKey),
    date: day(start),
    endDate: end !== null && end !== start ? day(end) : undefined,
    startTime: times?.[0],
    endTime: times?.[1],
    personIds: who.map(pid),
    notes,
    createdAt: now,
    updatedAt: now,
    createdBy: "Owner",
  });
  // A believable week: two kitchens on the go, the extension, snagging, and next week's media wall.
  const bookings: Booking[] = [
    b("sophie_fit", "kitchen_copthorne", 0, 2, ["08:00", "16:30"], ["liam", "callum"], "Fit wall units and plinths. Worktops arrive Wednesday."),
    b("sophie_tops", "kitchen_copthorne", 3, null, ["08:00", "13:00"], ["liam"], "Worktops in. Template for the sink cut-out is in the van."),
    b("fletcher_elec", "extension_copthorne", 2, null, ["09:00", "13:00"], ["mark"], "Electrical first fix — kitchen-diner circuits."),
    b("fletcher_frame", "extension_copthorne", 3, 4, ["07:30", "16:00"], ["callum", "ellie"], "Stud walls and roof lantern trim."),
    b("fletcher_plaster", "extension_copthorne", 4, null, ["08:00", "17:00"], ["sam"], "Skim the new stud walls once boarded."),
    b("patel_island", "kitchen_crawley", 3, 4, ["08:30", "16:30"], ["liam"], "Island seating and end panels."),
    b("patel_templating", "kitchen_crawley", 2, null, ["11:00", "12:00"], [], "Worktop templating visit — needs someone to meet the templater."),
    b("patel_plumb", "kitchen_crawley", 4, null, ["10:00", "14:00"], ["priya"], "Connect sink, dishwasher and island tap."),
    b("smith_snag", "stairs_horley", 1, null, ["13:00", "15:00"], ["ellie"], "Fix the squeaky tread."),
    b("nadia_wall", "mediawall_reigate", 7, 8, null, ["callum"], "Build the media wall frame and shelves."),
  ];

  const m = (key: string, jobKey: string, item: string, quantity: string, status: Material["status"], neededBy: number | null, supplier?: string): Material => ({
    id: `${k}_mat_${key}`,
    jobId: job(jobKey),
    item,
    quantity,
    supplier,
    neededBy: neededBy === null ? undefined : day(neededBy),
    status,
    createdAt: now,
    updatedAt: now,
  });
  const materials: Material[] = [
    m("oak_tops", "kitchen_copthorne", "Solid oak worktops, 3m", "3", "ordered", 2, "Crawley Timber Supplies"),
    m("plinth", "kitchen_copthorne", "Plinth clips", "1 box", "on_site", null),
    m("board", "extension_copthorne", "Plasterboard 12.5mm, 2.4 x 1.2m", "40 sheets", "to_order", 3, "Sussex Builders Merchants"),
    m("lantern", "extension_copthorne", "Roof lantern trim kit", "1", "on_site", null),
    m("multifinish", "extension_copthorne", "Multi-finish plaster, 25kg", "12 bags", "to_order", 4, "Sussex Builders Merchants"),
    m("offcuts", "kitchen_crawley", "Quartz worktop offcuts for island seating", "2", "to_order", 3, "Stone & Surface Ltd"),
    m("tap", "kitchen_crawley", "Island mixer tap", "1", "ordered", 4),
    m("mdf", "mediawall_reigate", "MDF sheets 18mm", "10", "to_order", 6, "Crawley Timber Supplies"),
    m("led", "mediawall_reigate", "LED shelf strip lighting", "4 m", "to_order", 7),
  ];

  const bill = (key: string, supplier: string, description: string, amount: number, due: number, status: Bill["status"], jobKey?: string, reference?: string): Bill => ({
    id: `${k}_bill_${key}`,
    supplier,
    description,
    amount,
    dueDate: addDays(today, due),
    status,
    jobId: jobKey ? job(jobKey) : undefined,
    reference,
    paidAt: status === "paid" ? now : undefined,
    createdAt: now,
  });
  const bills: Bill[] = [
    bill("timber", "Crawley Timber Supplies", "Oak worktops and battens", 1840, 3, "due", "kitchen_copthorne", "CTS-20931"),
    bill("davies", cast.people.find((p) => p.key === "mark")?.company ?? "Electrician", "Electrical first fix — extension", 960, -2, "due", "extension_copthorne", "INV-0412"),
    bill("merchant", "Sussex Builders Merchants", "Blocks, timber and roof lantern", 2140, 12, "due", "extension_copthorne", "SBM-55810"),
    bill("skip", "Sussex Skip Hire", "8-yard skip swap", 320, -6, "paid", "extension_copthorne", "SK-3391"),
  ];

  const tasks: Task[] = [
    { id: `${k}_task_paint`, title: "Get paint colour samples to the Horsham wardrobes customer", dueDate: day(2), done: false, relatedType: "job", relatedId: job("wardrobes_horsham"), assignedPersonId: pid("ellie"), createdAt: now, createdBy: "Owner" },
    { id: `${k}_task_beads`, title: "Check angle beads are on site before skimming", dueDate: day(3), done: false, relatedType: "job", relatedId: job("extension_copthorne"), assignedPersonId: pid("sam"), createdAt: now, createdBy: "Owner" },
  ];

  return { cast, people, bookings, materials, bills, tasks, sites: cast.sites, jobId: job, personId: pid };
}

/** Insert the team scenario for one org (fresh seed, reset, or upgrade of an older sample DB). */
export function seedTeam(db: DatabaseSync, insert: InsertFn, orgId: string, timeZone?: string) {
  const s = buildTeamScenario(orgId, timeZone);
  if (!s) return;
  for (const p of s.people) insert(db, "people", orgId, p);
  for (const bk of s.bookings) insert(db, "bookings", orgId, bk);
  for (const m of s.materials) insert(db, "materials", orgId, m);
  for (const bl of s.bills) insert(db, "bills", orgId, bl);
  for (const t of s.tasks) {
    const exists = db.prepare("SELECT 1 FROM tasks WHERE org_id = ? AND id = ?").get(orgId, t.id);
    if (!exists) insert(db, "tasks", orgId, t);
  }
  for (const [jobKey, site] of Object.entries(s.sites)) {
    db.prepare("UPDATE jobs SET site_address = ?, what3words = ?, shared_notes = ? WHERE org_id = ? AND id = ?").run(
      site.siteAddress,
      site.what3words ?? null,
      site.sharedNotes ?? null,
      orgId,
      s.jobId(jobKey),
    );
  }
  const now = new Date().toISOString();
  // The subcontractor who already accepted their invite: a real (fictional) login.
  if (s.cast.workerLogin) {
    const person = s.people.find((p) => p.id === s.personId(s.cast.workerLogin!.personKey))!;
    const userId = `usr_${s.cast.key}_worker`;
    db.prepare("INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, s.cast.workerLogin.email, person.name, hashPassword(DEMO_PASSWORD), now);
    db.prepare("INSERT OR IGNORE INTO memberships (org_id, user_id, role) VALUES (?, ?, 'worker')").run(orgId, userId);
    db.prepare("UPDATE people SET user_id = ? WHERE org_id = ? AND id = ?").run(userId, orgId, person.id);
    db.prepare("INSERT INTO invites (id, org_id, person_id, email, role, token_hash, created_by, created_at, expires_at, accepted_at, accepted_user_id) VALUES (?, ?, ?, ?, 'worker', ?, 'Owner', ?, ?, ?, ?)").run(
      `${s.cast.key}_inv_accepted`, orgId, person.id, s.cast.workerLogin.email, sha256(randomToken()), now, new Date(Date.now() + 7 * 864e5).toISOString(), now, userId,
    );
  }
  // An invite that's been sent but not accepted (its link is not known to anyone).
  if (s.cast.pendingInvite) {
    const person = s.people.find((p) => p.id === s.personId(s.cast.pendingInvite!.personKey))!;
    db.prepare("INSERT INTO invites (id, org_id, person_id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, 'worker', ?, 'Owner', ?, ?)").run(
      `${s.cast.key}_inv_pending`, orgId, person.id, person.email ?? `${person.id}@example.com`, sha256(randomToken()), now, new Date(Date.now() + 7 * 864e5).toISOString(),
    );
  }
}

/** Sample workspaces created before the team/schedule existed get it once. Live workspaces are never touched. */
export function upgradeSampleData(db: DatabaseSync, insert: InsertFn) {
  const orgs = db.prepare("SELECT id, config FROM orgs").all() as { id: string; config: string }[];
  for (const o of orgs) {
    const config = JSON.parse(o.config) as { dataMode?: string; timeZone?: string };
    if (config.dataMode !== "sample" || !TEAM_CASTS[o.id]) continue;
    const has = db.prepare("SELECT COUNT(*) AS n FROM people WHERE org_id = ?").get(o.id) as { n: number };
    if (has.n > 0) continue;
    const jobs = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE org_id = ?").get(o.id) as { n: number };
    if (jobs.n === 0) continue;
    db.exec("BEGIN");
    try {
      seedTeam(db, insert, o.id, config.timeZone);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export type { Job };
