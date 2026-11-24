import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Supplied project photographs (e.g. Ninety3's own, with permission) for the
 * demo workspace, in place of the drawn placeholder pictures. Add them to
 * public/demo/photos/ with a manifest.json entry each (file, author, licence
 * or permission note, width, height) plus a "-thumb.jpg" (about 600 px wide);
 * keep originals around 1280 px wide for phones. They're labelled "Demo photo"
 * in the app. With no manifest, nothing changes and the placeholders stay.
 *
 * Runs on every start and after "Reset sample data"; already-swapped files
 * are left alone.
 */
export interface DemoPhoto {
  file: string; // e.g. "kitchen-finished.jpg" (thumbnail: "kitchen-finished-thumb.jpg")
  subject: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
  width: number;
  height: number;
}

const DIR = () => path.join(process.cwd(), "public", "demo", "photos");

/** Which seeded file (by key) shows which photo. */
export const PHOTO_FOR: Record<string, string> = {
  // Drawn illustrations used as job covers
  il_kc: "kitchen-finished",
  il_kcop: "kitchen-shaker",
  il_mackay: "kitchen-island",
  il_ext: "extension-finished",
  il_loft: "loft",
  il_wh: "wardrobes",
  il_mw: "wardrobes-alcove",
  il_media: "media-wall",
  il_stairs: "staircase",
  il_gr: "garden-room",
  // Placeholder progress and completion pictures
  kc_p1: "kitchen-stripped",
  kc_p2: "kitchen-units",
  ext_p1: "site-roof-joists",
  kcop_p1: "kitchen-worktop",
  gr_c1: "garden-room-inside",
  gr_c2: "garden-room-desk",
  gr_p1: "site-timber-frame",
  gr_before: "garden-before",
  st_tread: "staircase",
};

export function loadManifest(): DemoPhoto[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR(), "manifest.json"), "utf8")) as DemoPhoto[];
  } catch {
    return [];
  }
}

export function applyDemoPhotos(db: DatabaseSync, orgId: string, k: string) {
  const manifest = new Map(loadManifest().map((p) => [p.file.replace(/\.jpg$/, ""), p]));
  if (!manifest.size) return;
  const now = new Date().toISOString();
  for (const [key, name] of Object.entries(PHOTO_FOR)) {
    const photo = manifest.get(name);
    if (!photo) continue;
    const id = `${k}_fil_${key}`;
    const row = db.prepare("SELECT filename, created_at FROM job_files WHERE org_id = ? AND id = ?").get(orgId, id) as { filename: string; created_at: string } | undefined;
    if (!row || row.filename === `${name}.jpg`) continue;
    let original: Buffer, thumb: Buffer;
    try {
      original = fs.readFileSync(path.join(DIR(), `${name}.jpg`));
      thumb = fs.readFileSync(path.join(DIR(), `${name}-thumb.jpg`));
    } catch {
      continue;
    }
    const credit = `Demo photo · ${photo.author}, ${photo.license}`;
    db.prepare("UPDATE job_files SET filename = ?, mime_type = 'image/jpeg', bytes = ?, has_thumb = 1, width = ?, height = ?, description = CASE WHEN description IS NULL OR description = '' OR description LIKE 'Illustrative image%' THEN ? ELSE description || ' (' || ? || ')' END WHERE org_id = ? AND id = ?").run(
      `${name}.jpg`, original.length, photo.width, photo.height, credit, credit, orgId, id,
    );
    db.prepare("INSERT OR REPLACE INTO file_blobs (file_id, org_id, kind, data, created_at) VALUES (?, ?, 'original', ?, ?)").run(id, orgId, original, row.created_at ?? now);
    db.prepare("INSERT OR REPLACE INTO file_blobs (file_id, org_id, kind, data, created_at) VALUES (?, ?, 'thumb', ?, ?)").run(id, orgId, thumb, row.created_at ?? now);
  }
}
