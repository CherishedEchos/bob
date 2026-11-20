import { describe, expect, it } from "vitest";
import { jobFinancials } from "@/lib/job-financials";

const job = { id: "j1", quotedValue: 10000, status: "in_progress" as const };
const base = { variations: [], payments: [], expenses: [], bills: [] };

describe("job financials", () => {
  it("contract value includes approved variations only; outstanding = contract − received", () => {
    const f = jobFinancials(job, {
      ...base,
      variations: [
        { id: "v1", jobId: "j1", description: "Step", amount: 650, amountsAre: "no_vat", status: "approved", createdAt: "", createdBy: "" },
        { id: "v2", jobId: "j1", description: "Maybe", amount: 900, amountsAre: "no_vat", status: "proposed", createdAt: "", createdBy: "" },
      ] as never,
      payments: [{ id: "p1", jobId: "j1", amount: 3000, type: "deposit", method: "bank_transfer", receivedAt: "", recordedBy: "", recordedAt: "" }] as never,
    });
    expect(f.contractValue).toBe(10650);
    expect(f.received).toBe(3000);
    expect(f.outstanding).toBe(7650);
    expect(f.paidPercent).toBe(28);
  });

  it("no costs recorded → no profit figure, and the gaps are listed", () => {
    const f = jobFinancials(job, base);
    expect(f.profit).toBeNull();
    expect(f.margin).toBeNull();
    expect(f.basis).toBe("none");
    expect(f.missing).toEqual(["labour", "materials", "subcontractors"]);
  });

  it("costs by type, bills count as materials; estimated while open, actual when completed", () => {
    const data = {
      ...base,
      expenses: [
        { id: "e1", jobId: "j1", amount: 2000, category: "labour", description: "", incurredOn: "", recordedBy: "", createdAt: "" },
        { id: "e2", jobId: "j1", amount: 500, category: "waste", description: "", incurredOn: "", recordedBy: "", createdAt: "" },
        { id: "e3", jobId: "other", amount: 999, category: "labour", description: "", incurredOn: "", recordedBy: "", createdAt: "" },
      ] as never,
      bills: [{ id: "b1", jobId: "j1", supplier: "Travis", description: "", amount: 1500, dueDate: "", status: "due", createdAt: "" }] as never,
    };
    const f = jobFinancials(job, data);
    expect(f.costs).toEqual({ labour: 2000, materials: 0, subcontractors: 0, other: 500, bills: 1500, total: 4000 });
    expect(f.missing).toEqual(["subcontractors"]);
    expect(f.profit).toBe(6000);
    expect(f.margin).toBe(60);
    expect(f.basis).toBe("estimated");
    expect(jobFinancials({ ...job, status: "completed" }, data).basis).toBe("actual");
  });
});
