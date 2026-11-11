import { NextResponse } from "next/server";
import { authed } from "@/server/http";
import { HttpError } from "@/server/context";
import { can } from "@/lib/auth/permissions";
import { randomToken } from "@/server/auth/password";
import { OAUTH_PROVIDERS, buildAuthorizeUrl, missingConfig, providerConfigured, type OAuthProvider } from "@/server/integrations/oauth";

export const runtime = "nodejs";

/** Start OAuth. Users sign in on the provider's page — Bob never sees their password. */
export const GET = authed(async (_req, ctx, params) => {
  if (!can(ctx.role, "integrations.manage")) throw new HttpError(403, "Only the account owner can connect integrations.");
  const provider = params.provider as OAuthProvider;
  if (!(provider in OAUTH_PROVIDERS)) throw new HttpError(404, "Unknown integration");
  if (!providerConfigured(provider))
    return NextResponse.json(
      { error: `${OAUTH_PROVIDERS[provider].label} isn't configured on this server yet.`, missing: missingConfig(provider) },
      { status: 501 },
    );
  const state = randomToken(24);
  const res = NextResponse.redirect(buildAuthorizeUrl(provider, state));
  res.cookies.set("bob_oauth_state", `${state}|${provider}|${ctx.orgId}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/integrations",
    maxAge: 600,
  });
  return res;
});
