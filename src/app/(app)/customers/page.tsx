"use client";

import * as React from "react";
import { Plus, Search, Users } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { ENQUIRY_STATUS_LABEL, JOB_STATUS_LABEL, invoiceBalance, isActiveJob, needsReply, wantsCallback } from "@/lib/derive";
import type { Snapshot } from "@/lib/types";
import { gbp, timeAgo, todayKey } from "@/lib/utils";
import { relativeDayInline } from "@/lib/dates";
import { EmptyState, ListRow, StatusText, pageSecondaryClass } from "@/components/common/bits";
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
          <button type="button" onClick={() => ui.openForm({ form: "customer" })} className={pageSecondaryClass}>
            <Plus className="size-[18px]" aria-hidden /> Add customer
          </button>
        ) : null}
      </div>
      <div className="relative mb-3">
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-subtle" />
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, town, phone or email" aria-label="Search customers" className="h-[52px] pl-11 text-[16.5px]" />
      </div>
      {list.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {list.map((c) => {
            const owed = data.invoices.filter((i) => i.customerId === c.id && i.status === "sent").reduce((s, i) => s + invoiceBalance(i), 0);
            const openEnquiry = data.enquiries.find((e) => e.customerId === c.id && needsReply(e));
            return (
              <ListRow
                key={c.id}
                onOpen={() => ui.openCustomer(c.id)}
                openLabel={`Open ${c.name}`}
                leading={
                  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-selected text-[15px] font-semibold text-accent-fg">
                    {c.name.replace(/^the\s+/i, "").slice(0, 1).toUpperCase()}
                  </span>
                }
                title={c.name}
                aside={can("finance.read") && owed ? <span className="font-semibold text-warn-fg">{gbp(owed)} owed</span> : undefined}
                meta={
                  <>
                    <span className="block truncate">
                      {c.town ?? "No town"} · {latestActivity(c.id, data, can("finance.read"))}
                    </span>
                    {openEnquiry ? <StatusText tone="amber" className="mt-1">{wantsCallback(openEnquiry) ? "Asked for a call back" : "Waiting for a reply"}</StatusText> : null}
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

/** The most useful thing to know about a customer, from their records. */
function latestActivity(id: string, data: Snapshot, finance: boolean): string {
  const today = todayKey();
  const jobIds = new Set(data.jobs.filter((j) => j.customerId === id).map((j) => j.id));
  const next = data.bookings.filter((b) => jobIds.has(b.jobId) && (b.endDate ?? b.date) >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (next) return `${data.jobs.find((j) => j.id === next.jobId)?.title ?? "Job"} · booked ${relativeDayInline(next.date, today)}`;
  const active = data.jobs.find((j) => j.customerId === id && isActiveJob(j));
  if (active) return `${active.title} · ${JOB_STATUS_LABEL[active.status]}`;
  const quote = data.quotes.filter((q) => q.customerId === id && q.status === "sent").sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))[0];
  if (quote) return `Quote sent${finance ? ` · ${gbp(quote.amount)}` : ""} · ${quote.sentAt ? timeAgo(quote.sentAt) : "awaiting answer"}`;
  const jobs = data.jobs.filter((j) => j.customerId === id);
  if (jobs.length) return `${jobs[0].title} · ${JOB_STATUS_LABEL[jobs[0].status]}`;
  const enquiry = data.enquiries.filter((e) => e.customerId === id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  if (enquiry) return `${enquiry.title} enquiry · ${ENQUIRY_STATUS_LABEL[enquiry.status]}`;
  return "No activity yet";
}
