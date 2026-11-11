import { NextResponse } from "next/server";
import { authed } from "@/server/http";
import { HttpError } from "@/server/context";
import { can } from "@/lib/auth/permissions";
import { OAUTH_PROVIDERS, appUrl, exchangeCode, saveTokens, type OAuthProvider } from "@/server/integrations/oauth";
import { audit } from "@/server/services/records";

export const runtime = "nodejs";

/**
 * OAuth callback. Verifies the CSRF state cookie, exchanges the code, then
 * stores tokens encrypted (AES-256-GCM). NOT yet exercised against live providers.
 */
export const GET = authed(async (req, ctx, params) => {
  if (!can(ctx.role, "integrations.manage")) throw new HttpError(403, "Only the account owner can connect integrations.");
  const provider = params.provider as OAuthProvider;
  if (!(provider in OAUTH_PROVIDERS)) throw new HttpError(404, "Unknown integration");
  const url = req.nextUrl;
  const [state, stateProvider, stateOrg] = (req.cookies.get("bob_oauth_state")?.value ?? "").split("|");
  if (!state || state !== url.searchParams.get("state") || stateProvider !== provider || stateOrg !== ctx.orgId)
    throw new HttpError(400, "This connection link has expired. Please try again from Settings.");
  const code = url.searchParams.get("code");
  if (!code) throw new HttpError(400, url.searchParams.get("error_description") ?? "Connection was cancelled.");

  const tokens = await exchangeCode(provider, code);
  if (provider === "xero") {
    const conns = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const list = conns.ok ? ((await conns.json()) as { tenantId: string; tenantName: string }[]) : [];
    tokens.tenant_id = list[0]?.tenantId;
    tokens.account = list[0]?.tenantName;
  }
  if (provider === "quickbooks") tokens.realm_id = url.searchParams.get("realmId") ?? undefined;
  saveTokens(ctx, provider, tokens, tokens.account ?? OAUTH_PROVIDERS[provider].label);
  audit(ctx, "integration.connected", `${OAUTH_PROVIDERS[provider].label} connected`);
  const res = NextResponse.redirect(`${appUrl()}/settings?connected=${provider}`);
  res.cookies.set("bob_oauth_state", "", { path: "/api/integrations", expires: new Date(0) });
  return res;
});
