import "server-only";
import type { Connection, IntegrationProvider } from "@/lib/types";
import { getDb } from "@/server/db";
import type { Ctx } from "@/server/context";
import { demoInboxMessages } from "@/server/db/seed";
import { OAUTH_PROVIDERS, providerConfigured, type OAuthProvider } from "./oauth";
import { gmailProvider, outlookProvider, quickbooksProvider, xeroProvider } from "./providers";
import type { AccountingProvider, EmailProvider } from "./types";

/* ------------------------------ Demo adapters ------------------------------ */

/**
 * Demo inbox: serves fictional messages and NEVER sends anything. A "send"
 * is recorded as simulated so the demo shows the full approval flow honestly.
 */
export const demoInboxProvider: EmailProvider = {
  id: "demo_inbox",
  label: "Demo inbox",
  simulated: true,
  async listRecent(ctx) {
    return demoInboxMessages(ctx.orgId).map((m) => ({ ...m, threadId: m.externalId }));
  },
  async send(_ctx, msg, idempotencyKey) {
    if (/@fail\.example$/i.test(msg.to)) return { ok: false, error: "The demo mail server rejected this address", retryable: false };
    return { ok: true, externalId: `demo-email-${idempotencyKey.slice(0, 10)}`, simulated: true };
  },
};

/** Demo accounting: simulates an accounting system accepting the invoice. Nothing is sent. */
export const demoAccountingProvider: AccountingProvider = {
  id: "demo_accounting",
  label: "Demo accounting",
  simulated: true,
  async sendInvoice(_ctx, invoice, customer, idempotencyKey) {
    if (!customer.email) return { ok: false, error: `${customer.name} has no email address on file, so the invoice can't be emailed`, retryable: false };
    const n = parseInt(invoice.draftRef.replace(/\D/g, ""), 10) || 0;
    return { ok: true, externalId: `demo-inv-${idempotencyKey.slice(0, 10)}`, number: `DEMO-${1040 + n}`, simulated: true };
  },
};

/* ------------------------------ Test overrides ------------------------------ */

let emailOverride: EmailProvider | null | undefined;
let accountingOverride: AccountingProvider | null | undefined;
export function overrideProvidersForTests(o: { email?: EmailProvider | null; accounting?: AccountingProvider | null }) {
  emailOverride = o.email;
  accountingOverride = o.accounting;
}

/* --------------------------------- Registry --------------------------------- */

interface ConnRow {
  provider: IntegrationProvider;
  kind: "email" | "accounting";
  status: Connection["status"];
  account_label: string | null;
  last_sync_at: string | null;
  error: string | null;
}

function rows(ctx: Ctx): ConnRow[] {
  return getDb()
    .prepare("SELECT provider, kind, status, account_label, last_sync_at, error FROM connections WHERE org_id = ?")
    .all(ctx.orgId) as unknown as ConnRow[];
}

/** Connection status for the settings page and Bob (never includes tokens). */
export function listConnections(ctx: Ctx): Connection[] {
  const existing = rows(ctx);
  const out: Connection[] = existing.map((r) => ({
    provider: r.provider,
    kind: r.kind,
    status: r.status,
    accountLabel: r.account_label ?? undefined,
    lastSyncAt: r.last_sync_at ?? undefined,
    error: r.error ?? undefined,
  }));
  for (const p of Object.keys(OAUTH_PROVIDERS) as OAuthProvider[]) {
    if (existing.some((r) => r.provider === p)) continue;
    out.push({ provider: p, kind: OAUTH_PROVIDERS[p].kind, status: providerConfigured(p) ? "not_connected" : "not_configured" });
  }
  return out;
}

function connected(ctx: Ctx, kind: "email" | "accounting") {
  return rows(ctx).filter((r) => r.kind === kind && (r.status === "connected" || r.status === "demo"));
}

export function getEmailProvider(ctx: Ctx): EmailProvider | null {
  if (emailOverride !== undefined) return emailOverride;
  const live = connected(ctx, "email");
  if (live.some((r) => r.provider === "gmail" && r.status === "connected")) return gmailProvider;
  if (live.some((r) => r.provider === "outlook" && r.status === "connected")) return outlookProvider;
  if (live.some((r) => r.provider === "demo_inbox")) return demoInboxProvider;
  return null;
}

export function getAccountingProvider(ctx: Ctx): AccountingProvider | null {
  if (accountingOverride !== undefined) return accountingOverride;
  const live = connected(ctx, "accounting");
  if (live.some((r) => r.provider === "xero" && r.status === "connected")) return xeroProvider;
  if (live.some((r) => r.provider === "quickbooks" && r.status === "connected")) return quickbooksProvider;
  if (live.some((r) => r.provider === "demo_accounting")) return demoAccountingProvider;
  return null;
}

export function touchSync(ctx: Ctx, provider: string) {
  getDb().prepare("UPDATE connections SET last_sync_at = ?, error = NULL WHERE org_id = ? AND provider = ?").run(new Date().toISOString(), ctx.orgId, provider);
}
