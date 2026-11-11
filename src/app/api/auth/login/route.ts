import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, authenticate, cookieOptions } from "@/server/auth/session";
import { checkOrigin, errorResponse, readJson } from "@/server/http";

export const runtime = "nodejs";

const schema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200), orgId: z.string().max(80).optional() });

export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    const r = authenticate(parsed.data.email, parsed.data.password, parsed.data.orgId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, r.token, cookieOptions(r.expires));
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
