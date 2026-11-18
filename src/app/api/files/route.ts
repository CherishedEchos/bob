import { authed, fromResult } from "@/server/http";
import { HttpError } from "@/server/context";
import { MAX_FILE_BYTES, uploadFile } from "@/server/services/files";

export const runtime = "nodejs";

/**
 * Upload ONE file (multipart/form-data) to a job or enquiry. One file per
 * request, so each file succeeds or fails on its own and can be retried;
 * the client reference makes a retry return the file already saved.
 * Invited workers may upload to jobs they're booked on (checked in the service).
 */
export const POST = authed(async (req, ctx) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_FILE_BYTES + 600_000) throw new HttpError(413, `That file is over the ${MAX_FILE_BYTES / 1048576} MB limit.`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "The upload didn't arrive in one piece. Try again.");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new HttpError(400, "No file was attached.");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, `That file is over the ${MAX_FILE_BYTES / 1048576} MB limit.`);
  const thumb = form.get("thumb");
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const num = (k: string) => (str(k) ? Number(str(k)) : undefined);
  return fromResult(
    uploadFile(ctx, {
      jobId: str("jobId"),
      enquiryId: str("enquiryId"),
      category: str("category"),
      title: str("title"),
      description: str("description"),
      revision: str("revision"),
      replacesId: str("replacesId"),
      visibility: str("visibility"),
      clientRef: str("clientRef"),
      width: num("width"),
      height: num("height"),
      filename: (file as File).name || str("filename") || "file",
      data: Buffer.from(await file.arrayBuffer()),
      thumb: thumb instanceof Blob && thumb.size ? Buffer.from(await thumb.arrayBuffer()) : undefined,
    }),
  );
}, { workers: true });
