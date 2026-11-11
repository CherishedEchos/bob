/**
 * Role-based permissions. Enforced on the SERVER for every operation and every
 * Bob tool; the UI only uses this to hide controls a user can't use.
 *
 *  - owner:  everything, including settings, integrations and data deletion
 *  - office: day-to-day admin, money and customer communication
 *  - staff:  site team — jobs, tasks, notes and expenses; no financial records
 */
import type { Role } from "@/lib/types";

export type Permission =
  | "records.read"
  | "finance.read"
  | "enquiries.write"
  | "customers.write"
  | "jobs.write"
  | "notes.write"
  | "tasks.write"
  | "expenses.write"
  | "quotes.write"
  | "invoices.draft"
  | "invoices.send"
  | "payments.record"
  | "email.send"
  | "activity.read"
  | "settings.manage"
  | "integrations.manage"
  | "data.delete";

const ALL: Permission[] = [
  "records.read", "finance.read", "enquiries.write", "customers.write", "jobs.write", "notes.write", "tasks.write",
  "expenses.write", "quotes.write", "invoices.draft", "invoices.send", "payments.record", "email.send",
  "activity.read", "settings.manage", "integrations.manage", "data.delete",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>(ALL),
  office: new Set<Permission>(ALL.filter((p) => !["settings.manage", "integrations.manage", "data.delete"].includes(p))),
  staff: new Set<Permission>(["records.read", "notes.write", "tasks.write", "expenses.write"]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", office: "Office", staff: "Site team" };
