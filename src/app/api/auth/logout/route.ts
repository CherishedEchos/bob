import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/server/auth/session";
import { checkOrigin, errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) destroySession(token);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", expires: new Date(0) });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
