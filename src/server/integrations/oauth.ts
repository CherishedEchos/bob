import "server-only";
/**
 * OAuth 2.0 for Gmail, Outlook (Microsoft Graph), Xero and QuickBooks.
 *
 * STATUS: implemented against the providers' published OAuth endpoints but NOT
 * yet exercised against live accounts (no client credentials in this
 * environment). A provider only reports "available" when its client ID,
 * secret and BOB_ENCRYPTION_KEY are configured. Users never give Bob a
 * password — they sign in on the provider's own page.
 */
import { getDb } from "@/server/db";
import type { Ctx } from "@/server/context";
import { decrypt, encrypt, encryptionConfigured } from "./crypto";

export type OAuthProvider = "gmail" | "outlook" | "xero" | "quickbooks";

interface ProviderSpec {
  label: string;
  kind: "email" | "accounting";
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  env: { id: string; secret: string };
  extraAuthParams?: Record<string, string>;
}

export const OAUTH_PROVIDERS: Record<OAuthProvider, ProviderSpec> = {
  gmail: {
    label: "Gmail",
    kind: "email",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // Read + send only. No full-mailbox modify/delete scope.
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "openid", "email"],
    env: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  outlook: {
    label: "Outlook",
    kind: "email",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "User.Read", "Mail.Read", "Mail.Send"],
    env: { id: "MICROSOFT_CLIENT_ID", secret: "MICROSOFT_CLIENT_SECRET" },
  },
  xero: {
    label: "Xero",
    kind: "accounting",
    authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    scopes: ["openid", "profile", "email", "offline_access", "accounting.transactions", "accounting.contacts"],
    env: { id: "XERO_CLIENT_ID", secret: "XERO_CLIENT_SECRET" },
  },
  quickbooks: {
    label: "QuickBooks",
    kind: "accounting",
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    env: { id: "QUICKBOOKS_CLIENT_ID", secret: "QUICKBOOKS_CLIENT_SECRET" },
  },
};

export function appUrl(): string {
  return (process.env.BOB_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(provider: OAuthProvider) {
  return `${appUrl()}/api/integrations/${provider}/callback`;
}

export function providerConfigured(provider: OAuthProvider): boolean {
  const spec = OAUTH_PROVIDERS[provider];
  return Boolean(process.env[spec.env.id] && process.env[spec.env.secret] && encryptionConfigured());
}

export function missingConfig(provider: OAuthProvider): string[] {
  const spec = OAUTH_PROVIDERS[provider];
  const missing = [spec.env.id, spec.env.secret].filter((k) => !process.env[k]);
  if (!encryptionConfigured()) missing.push("BOB_ENCRYPTION_KEY");
  if (!process.env.BOB_APP_URL) missing.push("BOB_APP_URL");
  return missing;
}

export function buildAuthorizeUrl(provider: OAuthProvider, state: string): string {
  const spec = OAUTH_PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: process.env[spec.env.id]!,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: spec.scopes.join(" "),
    state,
    ...(spec.extraAuthParams ?? {}),
  });
  return `${spec.authorizeUrl}?${params.toString()}`;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
  tenant_id?: string; // Xero
  realm_id?: string; // QuickBooks
  account?: string;
}

async function tokenRequest(provider: OAuthProvider, body: Record<string, string>): Promise<TokenSet> {
  const spec = OAUTH_PROVIDERS[provider];
  const id = process.env[spec.env.id]!;
  const secret = process.env[spec.env.secret]!;
  const res = await fetch(spec.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ ...body, client_id: id, client_secret: secret }).toString(),
  });
  if (!res.ok) throw new Error(`${spec.label} token request failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
}

export function exchangeCode(provider: OAuthProvider, code: string) {
  return tokenRequest(provider, { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider) });
}

export function saveTokens(ctx: Ctx, provider: OAuthProvider, tokens: TokenSet, accountLabel?: string) {
  const spec = OAUTH_PROVIDERS[provider];
  getDb()
    .prepare(
      `INSERT INTO connections (org_id, provider, kind, status, account_label, token_enc, last_sync_at, error)
       VALUES (?, ?, ?, 'connected', ?, ?, NULL, NULL)
       ON CONFLICT(org_id, provider) DO UPDATE SET status='connected', account_label=excluded.account_label, token_enc=excluded.token_enc, error=NULL`,
    )
    .run(ctx.orgId, provider, spec.kind, accountLabel ?? null, encrypt(JSON.stringify(tokens)));
}

/** Get a valid access token, refreshing (and re-encrypting) when expired. */
export async function getAccessToken(ctx: Ctx, provider: OAuthProvider): Promise<TokenSet> {
  const row = getDb()
    .prepare("SELECT token_enc FROM connections WHERE org_id = ? AND provider = ? AND status = 'connected'")
    .get(ctx.orgId, provider) as { token_enc: string | null } | undefined;
  if (!row?.token_enc) throw new Error(`${OAUTH_PROVIDERS[provider].label} isn't connected`);
  const tokens = JSON.parse(decrypt(row.token_enc)) as TokenSet;
  if (tokens.expires_at > Date.now()) return tokens;
  if (!tokens.refresh_token) throw new Error(`${OAUTH_PROVIDERS[provider].label} needs reconnecting`);
  const fresh = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  const merged: TokenSet = { ...tokens, ...fresh, refresh_token: fresh.refresh_token ?? tokens.refresh_token };
  getDb()
    .prepare("UPDATE connections SET token_enc = ? WHERE org_id = ? AND provider = ?")
    .run(encrypt(JSON.stringify(merged)), ctx.orgId, provider);
  return merged;
}

export function markConnectionError(ctx: Ctx, provider: string, error: string) {
  getDb().prepare("UPDATE connections SET status = 'error', error = ? WHERE org_id = ? AND provider = ?").run(error, ctx.orgId, provider);
}

export function disconnect(ctx: Ctx, provider: string) {
  // Tokens are deleted, not just flagged.
  getDb().prepare("DELETE FROM connections WHERE org_id = ? AND provider = ?").run(ctx.orgId, provider);
}
