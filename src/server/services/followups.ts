import "server-only";
/**
 * Customer follow-ups: after a handover is finished, a thank-you email with
 * the published PDF attached and — if the business has switched it on — one
 * honest request for a Google review, plus an optional reminder a week later.
 *
 * Safeguards:
 *  - Sending goes through the connected mailbox only, and only once approved
 *    (the send action always needs approval; "automatic" mode counts finishing
 *    the handover as that approval). No mailbox → an editable draft instead.
 *  - Demo workspaces never send real email (see getEmailProvider).
 *  - One review request per job; the same PDF version isn't emailed twice.
 *  - Every customer gets the same wording. Bob never filters customers by
 *    expected rating and never records that a review was received.
 */
import type { CustomerFollowUp, HandoverReport, Job, ReportVersion } from "@/lib/types";
import { contactLine, fillTemplate, followUpSettings, REMINDER, REMINDER_DAYS, reviewsReady } from "@/lib/followups";
import { addDays } from "@/lib/dates";
import { todayKey, uid } from "@/lib/utils";
import { getDb, scoped, tx } from "@/server/db";
import { fail, ok, type Ctx, type Result } from "@/server/context";
import { getEmailProvider } from "@/server/integrations/registry";
import { usersInOrg } from "@/server/auth/session";
import { audit, createTask, deleteTask, getCustomer, getJob } from "./records";

const now = () => new Date().toISOString();

/** "Luke & Ryan": first names of the owner and admins who sign the email. */
function teamNames(ctx: Ctx): string {
  const names = usersInOrg(ctx.orgId).filter((u) => u.role === "owner" || u.role === "office").map((u) => u.name.split(/\s+/)[0]).filter((n) => n && !/^(owner|office)$/i.test(n));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names[0] ?? ctx.org.shortName ?? ctx.org.name;
}
const baseVars = (ctx: Ctx) => ({ business: ctx.org.shortName || ctx.org.name, businessName: ctx.org.name, team: teamNames(ctx), signOff: ctx.org.assistant.signOff, contact: contactLine(ctx.org) });
const isManager = (ctx: Ctx) => ctx.role === "owner" || ctx.role === "office";

export function listFollowUps(ctx: Ctx): CustomerFollowUp[] {
  if (!isManager(ctx)) return [];
  return scoped(ctx).list<CustomerFollowUp>("customer_followups", { order: "created_at DESC" });
}

const forJob = (ctx: Ctx, jobId: string) => scoped(ctx).list<CustomerFollowUp>("customer_followups", { where: "job_id = ?", params: [jobId], order: "created_at DESC" });

/** The finished report for a job and the PDF version it published. */
function published(ctx: Ctx, jobId: string): { job: Job; report: HandoverReport; version?: ReportVersion } | { error: string } {
  const job = getJob(ctx, jobId);
  if (!job) return { error: "I couldn't find that job." };
  const report = scoped(ctx).list<HandoverReport>("handover_reports", { where: "job_id = ?", params: [jobId] })[0];
  if (!report) return { error: `There's no handover report for ${job.customerName}'s ${job.title.toLowerCase()} yet. Create it from the job first.` };
  if (!report.completedAt) return { error: `${job.customerName}'s handover isn't finished yet. Open it and press Finish handover first.` };
  if (report.completedRevision !== report.revision) return { error: `The handover has changes that aren't in the PDF yet. Finish it again first, so ${job.customerName.split(" ")[0]} gets the latest version.` };
  const versions = scoped(ctx).list<ReportVersion & { content?: unknown; selection?: unknown }>("report_versions", { where: "report_id = ?", params: [report.id], order: "version DESC" });
  const v = versions.find((x) => x.revision === report.completedRevision) ?? versions[0];
  return { job, report, version: v ? { id: v.id, reportId: v.reportId, jobId: v.jobId, version: v.version, fileId: v.fileId, filename: v.filename, pages: v.pages, createdBy: v.createdBy, createdAt: v.createdAt, revision: v.revision } : undefined };
}

export interface Composed {
  jobId: string;
  to: string;
  subject: string;
  body: string;
  includeReview: boolean;
  /** Review requests are switched on with a valid link, and none has been sent for this job. */
  reviewAvailable: boolean;
  reviewAlreadyRequested?: string;
  attachment?: { filename: string; fileId: string; version: number };
  alreadySent?: { at: string; version?: number; by?: string };
  mailbox: { connected: boolean; simulated: boolean; label?: string };
  draftId?: string;
}

