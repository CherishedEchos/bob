/**
 * Route gate: pages require a session cookie; otherwise redirect to /login.
 * This is only a UX gate — every API route re-validates the session against
 * the database and derives the organisation server-side.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get("bob_session")?.value);
  if (hasSession) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|icons/|manifest.webmanifest|favicon.ico|login|api/auth/login).*)"],
};
