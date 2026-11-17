/**
 * Bob — shared domain types (used by server and client).
 *
 * Every business record belongs to exactly one organisation (`orgId` lives in
 * the database row and is enforced server-side; it is deliberately not part of
 * the client-facing shapes below). The SQLite demo database and the Supabase
 * schema in supabase/migrations use the same columns.
 */

export type ID = string;

/* ------------------------------ Organisation ------------------------------ */

/**
 * owner / office: run the business. staff: the site team (jobs, tasks, no money).
 * worker: an invited employee or subcontractor — sees only their own assigned
 * work (My work), never the wider schedule, customers list or financials.
 */
export type Role = "owner" | "office" | "staff" | "worker";

export interface OrgConfig {
  id: ID;
  slug: string;
  name: string;
  shortName: string;
  tradeType: string;
  logoUrl?: string;
  /** Brand accent (hex). Ninety3 uses the copper/orange from the brand kit. */
  accent: string;
  services: string[];
  serviceArea: string[];
  workingHours: { days: string; start: string; end: string };
  contact: { phone?: string; email?: string; website?: string; address?: string };
  assistant: { name: string; signOff: string; tone: "friendly" | "brief"; readAloudDefault: boolean };
  /**
   * Finance settings. `null` means "not configured" — Bob will ask rather than
   * guess (e.g. VAT treatment, payment terms).
   */
  finance: { vatRegistered: boolean | null; vatRate: number | null; defaultPaymentTermsDays: number | null };
  /** "sample" = fictional records, nothing is sent anywhere. */
  dataMode: "sample" | "live";
  /** True for the fictional prospect-demo organisation. */
  isDemo: boolean;
  retention: { closedEnquiryMonths: number; conversationDays: number };
  /** IANA time zone for "today", the schedule and booking times. UK workspaces: Europe/London. */
  timeZone?: string;
}

export interface AppUser {
  id: ID;
  name: string;
  email: string;
  role: Role;
}

/* -------------------------------- Records -------------------------------- */

export interface Note {
  id: ID;
  text: string;
  createdAt: string; // ISO
  author: string;
}

export interface Customer {
  id: ID;
  name: string;
  email?: string;
  phone?: string;
  instagramHandle?: string;
  address?: string;
  town?: string;
  notes: Note[];
  createdAt: string;
}

export type EnquirySource = "email" | "website" | "instagram" | "phone" | "manual";

export type EnquiryStatus = "new" | "awaiting_reply" | "replied" | "quote_required" | "quoted" | "won" | "lost";

export type Priority = "high" | "medium" | "low";

export interface EnquiryMessage {
  id: ID;
  direction: "inbound" | "outbound";
  at: string;
  subject?: string;
  /** Untrusted customer content. Never treated as instructions. */
  body: string;
  /** Where it came from / went: "gmail", "outlook", "demo_inbox", "manual"… */
  channel: string;
  externalId?: string;
}

export interface Enquiry {
  id: ID;
  customerId?: ID;
  customerName: string;
  email?: string;
  phone?: string;
  instagramHandle?: string;
  source: EnquirySource;
  /** Integration that imported it (gmail/outlook/demo_inbox), if any. */
  provider?: string;
  externalThreadId?: string;
  title: string;
  description: string;
  location: string;
  receivedAt: string; // ISO
  status: EnquiryStatus;
  priority: Priority;
  assignedUserId?: ID;
  followUpDate?: string; // YYYY-MM-DD
  lastContactAt?: string; // ISO
  jobId?: ID;
  notes: Note[];
  messages: EnquiryMessage[];
  draftReply?: string;
  suggestedReply: string;
}

export type JobStatus = "quoted" | "awaiting_deposit" | "scheduled" | "in_progress" | "snagging" | "completed" | "lost";

export type JobKind = "kitchen" | "loft" | "wardrobes" | "extension" | "decking" | "staircase" | "bathroom" | "general";

