/**
 * Route gate: pages require a session cookie; otherwise redirect to /login.
 * This is only a UX gate — every API route re-validates the session against
 * the database and derives the organisation server-side.
 *
 *  - "/" (signing in normally, the logo, Home): Overview for owners and admins.
 *    Invited workers and subcontractors are sent on from there to My work by
 *    the app layout, so the business Overview stays restricted.
 *  - A deep link (e.g. a particular job) followed while signed out comes back
 *    after sign-in: the path travels as ?next= and is checked on the way back.
 */
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";

export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get("bob_session")?.value);
  const { pathname, search } = request.nextUrl;
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = hasSession ? "/home" : "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (hasSession) {
    // Let the app layout know where this request was going (for a sign-in round trip if the session has expired).
    const headers = new Headers(request.headers);
    headers.set("x-bob-path", `${pathname}${search}`);
    return NextResponse.next({ request: { headers } });
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  const next = safeNext(`${pathname}${search}`);
  url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Public: sign-in, invite acceptance, static assets, the website enquiry form (/f/…), its example site and its submit API.
  matcher: ["/((?!_next/static|_next/image|brand/|icons/|manifest.webmanifest|favicon.ico|login|api/auth/login|invite/|api/invite/|api/calendar/|f/|example-site/|api/public/).*)"],
};
