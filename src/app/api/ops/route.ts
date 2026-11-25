import { NextResponse } from "next/server";
import { authed, fromResult, readJson } from "@/server/http";
import type { Ctx, Result } from "@/server/context";
import * as R from "@/server/services/records";
import * as F from "@/server/services/finance";
import { syncInbox } from "@/server/integrations/inbox";
import { buildSnapshot } from "@/server/services/snapshot";
import * as T from "@/server/services/team";
import * as M from "@/server/services/merchants";
import * as Cal from "@/server/services/calendar";
import * as Abs from "@/server/services/absences";
import * as Files from "@/server/services/files";
import * as Var from "@/server/services/variations";
import * as Rep from "@/server/services/handover-reports";
import * as FU from "@/server/services/followups";

export const runtime = "nodejs";

const s = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Dashboard operations — the manual (no-AI) path. Same services, permissions,
 * validation and audit log as Bob. Organisation comes from the session.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OPS: Record<string, (ctx: Ctx, a: Record<string, any>) => Result<unknown> | Promise<Result<unknown>>> = {
  createEnquiry: (c, a) => R.createEnquiry(c, a.input),
  updateEnquiry: (c, a) => R.updateEnquiry(c, s(a.id), a.patch),
  setEnquiryStatus: (c, a) => R.setEnquiryStatus(c, s(a.id), a.status),
  addEnquiryNote: (c, a) => R.addEnquiryNote(c, s(a.id), s(a.text)),
  saveDraftReply: (c, a) => R.saveDraftReply(c, s(a.id), s(a.text)),
  markEnquiryReplied: (c, a) => R.markEnquiryReplied(c, s(a.id)),
  createCustomer: (c, a) => R.createCustomer(c, a.input),
  updateCustomer: (c, a) => R.updateCustomer(c, s(a.id), a.input),
  addCustomerNote: (c, a) => R.addCustomerNote(c, s(a.id), s(a.text)),
  createJob: (c, a) => R.createJob(c, a.input),
  updateJob: (c, a) => R.updateJob(c, s(a.id), a.patch),
  setJobStatus: (c, a) => R.setJobStatus(c, s(a.id), a.status),
  addJobNote: (c, a) => R.addJobNote(c, s(a.id), s(a.text)),
  recordPayment: (c, a) => F.recordPayment(c, a.input),
  logPaymentChased: (c, a) => F.logPaymentChased(c, s(a.jobId)),
  createTask: (c, a) => R.createTask(c, a.input),
  setTaskDone: (c, a) => R.setTaskDone(c, s(a.id), a.done === true),
  deleteTask: (c, a) => R.deleteTask(c, s(a.id)),
  addExpense: (c, a) => R.addExpense(c, a.input),
  removeExpense: (c, a) => R.removeExpense(c, s(a.id)),
  createQuote: (c, a) => R.createQuote(c, a.input),
  setQuoteStatus: (c, a) => R.setQuoteStatus(c, s(a.id), a.status),
  createInvoiceDraft: (c, a) => F.createInvoiceDraft(c, a.input),
  markInvoiceSent: (c, a) => F.markInvoiceSentManually(c, s(a.id)),
  voidInvoice: (c, a) => F.voidInvoice(c, s(a.id)),
  deleteInvoiceDraft: (c, a) => F.deleteInvoiceDraft(c, s(a.id)),
  syncInbox: (c) => syncInbox(c),
  convertToJob: (c, a) => R.convertToJob(c, a),
  createPerson: (c, a) => T.createPerson(c, a.input),
  updatePerson: (c, a) => T.updatePerson(c, s(a.id), a.input),
  archivePerson: (c, a) => T.archivePerson(c, s(a.id), a.archived !== false),
  revokeAccess: (c, a) => T.revokeAccess(c, s(a.personId)),
  createInvite: (c, a) => T.createInvite(c, s(a.personId), typeof a.email === "string" ? a.email : undefined, a.role === "office" ? "office" : "worker"),
  revokeInvite: (c, a) => T.revokeInvite(c, s(a.inviteId)),
  saveBooking: (c, a) => T.saveBooking(c, a.input),
  deleteBooking: (c, a) => T.deleteBooking(c, s(a.id)),
  saveMaterial: (c, a) => T.saveMaterial(c, a.input),
  setMaterialStatus: (c, a) => T.setMaterialStatus(c, s(a.id), a.status),
  deleteMaterial: (c, a) => T.deleteMaterial(c, s(a.id)),
  createBill: (c, a) => T.createBill(c, a.input),
  setBillPaid: (c, a) => T.setBillPaid(c, s(a.id), a.paid !== false, a.payment ?? {}),
  saveMerchant: (c, a) => M.saveMerchant(c, typeof a.id === "string" ? a.id : undefined, a.input),
  archiveMerchant: (c, a) => M.archiveMerchant(c, s(a.id), a.archived !== false),
  createFeed: (c, a) => Cal.createFeed(c, a.scope === "company" ? "company" : "person"),
  revokeFeed: (c, a) => Cal.revokeFeed(c, s(a.id)),
  addAbsence: (c, a) => Abs.addAbsence(c, a.input),
  decideAbsence: (c, a) => Abs.decideAbsence(c, s(a.id), a.decision),
  cancelAbsence: (c, a) => Abs.cancelAbsence(c, s(a.id)),
  updateFile: (c, a) => Files.updateFile(c, s(a.id), a.patch ?? {}),
  deleteFile: (c, a) => Files.deleteFile(c, s(a.id)),
  saveVariation: (c, a) => Var.saveVariation(c, a.input),
  deleteVariation: (c, a) => Var.deleteVariation(c, s(a.id)),
  createReport: (c, a) => Rep.createReport(c, a),
  saveReport: (c, a) => Rep.saveReport(c, a),
  generateReport: (c, a) => Rep.generateReport(c, a),
  proposeRewrite: (c, a) => Rep.proposeRewrite(c, a),
  exportReport: (c, a) => Rep.exportReport(c, a),
  // Finishing can send the thank-you email straight away in automatic mode (Settings → Customer follow-ups).
  finishReport: async (c, a) => {
    const r = await Rep.finishReport(c, a);
    if (!r.ok) return r;
    const auto = await FU.afterHandoverFinished(c, r.value.report.jobId);
    return { ...r, value: { ...r.value, autoEmail: auto } };
  },
  composeFollowUp: (c, a) => FU.composeFollowUp(c, a),
  markFollowUpSent: (c, a) => FU.markFollowUpSent(c, a),
  cancelFollowUpReminder: (c, a) => FU.cancelFollowUpReminder(c, a),
  sendFollowUpReminder: (c, a) => FU.sendFollowUpReminder(c, a),
  markReportSent: (c, a) => Rep.markReportSent(c, a),
  reportPack: (c, a) => Rep.reportPack(c, a),
};

export const POST = authed(async (req, ctx) => {
  const body = await readJson(req);
  const op = OPS[s(body.op)];
  if (!op) return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
  const result = await op(ctx, (body.args as Record<string, unknown>) ?? {});
  const res = fromResult(result);
  if (res instanceof Response) {
    // Booking clashes come back with the details so the planner can confirm.
    const clashes = (result as { clashes?: unknown }).clashes;
    // A report save that lost a race returns the other person's version, so nothing is lost on screen.
    const current = (result as { current?: unknown }).current;
    if (clashes || current) {
      const json = await res.json();
      return NextResponse.json({ ...json, clashes, current }, { status: res.status });
    }
    return res;
  }
  return { ...res, snapshot: buildSnapshot(ctx) };
});
