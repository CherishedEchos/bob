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
  /** Full wordmark: onDark (white, for the sidebar and Ask Bob) and onLight (for customer documents). */
  wordmark?: { onDark?: string; onLight?: string };
  /** Restrained colour for customer documents (headings, rules). Falls back to the accent. */
  brandColor?: string;
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
  /** Claude API spending: monthly limit in USD (null = no limit) and when to warn. */
  ai?: { monthlyLimitUsd: number | null; warnAtPercent?: number };
  /** Thank-you email and Google review request after a handover (Settings → Customer follow-ups). */
  followUps?: FollowUpSettings;
  finance: { vatRegistered: boolean | null; vatRate: number | null; defaultPaymentTermsDays: number | null; /** How job prices and amounts are quoted when VAT registered. */ pricesAre?: "exclusive" | "inclusive" | null };
  /** "sample" = fictional records, nothing is sent anywhere. */
  dataMode: "sample" | "live";
  /** True for the fictional prospect-demo organisation. */
  isDemo: boolean;
  retention: { closedEnquiryMonths: number; conversationDays: number };
  /** IANA time zone for "today", the schedule and booking times. UK workspaces: Europe/London. */
  timeZone?: string;
  /** Where "Open QuickBooks" goes (e.g. the company's QuickBooks bills page). */
  quickbooksUrl?: string;
  /**
   * Leave policy. Defaults (when unset): owners/admins may record their own
   * leave as approved and approve crew requests.
   */
  leavePolicy?: { managersSelfApprove: boolean };
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

export type EnquiryStatus = "new" | "awaiting_reply" | "replied" | "site_visit" | "quote_required" | "quoted" | "won" | "lost";

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
  /** Site access: side gate, where to park, which entrance. Shown to people booked; never in calendar feeds. */
  accessNote?: string;
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
  /** Unset means normal. */
  priority?: "high" | "normal" | "low";
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
  /** Their login's role in this business (accepted), or the role a pending invite grants. */
  role?: Role;
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
  /** e.g. "sheets", "m", "bags". Optional; older items keep the unit inside quantity. */
  unit?: string;
  /** Free-text supplier (older records, or a merchant not added yet). */
  supplier?: string;
  merchantId?: ID;
  neededBy?: string; // YYYY-MM-DD
  status: MaterialStatus;
  orderRef?: string;
  expectedDelivery?: string; // YYYY-MM-DD
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** A supplier the business buys from. Account references and access fields are owner/office only. */
export interface Merchant {
  id: ID;
  name: string;
  branch?: string;
  phone?: string;
  email?: string;
  website?: string;
  notes?: string;
  /** Restricted: trade account number/reference. */
  accountRef?: string;
  /** Restricted: link to the company's password manager entry (never the password itself). */
  passwordManagerUrl?: string;
  /** Restricted: who manages the login, e.g. "Luke". */
  accessManagedBy?: string;
  archivedAt?: string;
  createdAt: string;
}

