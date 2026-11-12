import "server-only";
import { listPhotos } from "@/server/services/photos";
import type { Snapshot } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { scoped } from "@/server/db";
import type { Ctx } from "@/server/context";
import { usersInOrg } from "@/server/auth/session";
import { listConnections } from "@/server/integrations/registry";
import { activeEngine } from "@/server/bob/conversation";
import { listCustomers, listEnquiries, listExpenses, listJobs, listQuotes, listTasks } from "./records";
import { listInvoices, listPayments } from "./finance";

/**
 * Everything the dashboard needs, for the signed-in user's organisation only.
 * Financial records are withheld entirely (not just hidden) from roles
 * without finance access.
 */
export function buildSnapshot(ctx: Ctx): Snapshot {
  const finance = can(ctx.role, "finance.read");
  const jobs = listJobs(ctx).map((j) => (finance ? j : { ...j, quotedValue: 0, depositRequired: 0 }));
  return {
    org: ctx.org,
    user: { id: ctx.userId, name: ctx.userName, email: usersInOrg(ctx.orgId).find((u) => u.id === ctx.userId)?.email ?? "", role: ctx.role },
    members: usersInOrg(ctx.orgId),
    customers: listCustomers(ctx),
    enquiries: listEnquiries(ctx),
    jobs,
    quotes: finance ? listQuotes(ctx) : [],
    invoices: finance ? listInvoices(ctx) : [],
    payments: finance ? listPayments(ctx) : [],
    expenses: finance ? listExpenses(ctx) : [],
    tasks: listTasks(ctx),
    photos: listPhotos(ctx),
    activity: can(ctx.role, "activity.read") ? scoped(ctx).list("activity", { order: "at DESC", limit: 150 }) : [],
    connections: listConnections(ctx),
    mode: { database: "local-sqlite", aiEngine: activeEngine() },
    generatedAt: new Date().toISOString(),
  };
}
