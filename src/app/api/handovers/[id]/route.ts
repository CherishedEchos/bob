import { authed, fromResult } from "@/server/http";
import { buildHandoverZip } from "@/server/services/handover";
import { contentDisposition } from "@/server/content-disposition";

export const runtime = "nodejs";

/** Download the handover ZIP (built from the saved record; read-only). */
export const GET = authed(async (_req, ctx, params) => {
  const r = buildHandoverZip(ctx, params.id);
  if (!r.ok) return fromResult(r);
  return new Response(new Uint8Array(r.value.data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(r.value.data.length),
      "Content-Disposition": contentDisposition(r.value.filename, false),
      "Cache-Control": "private, no-store",
    },
  });
});
