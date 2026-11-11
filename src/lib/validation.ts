/**
 * Zod schemas for every write operation. Used client-side today and intended
 * to be re-used verbatim in server actions / API routes once Supabase is live
 * (never trust the client — validate again on the server).
 */
import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const money = z.coerce
  .number({ error: "Enter an amount" })
  .finite()
  .min(0, "Amount can't be negative")
  .max(5_000_000, "That looks too large");

export const enquiryInputSchema = z
  .object({
    customerName: z.string().trim().min(2, "Customer name is required").max(120),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    instagramHandle: z.string().trim().max(60).optional().or(z.literal("")),
    source: z.enum(["email", "instagram", "phone"]),
    title: z.string().trim().min(2, "What's the job?").max(120),
    description: z.string().trim().max(4000).default(""),
    location: z.string().trim().min(2, "Location is required").max(120),
    priority: z.enum(["high", "medium", "low"]),
    followUpDate: dateKey.optional().or(z.literal("")),
  })
  .refine((v) => v.email || v.phone || v.instagramHandle, {
    message: "Add at least one way to contact them",
    path: ["phone"],
  });
export type EnquiryInput = z.infer<typeof enquiryInputSchema>;

export const jobInputSchema = z
  .object({
    customerName: z.string().trim().min(2, "Customer name is required").max(120),
    customerPhone: z.string().trim().max(30).optional().or(z.literal("")),
    customerEmail: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
    title: z.string().trim().min(2, "Give the job a short title").max(120),
    description: z.string().trim().max(4000).default(""),
    location: z.string().trim().min(2, "Location is required").max(120),
    quotedValue: money,
    depositRequired: money,
    status: z.enum(["quoted", "awaiting_deposit", "scheduled", "in_progress", "snagging", "completed"]),
    startDate: dateKey.optional().or(z.literal("")),
    depositDueDate: dateKey.optional().or(z.literal("")),
    nextAction: z.string().trim().max(240).optional().or(z.literal("")),
    enquiryId: z.string().optional(),
  })
  .refine((v) => v.depositRequired <= v.quotedValue, {
    message: "Deposit can't be more than the quote",
    path: ["depositRequired"],
  });
export type JobInput = z.infer<typeof jobInputSchema>;

export const paymentInputSchema = z.object({
  jobId: z.string().min(1),
  amount: money.refine((n) => n > 0, "Amount must be more than £0"),
  type: z.enum(["deposit", "stage", "final"]),
  method: z.enum(["bank_transfer", "card", "cash", "cheque"]),
  receivedAt: dateKey,
  reference: z.string().trim().max(80).optional().or(z.literal("")),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const reminderInputSchema = z.object({
  title: z.string().trim().min(2, "What do you need reminding about?").max(200),
  dueDate: dateKey,
  relatedType: z.enum(["enquiry", "job"]).optional(),
  relatedId: z.string().optional(),
});
export type ReminderInput = z.infer<typeof reminderInputSchema>;

export const noteInputSchema = z.object({
  text: z.string().trim().min(1, "Write a note first").max(2000),
});

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().max(80).optional(),
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
