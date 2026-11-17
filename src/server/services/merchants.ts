import "server-only";
/**
 * Merchants (suppliers). Owners/office manage them and see trade account
 * references and access links; the site team sees names and contact details;
 * invited workers see none of this. Bob never stores passwords — only a link
 * to the company's password manager and a note of who manages the login.
 */
import type { Material, Merchant } from "@/lib/types";
import { merchantInputSchema } from "@/lib/validation";
import { can } from "@/lib/auth/permissions";
import { uid } from "@/lib/utils";
import { scoped, tx } from "@/server/db";
import { denied, fail, ok, type Ctx, type Result } from "@/server/context";
import { audit } from "./records";

const now = () => new Date().toISOString();
const errs = (issues: { path: PropertyKey[]; message: string }[]) => Object.fromEntries(issues.map((i) => [String(i.path[0] ?? "form"), i.message]));

/** Restricted fields are removed (not just hidden) for roles that can't manage merchants. */
function visible(ctx: Ctx, m: Merchant): Merchant {
  if (can(ctx.role, "merchants.manage")) return m;
  const { accountRef: _a, passwordManagerUrl: _p, accessManagedBy: _w, ...rest } = m;
  void _a; void _p; void _w;
  return rest;
}

export function listMerchants(ctx: Ctx): Merchant[] {
  if (!can(ctx.role, "records.read")) return [];
  return scoped(ctx).list<Merchant>("merchants", { order: "archived_at IS NOT NULL, name" }).map((m) => visible(ctx, m));
}

export function saveMerchant(ctx: Ctx, id: string | undefined, input: unknown): Result<Merchant> {
  const no = denied(ctx, "merchants.manage");
  if (no) return no;
  const parsed = merchantInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Check the merchant details.", errs(parsed.error.issues));
  const existing = id ? scoped(ctx).get<Merchant>("merchants", id) : undefined;
  if (id && !existing) return fail("not_found", "Merchant not found");
  const v = parsed.data;
  const clear = <T,>(x: T | undefined) => (x ?? (null as unknown as undefined));
  const out = tx(() => {
    if (existing) {
      scoped(ctx).update<Merchant>("merchants", existing.id, {
        name: v.name, branch: clear(v.branch), phone: clear(v.phone), email: clear(v.email), website: clear(v.website), notes: clear(v.notes),
        accountRef: clear(v.accountRef), passwordManagerUrl: clear(v.passwordManagerUrl), accessManagedBy: clear(v.accessManagedBy),
      });
      audit(ctx, "merchants.updated", `Merchant updated: ${v.name}`, "merchant", existing.id);
      return scoped(ctx).get<Merchant>("merchants", existing.id)!;
    }
    const m: Merchant = { id: uid("mer"), ...v, createdAt: now() };
    scoped(ctx).insert("merchants", m);
    audit(ctx, "merchants.added", `Merchant added: ${v.name}`, "merchant", m.id);
    return m;
  });
  return ok(out);
}

/** Archive keeps every historical material and bill linked to the merchant. */
export function archiveMerchant(ctx: Ctx, id: string, archived = true): Result<Merchant> {
  const no = denied(ctx, "merchants.manage");
  if (no) return no;
  const m = scoped(ctx).get<Merchant>("merchants", id);
  if (!m) return fail("not_found", "Merchant not found");
  tx(() => {
    scoped(ctx).update<Merchant>("merchants", id, { archivedAt: archived ? now() : (null as unknown as undefined) });
    audit(ctx, archived ? "merchants.archived" : "merchants.restored", `${m.name} ${archived ? "archived (history kept)" : "restored"}`, "merchant", id);
  });
  return ok(scoped(ctx).get<Merchant>("merchants", id)!);
}

export function openOrdersFor(ctx: Ctx, merchantId: string): Material[] {
  return scoped(ctx).list<Material>("materials", { where: "merchant_id = ? AND status != 'on_site'", params: [merchantId] });
}
