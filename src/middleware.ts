/**
 * Route protection.
 *
 * Demo mode (no Supabase env vars): everything is open because the app only
 * contains fictional data held in the visitor's own browser.
 *
 * Production: when NEXT_PUBLIC_SUPABASE_URL is set, refresh the Supabase
 * session cookie here and redirect unauthenticated users to /login for every
 * app route, and return 401 for /api/*. See docs/ARCHITECTURE.md.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const authEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.AUTH_REQUIRED === "true");
  if (!authEnabled) return NextResponse.next();

  // Placeholder gate until Supabase Auth is wired in (src/lib/supabase/server.ts):
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
  if (hasSession) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|manifest.webmanifest|favicon.ico|login).*)"],
};
