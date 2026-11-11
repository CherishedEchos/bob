import { AppShell } from "@/components/layout/app-shell";

/**
 * Authenticated area. In the demo there's no sign-in; once Supabase Auth is
 * enabled, src/middleware.ts redirects anonymous visitors before this renders.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
