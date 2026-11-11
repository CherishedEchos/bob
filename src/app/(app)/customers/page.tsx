"use client";

import * as React from "react";
import { ChevronRight, Plus, Search, Users } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { invoiceBalance, isActiveJob } from "@/lib/derive";
import { gbp } from "@/lib/utils";
import { Card, EmptyState, PageHeader } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function CustomersPage() {
  const { data, can } = useStore();
  const ui = useUI();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const list = data.customers.filter((c) => !q || [c.name, c.town, c.email, c.phone].some((s) => s?.toLowerCase().includes(q)));

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${data.customers.length} customers`}
        actions={
          can("customers.write") ? (
            <Button onClick={() => ui.openForm({ form: "customer" })}>
              <Plus /> New customer
            </Button>
          ) : null
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, town, phone or email" aria-label="Search customers" className="pl-10" />
      </div>
      {list.length ? (
        <Card className="divide-y divide-white/[0.05]">
          {list.map((c) => {
            const jobs = data.jobs.filter((j) => j.customerId === c.id);
            const active = jobs.filter(isActiveJob).length;
            const owed = data.invoices.filter((i) => i.customerId === c.id && i.status === "sent").reduce((s, i) => s + invoiceBalance(i), 0);
            return (
              <button key={c.id} onClick={() => ui.openCustomer(c.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03]">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-[14px] font-semibold text-copper-200 ring-1 ring-white/10">
                  {c.name.replace(/^the\s+/i, "").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{c.name}</div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {[c.town, c.phone].filter(Boolean).join(" · ") || "No contact details"}
                  </div>
                </div>
                <div className="hidden text-right text-[13px] text-muted-foreground sm:block">
                  {jobs.length ? `${jobs.length} job${jobs.length > 1 ? "s" : ""}${active ? ` · ${active} active` : ""}` : "No jobs"}
                  {can("finance.read") && owed ? <div className="font-semibold text-amber-200">{gbp(owed)} owed</div> : null}
                </div>
                <ChevronRight className="size-4 text-subtle" />
              </button>
            );
          })}
        </Card>
      ) : (
        <EmptyState icon={Users} title={q ? "No matches" : "No customers yet"} body={q ? "Try a different search." : "Customers are added when you create jobs, or here."} />
      )}
    </>
  );
}
