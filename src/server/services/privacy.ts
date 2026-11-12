import "server-only";
import { removePhotosFor } from "@/server/services/photos";
/**
 * UK GDPR controls: export, erasure (anonymisation), retention and sample-data
 * reset. Financial records are anonymised rather than deleted because HMRC
 * requires businesses to keep them (normally 6 years).
 */
import type { Customer, Enquiry, Task } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { getDb, insertRaw, scoped, tx, TABLES, type TableName } from "@/server/db";
import { seedOrgData } from "@/server/db/seed";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { audit } from "./records";

export function exportOrgData(ctx: Ctx): Result<Record<string, unknown>> {
  const no = denied(ctx, "data.delete");
  if (no) return no;
  const db = scoped(ctx);
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), organisation: ctx.org };
  for (const t of Object.keys(TABLES) as TableName[]) out[t] = db.list(t);
  out.conversations = getDb()
    .prepare("SELECT c.id, c.user_id, c.created_at, m.role, m.payload, m.created_at AS message_at FROM conversations c JOIN conversation_messages m ON m.conversation_id = c.id WHERE c.org_id = ? ORDER BY m.created_at")
    .all(ctx.orgId);
  audit(ctx, "privacy.exported", "Full data export downloaded");
  return ok(out);
}

/** Right to erasure: remove personal data about one customer. */
export function eraseCustomer(ctx: Ctx, customerId: string): Result<{ enquiriesDeleted: number }> {
  const no = denied(ctx, "data.delete");
  if (no) return no;
  const db = scoped(ctx);
  const c = db.get<Customer>("customers", customerId);
  if (!c) return fail("not_found", "Customer not found");
  return tx(() => {
    const enquiries = db.list<Enquiry>("enquiries", { where: "customer_id = ?", params: [customerId] });
    // Photos can show people and homes: remove those on their enquiries and jobs.
    removePhotosFor(ctx, [...enquiries.map((e) => e.id), ...db.list<{ id: string }>("jobs", { where: "customer_id = ?", params: [customerId] }).map((j) => j.id)]);
    for (const e of enquiries) db.remove("enquiries", e.id);
    for (const t of db.list<Task>("tasks", { where: "customer_id = ?", params: [customerId] })) db.remove("tasks", t.id);
    db.update<Customer>("customers", customerId, {
      name: "Erased customer",
      email: undefined,
      phone: undefined,
      instagramHandle: undefined,
      address: undefined,
      notes: [],
    });
    audit(ctx, "privacy.customer_erased", `Personal data erased for a customer (financial records kept, anonymised)`, "customer", customerId);
    return ok({ enquiriesDeleted: enquiries.length });
  });
}

/** Wipe and re-create the fictional sample data. Refused for live organisations. */
export function resetSampleData(ctx: Ctx): Result<true> {
  if (!can(ctx.role, "data.delete")) return fail("forbidden", "Only the owner can reset data.");
  if (ctx.org.dataMode !== "sample") return fail("forbidden", "This business has live data, so sample reset is disabled.");
  const raw = getDb();
  tx(() => {
    for (const t of Object.keys(TABLES) as TableName[]) raw.prepare(`DELETE FROM ${t} WHERE org_id = ?`).run(ctx.orgId);
    raw.prepare("DELETE FROM bob_actions WHERE org_id = ?").run(ctx.orgId);
    raw.prepare("DELETE FROM conversations WHERE org_id = ?").run(ctx.orgId);
    raw.prepare("DELETE FROM imported_messages WHERE org_id = ?").run(ctx.orgId);
    seedOrgData(raw, insertRaw, ctx.orgId);
  });
  audit(ctx, "demo.reset", "Sample data reset");
  return ok(true);
}
