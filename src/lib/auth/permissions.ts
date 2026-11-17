/**
 * Role-based permissions. Enforced on the SERVER for every operation and every
 * Bob tool; the UI only uses this to hide controls a user can't use.
 *
 *  - owner:  everything, including settings, integrations and data deletion
 *  - office: day-to-day admin, money and customer communication
 *  - staff:  site team — jobs, tasks, notes and expenses; no financial records
 *  - worker: an invited employee or subcontractor — only their own booked
 *            work and the site details they need (My work)
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
  | "data.delete"
  /** Plan the company schedule: add/move/reassign bookings. */
  | "schedule.manage"
  /** See the whole company schedule. */
  | "schedule.read"
  /** Add people, invite them, archive or revoke access. */
  | "team.manage"
  /** Job materials / order lists. */
  | "materials.write"
  /** Only their own assigned work (workers). */
  | "mywork.read"
  /** Add/edit/archive merchants and see trade account references and access links. */
  | "merchants.manage";

const ALL: Permission[] = [
  "records.read", "finance.read", "enquiries.write", "customers.write", "jobs.write", "notes.write", "tasks.write",
  "expenses.write", "quotes.write", "invoices.draft", "invoices.send", "payments.record", "email.send",
  "activity.read", "settings.manage", "integrations.manage", "data.delete",
  "schedule.manage", "schedule.read", "team.manage", "materials.write", "mywork.read", "merchants.manage",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>(ALL),
  office: new Set<Permission>(ALL.filter((p) => !["settings.manage", "integrations.manage", "data.delete"].includes(p))),
  staff: new Set<Permission>(["records.read", "notes.write", "tasks.write", "expenses.write", "schedule.read", "materials.write", "mywork.read"]),
  worker: new Set<Permission>(["mywork.read"]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", office: "Office", staff: "Site team", worker: "Team member (My work only)" };
