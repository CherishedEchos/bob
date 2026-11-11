/**
 * Integration contracts — NOT implemented in the demo.
 *
 * Each external system sits behind one of these interfaces and runs
 * server-side only. Credentials are stored as server env vars / Supabase
 * Vault secrets and OAuth tokens are never sent to the browser.
 */
import type { EnquirySource, Payment } from "@/lib/types";

/** Normalised inbound message from any channel, before it becomes an Enquiry. */
export interface InboundMessage {
  channel: EnquirySource;
  externalId: string; // provider message/thread id, for de-duplication
  receivedAt: string;
  fromName?: string;
  fromAddress?: string; // email address, phone number or IG user id
  body: string;
  attachments?: { name: string; mimeType: string; url: string }[];
}

/** Gmail (Google Workspace API) or Microsoft 365 (Graph API) via OAuth. */
export interface EmailChannel {
  readonly provider: "gmail" | "microsoft365";
  fetchNew(since: string): Promise<InboundMessage[]>;
  /** Only ever called after the user explicitly confirms a reply. */
  sendReply(threadId: string, body: string): Promise<{ messageId: string }>;
}

/** Instagram messaging via the official Meta Graph API (Business account + webhooks). */
export interface InstagramChannel {
  verifyWebhook(signature: string, rawBody: string): boolean;
  parseWebhook(payload: unknown): InboundMessage[];
  /** Subject to Meta's 24-hour messaging window; requires explicit confirmation. */
  sendReply(recipientId: string, body: string): Promise<{ messageId: string }>;
}

/** Manual phone capture is already in the app (Log enquiry). Future: call logs / voicemail transcription. */
export interface PhoneChannel {
  importCallLog?(since: string): Promise<InboundMessage[]>;
}

export interface SpeechToTextProvider {
  transcribe(audio: Blob, opts?: { language?: "en-GB" }): Promise<{ text: string; confidence?: number }>;
}

export interface TextToSpeechProvider {
  synthesize(text: string, opts?: { voice?: string }): Promise<Blob>;
}

/** Xero / QuickBooks / FreeAgent. One-way sync to start: push invoices, pull paid status. */
export interface AccountingProvider {
  readonly provider: "xero" | "quickbooks" | "freeagent";
  createInvoice(jobId: string, lines: { description: string; amount: number }[]): Promise<{ invoiceId: string }>;
  listPayments(since: string): Promise<Pick<Payment, "amount" | "receivedAt" | "reference">[]>;
}

/** Web Push (PWA) and/or SMS/email for reminders and new-enquiry alerts. */
export interface NotificationProvider {
  notify(userId: string, message: { title: string; body: string; url?: string }): Promise<void>;
}