/** The email Bob would send for this job: a saved draft if there is one, otherwise the business's template filled in. */
export function composeFollowUp(ctx: Ctx, input: { jobId?: unknown; includeReview?: unknown }): Result<Composed> {
  if (!isManager(ctx)) return fail("forbidden", "Only an owner or admin can email customers.");
  const jobId = typeof input.jobId === "string" ? input.jobId : "";
  const p = published(ctx, jobId);
  if ("error" in p) return fail("invalid", p.error);
  const settings = followUpSettings(ctx.org);
  const customer = getCustomer(ctx, p.job.customerId);
  const history = forJob(ctx, jobId);
  const requested = history.find((f) => f.status === "sent" && f.reviewRequested);
  const sentThisVersion = history.find((f) => f.status === "sent" && f.version === p.version?.version);
  const reviewAvailable = reviewsReady(settings) && !requested;
  const includeReview = reviewAvailable && input.includeReview !== false;
  const provider = getEmailProvider(ctx);
  const draft = history.find((f) => f.status === "draft");
  const vars = {
    firstName: (p.report.content.customerName || p.job.customerName).split(/\s+/)[0] || "there",
    customerName: p.report.content.customerName || p.job.customerName,
    job: p.report.content.title.toLowerCase(),
    ...baseVars(ctx),
    reviewLink: settings.reviewUrl,
  };
  let body = fillTemplate(settings.template.body, vars, includeReview);
  // Always give the customer a way to get in touch.
  if (vars.contact && !body.includes(vars.contact)) body = `${body}\n${body.includes(ctx.org.name) ? "" : `${ctx.org.name}\n`}${vars.contact}`;
  return ok({
    jobId,
    to: draft?.toAddress ?? customer?.email ?? p.job.customerEmail ?? "",
    subject: draft?.subject ?? fillTemplate(settings.template.subject, vars, false),
    body: draft?.body ?? body,
    includeReview: draft ? draft.reviewRequested && reviewAvailable : includeReview,
    reviewAvailable,
    reviewAlreadyRequested: requested?.sentAt,
    attachment: p.version ? { filename: p.version.filename, fileId: p.version.fileId, version: p.version.version } : undefined,
    alreadySent: sentThisVersion ? { at: sentThisVersion.sentAt!, version: sentThisVersion.version, by: sentThisVersion.approvedBy } : undefined,
    mailbox: { connected: !!provider, simulated: !!provider?.simulated, label: provider?.label },
    draftId: draft?.id,
  });
}

export interface SendInput {
  jobId: string;
  to: string;
  subject: string;
  body: string;
  includeReview: boolean;
}

/** Checks shared by the preview card and the send itself. Returns a plain-English reason when it can't go. */
export function checkSend(ctx: Ctx, a: SendInput): string | null {
  const p = published(ctx, a.jobId);
  if ("error" in p) return p.error;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.to)) return `I need ${p.job.customerName.split(" ")[0]}'s email address — add it to their customer record or type it in.`;
  const history = forJob(ctx, a.jobId);
  if (a.includeReview) {
    const requested = history.find((f) => f.status === "sent" && f.reviewRequested);
    if (requested) return `A review was already requested from ${p.job.customerName} on ${requested.sentAt?.slice(0, 10)}. Bob only asks once — remove the review link to send the email anyway.`;
    if (!reviewsReady(followUpSettings(ctx.org))) return "Review requests are switched off (or there's no Google review link) in Settings → Customer follow-ups.";
  }
  const dup = history.find((f) => f.status === "sent" && f.version === p.version?.version);
  if (dup) return `Version ${dup.version} of the handover was already sent to ${p.job.customerName} on ${dup.sentAt?.slice(0, 10)}. Edit and finish the handover again to send an updated version.`;
  return null;
}

