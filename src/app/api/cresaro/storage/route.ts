import { NextResponse } from "next/server";
import { authed } from "@/server/http";
import { isPlatformAdmin } from "@/server/auth/platform";
import { storageStatus } from "@/server/db/backup";
import { mailStatus } from "@/server/mail";

export const runtime = "nodejs";

/** Cresaro admins only: where records and files are stored, whether that's permanent, and email delivery. */
export const GET = authed(async (_req, ctx) => {
  if (!isPlatformAdmin(ctx)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return { storage: storageStatus(), mail: mailStatus() };
});
