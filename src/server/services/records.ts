import "server-only";
import type {
  ActivityEntry, Customer, Enquiry, EnquiryStatus, Expense, Job, JobStatus, Note, Quote, Task,
} from "@/lib/types";
import {
  customerInputSchema, enquiryInputSchema, enquiryPatchSchema, expenseInputSchema, jobInputSchema, jobPatchSchema,
  jobStatusSchema, noteInputSchema, quoteInputSchema, taskInputSchema, toFieldErrors,
} from "@/lib/validation";
import { ENQUIRY_STATUS_LABEL, JOB_STATUS_LABEL, EXPENSE_CATEGORY_LABEL, inferJobKind, nameMatches, normaliseText } from "@/lib/derive";
import { gbp, uid, firstName, formatDateInline } from "@/lib/utils";
import { scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";

const now = () => new Date().toISOString();

/* --------------------------------- Audit --------------------------------- */

export function audit(ctx: Ctx, action: string, summary: string, entityType?: string, entityId?: string): ActivityEntry {
  const entry: ActivityEntry = {
    id: uid("act"),
    at: now(),
    actor: ctx.userName,
    via: ctx.via,
    action,
    summary,
    entityType,
    entityId,
  };
  scoped(ctx).insert("activity", entry);
  return entry;
}

const makeNote = (ctx: Ctx, text: string): Note => ({ id: uid("note"), text, createdAt: now(), author: ctx.userName });

/* ------------------------------- Customers ------------------------------- */

export function listCustomers(ctx: Ctx): Customer[] {
  return scoped(ctx).list<Customer>("customers", { order: "name" });
}

export function getCustomer(ctx: Ctx, id: string): Customer | undefined {
  return scoped(ctx).get<Customer>("customers", id);
}

export interface CustomerMatch {
  customer: Customer;
  score: number;
  reason: string;
}

/**
 * Find customers by name (first name, surname, "the Smiths"), email, phone or
 * town. Returns scored matches; callers decide whether a match is clear.
 */
export function searchCustomers(ctx: Ctx, query: string): CustomerMatch[] {
  const q = normaliseText(query).replace(/^the /, "");
  if (!q) return [];
  const qDigits = query.replace(/\D/g, "");
  const out: CustomerMatch[] = [];
  for (const c of listCustomers(ctx)) {
    const name = normaliseText(c.name);
    let score = 0;
    let reason = "";
    if (name === q || name === `the ${q}`) [score, reason] = [100, "exact name"];
    else if (nameMatches(c.name, q)) [score, reason] = [q.includes(" ") ? 90 : 70, "name"];
    else if (c.email && c.email.toLowerCase() === query.trim().toLowerCase()) [score, reason] = [100, "email"];
    else if (qDigits.length >= 6 && c.phone && c.phone.replace(/\D/g, "").endsWith(qDigits)) [score, reason] = [95, "phone"];
    if (score) out.push({ customer: c, score, reason });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function createCustomer(ctx: Ctx, input: unknown): Result<Customer> {
  const no = denied(ctx, "customers.write");
  if (no) return no;
  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the customer details.", toFieldErrors(parsed.error));
  const customer: Customer = { id: uid("cus"), ...parsed.data, notes: [], createdAt: now() };
  tx(() => {
    scoped(ctx).insert("customers", customer);
    audit(ctx, "customer.created", `Customer added: ${customer.name}`, "customer", customer.id);
  });
  return ok(customer);
}

export function updateCustomer(ctx: Ctx, id: string, input: unknown): Result<Customer> {
  const no = denied(ctx, "customers.write");
  if (no) return no;
  const c = getCustomer(ctx, id);
  if (!c) return fail("not_found", "Customer not found");
  const parsed = customerInputSchema.partial().safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the customer details.", toFieldErrors(parsed.error));
  const updated = tx(() => {
    const u = scoped(ctx).update<Customer>("customers", id, parsed.data)!;
    audit(ctx, "customer.updated", `Updated ${c.name}'s details`, "customer", id);
    return u;
  });
  return ok(updated);
}

export function addCustomerNote(ctx: Ctx, id: string, text: string): Result<Note> {
  const no = denied(ctx, "notes.write");
  if (no) return no;
  const c = getCustomer(ctx, id);
  if (!c) return fail("not_found", "Customer not found");
  const parsed = noteInputSchema.safeParse({ text });
  if (!parsed.success) return fail("invalid", "Write a note first.", toFieldErrors(parsed.error));
  const note = makeNote(ctx, parsed.data.text);
  tx(() => {
    scoped(ctx).update<Customer>("customers", id, { notes: [note, ...c.notes] });
    audit(ctx, "customer.note_added", `Note added to ${c.name}`, "customer", id);
  });
  return ok(note);
}

/* ------------------------------- Enquiries ------------------------------- */

export function listEnquiries(ctx: Ctx): Enquiry[] {
  return scoped(ctx).list<Enquiry>("enquiries", { order: "received_at DESC" });
}

export function getEnquiry(ctx: Ctx, id: string) {
  return scoped(ctx).get<Enquiry>("enquiries", id);
}

export function createEnquiry(ctx: Ctx, input: unknown, extra: Partial<Enquiry> = {}): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const parsed = enquiryInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the enquiry details.", toFieldErrors(parsed.error));
  const v = parsed.data;
  if (v.customerId && !getCustomer(ctx, v.customerId)) return fail("not_found", "Customer not found");
  const at = now();
  const enquiry: Enquiry = {
    id: uid("enq"),
    customerId: v.customerId,
    customerName: v.customerName,
    email: v.email,
    phone: v.phone,
    instagramHandle: v.instagramHandle,
    source: v.source,
    title: v.title,
    description: v.description,
    location: v.location,
    receivedAt: at,
    status: "new",
    priority: v.priority,
    assignedUserId: v.assignedUserId,
    followUpDate: v.followUpDate,
    notes: [],
    messages: v.description
      ? [{ id: uid("msg"), direction: "inbound", at, body: v.description, channel: v.source === "phone" ? "phone" : "manual" }]
      : [],
    suggestedReply: `Hi ${firstName(v.customerName)},\n\nThanks for getting in touch about the ${v.title.toLowerCase()}. Could you send over a few photos and rough measurements? Then we can arrange a time to come and have a look.\n\n${ctx.org.assistant.signOff}`,
    ...extra,
  };
  tx(() => {
    scoped(ctx).insert("enquiries", enquiry);
    audit(ctx, "enquiry.created", `Enquiry logged for ${enquiry.customerName} — ${enquiry.title}, ${enquiry.location}`, "enquiry", enquiry.id);
  });
  return ok(enquiry);
}

export function updateEnquiry(ctx: Ctx, id: string, patch: unknown): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Enquiry not found");
  const parsed = enquiryPatchSchema.safeParse(patch);
  if (!parsed.success) return fail("invalid", "Invalid change", toFieldErrors(parsed.error));
  const p = parsed.data;
  if (p.customerId && !getCustomer(ctx, p.customerId)) return fail("not_found", "Customer not found");
  const clean: Partial<Enquiry> = {};
  for (const [k, v] of Object.entries(p)) (clean as Record<string, unknown>)[k] = v === null ? null : v;
  const parts: string[] = [];
  if ("followUpDate" in p) parts.push(p.followUpDate ? `follow-up set for ${formatDateInline(p.followUpDate)}` : "follow-up cleared");
  if (p.priority) parts.push(`priority ${p.priority}`);
  if ("assignedUserId" in p) parts.push("assignee changed");
  if ("customerId" in p) parts.push("linked customer changed");
  const updated = tx(() => {
    const u = scoped(ctx).update<Enquiry>("enquiries", id, clean)!;
    audit(ctx, "enquiry.updated", `${e.customerName}'s enquiry: ${parts.join(", ") || "updated"}`, "enquiry", id);
    return u;
  });
  return ok(updated);
}

export function setEnquiryStatus(ctx: Ctx, id: string, status: EnquiryStatus): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Enquiry not found");
  if (!(status in ENQUIRY_STATUS_LABEL)) return fail("invalid", "Unknown status");
  if (e.status === status) return ok(e);
  const updated = tx(() => {
    const u = scoped(ctx).update<Enquiry>("enquiries", id, {
      status,
      lastContactAt: status === "replied" ? now() : e.lastContactAt,
    })!;
    audit(ctx, "enquiry.status_changed", `${e.customerName}'s enquiry moved to ${ENQUIRY_STATUS_LABEL[status]}`, "enquiry", id);
    return u;
  });
  return ok(updated);
}

