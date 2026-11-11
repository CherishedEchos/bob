import { NextResponse } from "next/server";
import { authed, fromResult, readJson } from "@/server/http";
import type { Ctx, Result } from "@/server/context";
import * as R from "@/server/services/records";
import * as F from "@/server/services/finance";
import { syncInbox } from "@/server/integrations/inbox";
import { buildSnapshot } from "@/server/services/snapshot";

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
};

export const POST = authed(async (req, ctx) => {
  const body = await readJson(req);
  const op = OPS[s(body.op)];
  if (!op) return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
  const result = await op(ctx, (body.args as Record<string, unknown>) ?? {});
  const res = fromResult(result);
  if (res instanceof Response) return res;
  return { ...res, snapshot: buildSnapshot(ctx) };
});
