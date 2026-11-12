import "server-only";
import { z } from "zod";
import type { Enquiry, Job, Photo } from "@/lib/types";
import { scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { audit } from "@/server/services/records";
import { uid } from "@/lib/utils";

/**
 * Site photos, filed against a job or enquiry. Anyone in the business can add
 * them (the site team is who takes them). Images are resized on the phone
 * before upload; the server checks type and size and stores them per
 * organisation. Only metadata goes into the app snapshot.
 */
export const MAX_PHOTO_BYTES = 1_500_000;
const MIME = ["image/jpeg", "image/png", "image/webp"] as const;

const photoInput = z.object({
  relatedType: z.enum(["job", "enquiry"]),
  relatedId: z.string().min(3).max(80),
  caption: z.string().trim().max(200).optional().or(z.literal("")).transform((v) => v || undefined),
  mimeType: z.enum(MIME),
  dataBase64: z.string().min(100),
  width: z.number().int().positive().max(10000).optional(),
  height: z.number().int().positive().max(10000).optional(),
});

type Row = Photo & { mimeType: string; data: string; bytes: number };
const meta = ({ id, relatedType, relatedId, caption, width, height, createdAt, createdBy }: Row): Photo => ({ id, relatedType, relatedId, caption, width, height, createdAt, createdBy });

export function listPhotos(ctx: Ctx): Photo[] {
  return scoped(ctx).list<Row>("photos", { order: "created_at DESC" }).map(meta);
}

export function addPhoto(ctx: Ctx, input: unknown): Result<Photo> {
  const no = denied(ctx, "notes.write");
  if (no) return no;
  const parsed = photoInput.safeParse(input);
  if (!parsed.success) return fail("invalid", "That photo couldn't be read. Try another.");
  const v = parsed.data;
  const db = scoped(ctx);
  const target = v.relatedType === "job" ? db.get<Job>("jobs", v.relatedId) : db.get<Enquiry>("enquiries", v.relatedId);
  if (!target) return fail("not_found", v.relatedType === "job" ? "Job not found" : "Enquiry not found");
  const b64 = v.dataBase64.replace(/^data:[^,]+,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return fail("invalid", "That photo couldn't be read. Try another.");
  const bytes = Math.floor((b64.replace(/\s/g, "").length * 3) / 4);
  if (bytes > MAX_PHOTO_BYTES) return fail("invalid", "That photo is too big — try again (Bob shrinks photos before sending).");
  const photo: Row = {
    id: uid("pho"),
    relatedType: v.relatedType,
    relatedId: v.relatedId,
    caption: v.caption,
    width: v.width,
    height: v.height,
    mimeType: v.mimeType,
    data: b64.replace(/\s/g, ""),
    bytes,
    createdAt: new Date().toISOString(),
    createdBy: ctx.userName,
  };
  const label = v.relatedType === "job" ? `${(target as Job).title} job` : `${(target as Enquiry).customerName}'s enquiry`;
  tx(() => {
    db.insert("photos", photo);
    audit(ctx, "photo.added", `Photo added to ${label}${v.caption ? `: ${v.caption}` : ""}`, v.relatedType, v.relatedId);
  });
  return ok(meta(photo));
}

export function getPhotoImage(ctx: Ctx, id: string): { mimeType: string; data: Buffer } | null {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return null;
  const p = scoped(ctx).get<Row>("photos", id);
  return p ? { mimeType: p.mimeType, data: Buffer.from(p.data, "base64") } : null;
}

export function deletePhoto(ctx: Ctx, id: string): Result<{ id: string }> {
  const db = scoped(ctx);
  const p = db.get<Row>("photos", id);
  if (!p) return fail("not_found", "Photo not found");
  const mayDelete = ctx.role === "owner" || ctx.role === "office" || p.createdBy === ctx.userName;
  if (!mayDelete) return fail("forbidden", "Only the person who took it, or the office, can delete a photo.");
  tx(() => {
    db.remove("photos", id);
    audit(ctx, "photo.deleted", "Photo deleted", p.relatedType, p.relatedId);
  });
  return ok({ id });
}

/** Privacy: remove photos attached to these records. */
export function removePhotosFor(ctx: Ctx, relatedIds: string[]) {
  const db = scoped(ctx);
  for (const id of relatedIds) for (const p of db.list<Row>("photos", { where: "related_id = ?", params: [id] })) db.remove("photos", p.id);
}