export function addEnquiryNote(ctx: Ctx, id: string, text: string): Result<Note> {
  const no = denied(ctx, "notes.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Enquiry not found");
  const parsed = noteInputSchema.safeParse({ text });
  if (!parsed.success) return fail("invalid", "Write a note first.", toFieldErrors(parsed.error));
  const note = makeNote(ctx, parsed.data.text);
  tx(() => {
    scoped(ctx).update<Enquiry>("enquiries", id, { notes: [note, ...e.notes] });
    audit(ctx, "enquiry.note_added", `Note added to ${e.customerName}'s enquiry`, "enquiry", id);
  });
  return ok(note);
}

export function saveDraftReply(ctx: Ctx, id: string, text: string): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Enquiry not found");
  const parsed = noteInputSchema.safeParse({ text });
  if (!parsed.success) return fail("invalid", "The reply is empty.", toFieldErrors(parsed.error));
  const updated = tx(() => {
    const u = scoped(ctx).update<Enquiry>("enquiries", id, { draftReply: parsed.data.text })!;
    audit(ctx, "enquiry.draft_saved", `Draft reply saved for ${e.customerName} (not sent)`, "enquiry", id);
    return u;
  });
  return ok(updated);
}

/** The user confirms they replied outside Bob (e.g. on Instagram or by phone). */
export function markEnquiryReplied(ctx: Ctx, id: string): Result<Enquiry> {
  const no = denied(ctx, "enquiries.write");
  if (no) return no;
  const e = getEnquiry(ctx, id);
  if (!e) return fail("not_found", "Enquiry not found");
  const updated = tx(() => {
    const u = scoped(ctx).update<Enquiry>("enquiries", id, {
      status: e.status === "new" || e.status === "awaiting_reply" ? "replied" : e.status,
      lastContactAt: now(),
    })!;
    audit(ctx, "enquiry.marked_replied", `${e.customerName} marked as replied to`, "enquiry", id);
    return u;
  });
  return ok(updated);
}

