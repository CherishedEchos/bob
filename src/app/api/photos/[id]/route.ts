import { authed, fromResult } from "@/server/http";
import { deletePhoto, getPhotoImage } from "@/server/services/photos";

export const runtime = "nodejs";

/** The image itself — only for members of the business that owns it. */
export const GET = authed(async (_req, ctx, params) => {
  const img = getPhotoImage(ctx, params.id);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.data), { headers: { "Content-Type": img.mimeType, "Cache-Control": "private, max-age=86400" } });
});

export const DELETE = authed(async (_req, ctx, params) => fromResult(deletePhoto(ctx, params.id)));