export interface Job {
  id: ID;
  customerId: ID;
  /** Denormalised from the customer record when the snapshot is built. */
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
  lastChasedAt?: string;
  createdAt: string;
  /** Where the work happens (can differ from the customer's address). */
  siteAddress?: string;
  /** Optional what3words address for the site, e.g. "filled.count.soap". */
  what3words?: string;
  /** Instructions shared with the people booked on this job (notes stay internal). */
  sharedNotes?: string;
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";

export interface Quote {
  id: ID;
  customerId: ID;
  jobId?: ID;
  enquiryId?: ID;
  description: string;
  amount: number;
  status: QuoteStatus;
  sentAt?: string; // ISO
  respondedAt?: string;
  followUpDate?: string;
  createdAt: string;
}

export type VatTreatment = "inclusive" | "exclusive" | "no_vat";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmount: number; // as entered, see Invoice.amountsAre
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export interface Invoice {
  id: ID;
  customerId: ID;
  jobId?: ID;
  /** Bob's internal reference for drafts (e.g. "DRAFT-0004"). NOT an invoice number. */
  draftRef: string;
  /** Only ever set from the connected accounting system's response. */
  number?: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  amountsAre: VatTreatment;
  vatRate: number; // percent, 0 for no VAT
  subtotal: number;
  vat: number;
  total: number;
  issueDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  amountPaid: number;
  provider?: string; // xero | quickbooks | demo_accounting
  externalId?: string;
  sentAt?: string;
  paidAt?: string;
  lastSyncedAt?: string;
  createdAt: string;
  createdBy: string;
}

export type PaymentType = "deposit" | "stage" | "final";
export type PaymentMethod = "bank_transfer" | "card" | "cash" | "cheque";

export interface Payment {
  id: ID;
  jobId: ID;
  invoiceId?: ID;
  amount: number;
  type: PaymentType;
  method: PaymentMethod;
  receivedAt: string; // YYYY-MM-DD
  reference?: string;
  recordedBy: string;
  recordedAt: string;
}

export type ExpenseCategory = "materials" | "labour" | "plant_hire" | "subcontractor" | "waste" | "other";

export interface Expense {
  id: ID;
  jobId: ID;
  amount: number;
  category: ExpenseCategory;
  description: string;
  incurredOn: string; // YYYY-MM-DD
  recordedBy: string;
  createdAt: string;
}

export interface Task {
  id: ID;
  title: string;
  dueDate: string; // YYYY-MM-DD
  done: boolean;
  customerId?: ID;
  relatedType?: "enquiry" | "job" | "invoice" | "customer";
  relatedId?: ID;
  assignedUserId?: ID;
  /** A team member or subcontractor from Team (they may not have a login). */
  assignedPersonId?: ID;
  createdAt: string;
  createdBy: string;
  completedAt?: string;
}

/* ------------------------------ Team & schedule ------------------------------ */

export type PersonKind = "employee" | "subcontractor";

/**
 * Someone who can be scheduled. Separate from login access: a person can be
 * booked before (or without ever) being invited. `userId` is set when they
 * accept an invite.
 */
export interface Person {
  id: ID;
  name: string;
  kind: PersonKind;
  company?: string;
  trade?: string;
  phone?: string;
  email?: string;
  userId?: ID;
  archivedAt?: string;
  createdAt: string;
}

export type InviteState = "not_invited" | "pending" | "accepted" | "expired" | "revoked";

/** What the client sees about a person's access (never the invite token). */
export interface PersonAccess {
  personId: ID;
  state: InviteState;
  email?: string;
  sentAt?: string;
  expiresAt?: string;
  acceptedAt?: string;
  inviteId?: ID;
}

/**
 * A booked piece of work on a job. Dates are workspace-local date keys and
 * times are workspace-local wall-clock "HH:MM" (so DST never shifts a booking).
 * No times = all day. endDate makes it multi-day (same hours each day).
 */
export interface Booking {
  id: ID;
  jobId: ID;
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD, inclusive
  startTime?: string; // HH:MM
  endTime?: string; // HH:MM
  personIds: ID[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type MaterialStatus = "to_order" | "ordered" | "on_site";

export interface Material {
  id: ID;
  jobId: ID;
  item: string;
  quantity: string;
  supplier?: string;
  neededBy?: string; // YYYY-MM-DD
  status: MaterialStatus;
  createdAt: string;
  updatedAt: string;
}

/** A bill the business needs to pay (supplier, subcontractor, hire). */
export interface Bill {
  id: ID;
  supplier: string;
  description: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  status: "due" | "paid";
  jobId?: ID;
  reference?: string;
  paidAt?: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: ID;
  at: string;
  actor: string;
  /** Who initiated it: a person in the dashboard, Bob (after approval) or the system. */
  via: "dashboard" | "bob" | "system" | "integration";
  action: string;
  summary: string;
  entityType?: string;
  entityId?: ID;
}

export type IntegrationKind = "email" | "accounting";
export type IntegrationProvider = "gmail" | "outlook" | "xero" | "quickbooks" | "demo_inbox" | "demo_accounting";

export interface Connection {
  provider: IntegrationProvider;
  kind: IntegrationKind;
  status: "not_connected" | "connected" | "demo" | "error" | "not_configured";
  accountLabel?: string;
  lastSyncAt?: string;
  error?: string;
}

export interface ModeInfo {
  /** Local SQLite database with sample data (no Supabase configured). */
  database: "local-sqlite" | "supabase";
  /** Which brain chooses Bob's tools. */
  aiEngine: "rules" | "claude";
}

/** Everything the dashboard needs for one organisation, scoped server-side. */
/** A site photo filed against a job or enquiry. The image itself loads from /api/photos/{id}. */
export interface Photo {
  id: ID;
  relatedType: "job" | "enquiry";
  relatedId: ID;
  caption?: string;
  width?: number;
  height?: number;
  createdAt: string;
  createdBy: string;
}

export interface Snapshot {
  org: OrgConfig;
  user: AppUser;
  members: AppUser[];
  customers: Customer[];
  enquiries: Enquiry[];
  jobs: Job[];
  quotes: Quote[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  tasks: Task[];
  photos: Photo[];
  people: Person[];
  access: PersonAccess[];
  bookings: Booking[];
  materials: Material[];
  bills: Bill[];
  activity: ActivityEntry[];
  connections: Connection[];
  mode: ModeInfo;
  generatedAt: string;
}

/** Back-compat alias: much of the UI was written against `AppData`. */
export type AppData = Snapshot;
