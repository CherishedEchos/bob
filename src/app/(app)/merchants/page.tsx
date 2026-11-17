"use client";

/**
 * Merchants — the suppliers Ninety3 buys from. Contact details for the team;
 * trade account references and login access links for owners/office only
 * (the server removes those fields for everyone else). Bob never stores
 * passwords — only a link to the company's password manager.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Archive, ExternalLink, KeyRound, Mail, Pencil, Phone, Plus, Search, Store } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { relativeDay } from "@/lib/dates";
import { todayKey } from "@/lib/utils";
import { EmptyState, ListRow, Tabs, pageActionClass } from "@/components/common/bits";
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
  const list = data.merchants.filter((m) => (view === "archived" ? !!m.archivedAt : !m.archivedAt) && (!q || [m.name, m.branch, m.notes].some((x) => x?.toLowerCase().includes(q))));
  const openCount = (id: string) => data.materials.filter((x) => x.merchantId === id && x.status !== "on_site").length;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-page">Merchants</h1>
          <p className="t-meta mt-0.5">{data.merchants.filter((m) => !m.archivedAt).length} suppliers</p>
        </div>
        {manage ? (
          <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "merchant" })}>
            <Plus className="size-[18px]" aria-hidden /> Add merchant
          </button>
        ) : null}
      </div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search merchants" aria-label="Search merchants" className="pl-10" />
        </div>
        <Tabs label="Merchant list" className="sm:max-w-xs" value={view} onChange={setView} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
      </div>
      {list.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {list.map((m) => (
            <ListRow
              key={m.id}
              onOpen={() => setOpen(m.id)}
              openLabel={`Open ${m.name}`}
              leading={
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-3 text-muted-foreground">
                  <Store className="size-5" />
                </span>
              }
              title={m.name}
              aside={openCount(m.id) ? <span className="font-semibold text-foreground">{openCount(m.id)} open</span> : undefined}
              meta={[m.branch, m.phone].filter(Boolean).join(" · ") || "No contact details yet"}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Store}
          title={q ? "No matches" : view === "archived" ? "No archived merchants" : "No merchants yet"}
          body={q || view === "archived" ? undefined : "Add the suppliers you order from, then choose them on materials and bills."}
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
          {m.archivedAt ? <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[14.5px] text-muted-foreground">Archived — kept so past orders and bills still show who they were with.</p> : null}
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
                <KeyRound className="size-4 text-subtle" aria-hidden /> Account & access <span className="text-[13px] font-normal text-muted-foreground">· owner and office only</span>
              </h3>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14.5px]">
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
              <p className="mt-2 text-[13px] text-muted-foreground">Passwords stay in your password manager. Bob only keeps the link.</p>
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
                          <span className="block text-[13.5px] text-muted-foreground">
                            {j ? `${j.title} · ${j.customerName}` : "Job"}
                            {o.neededBy ? ` · needed ${relativeDay(o.neededBy, today).toLowerCase()}` : ""}
                          </span>
                        </span>
                        <span className={o.status === "to_order" ? "text-[13.5px] font-semibold text-warn-fg" : "text-[13.5px] font-semibold text-info-fg"}>{MATERIAL_STATUS_LABEL[o.status]}</span>
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
            <p className="mt-4 text-[14.5px]">
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
                  <p className="text-[14.5px]">Archive {m.name}? It leaves the merchant lists but past orders and bills keep its name.</p>
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