/* ---------------------------------- Jobs ---------------------------------- */

export function listJobs(ctx: Ctx): Job[] {
  const customers = new Map(listCustomers(ctx).map((c) => [c.id, c]));
  return scoped(ctx)
    .list<Job>("jobs", { order: "created_at DESC" })
    .map((j) => {
      const c = customers.get(j.customerId);
      return { ...j, customerName: c?.name ?? "Unknown customer", customerPhone: c?.phone, customerEmail: c?.email };
    });
}

export function getJob(ctx: Ctx, id: string): Job | undefined {
  const j = scoped(ctx).get<Job>("jobs", id);
  if (!j) return undefined;
  const c = getCustomer(ctx, j.customerId);
  return { ...j, customerName: c?.name ?? "Unknown customer", customerPhone: c?.phone, customerEmail: c?.email };
}

export function createJob(ctx: Ctx, input: unknown): Result<Job> {
  const no = denied(ctx, "jobs.write");
  if (no) return no;
  const parsed = jobInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the job details.", toFieldErrors(parsed.error));
  const v = parsed.data;
  if (v.customerId && !getCustomer(ctx, v.customerId)) return fail("not_found", "Customer not found");
  if (v.enquiryId && !getEnquiry(ctx, v.enquiryId)) return fail("not_found", "Enquiry not found");

  return tx(() => {
    let customerId = v.customerId;
    if (!customerId) {
      const created = createCustomer(ctx, {
        name: v.customerName,
        phone: v.customerPhone,
        email: v.customerEmail,
        town: v.location,
      });
      if (!created.ok) throw new Error(created.error);
      customerId = created.value.id;
    }
    const job: Job = {
      id: uid("job"),
      customerId,
      customerName: "",
      title: v.title,
      description: v.description,
      location: v.location,
      kind: inferJobKind(`${v.title} ${v.description}`),
      quotedValue: v.quotedValue,
      depositRequired: v.depositRequired,
      status: v.status,
      startDate: v.startDate,
      depositDueDate: v.depositDueDate,
      nextAction: v.nextAction,
      notes: [],
      enquiryId: v.enquiryId,
      createdAt: now(),
    };
    const { customerName: _n, customerPhone: _p, customerEmail: _e, ...row } = job;
    void _n; void _p; void _e;
    scoped(ctx).insert("jobs", row as Job);
    if (v.enquiryId) scoped(ctx).update<Enquiry>("enquiries", v.enquiryId, { status: "won", jobId: job.id, customerId });
    const full = getJob(ctx, job.id)!;
    audit(ctx, "job.created", `Job added: ${full.title} for ${full.customerName}, ${full.location} (${gbp(full.quotedValue)})`, "job", job.id);
    return ok(full);
  });
}

