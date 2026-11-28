import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { ctxFor, freshDb, N93_OFFICE, N93_OWNER, N93_STAFF, RDG_OWNER } from "./helpers";
import * as Rep from "@/server/services/handover-reports";
import * as U from "@/server/services/updates";
import * as F from "@/server/services/files";
import * as H from "@/server/services/handover";
import * as R from "@/server/services/records";
import { setClaudeClientForTests } from "@/server/bob/claude";
import { reportCostSummary } from "@/lib/report-costs";
import { scoped } from "@/server/db";
import type { HandoverReport, Invoice, Payment, Variation } from "@/lib/types";

const SAM = "sam@so-plastering.example";
const GR = "n93_job_gardenroom_lingfield";
const OUT = process.env.REPORT_OUT;
const ok = <T,>(r: { ok: boolean; value?: T; error?: string }) => {
  if (!r.ok) throw new Error(`Expected ok, got: ${r.error}`);
  return r.value as T;
};
const pdfText = (buf: Buffer) => {
  const f = `/tmp/bob-report-${Math.random().toString(36).slice(2)}.pdf`;
  fs.writeFileSync(f, buf);
  try {
    return execFileSync("pdftotext", ["-layout", f, "-"]).toString();
  } finally {
    fs.unlinkSync(f);
  }
};

/** A fake Claude that answers the draft tool with `draft` and records what it was sent. */
function fakeAi(draft: unknown, seen: string[]) {
  process.env.ANTHROPIC_API_KEY = "test-key";
  setClaudeClientForTests(() => ({ beta: { messages: { create: async (req: { messages: { content: string }[]; tools: { name: string }[] }) => {
    seen.push(JSON.stringify(req));
    return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: req.tools[0].name, input: draft }] };
  } } } }) as never);
}

beforeEach(() => freshDb());
afterEach(() => {
  setClaudeClientForTests(null);
  delete process.env.ANTHROPIC_API_KEY;
});

