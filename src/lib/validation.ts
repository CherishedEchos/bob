/**
 * Zod schemas for every write. The server validates EVERY request with these
 * (never trusting the client); the dashboard reuses them for inline errors.
 */
import { z } from "zod";

/**
 * what3words: three words separated by dots, with or without a leading ///.
 * This checks the format only — it doesn't confirm the square exists
 * (that needs the what3words API, not configured).
 */
export const W3W_HELP = "Use three words with dots between them, like ///filled.count.soap";
export function normaliseW3w(input: string): string | null {
  const v = input.trim().replace(/^\/{1,3}/, "").replace(/^https?:\/\/(www\.)?what3words\.com\//i, "").toLowerCase();
  if (!v) return "";
  return /^\p{L}+\.\p{L}+\.\p{L}+$/u.test(v) ? v : null;
}

/** Bob never stores passwords: refuse text that looks like one. */
export const SECRET_PATTERN = /\b(password|passcode|pwd|login\s*pin)\s*(is|:|=)\s*\S+/i;
export const noSecrets = <T extends z.ZodString>(s: T) => s.refine((v) => !SECRET_PATTERN.test(v), "Don't store passwords in Bob — keep them in your password manager and add its link instead.");

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optDate = dateKey.optional().or(z.literal("")).transform((v) => v || undefined);
const optStr = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || undefined);
const optEmail = z.string().trim().email("Enter a valid email").optional().or(z.literal("")).transform((v) => v || undefined);
export const money = z.coerce
  .number({ error: "Enter an amount" })
  .finite()
  .min(0, "Amount can't be negative")
  .max(5_000_000, "That looks too large")
  .transform((n) => Math.round(n * 100) / 100);
const positiveMoney = money.refine((n) => n > 0, "Amount must be more than £0");
const id = z.string().min(1).max(80);

export const customerInputSchema = z.object({
  name: z.string().trim().min(2, "Customer name is required").max(120),
  email: optEmail,
  phone: optStr(30),
  instagramHandle: optStr(60),
  address: optStr(240),
  town: optStr(80),
});
export type CustomerInput = z.input<typeof customerInputSchema>;

export const enquiryInputSchema = z
  .object({
    customerName: z.string().trim().min(2, "Customer name is required").max(120),
    customerId: id.optional(),
    email: optEmail,
    phone: optStr(30),
    instagramHandle: optStr(60),
    source: z.enum(["email", "website", "instagram", "phone", "manual"]),
    title: z.string().trim().min(2, "What's the job?").max(120),
    description: z.string().trim().max(4000).default(""),
    location: z.string().trim().min(2, "Location is required").max(120),
    priority: z.enum(["high", "medium", "low"]).default("medium"),
    followUpDate: optDate,
    assignedUserId: id.optional(),
  })
  .refine((v) => v.email || v.phone || v.instagramHandle || v.customerId, {
    message: "Add at least one way to contact them",
    path: ["phone"],
  });
export type EnquiryInput = z.input<typeof enquiryInputSchema>;

export const enquiryPatchSchema = z.object({
  priority: z.enum(["high", "medium", "low"]).optional(),
  followUpDate: z.union([dateKey, z.null()]).optional(),
  assignedUserId: z.union([id, z.null()]).optional(),
  customerId: z.union([id, z.null()]).optional(),
});

export const jobStatusSchema = z.enum(["quoted", "awaiting_deposit", "scheduled", "in_progress", "snagging", "completed", "lost"]);

export const jobInputSchema = z
  .object({
    customerId: id.optional(),
    customerName: z.string().trim().max(120).optional(),
    customerPhone: optStr(30),
    customerEmail: optEmail,
    title: z.string().trim().min(2, "Give the job a short title").max(120),
    description: z.string().trim().max(4000).default(""),
    location: z.string().trim().min(2, "Location is required").max(120),
    quotedValue: money,
    depositRequired: money.default(0),
    status: jobStatusSchema.default("quoted"),
    startDate: optDate,
    depositDueDate: optDate,
    nextAction: optStr(240),
    enquiryId: id.optional(),
    quoteId: id.optional(),
    siteAddress: optStr(240),
    what3words: optStr(80).superRefine((v, c) => {
      if (v && normaliseW3w(v) === null) c.addIssue({ code: "custom", message: W3W_HELP });
    }).transform((v) => (v ? normaliseW3w(v) || undefined : undefined)),
    sharedNotes: optStr(2000),
    accessNote: optStr(500),
  })
  .refine((v) => v.depositRequired <= v.quotedValue, { message: "Deposit can't be more than the quote", path: ["depositRequired"] })
  .refine((v) => v.customerId || (v.customerName && v.customerName.length >= 2), {
    message: "Customer name is required",
    path: ["customerName"],
  });
export type JobInput = z.input<typeof jobInputSchema>;

export const jobPatchSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  location: z.string().trim().min(2).max(120).optional(),
  nextAction: z.string().trim().max(240).optional(),
  startDate: z.union([dateKey, z.null()]).optional(),
  depositDueDate: z.union([dateKey, z.null()]).optional(),
  quotedValue: money.optional(),
  depositRequired: money.optional(),
  siteAddress: z.string().trim().max(240).optional(),
  what3words: z.string().trim().max(80).optional().superRefine((v, c) => {
    if (v && !normaliseW3w(v)) c.addIssue({ code: "custom", message: W3W_HELP });
  }).transform((v) => (v === undefined ? undefined : normaliseW3w(v) ?? "")),
  sharedNotes: noSecrets(z.string().trim().max(2000)).optional(),
  accessNote: z.string().trim().max(500).optional(),
});

