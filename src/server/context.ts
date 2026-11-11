import "server-only";
import type { OrgConfig, Role } from "@/lib/types";
import { can, type Permission } from "@/lib/auth/permissions";

/**
 * The authenticated request context. Built ONLY from the server-side session
 * (never from request bodies), and passed to every service and Bob tool.
 */
export interface Ctx {
  orgId: string;
  userId: string;
  userName: string;
  role: Role;
  org: OrgConfig;
  /** Where the request came from — recorded in the audit log. */
  via: "dashboard" | "bob" | "system" | "integration";
}

export type Fail = { ok: false; error: string; code: "forbidden" | "not_found" | "invalid" | "conflict" | "unavailable"; fieldErrors?: Record<string, string> };
export type Result<T> = { ok: true; value: T } | Fail;

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: Fail["code"], error: string, fieldErrors?: Record<string, string>): Fail => ({ ok: false, code, error, fieldErrors });

export function denied(ctx: Ctx, perm: Permission): Fail | null {
  return can(ctx.role, perm) ? null : fail("forbidden", "Your account doesn't have permission to do that.");
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
