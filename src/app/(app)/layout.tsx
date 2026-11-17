import { redirect } from "next/navigation";
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
  if (!ctx) redirect("/login");
  if (!can(ctx.role, "records.read")) redirect("/my-work");
  return <AppShell>{children}</AppShell>;
}
