import { authed, fromResult, readJson } from "@/server/http";
import { deleteFile, readFile, updateFile } from "@/server/services/files";
import { contentDisposition } from "@/server/content-disposition";

export const runtime = "nodejs";

/**
 * The file itself (or its thumbnail). Private: only for people allowed to see
 * it — the same "not found" for missing and forbidden, so ids can't be probed.
 * Only verified images and PDFs are shown inline; everything else downloads.
 */
export const GET = authed(async (req, ctx, params) => {
  const url = new URL(req.url);
  const variant = url.searchParams.get("variant") === "thumb" ? "thumb" : "original";
  const r = readFile(ctx, params.id, variant);
  if (!r) return new Response("Not found", { status: 404 });
  const inline = r.file.previewable && url.searchParams.get("download") !== "1";
  const type = variant === "thumb" ? "image/jpeg" : inline ? r.file.mimeType : r.file.mimeType || "application/octet-stream";
  return new Response(new Uint8Array(r.data), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(r.data.length),
      "Content-Disposition": contentDisposition(r.file.filename, inline || variant === "thumb"),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, { workers: true });

export const PATCH = authed(async (req, ctx, params) => fromResult(updateFile(ctx, params.id, await readJson(req))));

export const DELETE = authed(async (_req, ctx, params) => fromResult(deleteFile(ctx, params.id)), { workers: true });
