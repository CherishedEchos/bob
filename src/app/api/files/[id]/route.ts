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
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Disposition": contentDisposition(r.file.filename, inline || variant === "thumb"),
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
  // Phones (Safari especially) play videos by asking for byte ranges.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && variant === "original") {
    const size = r.data.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2] || 0);
    let end = range[1] ? (range[2] ? Number(range[2]) : size - 1) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const part = r.data.subarray(start, end + 1);
    return new Response(new Uint8Array(part), { status: 206, headers: { ...headers, "Content-Length": String(part.length), "Content-Range": `bytes ${start}-${end}/${size}` } });
  }
  return new Response(new Uint8Array(r.data), { headers: { ...headers, "Content-Length": String(r.data.length) } });
}, { workers: true });

export const PATCH = authed(async (req, ctx, params) => fromResult(updateFile(ctx, params.id, await readJson(req))), { workers: true });

export const DELETE = authed(async (_req, ctx, params) => fromResult(deleteFile(ctx, params.id)), { workers: true });
