/**
 * Placeholder for the production repository.
 *
 * Intentionally NOT implemented in the demo build. When wiring it up:
 *  - Reads happen in server components / route handlers using the
 *    request-scoped Supabase client (src/lib/supabase/server.ts), so customer
 *    data is never fetched with a public key from the browser.
 *  - Writes go through server actions that (1) check the session, (2) check
 *    the user's role via src/lib/auth/permissions.ts, (3) re-validate with the
 *    zod schemas in src/lib/validation.ts, (4) write the row and an
 *    audit_log row in the same transaction (see supabase/migrations).
 *  - Row Level Security restricts every table to members of the same
 *    organisation, giving data isolation even if application code is wrong.
 */
import type { Repository } from "./repository";
import type { AppData } from "@/lib/types";

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;

  async load(): Promise<AppData> {
    throw new Error("SupabaseRepository is not implemented in the demo build.");
  }
  async persist(): Promise<void> {
    throw new Error("SupabaseRepository is not implemented in the demo build.");
  }
  async reset(): Promise<AppData> {
    throw new Error("Resetting is only available for demo data.");
  }
}
