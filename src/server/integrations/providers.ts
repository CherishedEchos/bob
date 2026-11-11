import "server-only";
/**
 * Live provider adapters.
 *
 * STATUS: written against the official Gmail API, Microsoft Graph, Xero
 * Accounting API and QuickBooks Online API, but NOT yet tested against live
 * accounts. They are only reachable once the provider is connected via OAuth
 * (which needs credentials). Do not describe them as working until tested.
 */
import type { Customer, Invoice } from "@/lib/types";
import type { Ctx } from "@/server/context";
import { getAccessToken } from "./oauth";
import type { AccountingProvider, EmailProvider, InboundEmail, InvoiceSendOutcome, OutboundEmail, SendOutcome } from "./types";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function rfc2822(msg: OutboundEmail): string {
  const subject = `=?UTF-8?B?${Buffer.from(msg.subject).toString("base64")}?=`;
  return [`To: ${msg.to}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", msg.body].join("\r\n");
}

function failure(res: Response, label: string): { ok: false; error: string; retryable: boolean } {
  return { ok: false, error: `${label} returned ${res.status}`, retryable: res.status >= 500 || res.status === 429 };
}

/* ---------------------------------- Gmail ---------------------------------- */

export const gmailProvider: EmailProvider = {
  id: "gmail",
  label: "Gmail",
  simulated: false,
  async listRecent(ctx, sinceIso) {
    const { access_token } = await getAccessToken(ctx, "gmail");
    const after = sinceIso ? Math.floor(new Date(sinceIso).getTime() / 1000) : Math.floor(Date.now() / 1000) - 7 * 86400;
    const q = encodeURIComponent(`in:inbox after:${after} -category:promotions -category:social`);
    const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${q}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!list.ok) throw new Error(`Gmail list failed (${list.status})`);
    const ids = ((await list.json()) as { messages?: { id: string }[] }).messages ?? [];
    const out: InboundEmail[] = [];
    for (const { id } of ids) {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!r.ok) continue;
      const m = (await r.json()) as GmailMessage;
      const header = (n: string) => m.payload.headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";
      const fromRaw = header("from");
      const match = fromRaw.match(/^(.*?)\s*<(.+)>$/);
      out.push({
        externalId: m.id,
        threadId: m.threadId,
        from: { name: (match?.[1] ?? fromRaw).replace(/"/g, "").trim(), email: (match?.[2] ?? fromRaw).trim() },
        subject: header("subject"),
        body: extractGmailText(m.payload).slice(0, 8000),
        receivedAt: new Date(Number(m.internalDate)).toISOString(),
      });
    }
    return out;
  },
  async send(ctx, msg): Promise<SendOutcome> {
    const { access_token } = await getAccessToken(ctx, "gmail");
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(rfc2822(msg)), threadId: msg.threadId }),
    });
    if (!res.ok) return failure(res, "Gmail");
    const json = (await res.json()) as { id: string };
    return { ok: true, externalId: json.id, simulated: false };
  },
};

interface GmailPart {
  mimeType: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers: { name: string; value: string }[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  payload: GmailPart;
}
function extractGmailText(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts ?? []) {
    const t = extractGmailText({ ...p, headers: p.headers ?? [] });
    if (t) return t;
  }
  return "";
}

/* --------------------------------- Outlook --------------------------------- */

export const outlookProvider: EmailProvider = {
  id: "outlook",
  label: "Outlook",
  simulated: false,
  async listRecent(ctx, sinceIso) {
    const { access_token } = await getAccessToken(ctx, "outlook");
    const since = sinceIso ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
    const url =
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=25" +
      "&$select=id,conversationId,from,subject,body,receivedDateTime" +
      `&$filter=receivedDateTime ge ${since}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}`, Prefer: 'outlook.body-content-type="text"' } });
    if (!res.ok) throw new Error(`Outlook list failed (${res.status})`);
    const json = (await res.json()) as {
      value: { id: string; conversationId: string; subject: string; receivedDateTime: string; body: { content: string }; from?: { emailAddress: { name: string; address: string } } }[];
    };
    return json.value.map((m) => ({
      externalId: m.id,
      threadId: m.conversationId,
      from: { name: m.from?.emailAddress.name ?? "", email: m.from?.emailAddress.address ?? "" },
      subject: m.subject ?? "",
      body: (m.body?.content ?? "").slice(0, 8000),
      receivedAt: m.receivedDateTime,
    }));
  },
  async send(ctx, msg): Promise<SendOutcome> {
    const { access_token } = await getAccessToken(ctx, "outlook");
    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { subject: msg.subject, body: { contentType: "Text", content: msg.body }, toRecipients: [{ emailAddress: { address: msg.to } }] },
        saveToSentItems: true,
      }),
    });
    // Graph returns 202 with no id; use our idempotency key as the reference.
    if (!res.ok) return failure(res, "Outlook");
    return { ok: true, externalId: `graph-${Date.now()}`, simulated: false };
  },
};

/* ----------------------------------- Xero ----------------------------------- */

const XERO_LINE_TYPES: Record<Invoice["amountsAre"], string> = { exclusive: "Exclusive", inclusive: "Inclusive", no_vat: "NoTax" };

export const xeroProvider: AccountingProvider = {
  id: "xero",
  label: "Xero",
  simulated: false,
  async sendInvoice(ctx, invoice, customer, idempotencyKey): Promise<InvoiceSendOutcome> {
    const tokens = await getAccessToken(ctx, "xero");
    if (!tokens.tenant_id) return { ok: false, error: "Xero organisation not selected — reconnect Xero", retryable: false };
    if (!customer.email) return { ok: false, error: `${customer.name} has no email address, so Xero can't email the invoice`, retryable: false };
    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
      "Xero-tenant-id": tokens.tenant_id,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    const res = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
      method: "POST",
      headers,
      body: JSON.stringify({
        Invoices: [
          {
            Type: "ACCREC",
            Contact: { Name: customer.name, EmailAddress: customer.email },
            LineAmountTypes: XERO_LINE_TYPES[invoice.amountsAre],
            LineItems: invoice.lines.map((l) => ({
              Description: l.description,
              Quantity: l.quantity,
              UnitAmount: l.unitAmount,
              AccountCode: process.env.XERO_SALES_ACCOUNT_CODE || "200",
            })),
            DueDate: invoice.dueDate,
            Reference: invoice.draftRef,
            Status: "AUTHORISED",
          },
        ],
      }),
    });
    if (!res.ok) return failure(res, "Xero");
    const created = ((await res.json()) as { Invoices: { InvoiceID: string; InvoiceNumber: string }[] }).Invoices[0];
    const email = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${created.InvoiceID}/Email`, { method: "POST", headers, body: "{}" });
    if (!email.ok)
      return { ok: false, error: `Invoice ${created.InvoiceNumber} was created in Xero but emailing it failed (${email.status})`, retryable: false };
    return { ok: true, externalId: created.InvoiceID, number: created.InvoiceNumber, simulated: false };
  },
};

/* -------------------------------- QuickBooks -------------------------------- */

export const quickbooksProvider: AccountingProvider = {
  id: "quickbooks",
  label: "QuickBooks",
  simulated: false,
  async sendInvoice(ctx, invoice, customer: Customer, idempotencyKey): Promise<InvoiceSendOutcome> {
    const tokens = await getAccessToken(ctx, "quickbooks");
    if (!tokens.realm_id) return { ok: false, error: "QuickBooks company not selected — reconnect QuickBooks", retryable: false };
    const base = `${process.env.QUICKBOOKS_API_BASE || "https://quickbooks.api.intuit.com"}/v3/company/${tokens.realm_id}`;
    const headers = { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json", Accept: "application/json" };
    // QuickBooks needs an existing Customer and Item; find the customer by display name.
    const q = encodeURIComponent(`select Id from Customer where DisplayName = '${customer.name.replace(/'/g, "\\'")}'`);
    const found = await fetch(`${base}/query?query=${q}`, { headers });
    if (!found.ok) return failure(found, "QuickBooks");
    const qbCustomer = ((await found.json()) as { QueryResponse: { Customer?: { Id: string }[] } }).QueryResponse.Customer?.[0];
    if (!qbCustomer) return { ok: false, error: `${customer.name} isn't set up as a customer in QuickBooks yet`, retryable: false };
    const itemId = process.env.QUICKBOOKS_SERVICE_ITEM_ID;
    if (!itemId) return { ok: false, error: "QUICKBOOKS_SERVICE_ITEM_ID isn't configured", retryable: false };
    const res = await fetch(`${base}/invoice?requestid=${encodeURIComponent(idempotencyKey)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        CustomerRef: { value: qbCustomer.Id },
        BillEmail: customer.email ? { Address: customer.email } : undefined,
        DueDate: invoice.dueDate,
        GlobalTaxCalculation: invoice.amountsAre === "inclusive" ? "TaxInclusive" : invoice.amountsAre === "exclusive" ? "TaxExcluded" : "NotApplicable",
        Line: invoice.lines.map((l) => ({
          Amount: l.unitAmount * l.quantity,
          Description: l.description,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: l.quantity, UnitPrice: l.unitAmount },
        })),
      }),
    });
    if (!res.ok) return failure(res, "QuickBooks");
    const inv = ((await res.json()) as { Invoice: { Id: string; DocNumber?: string } }).Invoice;
    const send = await fetch(`${base}/invoice/${inv.Id}/send`, { method: "POST", headers });
    if (!send.ok) return { ok: false, error: `Invoice created in QuickBooks but sending failed (${send.status})`, retryable: false };
    return { ok: true, externalId: inv.Id, number: inv.DocNumber, simulated: false };
  },
};