/** A private calendar subscription link (owner feed or a person's own bookings). Token never sent to the client. */
export interface CalendarFeed {
  id: ID;
  scope: "company" | "person";
  personId?: ID;
  createdAt: string;
  lastFetchedAt?: string;
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
  merchantId?: ID;
  reference?: string;
  paidAt?: string;
  /** Date the payment was made elsewhere (bank, card). */
  paidOn?: string; // YYYY-MM-DD
  paymentMethod?: string;
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
  /** A Cresaro platform administrator (sees the restricted admin area). */
  platformAdmin?: boolean;
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

/* ------------------------------ Files & handover ------------------------------ */

export type FileCategory = "drawing" | "progress" | "completion" | "other";

/**
 * A file on a job (or on an enquiry, carried to the job when it's won).
 * The bytes live in file_blobs; only metadata is sent to the browser.
 * Revisions of a drawing share a groupId; the newest one not deleted is current.
 */
export interface JobFile {
  id: ID;
  jobId?: ID;
  enquiryId?: ID;
  category: FileCategory;
  title?: string;
  filename: string;
  mimeType: string;
  bytes: number;
  description?: string;
  /** Drawing revision label as entered, e.g. "Rev C". */
  revision?: string;
  groupId: ID;
  /** "team": people booked on the job can see it. "office": owners, admins and site team only. */
  visibility: "team" | "office";
  /** Browser can show it inline (JPEG/PNG/WebP/GIF image or PDF, checked by content). */
  previewable: boolean;
  hasThumb: boolean;
  width?: number;
  height?: number;
  uploadedBy: string;
  uploadedByUserId?: ID;
  createdAt: string;
  deletedAt?: string;
  /** The job update this photo belongs to, if any. */
  updateId?: ID;
  /** Set on an exported handover report PDF (owners/admins only). */
  reportId?: ID;
}

export type UpdateStage = "before" | "in_progress" | "finished";

/** A dated update on a job: a short note and/or photos (the photos are JobFiles with updateId). */
export interface JobUpdate {
  id: ID;
  jobId: ID;
  note?: string;
  stage?: UpdateStage;
  authorName: string;
  authorUserId?: ID;
  createdAt: string;
  updatedAt: string;
}

/** A change to the agreed work and price. Customer-facing; internal costs never live here. */
export interface Variation {
  id: ID;
  jobId: ID;
  description: string;
  amount: number;
  amountsAre: VatTreatment;
  status: "proposed" | "approved" | "declined";
  /** Set when this variation has been billed on an invoice (so it's not counted twice). */
  invoiceId?: ID;
  approvedAt?: string;
  createdAt: string;
  createdBy: string;
}

/* ------------------------------ Handover report ------------------------------ */

export interface ReportSection {
  id: string;
  kind: "text" | "bullets" | "photos" | "costs";
  heading: string;
  body?: string;
  items?: string[];
  hidden?: boolean;
}

export interface ReportPhoto {
  fileId: ID;
  caption: string;
  include: boolean;
}

/** A figure typed in for the report only (never touches invoices or payments). */
export interface ReportManualFigure {
  label: string;
  amount: number;
}

export interface ReportSelection {
  updateIds: ID[];
  photoIds: ID[];
  /** Drawings, certificates and other documents the narrative may mention. */
  fileIds: ID[];
  includeCosts: boolean;
}

export interface ReportContent {
  title: string;
  customerName: string;
  siteAddress?: string;
  completionDate?: string;
  coverFileId?: ID;
  sections: ReportSection[];
  photos: ReportPhoto[];
  /** Cost section source: figures from Bob's records, or figures typed in for this report. */
  costMode: "records" | "manual";
  manualFigures: ReportManualFigure[];
  /** Editor-only notes ("No caption — add one?"). Never printed. */
  prompts: { target: string; text: string }[];
}

export interface HandoverReport {
  id: ID;
  jobId: ID;
  selection: ReportSelection;
  content: ReportContent;
  /** Increments on every save; a save based on an older revision is refused (protects the other person's edits). */
  revision: number;
  aiStatus: "none" | "drafted" | "fallback";
  aiNote?: string;
  /** Where the person left the handover workspace (1 Job details … 5 Review & finish), so they resume there. */
  step?: number;
  /** Finished (published): when, by whom, and which revision the published PDF matches. Later edits = unpublished changes. */
  completedAt?: string;
  completedBy?: string;
  completedRevision?: number;
  /** Recorded by the person once they've sent it to the customer themselves (Bob doesn't send it). */
  sentAt?: string;
  sentBy?: string;
  sentVersion?: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

/** An exported PDF. The bytes are a JobFile (reportId set), so the exact issued document can be retrieved. */
export interface ReportVersion {
  id: ID;
  reportId: ID;
  jobId: ID;
  version: number;
  fileId: ID;
  filename: string;
  pages: number;
  createdBy: string;
  createdAt: string;
  /** The report revision this PDF was made from (older versions don't have it). */
  revision?: number;
}

/** A line of the customer cost summary. Amounts come only from Bob's records (or labelled report figures). */
export interface CostLine {
  key: string;
  label: string;
  amount: number;
  note?: string;
  strong?: boolean;
}

export interface HandoverItem {
  fileId: ID;
  /** The name inside the ZIP (folder/name), unique within the handover. */
  zipPath: string;
  title: string;
  filename: string;
  category: FileCategory;
  description?: string;
  revision?: string;
  bytes: number;
  mimeType: string;
}

/** A generated customer handover. Its contents are frozen when it's created. */
export interface Handover {
  id: ID;
  jobId: ID;
  title: string;
  jobTitle: string;
  siteAddress?: string;
  completionDate?: string;
  message?: string;
  items: HandoverItem[];
  createdAt: string;
  createdBy: string;
  downloads: number;
}

/* ------------------------------ Leave & availability ------------------------------ */

/** holiday: an employee's leave. unavailable: a subcontractor (or anyone) can't work. sick, other: recorded by a manager. */
export type AbsenceKind = "holiday" | "unavailable" | "sick" | "other";
export type AbsenceStatus = "pending" | "approved" | "declined" | "cancelled";

/**
 * Leave or unavailability for a Team person. Dates are plain date keys
 * (YYYY-MM-DD, inclusive) — never converted through a time zone.
 * part: a half day (only when startDate === endDate).
 */
export interface Absence {
  id: ID;
  personId: ID;
  kind: AbsenceKind;
  startDate: string;
  endDate: string;
  part?: "am" | "pm";
  status: AbsenceStatus;
  /** Private: only the requester and owners/admins see it. */
  reason?: string;
  requestedBy: string;
  requestedByUserId?: ID;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
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
  merchants: Merchant[];
  feeds: CalendarFeed[];
  files: JobFile[];
  handovers: Handover[];
  absences: Absence[];
  updates: JobUpdate[];
  variations: Variation[];
  reports: HandoverReport[];
  reportVersions: ReportVersion[];
  followUps: CustomerFollowUp[];
  activity: ActivityEntry[];
  connections: Connection[];
  mode: ModeInfo;
  generatedAt: string;
}

/** Back-compat alias: much of the UI was written against `AppData`. */
export type AppData = Snapshot;

export interface FollowUpSettings {
  /** The business's own Google review link (e.g. https://g.page/r/…/review). */
  reviewUrl?: string;
  reviewsEnabled: boolean;
  /** "manual": every email is shown for approval. "auto": sent when the handover is finished (needs a connected mailbox). */
  mode: "manual" | "auto";
  /** One reminder seven days later, only if a review was asked for. */
  reminder: boolean;
  template: { subject: string; body: string };
}

/**
 * One thank-you / handover email to a customer, and its optional review
 * reminder. Bob never records that a review was received — it can't verify it.
 */
export interface CustomerFollowUp {
  id: ID;
  jobId: ID;
  reportId: ID;
  /** The published PDF version that was attached. */
  version?: number;
  toAddress: string;
  subject: string;
  body: string;
  reviewRequested: boolean;
  reviewUrl?: string;
  /** draft (no mailbox, or saved for later) · sent · failed */
  status: "draft" | "sent" | "failed";
  /** gmail / outlook / demo (simulated, nothing left Bob) / manual (sent by the person from their own email) */
  sentVia?: "gmail" | "outlook" | "demo" | "manual";
  approvedBy?: string;
  approvedAt?: string;
  sentAt?: string;
  error?: string;
  reminderStatus: "none" | "scheduled" | "sent" | "cancelled";
  reminderDueAt?: string;
  reminderSentAt?: string;
  reminderTaskId?: ID;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