/** Save (or update) the editable draft for this job. Nothing is sent. */
export function saveFollowUpDraft(ctx: Ctx, a: SendInput): Result<CustomerFollowUp> {
  if (!isManager(ctx)) return fail("forbidden", "Only an owner or admin can email customers.");
  const p = published(ctx, a.jobId);
  if ("error" in p) return fail("invalid", p.error);
  const db = scoped(ctx);
  const existing = forJob(ctx, a.jobId).find((f) => f.status === "draft");
  const fields = { toAddress: a.to, subject: a.subject.slice(0, 200), body: a.body.slice(0, 8000), reviewRequested: a.includeReview, reviewUrl: a.includeReview ? followUpSettings(ctx.org).reviewUrl : undefined, version: p.version?.version, updatedAt: now() };
  const row = existing
    ? db.update<CustomerFollowUp>("customer_followups", existing.id, fields)!
    : db.insert<CustomerFollowUp>("customer_followups", { id: uid("fu"), jobId: a.jobId, reportId: p.report.id, status: "draft", reminderStatus: "none", createdBy: ctx.userName, createdAt: now(), ...fields });
  if (!existing) audit(ctx, "followup.draft", `Thank-you email drafted for ${p.job.customerName} (not sent)`, "job", a.jobId);
  return ok(row);
}

function scheduleReminder(ctx: Ctx, f: CustomerFollowUp, job: Job): Partial<CustomerFollowUp> {
  const s = followUpSettings(ctx.org);
  if (!f.reviewRequested || !s.reminder) return { reminderStatus: "none" };
  const due = addDays(todayKey(), REMINDER_DAYS);
  // A task for whoever approved it, so the reminder is visible (and can be sent or cancelled) even without a mailbox.
  const t = createTask(ctx, { title: `Review reminder: ${job.customerName} (${job.title})`, dueDate: due, relatedType: "job", relatedId: job.id, customerId: job.customerId, assignedUserId: ctx.userId });
  return { reminderStatus: "scheduled", reminderDueAt: due, reminderTaskId: t.ok ? t.value.id : undefined };
}

function afterSent(ctx: Ctx, f: CustomerFollowUp, job: Job, report: HandoverReport, version?: number) {
  getDb().prepare("UPDATE handover_reports SET sent_at = ?, sent_by = ?, sent_version = ? WHERE org_id = ? AND id = ?").run(f.sentAt!, f.approvedBy!, version ?? null, ctx.orgId, report.id);
}

/** Send the email now through the connected mailbox (or the demo inbox), with the PDF attached. */
export async function sendFollowUp(ctx: Ctx, a: SendInput, idempotencyKey: string): Promise<Result<CustomerFollowUp>> {
  if (!isManager(ctx)) return fail("forbidden", "Only an owner or admin can email customers.");
  const problem = checkSend(ctx, a);
  if (problem) return fail("invalid", problem);
  const provider = getEmailProvider(ctx);
  if (!provider) return fail("invalid", "Email isn't connected, so Bob can't send it. Save it as a draft instead.");
  const p = published(ctx, a.jobId) as Exclude<ReturnType<typeof published>, { error: string }>;
  const attachments = [];
  if (p.version) {
    const blob = getDb().prepare("SELECT data FROM file_blobs WHERE org_id = ? AND file_id = ? AND kind = 'original'").get(ctx.orgId, p.version.fileId) as { data: Uint8Array } | undefined;
    if (!blob) return fail("unavailable", "Couldn't find the handover PDF to attach. Finish the handover again and retry.");
    attachments.push({ filename: p.version.filename, mimeType: "application/pdf", data: Buffer.from(blob.data) });
  }
  let outcome;
  try {
    outcome = await provider.send(ctx, { to: a.to, subject: a.subject, body: a.body, attachments }, idempotencyKey);
  } catch (e) {
    outcome = { ok: false as const, error: e instanceof Error ? e.message : "Email provider error", retryable: true };
  }
  const db = scoped(ctx);
  const draft = forJob(ctx, a.jobId).find((f) => f.status === "draft");
  if (!outcome.ok) {
    audit(ctx, "followup.failed", `Thank-you email to ${a.to} failed: ${outcome.error}`, "job", a.jobId);
    return fail("unavailable", `The email didn't send (${outcome.error}). Nothing was recorded as sent — try again.`);
  }
  const at = now();
  const base = {
    toAddress: a.to, subject: a.subject, body: a.body, reviewRequested: a.includeReview, reviewUrl: a.includeReview ? followUpSettings(ctx.org).reviewUrl : undefined,
    status: "sent" as const, sentVia: provider.simulated ? ("demo" as const) : provider.id === "gmail" ? ("gmail" as const) : ("outlook" as const),
    approvedBy: ctx.userName, approvedAt: at, sentAt: at, version: p.version?.version, updatedAt: at,
  };
  const row = tx(() => {
    let f = draft
      ? db.update<CustomerFollowUp>("customer_followups", draft.id, base)!
      : db.insert<CustomerFollowUp>("customer_followups", { id: uid("fu"), jobId: a.jobId, reportId: p.report.id, reminderStatus: "none", createdBy: ctx.userName, createdAt: at, ...base });
    f = db.update<CustomerFollowUp>("customer_followups", f.id, scheduleReminder(ctx, f, p.job))!;
    afterSent(ctx, f, p.job, p.report, p.version?.version);
    audit(ctx, "followup.sent", `${provider.simulated ? "Demo: thank-you email simulated (not really sent)" : "Thank-you email sent"} to ${p.job.customerName} with handover v${p.version?.version ?? "?"}${a.includeReview ? " and a review request" : ""} — approved by ${ctx.userName}`, "job", a.jobId);
    return f;
  });
  return ok(row);
}

