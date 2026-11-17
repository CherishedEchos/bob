import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, cookieOptions } from "@/server/auth/session";
import { checkOrigin, errorResponse, readJson } from "@/server/http";
import { acceptInvite, inviteInfo } from "@/server/services/team";

export const runtime = "nodejs";

/** Public: is this invite usable, and for whom. Says nothing about bad links. */
export async function GET(_req: NextRequest, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  return NextResponse.json(inviteInfo(token), { headers: { "Cache-Control": "no-store" } });
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
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, r.value.token, cookieOptions(r.value.expires));
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
