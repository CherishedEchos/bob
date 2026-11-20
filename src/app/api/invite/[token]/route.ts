import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, contextFromToken, cookieOptions, destroySession } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { checkOrigin, errorResponse, readJson } from "@/server/http";
import { acceptInvite, inviteInfo } from "@/server/services/team";

export const runtime = "nodejs";

/**
 * Public: is this invite usable, and for whom. Says nothing about bad links.
 * If this browser is already signed in (e.g. a demo opened in the meeting),
 * it also says as whom — only that browser's own name/email — so the page can
 * explain that accepting signs in as the invited person instead.
 */
export async function GET(req: NextRequest, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  const info = inviteInfo(token);
  const ctx = info.state === "pending" ? contextFromToken(req.cookies.get(SESSION_COOKIE)?.value) : null;
  let signedInAs: { name: string; email: string; businessName: string; demo: boolean; isInvitee: boolean } | undefined;
  if (ctx) {
    const email = (getDb().prepare("SELECT email FROM users WHERE id = ?").get(ctx.userId) as { email: string } | undefined)?.email ?? "";
    signedInAs = { name: ctx.userName, email, businessName: ctx.org.name, demo: ctx.org.dataMode === "sample", isInvitee: email.toLowerCase() === (info.email ?? "").toLowerCase() };
  }
  return NextResponse.json({ ...info, signedInAs }, { headers: { "Cache-Control": "no-store" } });
}

/** Accept: bound to the invited email, single use, expiring, revocable. */
export async function POST(req: NextRequest, route: { params: Promise<{ token: string }> }) {
  try {
    checkOrigin(req);
    const { token } = await route.params;
    const body = await readJson(req);
    const r = acceptInvite(token, { password: body.password, name: body.name });
    if (!r.ok) {
      const status = r.code === "forbidden" ? 403 : r.code === "not_found" ? 404 : r.code === "conflict" ? 409 : 422;
      return NextResponse.json({ ok: false, error: r.error, fieldErrors: r.fieldErrors }, { status });
    }
    // Whatever this browser was signed in as (e.g. a demo) is signed out: the invited person's session replaces it.
    const previous = req.cookies.get(SESSION_COOKIE)?.value;
    if (previous) destroySession(previous);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, r.value.token, cookieOptions(r.value.expires));
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
