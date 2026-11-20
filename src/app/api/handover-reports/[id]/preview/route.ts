import { authed, fromResult } from "@/server/http";
import { previewReport } from "@/server/services/handover-reports";
import { contentDisposition } from "@/server/content-disposition";

export const runtime = "nodejs";

/** The exact PDF the current draft would export (not saved as a version). Owners/admins only. */
export const GET = authed(async (_req, ctx, params) => {
  const r = await previewReport(ctx, params.id);
  if (!r.ok) return fromResult(r);
  return new Response(new Uint8Array(r.value.data), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition("Preview - handover report.pdf", true), "Cache-Control": "private, no-store", "X-Pdf-Pages": String(r.value.pages) },
  });
});