export function updateJob(ctx: Ctx, id: string, patch: unknown): Result<Job> {
  const no = denied(ctx, "jobs.write");
  if (no) return no;
  const j = getJob(ctx, id);
  if (!j) return fail("not_found", "Job not found");
  const parsed = jobPatchSchema.safeParse(patch);
  if (!parsed.success) return fail("invalid", "Check the job details.", toFieldErrors(parsed.error));
  const p = parsed.data as Record<string, unknown>;
  const quoted = (p.quotedValue as number | undefined) ?? j.quotedValue;
  const deposit = (p.depositRequired as number | undefined) ?? j.depositRequired;
  if (deposit > quoted) return fail("invalid", "Deposit can't be more than the quote", { depositRequired: "Deposit can't be more than the quote" });
  const updated = tx(() => {
    scoped(ctx).update<Job>("jobs", id, p as Partial<Job>);
    audit(ctx, "job.updated", `Updated ${j.customerName}'s ${j.title.toLowerCase()}`, "job", id);
    return getJob(ctx, id)!;
  });
  return ok(updated);
}

export function setJobStatus(ctx: Ctx, id: string, status: JobStatus): Result<Job> {
  const no = denied(ctx, "jobs.write");
  if (no) return no;
  const j = getJob(ctx, id);
  if (!j) return fail("not_found", "Job not found");
  if (!jobStatusSchema.safeParse(status).success) return fail("invalid", "Unknown status");
  if (j.status === status) return ok(j);
  const updated = tx(() => {
    scoped(ctx).update<Job>("jobs", id, { status });
    audit(ctx, "job.status_changed", `${j.customerName}'s ${j.title.toLowerCase()} moved to ${JOB_STATUS_LABEL[status]}`, "job", id);
    return getJob(ctx, id)!;
  });
  return ok(updated);
}

export function addJobNote(ctx: Ctx, id: string, text: string): Result<Note> {
  const no = denied(ctx, "notes.write");
  if (no) return no;
  const j = getJob(ctx, id);
  if (!j) return fail("not_found", "Job not found");
  const parsed = noteInputSchema.safeParse({ text });
  if (!parsed.success) return fail("invalid", "Write a note first.", toFieldErrors(parsed.error));
  const note = makeNote(ctx, parsed.data.text);
  tx(() => {
    scoped(ctx).update<Job>("jobs", id, { notes: [note, ...j.notes] });
    audit(ctx, "job.note_added", `Note added to ${j.customerName}'s ${j.title.toLowerCase()}`, "job", id);
  });
  return ok(note);
}

export function removeJobNote(ctx: Ctx, jobId: string, noteId: string): Result<true> {
  const no = denied(ctx, "notes.write");
  if (no) return no;
  const j = getJob(ctx, jobId);
  if (!j) return fail("not_found", "Job not found");
  tx(() => {
    scoped(ctx).update<Job>("jobs", jobId, { notes: j.notes.filter((n) => n.id !== noteId) });
    audit(ctx, "job.note_removed", `Note removed from ${j.customerName}'s ${j.title.toLowerCase()}`, "job", jobId);
  });
  return ok(true);
}

/* ---------------------------------- Tasks ---------------------------------- */

export function listTasks(ctx: Ctx): Task[] {
  return scoped(ctx).list<Task>("tasks", { order: "due_date ASC" });
}

export function createTask(ctx: Ctx, input: unknown): Result<Task> {
  const no = denied(ctx, "tasks.write");
  if (no) return no;
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the reminder.", toFieldErrors(parsed.error));
  const v = parsed.data;
  if (v.customerId && !getCustomer(ctx, v.customerId)) return fail("not_found", "Customer not found");
  if (v.relatedType && v.relatedId) {
    const table = ({ enquiry: "enquiries", job: "jobs", invoice: "invoices", customer: "customers" } as const)[v.relatedType];
    if (!scoped(ctx).get(table, v.relatedId)) return fail("not_found", "Linked record not found");
  }
  const task: Task = { id: uid("task"), ...v, done: false, createdAt: now(), createdBy: ctx.userName };
  tx(() => {
    scoped(ctx).insert("tasks", task);
    audit(ctx, "task.created", `Reminder set: ${task.title} (${formatDateInline(task.dueDate)})`, "task", task.id);
  });
  return ok(task);
}

