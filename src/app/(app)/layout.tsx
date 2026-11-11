import { AppShell } from "@/components/layout/app-shell";

/**
 * Authenticated area. src/middleware.ts redirects visitors without a session
 * to /login; every API call re-validates the session server-side.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