describe("Job updates", () => {
  it("saves a note-only update and a photo-only update, links photos, and a retry doesn't duplicate", () => {
    const owner = ctxFor(N93_OWNER);
    const a = ok(U.createUpdate(owner, { jobId: GR, note: "Doors hung", stage: "in_progress", clientRef: "u-1" }));
    expect(ok(U.createUpdate(owner, { jobId: GR, note: "Doors hung", clientRef: "u-1" }))).toMatchObject({ id: a.id, existed: true });
    const b = ok(U.createUpdate(owner, { jobId: GR, clientRef: "u-2" }));
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]);
    const f = ok(F.uploadFile(owner, { jobId: GR, updateId: b.id, filename: "a.jpg", data: jpeg, clientRef: "p-1" }));
    expect(f.updateId).toBe(b.id);
    expect(U.listUpdates(owner).filter((u) => u.jobId === GR && (u.id === a.id || u.id === b.id))).toHaveLength(2);
  });
  it("crew can add updates only on jobs they're booked on; only author or managers edit", () => {
    const sam = ctxFor(SAM);
    expect(U.createUpdate(sam, { jobId: "n93_job_extension_copthorne", note: "Skimmed" })).toMatchObject({ ok: true });
    expect(U.createUpdate(sam, { jobId: GR, note: "x" })).toMatchObject({ ok: false, code: "not_found" });
    const owners = ok(U.createUpdate(ctxFor(N93_OWNER), { jobId: "n93_job_extension_copthorne", note: "Office note" }));
    expect(U.editUpdate(sam, owners.id, { note: "changed" })).toMatchObject({ ok: false });
    expect(U.createUpdate(ctxFor(RDG_OWNER), { jobId: GR, note: "x" })).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("Cost summary", () => {
  it("labels agreed price, approved variation, payments and balance without double counting", () => {
    const owner = ctxFor(N93_OWNER);
    const db = scoped(owner);
    const job = R.getJob(owner, GR)!;
    const data = { variations: db.list<Variation>("variations"), invoices: db.list<Invoice>("invoices"), payments: db.list<Payment>("payments") };
    const s = reportCostSummary(job, data);
    const by = Object.fromEntries(s.lines.map((l) => [l.key, l]));
    expect(by.agreed.amount).toBe(9500);
    expect(by["var_n93_var_gr_step"].amount).toBe(650);
    expect(by.total.amount).toBe(10150);
    expect(by.paid.amount).toBe(9500);
    expect(by.balance).toMatchObject({ label: "Left to pay", amount: 650 });
    // The un-invoiced £650 is not "due on invoices" or overdue.
    expect(by.due).toBeUndefined();
    // Billing the variation on an invoice doesn't add it twice.
    const billed = reportCostSummary(job, { ...data, variations: data.variations.map((v) => ({ ...v, invoiceId: data.invoices.find((i) => i.jobId === GR)!.id })) });
    expect(billed.lines.find((l) => l.key === "total")!.amount).toBe(10150);
  });
});

describe("Handover report", () => {
  it("Ryan drafts with AI from selected records only — no internal notes, access codes, money or unselected photos", async () => {
    const office = ctxFor(N93_OFFICE);
    R.addJobNote(office, GR, "INTERNAL: margin was thin on this one");
    R.updateJob(office, GR, { accessNote: "Key safe code 7719 by the back gate" });
    const r = ok(Rep.createReport(office, { jobId: GR }));
    const excluded = r.selection.photoIds[0];
    const saved = ok(Rep.saveReport(office, { id: r.id, baseRevision: r.revision, selection: { ...r.selection, photoIds: r.selection.photoIds.slice(1), includeCosts: true } }));
    const seen: string[] = [];
    fakeAi({ overview: "We built an insulated cedar garden room at the end of the garden. It cost £9,500.", workCompleted: ["Ground-screw base and timber frame", "Cedar cladding on all four sides", "Oak floor and oiled cedar ceiling"], captions: [], aftercare: [], outstanding: [], questions: ["Is there a warranty on the cladding?"] }, seen);
    const g = ok(await Rep.generateReport(office, { id: saved.id, baseRevision: saved.revision }));
    expect(g.usedAi).toBe(true);
    const sent = seen.join("");
    expect(sent).not.toMatch(/INTERNAL|margin|7719|Key safe|9500|9,500|6650/);
    expect(sent).not.toContain(excluded);
    expect(g.content.sections.find((s) => s.id === "overview")!.body).not.toMatch(/£/);
    expect(g.content.prompts.some((p) => /warranty/i.test(p.text))).toBe(true);
    const pdf = ok(await Rep.previewReport(office, g.id));
    const text = pdfText(pdf.data);
    expect(text).toContain("Garden room");
    expect(text).toContain("Claire Dawson");
    expect(text).toMatch(/Extra: Cedar step and door canopy\s+£650/);
    expect(text).toMatch(/Left to pay\s+£650/);
    expect(text).not.toMatch(/INTERNAL|7719|warranty on the cladding/);
    if (OUT) fs.writeFileSync(`${OUT}/sample-gardenroom.pdf`, pdf.data);
  });

  it("a failed AI request keeps the selections and opens an editable draft from known details", async () => {
    const owner = ctxFor(N93_OWNER);
    const r = ok(Rep.createReport(owner, { jobId: GR }));
    process.env.ANTHROPIC_API_KEY = "x";
    setClaudeClientForTests(() => ({ beta: { messages: { create: async () => { throw new Error("overloaded"); } } } }) as never);
    const g = ok(await Rep.generateReport(owner, { id: r.id, baseRevision: r.revision }));
    expect(g.usedAi).toBe(false);
    expect(g.aiError).toMatch(/didn't respond/);
    expect(g.selection).toEqual(r.selection);
    expect(g.content.sections.find((s) => s.id === "work")!.items!.join(" ")).toMatch(/Cedar cladding finished/);
    expect(g.content.photos.length).toBe(r.content.photos.length);
  });

  it("protects edits when two people save the same draft, and a rewrite is only a proposal", async () => {
    const luke = ctxFor(N93_OWNER);
    const ryan = ctxFor(N93_OFFICE);
    const r = ok(Rep.createReport(luke, { jobId: GR }));
    const content = { ...r.content, sections: r.content.sections.map((s) => (s.id === "overview" ? { ...s, body: "Luke's words." } : s)) };
    const l = ok(Rep.saveReport(luke, { id: r.id, baseRevision: r.revision, content }));
    const clash = Rep.saveReport(ryan, { id: r.id, baseRevision: r.revision, content: { ...r.content } });
    expect(clash).toMatchObject({ ok: false, code: "conflict" });
    expect((clash as { current?: HandoverReport }).current!.content.sections.find((s) => s.id === "overview")!.body).toBe("Luke's words.");
    fakeAi({ text: "A rewritten overview." }, []);
    const p = ok(await Rep.proposeRewrite(ryan, { id: r.id, sectionId: "overview" }));
    expect(p.body).toBe("A rewritten overview.");
    const after = scoped(luke).get<HandoverReport>("handover_reports", r.id)!;
    expect(after.content.sections.find((s) => s.id === "overview")!.body).toBe("Luke's words.");
    expect(after.revision).toBe(l.revision);
  });

  it("exports numbered versions that stay retrievable, and can head the handover pack", async () => {
    const owner = ctxFor(N93_OWNER);
    const r = ok(Rep.createReport(owner, { jobId: GR }));
    const v1 = ok(await Rep.exportReport(owner, { id: r.id }));
    expect(v1.filename).toBe("Ninety3 - Garden Room - Handover v1.pdf");
    const cur = scoped(owner).get<HandoverReport>("handover_reports", r.id)!;
    ok(Rep.saveReport(owner, { id: r.id, baseRevision: cur.revision, content: { ...cur.content, title: "Lingfield garden room" } }));
    const v2 = ok(await Rep.exportReport(owner, { id: r.id }));
    expect(v2).toMatchObject({ version: 2, filename: "Ninety3 - Lingfield Garden Room - Handover v2.pdf" });
    expect(pdfText(F.readFile(owner, v1.fileId, "original")!.data)).toContain("Garden room");
    expect(F.deleteFile(owner, v1.fileId)).toMatchObject({ ok: false, code: "conflict" });
    // Not for the site team, workers or another company.
    expect(F.readFile(ctxFor(N93_STAFF), v1.fileId, "original")).toBeNull();
    expect(F.listFiles(ctxFor(N93_STAFF)).some((f) => f.reportId)).toBe(false);
    expect(F.readFile(ctxFor(RDG_OWNER), v1.fileId, "original")).toBeNull();
    expect(Rep.previewReport(ctxFor(RDG_OWNER), r.id)).resolves.toMatchObject({ ok: false });
    expect(Rep.saveReport(ctxFor(N93_STAFF), { id: r.id, baseRevision: 1 })).toMatchObject({ ok: false, code: "forbidden" });
    // In the handover pack, the report is the overview at the top.
    const h = ok(H.createHandover(owner, { jobId: GR, fileIds: ["n93_fil_gr_plan", v2.fileId] }));
    expect(h.items[0].zipPath).toBe("Ninety3 - Lingfield Garden Room - Handover v2.pdf");
  });

  it("a small job makes a one-page report; no costs section when costs are off", async () => {
    const owner = ctxFor(N93_OWNER);
    const r = ok(Rep.createReport(owner, { jobId: "n93_job_stairs_horley" }));
    const pdf = ok(await Rep.previewReport(owner, r.id));
    expect(pdf.pages).toBe(1);
    const text = pdfText(pdf.data);
    expect(text).toContain("Oak staircase");
    expect(text).not.toMatch(/Cost summary|£/);
    if (OUT) fs.writeFileSync(`${OUT}/sample-staircase.pdf`, pdf.data);
  });
});

describe("Cost summary edge cases", () => {
  it("never shows invoiced money as due when payments (e.g. an unallocated deposit) already cover it", () => {
    const job = { id: "j", quotedValue: 12500 };
    const inv = { id: "i", jobId: "j", status: "sent", total: 4000, amountPaid: 0, vat: 0, dueDate: "2020-01-01" } as unknown as Invoice;
    const pay = { id: "p", jobId: "j", amount: 5000 } as unknown as Payment;
    const s = reportCostSummary(job, { variations: [], invoices: [inv], payments: [pay] });
    expect(s.lines.find((l) => l.key === "due")).toBeUndefined();
    expect(s.lines.find((l) => l.key === "balance")!.amount).toBe(7500);
    const s2 = reportCostSummary(job, { variations: [], invoices: [inv], payments: [] });
    expect(s2.lines.find((l) => l.key === "due")).toMatchObject({ amount: 4000, note: expect.stringMatching(/past its due date/) });
  });
  it("with no agreed price, says so and offers to omit or enter report figures", () => {
    const s = reportCostSummary({ id: "j", quotedValue: 0 }, { variations: [], invoices: [], payments: [] });
    expect(s.reliable).toBe(false);
    expect(s.lines).toHaveLength(0);
  });
});