/** The person sent the draft from their own email: record it (who, when) and start the reminder if set. */
export function markFollowUpSent(ctx: Ctx, input: { id?: unknown }): Result<CustomerFollowUp> {
  if (!isManager(ctx)) return fail("forbidden", "Only an owner or admin can do that.");
  const db = scoped(ctx);
  const f = typeof input.id === "string" ? db.get<CustomerFollowUp>("customer_followups", input.id) : undefined;
  if (!f) return fail("not_found", "Email not found");
  if (f.status === "sent") return ok(f);
  const problem = checkSend(ctx, { jobId: f.jobId, to: f.toAddress, subject: f.subject, body: f.body, includeReview: f.reviewRequested });
  if (problem) return fail("invalid", problem);
  const p = published(ctx, f.jobId) as Exclude<ReturnType<typeof published>, { error: string }>;
  const at = now();
  const out = tx(() => {
    let u = db.update<CustomerFollowUp>("customer_followups", f.id, { status: "sent", sentVia: "manual", approvedBy: ctx.userName, approvedAt: at, sentAt: at, version: p.version?.version, updatedAt: at })!;
    u = db.update<CustomerFollowUp>("customer_followups", f.id, scheduleReminder(ctx, u, p.job))!;
    afterSent(ctx, u, p.job, p.report, p.version?.version);
    audit(ctx, "followup.sent_manually", `${ctx.userName} sent the thank-you email to ${p.job.customerName} from their own email${f.reviewRequested ? " (with a review request)" : ""}`, "job", f.jobId);
    return u;
  });
  return ok(out);
}

export function cancelFollowUpReminder(ctx: Ctx, input: { id?: unknown }): Result<CustomerFollowUp> {
  if (!isManager(ctx)) return fail("forbidden", "Only an owner or admin can do that.");
  const db = scoped(ctx);
  const f = typeof input.id === "string" ? db.get<CustomerFollowUp>("customer_followups", input.id) : undefined;
  if (!f) return fail("not_found", "Email not found");
  if (f.reminderStatus !== "scheduled") return fail("invalid", "There's no reminder waiting to be cancelled.");
  if (f.reminderTaskId) deleteTask(ctx, f.reminderTaskId);
  const u = db.update<CustomerFollowUp>("customer_followups", f.id, { reminderStatus: "cancelled", updatedAt: now() })!;
  audit(ctx, "followup.reminder_cancelled", `Review reminder for ${getJob(ctx, f.jobId)?.customerName ?? "the customer"} cancelled`, "job", f.jobId);
  return ok(u);
}

