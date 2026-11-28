"use client";

/**
 * Browser side of job uploads: one request per file, with progress, a
 * thumbnail made on the device (the original is always sent untouched) and a
 * client reference so a retry can never create a duplicate.
 */
import type { FileCategory, JobFile } from "@/lib/types";

export const MAX_UPLOAD_MB = 25;
/** Short site videos (about a minute). */
export const MAX_VIDEO_MB = 60;
export const ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.mp4,.m4v,.mov,.webm,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.txt,.csv,image/*,video/*,application/pdf";
export const isVideoName = (name: string) => ["mp4", "m4v", "mov", "webm"].includes((name.split(".").pop() ?? "").toLowerCase());
const ALLOWED = new Set(ACCEPT.split(",").filter((x) => x.startsWith(".")).map((x) => x.slice(1)));

export const CATEGORY_LABEL: Record<FileCategory, string> = { drawing: "Drawings", progress: "Progress photos", completion: "Completion", other: "Other" };
export const CATEGORY_SINGULAR: Record<FileCategory, string> = { drawing: "Drawing", progress: "Progress photo", completion: "Completion photo", other: "Document" };

export const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
export const isImageName = (name: string) => ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(extOf(name));

/** Problems we can spot before sending anything. */
export function precheck(file: File): string | null {
  if (!ALLOWED.has(extOf(file.name))) return `${file.name}: this type of file isn't supported. Upload photos (JPG, PNG, HEIC), short videos (MP4, MOV), PDFs, Word/Excel documents or DWG/DXF drawings.`;
  if (isVideoName(file.name) && file.size > MAX_VIDEO_MB * 1048576) return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB — videos can be up to ${MAX_VIDEO_MB} MB. Keep it to about a minute, or trim it on your phone first.`;
  if (!isVideoName(file.name) && file.size > MAX_UPLOAD_MB * 1048576) return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_UPLOAD_MB} MB per file.`;
  if (!file.size) return `${file.name} is empty.`;
  return null;
}

export function guessCategory(file: File, fallback: FileCategory = "progress"): FileCategory {
  if (["dwg", "dxf"].includes(extOf(file.name))) return "drawing";
  if (isImageName(file.name)) return fallback === "drawing" ? "progress" : fallback;
  return /drawing|plan|elevation|section|layout|rev[\s_-]?[a-z0-9]\b/i.test(file.name) ? "drawing" : "other";
}

/** A small JPEG preview for photo grids (the original is kept as uploaded). HEIC in non-Safari browsers can't be decoded: no thumbnail. */
export async function makeThumb(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (!["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(extOf(file.name))) return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.78));
    const out = blob ? { blob, width: bitmap.width, height: bitmap.height } : null;
    bitmap.close();
    return out;
  } catch {
    return null;
  }
}

export interface UploadFields {
  jobId?: string;
  enquiryId?: string;
  category: FileCategory;
  title?: string;
  description?: string;
  revision?: string;
  replacesId?: string;
  updateId?: string;
  visibility?: "team" | "office";
  clientRef: string;
}

export type UploadOutcome = { ok: true; file: JobFile & { existed?: boolean } } | { ok: false; error: string; retryable: boolean };

export function newClientRef() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function uploadFile(file: File, fields: UploadFields, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<UploadOutcome> {
  const problem = precheck(file);
  if (problem) return { ok: false, error: problem, retryable: false };
  const thumb = await makeThumb(file);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== "") form.set(k, String(v));
  if (thumb) {
    form.set("thumb", thumb.blob, "thumb.jpg");
    form.set("width", String(thumb.width));
    form.set("height", String(thumb.height));
  }
  form.set("file", file, file.name);
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { ok?: boolean; value?: JobFile; error?: string };
      if (xhr.status === 200 && body.ok && body.value) return resolve({ ok: true, file: body.value });
      if (xhr.status === 401) window.location.href = "/login";
      resolve({ ok: false, error: body.error ?? (xhr.status === 413 ? `That file is over the ${MAX_UPLOAD_MB} MB limit.` : "Couldn't save this file."), retryable: xhr.status >= 500 || xhr.status === 0 || xhr.status === 409 });
    };
    xhr.onerror = () => resolve({ ok: false, error: "Upload interrupted — check your signal and tap Retry.", retryable: true });
    xhr.onabort = () => resolve({ ok: false, error: "Upload cancelled.", retryable: true });
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

export const fileUrl = (id: string, opts: { thumb?: boolean; download?: boolean } = {}) =>
  `/api/files/${encodeURIComponent(id)}${opts.thumb ? "?variant=thumb" : opts.download ? "?download=1" : ""}`;

export const formatBytes = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
