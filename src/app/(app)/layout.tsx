import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { safeNext } from "@/lib/safe-next";
import { AppShell } from "@/components/layout/app-shell";
import { getContext } from "@/server/auth/session";
import { can } from "@/lib/auth/permissions";

/**
 * Authenticated area. src/middleware.ts redirects visitors without a session
 * to /login; every API call re-validates the session server-side. Invited
 * workers and subcontractors only have My work, so they're sent there.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (!ctx) {
    // Expired or removed session: come back to the same page after signing in.
    const next = safeNext((await headers()).get("x-bob-path"));
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  if (!can(ctx.role, "records.read")) redirect("/my-work");
  return <AppShell>{children}</AppShell>;
}
