import "server-only";
import type { Ctx } from "@/server/context";
import type { Customer, Invoice } from "@/lib/types";

/** A message fetched from a mailbox. `body` is UNTRUSTED customer content. */
export interface InboundEmail {
  externalId: string;
  threadId?: string;
  from: { name: string; email: string };
  subject: string;
  body: string;
  receivedAt: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  /** Reply threading where the provider supports it. */
  threadId?: string;
}

export type SendOutcome =
  | { ok: true; externalId: string; simulated: boolean }
  | { ok: false; error: string; retryable: boolean };

/** Provider-independent email integration (Gmail, Outlook, demo inbox…). */
export interface EmailProvider {
  readonly id: "gmail" | "outlook" | "demo_inbox";
  readonly label: string;
  /** True when nothing real leaves the system. */
  readonly simulated: boolean;
  listRecent(ctx: Ctx, sinceIso?: string): Promise<InboundEmail[]>;
  send(ctx: Ctx, msg: OutboundEmail, idempotencyKey: string): Promise<SendOutcome>;
}

export type InvoiceSendOutcome =
  | { ok: true; externalId: string; number?: string; simulated: boolean }
  | { ok: false; error: string; retryable: boolean };

/** Provider-independent accounting integration (Xero, QuickBooks, demo…). */
export interface AccountingProvider {
  readonly id: "xero" | "quickbooks" | "demo_accounting";
  readonly label: string;
  readonly simulated: boolean;
  /** Create the invoice in the accounting system and email it to the customer. */
  sendInvoice(ctx: Ctx, invoice: Invoice, customer: Customer, idempotencyKey: string): Promise<InvoiceSendOutcome>;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