/** Send the one review reminder now (no attachment). Needs a mailbox; demo workspaces simulate it. */
export async function sendFollowUpReminder(ctx: Ctx, input: { id?: unknown }, idempotencyKey = uid("rem")): Promise<Result<CustomerFollowUp>> {
  if (!isManager(ctx)) return fail("forbidden", "Only an owner or admin can email customers.");
  const db = scoped(ctx);
  const f = typeof input.id === "string" ? db.get<CustomerFollowUp>("customer_followups", input.id) : undefined;
  if (!f) return fail("not_found", "Email not found");
  if (f.reminderStatus !== "scheduled") return fail("invalid", f.reminderStatus === "sent" ? "The reminder has already been sent." : "There's no reminder scheduled.");
  const provider = getEmailProvider(ctx);
  if (!provider) return fail("invalid", "Email isn't connected, so Bob can't send the reminder. Send it from your own email, then cancel the reminder here.");
  const job = getJob(ctx, f.jobId);
  const settings = followUpSettings(ctx.org);
  const vars = { firstName: (job?.customerName ?? "").split(/\s+/)[0] || "there", customerName: job?.customerName ?? "", job: (job?.title ?? "project").toLowerCase(), ...baseVars(ctx), reviewLink: f.reviewUrl ?? settings.reviewUrl };
  const outcome = await provider.send(ctx, { to: f.toAddress, subject: fillTemplate(REMINDER.subject, vars, true), body: fillTemplate(REMINDER.body, vars, true) }, idempotencyKey).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Email provider error", retryable: true }));
  if (!outcome.ok) return fail("unavailable", `The reminder didn't send (${outcome.error}). Try again.`);
  if (f.reminderTaskId) deleteTask(ctx, f.reminderTaskId);
  const u = db.update<CustomerFollowUp>("customer_followups", f.id, { reminderStatus: "sent", reminderSentAt: now(), updatedAt: now() })!;
  audit(ctx, "followup.reminder_sent", `${provider.simulated ? "Demo: review reminder simulated" : "Review reminder sent"} to ${job?.customerName ?? f.toAddress} — by ${ctx.userName}`, "job", f.jobId);
  return ok(u);
}

/**
 * Due reminders. In automatic mode with a mailbox they're sent; otherwise the
 * task created when the email went stays on the list for the person to act on.
 * Called when someone opens Bob (there's no background worker on the free plan).
 */
export async function processDueReminders(ctx: Ctx): Promise<number> {
  if (!isManager(ctx)) return 0;
  const s = followUpSettings(ctx.org);
  if (s.mode !== "auto" || !getEmailProvider(ctx)) return 0;
  const due = scoped(ctx).list<CustomerFollowUp>("customer_followups", { where: "reminder_status = 'scheduled' AND reminder_due_at <= ?", params: [todayKey()] });
  let n = 0;
  for (const f of due) if ((await sendFollowUpReminder(ctx, { id: f.id }, `rem_${f.id}`)).ok) n++;
  return n;
}

/** Automatic mode: finishing the handover counts as approval, so the email goes straight away (mailbox and email address permitting). */
export async function afterHandoverFinished(ctx: Ctx, jobId: string): Promise<{ sent?: CustomerFollowUp; note?: string }> {
  const s = followUpSettings(ctx.org);
  if (s.mode !== "auto") return {};
  if (!getEmailProvider(ctx)) return { note: "Automatic sending is on, but no email account is connected — open Send to customer to save a draft." };
  const c = composeFollowUp(ctx, { jobId });
  if (!c.ok) return { note: c.error };
  if (c.value.alreadySent) return {};
  const r = await sendFollowUp(ctx, { jobId, to: c.value.to, subject: c.value.subject, body: c.value.body, includeReview: c.value.includeReview }, `auto_${jobId}_${c.value.attachment?.version ?? 0}`);
  return r.ok ? { sent: r.value } : { note: r.error };
}

/** For Ask Bob: finished handovers and where each customer is up to. */
export function reviewRequestStatus(ctx: Ctx) {
  const reports = scoped(ctx).list<HandoverReport>("handover_reports", { where: "completed_at IS NOT NULL" });
  const all = listFollowUps(ctx);
  return reports.map((r) => {
    const job = getJob(ctx, r.jobId);
    const fs = all.filter((f) => f.jobId === r.jobId);
    const sent = fs.find((f) => f.status === "sent");
    const review = fs.find((f) => f.status === "sent" && f.reviewRequested);
    return {
      job_id: r.jobId,
      job: job ? `${job.customerName} — ${job.title}` : r.jobId,
      handover_completed: r.completedAt?.slice(0, 10),
      email_sent: sent ? `${sent.sentAt?.slice(0, 10)}${sent.sentVia === "demo" ? " (demo, simulated)" : sent.sentVia === "manual" ? " (sent from their own email)" : ""}` : null,
      draft_waiting: fs.some((f) => f.status === "draft"),
      review_requested: review ? review.sentAt?.slice(0, 10) : null,
      reminder: review ? review.reminderStatus : null,
    };
  });
}
