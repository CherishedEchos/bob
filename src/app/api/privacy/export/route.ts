import { NextResponse } from "next/server";
import { authed, fromResult } from "@/server/http";
import { exportOrgData } from "@/server/services/privacy";

export const runtime = "nodejs";

export const GET = authed(async (_req, ctx) => {
  const r = exportOrgData(ctx);
  if (!r.ok) return fromResult(r);
  return new NextResponse(JSON.stringify(r.value, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${ctx.org.slug}-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
