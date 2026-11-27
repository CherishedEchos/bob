import { beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_OWNER } from "./helpers";
import * as R from "@/server/services/records";
import { buildSnapshot } from "@/server/services/snapshot";

beforeEach(() => freshDb());

describe("Customers: domestic and commercial", () => {
  it("adds a commercial customer with a main contact and other contacts", () => {
    const ctx = ctxFor(N93_OWNER);
    const r = R.createCustomer(ctx, {
      name: "Hollybank Care Homes Ltd",
      kind: "commercial",
      contactName: "Jo Marsh",
      phone: "01632 960 700",
      address: "1 Hollybank Road, Crawley",
      contacts: [{ name: "Sam Lee", role: "Estates", email: "sam@hollybank.example" }],
    });
    expect(r.ok).toBe(true);
    const c = buildSnapshot(ctx).customers.find((x) => x.name === "Hollybank Care Homes Ltd")!;
    expect(c).toMatchObject({ kind: "commercial", contactName: "Jo Marsh", contacts: [{ name: "Sam Lee", role: "Estates", email: "sam@hollybank.example" }] });
  });

  it("leaves a customer unclassified unless someone chooses a type, and can classify later", () => {
    const ctx = ctxFor(N93_OWNER);
    const r = R.createCustomer(ctx, { name: "Pat Brown" });
    if (!r.ok) throw new Error("create failed");
    expect(r.value.kind).toBeUndefined();
    expect(R.updateCustomer(ctx, r.value.id, { kind: "domestic" }).ok).toBe(true);
    expect(buildSnapshot(ctx).customers.find((x) => x.id === r.value.id)!.kind).toBe("domestic");
  });

  it("rejects an unknown type", () => {
    expect(R.createCustomer(ctxFor(N93_OWNER), { name: "Odd Ltd", kind: "industrial" }).ok).toBe(false);
  });

  it("the demo has domestic customers and one commercial customer", () => {
    const s = buildSnapshot(ctxFor(N93_OWNER));
    expect(s.customers.filter((c) => c.kind === "commercial").map((c) => c.name)).toEqual(["Brookside Lettings Ltd"]);
    expect(s.customers.some((c) => c.kind === "domestic")).toBe(true);
  });
});

describe("Jobs: start and finish dates", () => {
  it("sets, clears and validates the finish date", () => {
    const ctx = ctxFor(N93_OWNER);
    const id = "n93_job_mackay_kitchen";
    expect(R.updateJob(ctx, id, { startDate: "2026-11-05", endDate: "2026-12-04" }).ok).toBe(true);
    expect(R.getJob(ctx, id)).toMatchObject({ startDate: "2026-11-05", endDate: "2026-12-04" });
    const bad = R.updateJob(ctx, id, { endDate: "2026-11-01" });
    expect(bad.ok).toBe(false);
    expect(R.updateJob(ctx, id, { startDate: null, endDate: null }).ok).toBe(true);
    const j = R.getJob(ctx, id)!;
    expect(j.startDate ?? null).toBeNull();
    expect(j.endDate ?? null).toBeNull();
  });

  it("demo jobs have dates in order", () => {
    for (const j of buildSnapshot(ctxFor(N93_OWNER)).jobs) if (j.startDate && j.endDate) expect(j.endDate >= j.startDate).toBe(true);
  });
});
