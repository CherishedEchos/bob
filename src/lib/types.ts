/**
 * Core domain types for Ninety3 Assistant.
 * These mirror the Supabase schema in supabase/migrations so the demo
 * repository can be swapped for a real database without UI changes.
 */

export type ID = string;

export type UserRole = "owner" | "admin";

export interface AppUser {
  id: ID;
  displayName: string;
  role: UserRole;
}

export type EnquirySource = "email" | "instagram" | "phone";

export type EnquiryStatus =
  | "new"
  | "awaiting_reply"
  | "replied"
  | "site_visit"
  | "quoted"
  | "won"
  | "closed";

export type Priority = "high" | "medium" | "low";

export interface Note {
  id: ID;
  text: string;
  createdAt: string; // ISO
  author: string;
}

export interface Enquiry {
  id: ID;
  customerName: string;
  email?: string;
  phone?: string;
  instagramHandle?: string;
  source: EnquirySource;
  title: string;
  description: string;
  location: string;
  receivedAt: string; // ISO
  status: EnquiryStatus;
  priority: Priority;
  notes: Note[];
  suggestedReply: string;
  draftReply?: string;
  followUpDate?: string; // YYYY-MM-DD
  lastContactAt?: string; // ISO
  jobId?: ID;
}

export type JobStatus =
  | "quoted"
  | "awaiting_deposit"
  | "scheduled"
  | "in_progress"
  | "snagging"
  | "completed";

export type JobKind =
  | "kitchen"
  | "loft"
  | "wardrobes"
  | "extension"
  | "decking"
  | "staircase"
  | "general";

export interface Job {
  id: ID;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  title: string;
  description: string;
  location: string;
  kind: JobKind;
  quotedValue: number; // pounds
  depositRequired: number; // pounds
  status: JobStatus;
  startDate?: string; // YYYY-MM-DD
  depositDueDate?: string; // YYYY-MM-DD
  nextAction?: string;
  notes: Note[];
  enquiryId?: ID;
  lastChasedAt?: string; // ISO — when someone last chased payment
  createdAt: string;
}

export type PaymentType = "deposit" | "stage" | "final";
export type PaymentMethod = "bank_transfer" | "card" | "cash" | "cheque";

export interface Payment {
  id: ID;
  jobId: ID;
  amount: number;
  type: PaymentType;
  method: PaymentMethod;
  receivedAt: string; // YYYY-MM-DD
  reference?: string;
  recordedBy: string;
  recordedAt: string; // ISO
}

export interface Reminder {
  id: ID;
  title: string;
  dueDate: string; // YYYY-MM-DD
  relatedType?: "enquiry" | "job";
  relatedId?: ID;
  done: boolean;
  createdAt: string;
  createdBy: string;
}

/** Audit log entry. Every state change writes one of these. */
export interface ActivityEntry {
  id: ID;
  at: string; // ISO
  actor: string;
  action:
    | "enquiry.created"
    | "enquiry.updated"
    | "enquiry.status_changed"
    | "enquiry.note_added"
    | "enquiry.draft_saved"
    | "enquiry.marked_replied"
    | "job.created"
    | "job.updated"
    | "job.status_changed"
    | "job.note_added"
    | "payment.recorded"
    | "payment.chased"
    | "reminder.created"
    | "reminder.completed"
    | "reminder.reopened"
    | "reminder.deleted"
    | "demo.reset";
  summary: string;
  entityType?: "enquiry" | "job" | "payment" | "reminder";
  entityId?: ID;
}

export interface AppData {
  version: number;
  seededAt: string;
  enquiries: Enquiry[];
  jobs: Job[];
  payments: Payment[];
  reminders: Reminder[];
  activity: ActivityEntry[];
}
