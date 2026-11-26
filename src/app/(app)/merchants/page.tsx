"use client";

/**
 * Merchants — the suppliers Ninety3 buys from. Contact details for the team;
 * trade account references and login access links for owners/office only
 * (the server removes those fields for everyone else). Bob never stores
 * passwords — only a link to the company's password manager.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Archive, ChevronRight, ExternalLink, KeyRound, Mail, Pencil, Phone, Plus, Search, Store } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { relativeDayInline } from "@/lib/dates";
import { cn, todayKey } from "@/lib/utils";
import { EmptyState, pageActionClass } from "@/components/common/bits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { MATERIAL_STATUS_LABEL } from "@/components/forms/team-forms";

export default function MerchantsPage() {
  return (
    <React.Suspense>
      <Merchants />
    </React.Suspense>
  );
}

function Merchants() {
  const { data, can } = useStore();
  const ui = useUI();
  const params = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [view, setView] = React.useState<"active" | "archived">("active");
  const [open, setOpen] = React.useState<string | null>(params.get("open"));
  const manage = can("merchants.manage");
  const q = query.trim().toLowerCase();
  const list = data.merchants
    .filter((m) => (view === "archived" ? !!m.archivedAt : !m.archivedAt) && (!q || [m.name, m.branch, m.phone, m.notes].some((x) => x?.toLowerCase().includes(q))))
    .sort((a, b) => a.name.localeCompare(b.name));
  /** Plain count from the materials records: what's still to order and what's on its way. */
  const orders = (id: string) => {
    const mine = data.materials.filter((x) => x.merchantId === id);
    const toOrder = mine.filter((x) => x.status === "to_order").length;
    const ordered = mine.filter((x) => x.status === "ordered").length;
    return { toOrder, ordered, label: toOrder || ordered ? [toOrder ? `${toOrder} to order` : "", ordered ? `${ordered} ordered` : ""].filter(Boolean).join(" · ") : "No open orders" };
  };
  const activeCount = data.merchants.filter((m) => !m.archivedAt).length;
  const archivedCount = data.merchants.length - activeCount;

  return (
    <div className="max-w-[1400px]">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-page">Merchants</h1>
          <p className="t-meta mt-0.5">
            {activeCount} {activeCount === 1 ? "supplier" : "suppliers"}
          </p>
        </div>
        {manage ? (
          <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "merchant" })}>
            <Plus className="size-[18px]" aria-hidden /> Add merchant
          </button>
        ) : null}
      </header>

      <div role="toolbar" aria-label="Find merchants" className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Merchant list" className="flex w-full shrink-0 gap-0.5 rounded-xl bg-surface-3 p-1 sm:w-auto">
          {(
            [
              ["active", "Active", activeCount],
              ["archived", "Archived", archivedCount],
            ] as ["active" | "archived", string, number][]
          ).map(([v, label, n]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[15px] font-semibold transition sm:flex-none", view === v ? "bg-card text-heading shadow-[0_1px_2px_rgb(16_24_40/0.08)] ring-1 ring-line" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
              <span className={cn("tabular text-[13.5px]", view === v ? "text-accent-fg" : "text-subtle")}>{n}</span>
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, branch or phone" aria-label="Search merchants" className="h-11 pl-10 text-[15px]" />
        </div>
      </div>

      {list.length ? (
        <>
          {/* Desktop: aligned columns; the whole row opens the supplier */}
          <div className="panel hidden overflow-hidden md:block">
            <table className="w-full table-fixed border-collapse text-left">
              <caption className="sr-only">Merchants</caption>
              <colgroup>
                <col />
                <col className="w-[22%]" />
                <col className="w-[150px]" />
                <col className="w-[190px]" />
                <col className="w-[44px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[14px] font-semibold text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 lg:px-5">Supplier</th>
                  <th scope="col" className="px-3 py-2.5">Branch</th>
                  <th scope="col" className="px-3 py-2.5">Phone</th>
                  <th scope="col" className="px-3 py-2.5">Materials orders</th>
                  <th scope="col" className="py-2.5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => {
                  const o = orders(m.id);
                  return (
                    <tr key={m.id} onClick={() => setOpen(m.id)} className="group cursor-pointer border-t border-line align-middle transition-colors first:border-t-0 hover:bg-surface-2">
                      <td className="px-4 py-3.5 lg:px-5">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(m.id); }} className="flex w-full min-w-0 items-center gap-3 rounded text-left">
                          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-muted-foreground">
                            <Store className="size-[18px]" />
                          </span>
                          <span className="min-w-0 text-[15.5px] font-semibold leading-snug text-heading [overflow-wrap:anywhere]">{m.name}</span>
                        </button>
                      </td>
                      <td className="truncate px-3 py-3.5 text-[15px] text-foreground" title={m.branch}>
                        {m.branch ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-[15px] tabular text-foreground">{m.phone ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-3.5 text-[15px]">
                        <span className={cn(o.toOrder ? "font-semibold text-warn-fg" : o.ordered ? "text-info-fg" : "text-muted-foreground")}>{o.label}</span>
                      </td>
                      <td className="pr-4 text-right">
                        <ChevronRight aria-hidden className="ml-auto size-[18px] text-subtle transition group-hover:translate-x-0.5 group-hover:text-accent-icon" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: stacked rows, same information */}
          <ul className="panel divide-y divide-line overflow-hidden md:hidden">
            {list.map((m) => {
              const o = orders(m.id);
              return (
                <li key={m.id} className="row-open flex items-center gap-3 px-4 py-3">
                  <button type="button" onClick={() => setOpen(m.id)} className="row-target min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-['']" aria-label={`Open ${m.name}`}>
                    <span className="block text-[15.5px] font-semibold leading-snug text-heading [overflow-wrap:anywhere]">{m.name}</span>
                    <span className="mt-0.5 block text-[15px] text-muted-foreground">{[m.branch, m.phone].filter(Boolean).join(" · ") || "No contact details yet"}</span>
                    <span className={cn("mt-0.5 block text-[15px]", o.toOrder ? "font-semibold text-warn-fg" : o.ordered ? "text-info-fg" : "text-muted-foreground")}>{o.label}</span>
                  </button>
                  <ChevronRight aria-hidden className="row-chevron size-[18px] shrink-0" />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={Store}
          title={q ? "No matches" : view === "archived" ? "No archived merchants" : "No merchants yet"}
          body={q ? "Try a different name, branch or phone number." : view === "archived" ? undefined : "Add the suppliers you order from, then choose them on materials and bills."}
          action={manage && !q && view === "active" ? <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "merchant" })}><Plus className="size-[18px]" /> Add merchant</button> : undefined}
        />
      )}
      <MerchantSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function MerchantSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, can, actions } = useStore();
  const ui = useUI();
  const m = data.merchants.find((x) => x.id === id);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => setConfirm(false), [id]);
  if (!m) return null;
  const manage = can("merchants.manage");
  const today = todayKey();
  const orders = data.materials.filter((x) => x.merchantId === m.id && x.status !== "on_site").sort((a, b) => (a.neededBy ?? "9999").localeCompare(b.neededBy ?? "9999"));
  const bills = data.bills.filter((b) => b.merchantId === m.id && b.status === "due");
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={`Merchant: ${m.name}`}>
        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6 sm:px-6">
          <h2 className="pr-12 text-[22px] font-bold leading-tight tracking-tight">{m.name}</h2>
          {m.branch ? <p className="mt-0.5 text-[15px] text-muted-foreground">{m.branch}</p> : null}
          {m.archivedAt ? <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[15px] text-muted-foreground">Archived — kept so past orders and bills still show who they were with.</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {m.phone ? (
              <Button asChild size="sm" variant="secondary">
                <a href={`tel:${m.phone.replace(/\s/g, "")}`}>
                  <Phone /> {m.phone}
                </a>
              </Button>
            ) : null}
            {m.email ? (
              <Button asChild size="sm" variant="secondary">
                <a href={`mailto:${m.email}`}>
                  <Mail /> Email
                </a>
              </Button>
            ) : null}
            {m.website ? (
              <Button asChild size="sm" variant="secondary">
                <a href={m.website} target="_blank" rel="noreferrer">
                  <ExternalLink /> Website / trade portal
                </a>
              </Button>
            ) : null}
          </div>
          {m.notes ? <p className="mt-4 whitespace-pre-wrap rounded-xl bg-message px-3.5 py-3 text-[15px] leading-relaxed">{m.notes}</p> : null}

          {manage ? (
            <section className="mt-5 rounded-2xl p-4 ring-1 ring-line">
              <h3 className="flex items-center gap-1.5 text-[15px] font-semibold">
                <KeyRound className="size-4 text-subtle" aria-hidden /> Account & access <span className="text-[14px] font-normal text-muted-foreground">· owner and office only</span>
              </h3>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
                <dt className="text-muted-foreground">Trade account</dt>
                <dd>{m.accountRef ?? "Not set"}</dd>
                <dt className="text-muted-foreground">Login managed by</dt>
                <dd>{m.accessManagedBy ?? "Not set"}</dd>
                <dt className="text-muted-foreground">Password manager</dt>
                <dd>
                  {m.passwordManagerUrl ? (
                    <a href={m.passwordManagerUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent-fg">
                      Open in password manager
                    </a>
                  ) : (
                    "No link"
                  )}
                </dd>
              </dl>
              <p className="mt-2 text-[14px] text-muted-foreground">Passwords stay in your password manager. Bob only keeps the link.</p>
            </section>
          ) : null}

          <section className="mt-6">
            <h3 className="t-eyebrow">Open orders · {orders.length}</h3>
            {orders.length ? (
              <ul className="mt-1 divide-y divide-line">
                {orders.map((o) => {
                  const j = jobs.get(o.jobId);
                  return (
                    <li key={o.id}>
                      <button type="button" onClick={() => ui.openForm({ form: "material", materialId: o.id })} className="row-open flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2.5 text-left">
                        <span className="min-w-0">
                          <span className="block text-[15px] font-medium">
                            {o.item} × {o.quantity}
                            {o.unit ? ` ${o.unit}` : ""}
                          </span>
                          <span className="block text-[14.5px] text-muted-foreground">
                            {j ? `${j.title} · ${j.customerName}` : "Job"}
                            {o.neededBy ? ` · needed ${relativeDayInline(o.neededBy, today)}` : ""}
                          </span>
                        </span>
                        <span className={o.status === "to_order" ? "text-[14.5px] font-semibold text-warn-fg" : "text-[14.5px] font-semibold text-info-fg"}>{MATERIAL_STATUS_LABEL[o.status]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-[15px] text-muted-foreground">No open orders.</p>
            )}
          </section>
          {bills.length && can("finance.read") ? (
            <p className="mt-4 text-[15px]">
              {bills.length} unpaid {bills.length === 1 ? "bill" : "bills"} — see Money → Bills to pay.
            </p>
          ) : null}

          {manage ? (
            <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
              <Button size="sm" variant="secondary" onClick={() => ui.openForm({ form: "merchant", merchantId: m.id })}>
                <Pencil /> Edit merchant
              </Button>
              {m.archivedAt ? (
                <Button size="sm" variant="secondary" onClick={async () => { const r = await actions.run("archiveMerchant", { id: m.id, archived: false }); toast(r.ok ? `${m.name} restored` : "Couldn't restore", r.ok ? "success" : "error"); }}>
                  Restore
                </Button>
              ) : confirm ? (
                <div className="w-full rounded-xl bg-red-500/[0.06] p-3 ring-1 ring-red-500/25">
                  <p className="text-[15px]">Archive {m.name}? It leaves the merchant lists but past orders and bills keep its name.</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>Keep</Button>
                    <Button size="sm" variant="destructive" onClick={async () => { const r = await actions.run("archiveMerchant", { id: m.id }); setConfirm(false); toast(r.ok ? `${m.name} archived` : "Couldn't archive", r.ok ? "success" : "error"); }}>Archive</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
                  <Archive /> Archive
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
