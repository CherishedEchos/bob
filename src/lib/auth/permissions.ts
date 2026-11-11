/**
 * Role-based access. Two roles to start with:
 *  - owner: everything
 *  - admin: day-to-day admin (the office) — can't delete records or change settings
 *
 * The same map should be enforced server-side (server actions + RLS); the UI
 * uses it only to hide controls a user can't use.
 */
import type { UserRole } from "@/lib/types";

export type Permission =
  | "enquiries.read"
  | "enquiries.write"
  | "jobs.read"
  | "jobs.write"
  | "payments.read"
  | "payments.record"
  | "reminders.write"
  | "activity.read"
  | "settings.manage"
  | "records.delete";

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    "enquiries.read", "enquiries.write", "jobs.read", "jobs.write", "payments.read",
    "payments.record", "reminders.write", "activity.read", "settings.manage", "records.delete",
  ]),
  admin: new Set<Permission>([
    "enquiries.read", "enquiries.write", "jobs.read", "jobs.write", "payments.read",
    "payments.record", "reminders.write", "activity.read",
  ]),
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