export const paymentInputSchema = z.object({
  jobId: id,
  invoiceId: id.optional(),
  amount: positiveMoney,
  type: z.enum(["deposit", "stage", "final"]),
  method: z.enum(["bank_transfer", "card", "cash", "cheque"]),
  receivedAt: dateKey,
  reference: optStr(80),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const taskInputSchema = z.object({
  title: z.string().trim().min(2, "What do you need reminding about?").max(200),
  dueDate: dateKey,
  relatedType: z.enum(["enquiry", "job", "invoice", "customer"]).optional(),
  relatedId: id.optional(),
  customerId: id.optional(),
  assignedUserId: id.optional(),
  assignedPersonId: optStr(80),
  priority: z.enum(["high", "normal", "low"]).optional(),
});
export type TaskInput = z.input<typeof taskInputSchema>;

export const expenseInputSchema = z.object({
  jobId: id,
  amount: positiveMoney,
  category: z.enum(["materials", "labour", "plant_hire", "subcontractor", "waste", "other"]).default("materials"),
  description: z.string().trim().min(2, "What was it for?").max(200),
  incurredOn: dateKey,
});
export type ExpenseInput = z.input<typeof expenseInputSchema>;

export const quoteInputSchema = z.object({
  customerId: id,
  jobId: id.optional(),
  enquiryId: id.optional(),
  description: z.string().trim().min(2).max(200),
  amount: positiveMoney,
  status: z.enum(["draft", "sent"]).default("sent"),
  followUpDate: optDate,
});

export const invoiceDraftSchema = z.object({
  customerId: id,
  jobId: id.optional(),
  description: z.string().trim().min(2, "Add a description").max(200),
  amount: positiveMoney,
  amountsAre: z.enum(["inclusive", "exclusive", "no_vat"], { error: "Say whether the amount includes VAT" }),
  vatRate: z.coerce.number().min(0).max(30).optional(),
  dueDate: dateKey,
});
export type InvoiceDraftInput = z.input<typeof invoiceDraftSchema>;

export const noteInputSchema = z.object({ text: z.string().trim().min(1, "Write a note first").max(2000) });

export const emailDraftSchema = z.object({
  to: z.string().trim().email("No valid email address"),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1, "The email is empty").max(10000),
});

export type FieldErrors = Record<string, string>;

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/* ------------------------------ Team & schedule ------------------------------ */

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00");

export const personInputSchema = z.object({
  name: z.string().trim().min(2, "Enter their name").max(120),
  kind: z.enum(["employee", "subcontractor"]),
  company: optStr(120),
  trade: optStr(80),
  phone: optStr(30),
  email: optEmail,
});

export const bookingInputSchema = z
  .object({
    id: id.optional(),
    jobId: id,
    date: dateKey,
    endDate: optDate,
    allDay: z.boolean().default(false),
    startTime: time.optional().or(z.literal("")).transform((v) => v || undefined),
    endTime: time.optional().or(z.literal("")).transform((v) => v || undefined),
    personIds: z.array(id).max(30).default([]),
    notes: optStr(1000),
    /** The planner saw the clash warning and chose to book anyway. */
    confirmOverlap: z.boolean().default(false),
  })
  .refine((v) => !v.endDate || v.endDate >= v.date, { message: "The end date can't be before the start date", path: ["endDate"] })
  .refine((v) => v.allDay || (v.startTime && v.endTime), { message: "Add a start and end time, or choose All day", path: ["startTime"] })
  .refine((v) => v.allDay || !v.startTime || !v.endTime || v.endTime > v.startTime, { message: "The end time must be after the start time", path: ["endTime"] });

export const materialInputSchema = z.object({
  id: id.optional(),
  jobId: id,
  item: z.string().trim().min(2, "What's the item?").max(160),
  quantity: z.string().trim().min(1, "How many?").max(40),
  unit: optStr(30),
  supplier: optStr(120),
  merchantId: optStr(80),
  neededBy: optDate,
  status: z.enum(["to_order", "ordered", "on_site"]).default("to_order"),
  orderRef: optStr(80),
  expectedDelivery: optDate,
  notes: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => v || undefined).refine((v) => !v || !SECRET_PATTERN.test(v), "Don't store passwords in Bob."),
});

const optUrl = z.string().trim().max(300).optional().or(z.literal("")).transform((v) => v || undefined).refine((v) => !v || /^https?:\/\//i.test(v), "Use a full link starting with https://");
export const merchantInputSchema = z.object({
  name: z.string().trim().min(2, "Merchant name").max(120),
  branch: optStr(120),
  phone: optStr(30),
  email: optEmail,
  website: optUrl,
  notes: z.string().trim().max(1000).optional().or(z.literal("")).transform((v) => v || undefined).refine((v) => !v || !SECRET_PATTERN.test(v), "Don't store passwords in Bob — keep them in your password manager and add its link instead."),
  accountRef: optStr(80).refine((v) => !v || !SECRET_PATTERN.test(v), "That looks like a password — store the account number only."),
  passwordManagerUrl: optUrl,
  accessManagedBy: optStr(80),
});

export const billInputSchema = z.object({
  merchantId: optStr(80),
  supplier: z.string().trim().min(2, "Who is the bill from?").max(120),
  description: z.string().trim().min(2, "What's it for?").max(200),
  amount: positiveMoney,
  dueDate: dateKey,
  jobId: optStr(80),
  reference: optStr(80),
});

export const billPaymentSchema = z.object({
  paidOn: dateKey,
  paymentMethod: z.enum(["bank_transfer", "card", "cash", "cheque", "other"]).default("bank_transfer"),
});
