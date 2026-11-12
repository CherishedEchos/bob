import { beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_OWNER, N93_STAFF, RDG_OWNER } from "./helpers";
import * as R from "@/server/services/records";
import { addPhoto, deletePhoto, getPhotoImage, listPhotos } from "@/server/services/photos";
import { eraseCustomer } from "@/server/services/privacy";

beforeEach(() => freshDb());

// A real 1x1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==".padEnd(120, "=");
const pic = (relatedType: "job" | "enquiry", relatedId: string, extra = {}) => ({ relatedType, relatedId, mimeType: "image/png", dataBase64: PNG, width: 1, height: 1, ...extra });

describe("Site photos", () => {
  it("lets the site team file a photo to a job and only metadata appears in lists", () => {
    const staff = ctxFor(N93_STAFF);
    const job = R.listJobs(staff)[0];
    const r = addPhoto(staff, pic("job", job.id, { caption: "Worktop joint" }));
    expect(r.ok).toBe(true);
    const list = listPhotos(staff);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ relatedType: "job", relatedId: job.id, caption: "Worktop joint", createdBy: expect.any(String) });
    expect(Object.keys(list[0])).not.toContain("data");
    expect(getPhotoImage(staff, list[0].id)?.mimeType).toBe("image/png");
  });

  it("keeps each business's photos to itself", () => {
    const owner = ctxFor(N93_OWNER);
    const r = addPhoto(owner, pic("job", R.listJobs(owner)[0].id));
    if (!r.ok) throw new Error(r.error);
    const other = ctxFor(RDG_OWNER);
    expect(getPhotoImage(other, r.value.id)).toBeNull();
    expect(listPhotos(other)).toHaveLength(0);
    // Can't attach to another business's job either.
    expect(addPhoto(other, pic("job", R.listJobs(owner)[0].id)).ok).toBe(false);
  });

  it("rejects non-images and oversized uploads", () => {
    const owner = ctxFor(N93_OWNER);
    const job = R.listJobs(owner)[0];
    expect(addPhoto(owner, pic("job", job.id, { mimeType: "text/html" })).ok).toBe(false);
    expect(addPhoto(owner, pic("job", job.id, { dataBase64: "A".repeat(2_100_000) })).ok).toBe(false);
    expect(addPhoto(owner, pic("job", job.id, { dataBase64: "<script>alert(1)</script>".repeat(10) })).ok).toBe(false);
  });

  it("only the office or the person who took it can delete it", () => {
    const owner = ctxFor(N93_OWNER);
    const staff = ctxFor(N93_STAFF);
    const r = addPhoto(owner, pic("job", R.listJobs(owner)[0].id));
    if (!r.ok) throw new Error(r.error);
    expect(deletePhoto(staff, r.value.id)).toMatchObject({ ok: false, code: "forbidden" });
    expect(deletePhoto(owner, r.value.id).ok).toBe(true);
  });

  it("erasing a customer removes photos on their enquiries and jobs", () => {
    const owner = ctxFor(N93_OWNER);
    const job = R.listJobs(owner).find((j) => j.customerId)!;
    addPhoto(owner, pic("job", job.id));
    expect(listPhotos(owner)).toHaveLength(1);
    expect(eraseCustomer(owner, job.customerId).ok).toBe(true);
    expect(listPhotos(owner)).toHaveLength(0);
  });
});
