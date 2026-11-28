import fs from "node:fs";
import { NextResponse } from "next/server";
import { authed } from "@/server/http";
import { isPlatformAdmin } from "@/server/auth/platform";
import { backupToTemp } from "@/server/db/backup";
import { audit } from "@/server/services/records";

export const runtime = "nodejs";

/**
 * Cresaro admins only: download a consistent backup of the WHOLE server
 * database — every workspace's records and uploaded files — as one SQLite
 * file. Restore instructions: docs/BACKUP-RESTORE.md.
 */
export const GET = authed(async (_req, ctx) => {
  if (!isPlatformAdmin(ctx)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = backupToTemp();
  try {
    const data = fs.readFileSync(file);
    audit(ctx, "platform.backup_downloaded", `Server backup downloaded (${Math.round(data.length / 1024)} KB)`);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="bob-backup-${new Date().toISOString().slice(0, 10)}.sqlite"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
});