export function setTaskDone(ctx: Ctx, id: string, done: boolean): Result<Task> {
  const no = denied(ctx, "tasks.write");
  if (no) return no;
  const t = scoped(ctx).get<Task>("tasks", id);
  if (!t) return fail("not_found", "Reminder not found");
  const updated = tx(() => {
    const u = scoped(ctx).update<Task>("tasks", id, { done, completedAt: done ? now() : undefined })!;
    if (!done) scoped(ctx).update<Task>("tasks", id, { completedAt: null as unknown as undefined });
    audit(ctx, done ? "task.completed" : "task.reopened", `${done ? "Done" : "Reopened"}: ${t.title}`, "task", id);
    return u;
  });
  return ok({ ...updated, done });
}

export function deleteTask(ctx: Ctx, id: string): Result<Task> {
  const no = denied(ctx, "tasks.write");
  if (no) return no;
  const t = scoped(ctx).get<Task>("tasks", id);
  if (!t) return fail("not_found", "Reminder not found");
  tx(() => {
    scoped(ctx).remove("tasks", id);
    audit(ctx, "task.deleted", `Reminder removed: ${t.title}`, "task", id);
  });
  return ok(t);
}

/* -------------------------------- Expenses -------------------------------- */

export function listExpenses(ctx: Ctx): Expense[] {
  return scoped(ctx).list<Expense>("expenses", { order: "incurred_on DESC" });
}

export function addExpense(ctx: Ctx, input: unknown): Result<Expense> {
  const no = denied(ctx, "expenses.write");
  if (no) return no;
  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the expense.", toFieldErrors(parsed.error));
  const j = getJob(ctx, parsed.data.jobId);
  if (!j) return fail("not_found", "Job not found");
  const expense: Expense = { id: uid("exp"), ...parsed.data, recordedBy: ctx.userName, createdAt: now() };
  tx(() => {
    scoped(ctx).insert("expenses", expense);
    audit(
      ctx,
      "expense.added",
      `${gbp(expense.amount)} ${EXPENSE_CATEGORY_LABEL[expense.category].toLowerCase()} added to ${j.customerName}'s ${j.title.toLowerCase()}`,
      "job",
      j.id,
    );
  });
  return ok(expense);
}

export function removeExpense(ctx: Ctx, id: string): Result<Expense> {
  const no = denied(ctx, "expenses.write");
  if (no) return no;
  const e = scoped(ctx).get<Expense>("expenses", id);
  if (!e) return fail("not_found", "Expense not found");
  tx(() => {
    scoped(ctx).remove("expenses", id);
    audit(ctx, "expense.removed", `${gbp(e.amount)} expense removed (${e.description})`, "job", e.jobId);
  });
  return ok(e);
}

/* --------------------------------- Quotes --------------------------------- */

export function listQuotes(ctx: Ctx): Quote[] {
  return scoped(ctx).list<Quote>("quotes", { order: "created_at DESC" });
}

export function createQuote(ctx: Ctx, input: unknown): Result<Quote> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  const parsed = quoteInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the quote.", toFieldErrors(parsed.error));
  const v = parsed.data;
  const c = getCustomer(ctx, v.customerId);
  if (!c) return fail("not_found", "Customer not found");
  const quote: Quote = { id: uid("quo"), ...v, sentAt: v.status === "sent" ? now() : undefined, createdAt: now() };
  tx(() => {
    scoped(ctx).insert("quotes", quote);
    if (v.enquiryId) scoped(ctx).update<Enquiry>("enquiries", v.enquiryId, { status: "quoted", lastContactAt: now() });
    audit(ctx, "quote.recorded", `Quote ${v.status === "sent" ? "recorded as sent" : "drafted"} for ${c.name}: ${gbp(v.amount)}`, "quote", quote.id);
  });
  return ok(quote);
}

export function setQuoteStatus(ctx: Ctx, id: string, status: Quote["status"]): Result<Quote> {
  const no = denied(ctx, "quotes.write");
  if (no) return no;
  const q = scoped(ctx).get<Quote>("quotes", id);
  if (!q) return fail("not_found", "Quote not found");
  const updated = tx(() => {
    const u = scoped(ctx).update<Quote>("quotes", id, {
      status,
      respondedAt: status === "accepted" || status === "declined" ? now() : q.respondedAt,
      sentAt: status === "sent" && !q.sentAt ? now() : q.sentAt,
    })!;
    if (q.enquiryId && (status === "accepted" || status === "declined"))
      scoped(ctx).update<Enquiry>("enquiries", q.enquiryId, { status: status === "accepted" ? "won" : "lost" });
    audit(ctx, "quote.status_changed", `Quote ${status}: ${q.description}`, "quote", id);
    return u;
  });
  return ok(updated);
}
