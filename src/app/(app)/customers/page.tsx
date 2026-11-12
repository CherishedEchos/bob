"use client";

import * as React from "react";
import { Plus, Search, Users } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { JOB_STATUS_LABEL, invoiceBalance, isActiveJob, needsReply } from "@/lib/derive";
import { gbp } from "@/lib/utils";
import { EmptyState, ListRow, StatusText } from "@/components/common/bits";
import { Input } from "@/components/ui/input";

export default function CustomersPage() {
  const { data, can } = useStore();
  const ui = useUI();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const list = data.customers.filter((c) => !q || [c.name, c.town, c.email, c.phone].some((s) => s?.toLowerCase().includes(q)));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Customers</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">{data.customers.length} customers</p>
        </div>
        {can("customers.write") ? (
          <button type="button" onClick={() => ui.openForm({ form: "customer" })} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-raised px-4 text-[15px] font-semibold ring-1 ring-line-strong transition hover:bg-raised-hover">
            <Plus className="size-[18px]" /> Add
          </button>
        ) : null}
      </div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, town, phone or email" aria-label="Search customers" className="pl-10" />
      </div>
      {list.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {list.map((c) => {
            const jobs = data.jobs.filter((j) => j.customerId === c.id);
            const activeJob = jobs.find(isActiveJob);
            const owed = data.invoices.filter((i) => i.customerId === c.id && i.status === "sent").reduce((s, i) => s + invoiceBalance(i), 0);
            const openEnquiry = data.enquiries.find((e) => e.customerId === c.id && needsReply(e));
            return (
              <ListRow
                key={c.id}
                onOpen={() => ui.openCustomer(c.id)}
                leading={
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-[15px] font-semibold text-accent-fg">
                    {c.name.replace(/^the\s+/i, "").slice(0, 1).toUpperCase()}
                  </span>
                }
                title={c.name}
                aside={can("finance.read") && owed ? <span className="font-semibold text-warn-fg">{gbp(owed)} owed</span> : undefined}
                meta={
                  <>
                    <span className="block truncate">{activeJob ? `${activeJob.title} · ${JOB_STATUS_LABEL[activeJob.status]}` : jobs.length ? `${jobs.length} past job${jobs.length > 1 ? "s" : ""}` : "No jobs yet"}</span>
                    {openEnquiry ? <StatusText tone="amber" className="mt-1">Waiting for a reply</StatusText> : <span className="mt-0.5 block truncate text-[13.5px] text-subtle">{c.town ?? "No town"}</span>}
                  </>
                }
              />
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={Users} title={q ? "No matches" : "No customers yet"} body={q ? "Try a different search." : "Customers are added when you create jobs, or here."} />
      )}
    </div>
  );
}
