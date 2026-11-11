import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, cookieOptions, createSession, destroySession, membershipsFor } from "@/server/auth/session";
import { authed, readJson } from "@/server/http";
import { HttpError } from "@/server/context";

export const runtime = "nodejs";

/** Switch workspace — only to organisations the user is a member of. */
export const POST = authed(async (req, ctx) => {
  const { orgId } = await readJson(req);
  if (typeof orgId !== "string" || !membershipsFor(ctx.userId).some((m) => m.orgId === orgId)) throw new HttpError(403, "You're not a member of that business.");
  const r = createSession(ctx.userId, orgId);
  if (!r.ok) throw new HttpError(500, "Couldn't switch");
  const old = req.cookies.get(SESSION_COOKIE)?.value;
  if (old) destroySession(old);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, r.token, cookieOptions(r.expires));
  return res;
});

export const GET = authed(async (_req, ctx) => ({
  current: ctx.orgId,
  orgs: membershipsFor(ctx.userId).map((m) => ({ id: m.orgId, name: m.org.name, role: m.role, isDemo: m.org.isDemo })),
}));
