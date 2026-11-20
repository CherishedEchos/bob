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
import { listAccess, listBills, listBookings, listMaterials, listPeople } from "./team";
import { listMerchants } from "./merchants";
import { listMyFeeds } from "./calendar";
import { listFiles } from "./files";
import { listHandovers } from "./handover";
import { listAbsences } from "./absences";
import { listUpdates } from "./updates";
import { listVariations } from "./variations";
import { listReportVersions, listReports } from "./handover-reports";
import { HttpError } from "@/server/context";

/**
 * Everything the dashboard needs, for the signed-in user's organisation only.
 * Financial records are withheld entirely (not just hidden) from roles
 * without finance access.
 */
export function buildSnapshot(ctx: Ctx): Snapshot {
  // Invited workers never get the company snapshot — only My work (/api/my-work).
  if (!can(ctx.role, "records.read")) throw new HttpError(403, "Your account only shows your own work. Open My work.");
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
    people: listPeople(ctx),
    access: listAccess(ctx),
    bookings: listBookings(ctx),
    materials: listMaterials(ctx),
    bills: listBills(ctx),
    merchants: listMerchants(ctx),
    feeds: listMyFeeds(ctx),
    files: listFiles(ctx),
    handovers: listHandovers(ctx),
    absences: listAbsences(ctx),
    updates: listUpdates(ctx),
    variations: listVariations(ctx),
    reports: listReports(ctx),
    reportVersions: listReportVersions(ctx),
    activity: can(ctx.role, "activity.read") ? scoped(ctx).list("activity", { order: "at DESC", limit: 150 }) : [],
    connections: listConnections(ctx),
    mode: { database: "local-sqlite", aiEngine: activeEngine() },
    generatedAt: new Date().toISOString(),
  };
}
