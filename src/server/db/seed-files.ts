/**
 * FICTIONAL SAMPLE FILES AND LEAVE for the demo workspaces.
 *
 * The "photos" are simple generated pictures (no real homes or people) and
 * the "drawings" are generated PDFs, so the demo can show thumbnails, the
 * viewer, drawing revisions and a customer handover without shipping any
 * real customer material.
 */
import type { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import type { Absence, FileCategory, Handover, JobFile } from "@/lib/types";
import { DEFAULT_TIME_ZONE, addDays, dateKeyIn, weekStart } from "@/lib/dates";
import { crc32 } from "@/server/zip";
import type { TableName } from "./index";

type InsertFn = (db: DatabaseSync, table: TableName, orgId: string, obj: { id: string }) => void;

/* ------------------------------ Tiny PNG encoder ------------------------------ */

type RGB = [number, number, number];

function png(width: number, height: number, pixel: (x: number, y: number) => RGB): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A simple room scene: wall, floor, units/boards, a window. Variation by `v`. */
function roomPicture(v: number, w: number, h: number): Buffer {
  const walls: RGB[] = [[226, 220, 208], [214, 222, 226], [232, 226, 214], [205, 199, 190]];
  const units: RGB[] = [[62, 84, 96], [186, 148, 102], [238, 236, 230], [122, 92, 64]];
  const wall = walls[v % 4];
  const unit = units[(v + 1) % 4];
  const floor: RGB = v % 2 ? [150, 112, 78] : [176, 170, 160];
  const horizon = Math.round(h * 0.62);
  let seed = 1234 + v * 77;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 10;
  return png(w, h, (x, y) => {
    let c: RGB;
    if (y > horizon) {
      const plank = Math.floor((x + (Math.floor((y - horizon) / 18) % 2) * 60) / 120) % 2;
      c = mix(floor, [floor[0] - 20, floor[1] - 18, floor[2] - 14], plank ? 0.35 : 0);
    } else {
      c = mix(wall, [wall[0] - 30, wall[1] - 30, wall[2] - 30], y / horizon);
      // window
      if (x > w * 0.6 && x < w * 0.85 && y > h * 0.12 && y < h * 0.38) c = mix([180, 210, 235], [240, 248, 255], (y - h * 0.12) / (h * 0.26));
      if ((Math.abs(x - w * 0.725) < 3 && y > h * 0.12 && y < h * 0.38) || ((Math.abs(y - h * 0.25) < 3) && x > w * 0.6 && x < w * 0.85)) c = [250, 250, 250];
      // wall units / stud work
      if (v % 3 === 2) {
        if (x % 90 < 10 && y > h * 0.08) c = [190, 160, 112];
      } else if (x > w * 0.08 && x < w * 0.5 && y > h * 0.1 && y < h * 0.3) c = mix(unit, [unit[0] + 20, unit[1] + 20, unit[2] + 20], (x % 110) < 4 ? 1 : 0);
    }
    // base units and worktop
    if (y > h * 0.42 && y < horizon + 30 && x < w * 0.92 && v % 3 !== 2) {
      c = y < h * 0.45 ? [80, 72, 66] : mix(unit, [0, 0, 0], (x % 140) < 4 ? 0.5 : 0);
    }
    const n = noise();
    return [clamp(c[0] + n), clamp(c[1] + n), clamp(c[2] + n)];
  });
}

/* ------------------------------ Tiny PDF drawing ------------------------------ */

function pdfDrawing(title: string, revision: string, siteLine: string, variant: number): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const ops: string[] = ["0.15 0.15 0.15 RG", "1.6 w"];
  // A4 landscape 842 x 595. Border + title block.
  ops.push("20 20 802 555 re S", "0.8 w", "560 20 262 110 re S", "560 75 m 822 75 l S", "560 100 m 822 100 l S");
  // Floor plan
  ops.push("2.4 w", "80 170 420 330 re S");
  ops.push(variant ? "80 360 m 300 360 l S 300 360 m 300 500 l S" : "80 340 m 260 340 l S 260 340 m 260 500 l S");
  ops.push("300 170 m 300 300 l S", "1 w", "0.7 0.3 0.1 RG", variant ? "320 190 160 40 re S 320 190 m 480 230 l S" : "320 190 120 40 re S");
  ops.push("0.15 0.15 0.15 RG", "0.6 w", "80 150 m 500 150 l S", "80 146 m 80 154 l S", "500 146 m 500 154 l S", "530 170 m 530 500 l S", "526 170 m 534 170 l S", "526 500 m 534 500 l S");
  // Window and door arcs (approximated)
  ops.push("1.2 w", "180 500 m 260 500 l S", "300 260 m 300 300 l S", "300 260 m 330 262 345 280 340 300 c S");
  const text = (x: number, y: number, size: number, s: string, bold = false) => `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
  ops.push(
    "0 0 0 rg",
    text(260, 136, 10, variant ? "6200" : "6000"),
    text(540, 330, 10, "4800"),
    text(150, 420, 12, variant ? "KITCHEN / DINING" : "KITCHEN"),
    text(360, 420, 12, "LIVING"),
    text(330, 205, 9, variant ? "Island 2400 x 1000" : "Island 1800 x 900"),
    text(570, 110, 12, title, true),
    text(570, 83, 9, siteLine),
    text(570, 58, 10, `Revision: ${revision}`, true),
    text(570, 40, 8, "SAMPLE DRAWING - fictional, for the Bob demo only"),
    text(80, 530, 14, "GROUND FLOOR PLAN  1:50", true),
  );
  const stream = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* ------------------------------ Seeding ------------------------------ */

interface SeedFile {
  key: string;
  job: string;
  category: FileCategory;
  title: string;
  filename: string;
  description?: string;
  revision?: string;
  group?: string;
  daysAgo: number;
  by: string;
  visibility?: "team" | "office";
  data: () => Buffer;
}

export function seedFilesAndLeave(db: DatabaseSync, insert: InsertFn, orgId: string, k: string, timeZone = DEFAULT_TIME_ZONE) {
  const already = db.prepare("SELECT COUNT(*) AS n FROM job_files WHERE org_id = ? AND client_ref LIKE 'seed:%'").get(orgId) as { n: number };
  if (already.n > 0) return;
  const job = (key: string) => `${k}_job_${key}`;
  const pid = (key: string) => `${k}_per_${key}`;
  const exists = (id: string) => !!db.prepare("SELECT 1 FROM jobs WHERE org_id = ? AND id = ?").get(orgId, id);
  const site = (key: string) => (db.prepare("SELECT site_address, location FROM jobs WHERE org_id = ? AND id = ?").get(orgId, job(key)) as { site_address?: string; location: string } | undefined)?.site_address ?? "";
  const files: SeedFile[] = [
    { key: "kc_plan_a", job: "kitchen_crawley", category: "drawing", title: "Kitchen layout", filename: "Kitchen layout - Rev A.pdf", revision: "Rev A", group: "kc_plan", daysAgo: 30, by: "Luke", description: "First layout sent with the quote.", data: () => pdfDrawing("Kitchen layout", "A", site("kitchen_crawley"), 0) },
    { key: "kc_plan_b", job: "kitchen_crawley", category: "drawing", title: "Kitchen layout", filename: "Kitchen layout - Rev B.pdf", revision: "Rev B", group: "kc_plan", daysAgo: 12, by: "Luke", description: "Island widened to 2400 after the site visit. Build from this one.", data: () => pdfDrawing("Kitchen layout", "B", site("kitchen_crawley"), 1) },
    { key: "kc_p1", job: "kitchen_crawley", category: "progress", title: "Old units stripped out", filename: "IMG_4101.png", daysAgo: 4, by: "Liam Carter", description: "Back to bare walls, ready for first fix.", data: () => roomPicture(2, 960, 720) },
    { key: "kc_p2", job: "kitchen_crawley", category: "progress", title: "Base units in", filename: "IMG_4122.png", daysAgo: 1, by: "Liam Carter", description: "Island carcass level and fixed.", data: () => roomPicture(0, 960, 720) },
    { key: "kc_spec", job: "kitchen_crawley", category: "other", title: "Appliance spec sheet", filename: "Appliance spec.pdf", daysAgo: 20, by: "Ryan", visibility: "office", description: "Oven and hob cut-out sizes.", data: () => pdfDrawing("Appliance cut-outs", "-", site("kitchen_crawley"), 0) },
    { key: "ext_plan", job: "extension_copthorne", category: "drawing", title: "Extension plan and section", filename: "Extension GA - Rev C.pdf", revision: "Rev C", daysAgo: 40, by: "Luke", description: "Building control approved set.", data: () => pdfDrawing("Single-storey extension", "C", site("extension_copthorne"), 1) },
    { key: "ext_p1", job: "extension_copthorne", category: "progress", title: "Roof joists on", filename: "roof-joists.png", daysAgo: 3, by: "Callum Price", data: () => roomPicture(5, 960, 720) },
    { key: "kcop_p1", job: "kitchen_copthorne", category: "progress", title: "Oak worktops templated", filename: "worktops.png", daysAgo: 2, by: "Callum Price", data: () => roomPicture(1, 960, 720) },
    { key: "gr_plan", job: "gardenroom_lingfield", category: "drawing", title: "Garden room drawings", filename: "Garden room - Rev B.pdf", revision: "Rev B", daysAgo: 70, by: "Luke", description: "As built.", data: () => pdfDrawing("Garden room", "B", site("gardenroom_lingfield") || "Lingfield", 0) },
    { key: "gr_c1", job: "gardenroom_lingfield", category: "completion", title: "Finished studio - inside", filename: "garden-room-inside.png", daysAgo: 30, by: "Liam Carter", description: "Cedar ceiling and oak floor finished.", data: () => roomPicture(3, 960, 720) },
    { key: "gr_c2", job: "gardenroom_lingfield", category: "completion", title: "Finished studio - desk wall", filename: "garden-room-desk.png", daysAgo: 30, by: "Liam Carter", data: () => roomPicture(1, 960, 720) },
    { key: "gr_cert", job: "gardenroom_lingfield", category: "other", title: "Electrical installation certificate", filename: "EIC - garden room.pdf", daysAgo: 29, by: "Ryan", description: "From Davies Electrical.", data: () => pdfDrawing("Electrical certificate (sample)", "-", site("gardenroom_lingfield") || "Lingfield", 0) },
    { key: "gr_p1", job: "gardenroom_lingfield", category: "progress", title: "Base and frame", filename: "frame.png", daysAgo: 48, by: "Callum Price", description: "Internal progress photo — not for the customer pack.", data: () => roomPicture(2, 960, 720) },
  ];
  const now = Date.now();
  const ids: Record<string, string> = {};
  for (const f of files) {
    if (!exists(job(f.job))) continue;
    const data = f.data();
    const id = `${k}_fil_${f.key}`;
    ids[f.key] = id;
    const createdAt = new Date(now - f.daysAgo * 864e5).toISOString();
    const row: JobFile & { clientRef: string } = {
      id,
      jobId: job(f.job),
      category: f.category,
      title: f.title,
      filename: f.filename,
      mimeType: f.filename.endsWith(".pdf") ? "application/pdf" : "image/png",
      bytes: data.length,
      description: f.description,
      revision: f.revision,
      groupId: f.group ? `${k}_fil_${f.group}_a`.replace(/_a$/, "") : id,
      visibility: f.visibility ?? "team",
      previewable: true,
      hasThumb: false,
      width: f.filename.endsWith(".png") ? 960 : undefined,
      height: f.filename.endsWith(".png") ? 720 : undefined,
      uploadedBy: f.by,
      createdAt,
      clientRef: `seed:${f.key}`,
    };
    insert(db, "job_files", orgId, row as unknown as { id: string });
    db.prepare("INSERT OR REPLACE INTO file_blobs (file_id, org_id, kind, data, created_at) VALUES (?, ?, 'original', ?, ?)").run(id, orgId, data, createdAt);
  }

  // A handover already given to the garden-room customer: drawings, completion photos and the certificate.
  if (ids.gr_plan && ids.gr_c1) {
    const pick = ["gr_plan", "gr_c1", "gr_c2", "gr_cert"].filter((x) => ids[x]);
    const folder: Record<FileCategory, string> = { drawing: "Drawings", progress: "Progress photos", completion: "Completion photos", other: "Documents" };
    const h: Handover = {
      id: `${k}_ho_gardenroom`,
      jobId: job("gardenroom_lingfield"),
      title: "Garden room — handover",
      jobTitle: "Garden room",
      siteAddress: site("gardenroom_lingfield") || "Lingfield",
      completionDate: addDays(dateKeyIn(timeZone), -30),
      message: "Thanks for choosing us. Oil the cedar once a year; the electrical certificate is included for your records.",
      items: pick.map((x) => {
        const f = files.find((y) => y.key === x)!;
        return { fileId: ids[x], zipPath: `${folder[f.category]}/${f.filename}`, title: f.title, filename: f.filename, category: f.category, description: f.description, revision: f.revision, bytes: f.data().length, mimeType: f.filename.endsWith(".pdf") ? "application/pdf" : "image/png" };
      }),
      createdAt: new Date(now - 29 * 864e5).toISOString(),
      createdBy: "Luke",
      downloads: 1,
    };
    insert(db, "handovers", orgId, h);
  }

  // Leave and availability around this week.
  const today = dateKeyIn(timeZone);
  const mon = weekStart(today);
  const people = new Set((db.prepare("SELECT id FROM people WHERE org_id = ?").all(orgId) as { id: string }[]).map((r) => r.id));
  const nowIso = new Date().toISOString();
  const leave: Absence[] = [
    { id: `${k}_abs_ellie`, personId: pid("ellie"), kind: "holiday", startDate: addDays(mon, 11), endDate: addDays(mon, 14), status: "pending", reason: "Family wedding in Cornwall", requestedBy: "Ellie Ward", createdAt: nowIso, updatedAt: nowIso },
    { id: `${k}_abs_callum`, personId: pid("callum"), kind: "holiday", startDate: addDays(mon, 7), endDate: addDays(mon, 7), part: "pm", status: "approved", reason: "Dentist", requestedBy: "Callum Price", decidedBy: "Luke", decidedAt: nowIso, createdAt: nowIso, updatedAt: nowIso },
    { id: `${k}_abs_liam`, personId: pid("liam"), kind: "holiday", startDate: addDays(mon, 21), endDate: addDays(mon, 25), status: "approved", requestedBy: "Liam Carter", decidedBy: "Ryan", decidedAt: nowIso, createdAt: nowIso, updatedAt: nowIso },
    { id: `${k}_abs_mark`, personId: pid("mark"), kind: "unavailable", startDate: addDays(mon, 3), endDate: addDays(mon, 4), status: "approved", requestedBy: "Mark Davies", decidedBy: "Mark Davies", decidedAt: nowIso, createdAt: nowIso, updatedAt: nowIso },
  ];
  for (const a of leave) if (people.has(a.personId)) insert(db, "absences", orgId, a);
}
