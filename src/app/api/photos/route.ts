import { authed, fromResult } from "@/server/http";
import { HttpError } from "@/server/context";
import { addPhoto, MAX_PHOTO_BYTES } from "@/server/services/photos";

export const runtime = "nodejs";

// Base64 is ~4/3 the size of the image, plus a little JSON.
const MAX_BODY = Math.ceil(MAX_PHOTO_BYTES * 1.4) + 4096;

/** Upload a site photo for a job or enquiry. */
export const POST = authed(async (req, ctx) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, "That photo is too big.");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "That photo is too big.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid upload");
  }
  return fromResult(addPhoto(ctx, body));
});
