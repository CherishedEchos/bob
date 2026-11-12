"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Plus, ReceiptText, Send, Trash2, CheckCheck, Ban, PoundSterling } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { ActionView } from "@/lib/bob/types";
import type { Invoice } from "@/lib/types";
import { invoiceBalance, invoiceStatusLabel, isInvoiceOutstanding, isInvoiceOverdue, jobsAwaitingDeposit } from "@/lib/derive";
import { cn, formatDateInline, gbp, timeAgo } from "@/lib/utils";
import { EmptyState, ListPanel, ListRow, StatusText, Tabs } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { MoneyRow } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";
import { ActionCard } from "@/components/assistant/assistant-cards";

type Filter = "outstanding" | "overdue" | "draft" | "paid" | "all";

function InvoicesInner() {
  const { data, can } = useStore();
  const ui = useUI();
  const params = useSearchParams();
  const initialFilter = params.get("filter") as Filter | null;
  const [filter, setFilter] = React.useState<Filter>(initialFilter && ["outstanding", "overdue", "draft", "paid", "all"].includes(initialFilter) ? initialFilter : "outstanding");
  const [open, setOpen] = React.useState<string | null>(params.get("open"));
  const accounting = data.connections.find((c) => c.kind === "accounting" && (c.status === "connected" || c.status === "demo"));

  React.useEffect(() => {
    const id = params.get("open");
    if (id) setOpen(id);
  }, [params]);

  if (!can("finance.read")) return <EmptyState icon={ReceiptText} title="No access" body="Your account doesn't include money and invoices." />;

  const test: Record<Filter, (i: Invoice) => boolean> = {
    outstanding: isInvoiceOutstanding,
    overdue: isInvoiceOverdue,
    draft: (i) => i.status === "draft",
    paid: (i) => i.status === "paid",
    all: () => true,
  };
  const list = data.invoices.filter(test[filter]);
  const owed = data.invoices.filter(isInvoiceOutstanding).reduce((s, i) => s + invoiceBalance(i), 0);
  const overdue = data.invoices.filter(isInvoiceOverdue).reduce((s, i) => s + invoiceBalance(i), 0);
  const deposits = jobsAwaitingDeposit(data);
  const depositTotal = deposits.reduce((s, d) => s + d.finance.depositOutstanding, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Money</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">{accounting ? `Invoices sync with ${accounting.accountLabel ?? accounting.provider}` : "Invoices stay as drafts in Bob until Xero or QuickBooks is connected"}</p>
        </div>
        {can("invoices.draft") ? (
          <button type="button" onClick={() => ui.openForm({ form: "invoice" })} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-raised px-4 text-[15px] font-semibold ring-1 ring-line-strong transition hover:bg-raised-hover">
            <Plus className="size-[18px]" /> Invoice
          </button>
        ) : null}
      </div>

      <div className="panel mb-4 grid grid-cols-3 divide-x divide-line">
        {[
          { label: "Owed", value: gbp(owed), tone: "" },
          { label: "Overdue", value: gbp(overdue), tone: overdue ? "text-danger-fg" : "text-subtle" },
          { label: "Deposits due", value: gbp(depositTotal), tone: depositTotal ? "text-warn-fg" : "text-subtle" },
        ].map((x) => (
          <div key={x.label} className="px-4 py-3 lg:px-5">
            <div className={cn("tabular text-[19px] font-semibold sm:text-[22px]", x.tone)}>{x.value}</div>
            <div className="text-[13.5px] text-muted-foreground">{x.label}</div>
          </div>
        ))}
      </div>

      <Tabs
        label="Invoices"
        className="mb-3"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "outstanding", label: "Owed", count: data.invoices.filter(isInvoiceOutstanding).length },
          { value: "overdue", label: "Overdue", count: data.invoices.filter(isInvoiceOverdue).length, highlight: true },
          { value: "draft", label: "Drafts", count: data.invoices.filter((i) => i.status === "draft").length },
          { value: "all", label: "All" },
        ]}
      />

      {list.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {list.map((i) => (
            <InvoiceRow key={i.id} invoice={i} expanded={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={ReceiptText} title="Nothing here" body={filter === "draft" ? "Ask Bob to “invoice Sophie £7,500 for the Copthorne job”." : "Nothing in this list."} />
      )}

      {deposits.length ? (
        <ListPanel id="deposits" title="Deposits due" count={deposits.length} className="mt-5">
          <ul className="divide-y divide-line">
            {deposits.map(({ job, finance }) => (
              <ListRow
                key={job.id}
                onOpen={() => ui.openJob(job.id)}
                title={`${job.customerName} · ${job.title}`}
                aside={<span className="text-[15px] font-semibold text-foreground">{gbp(finance.depositOutstanding)}</span>}
                meta={
                  <StatusText tone={finance.depositOverdue ? "red" : "amber"}>
                    {finance.depositOverdue ? "Overdue" : job.depositDueDate ? `Due ${formatDateInline(job.depositDueDate)}` : "No due date"}
                  </StatusText>
                }
              />
            ))}
          </ul>
        </ListPanel>
      ) : null}
    </div>
  );
}

function InvoiceRow({ invoice: i, expanded, onToggle }: { invoice: Invoice; expanded: boolean; onToggle: () => void }) {
  const { data, actions, can, propose, decide } = useStore();
  const ui = useUI();
  const [pending, setPending] = React.useState<ActionView | null>(null);
  const customer = data.customers.find((c) => c.id === i.customerId);
  const job = data.jobs.find((j) => j.id === i.jobId);
  const label = invoiceStatusLabel(i);
  const accounting = data.connections.some((c) => c.kind === "accounting" && (c.status === "connected" || c.status === "demo"));
  const result = (ok: boolean, msg: string, err?: Record<string, string>) => toast(ok ? msg : Object.values(err ?? {})[0] ?? "Couldn't do that", ok ? "success" : "error");

  return (
    <li className={cn(expanded && "bg-surface-2/50")}>
      <button onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface-2 lg:px-5">
        <div className="min-w-0 flex-1">
          <div className="t-name truncate">{customer?.name ?? "Customer"}</div>
          <div className="truncate text-[14px] text-muted-foreground">
            {i.number ? `${i.number} · ` : ""}
            {i.draftRef} · {i.lines[0]?.description}
          </div>
        </div>
        <div className="text-right">
          <div className="tabular text-[16px] font-semibold">{gbp(i.status === "draft" || i.status === "paid" ? i.total : invoiceBalance(i))}</div>
          <StatusText tone={label === "Overdue" ? "red" : label === "Paid" ? "green" : label === "Draft" ? "blue" : "neutral"}>
            {label}
            {i.dueDate && i.status === "sent" ? ` · due ${formatDateInline(i.dueDate)}` : ""}
          </StatusText>
        </div>
      </button>
      {expanded ? (
        <div className="border-t border-line px-4 pb-4 pt-2 lg:px-5">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <div>
              <MoneyRow label={i.amountsAre === "no_vat" ? "Amount (no VAT)" : "Net"} value={gbp(i.subtotal)} />
              {i.vat ? <MoneyRow label={`VAT ${i.vatRate}%`} value={gbp(i.vat)} /> : null}
              <MoneyRow label="Total" value={gbp(i.total)} strong />
              {i.amountPaid ? <MoneyRow label="Paid" value={gbp(i.amountPaid)} tone="green" /> : null}
            </div>
            <dl className="mt-2 space-y-1 text-[14px] text-muted-foreground sm:mt-0">
              {job ? (
                <div>
                  Job:{" "}
                  <button className="text-foreground/90 underline-offset-2 hover:underline" onClick={() => ui.openJob(job.id)}>
                    {job.title}, {job.location}
                  </button>
                </div>
              ) : null}
              <div>Created by {i.createdBy} · {timeAgo(i.createdAt)}</div>
              {i.sentAt ? <div>Sent {timeAgo(i.sentAt)}{i.provider ? ` via ${i.provider === "demo_accounting" ? "demo accounting (simulated)" : i.provider}` : " (outside Bob)"}</div> : null}
              {i.status === "draft" ? <div className="text-info-fg">Draft — not sent. Bob ref {i.draftRef} is not an invoice number.</div> : null}
            </dl>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {i.status === "draft" && can("invoices.send") ? (
              accounting ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    const r = await propose("send_invoice", { invoiceId: i.id });
                    if (r.ok) setPending(r.action);
                    else toast(r.error, "error");
                  }}
                >
                  <Send /> Send…
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const r = await actions.markInvoiceSent(i.id);
                    result(r.ok, "Marked as sent (outside Bob)", r.ok ? undefined : r.errors);
                  }}
                >
                  <CheckCheck /> I sent it myself
                </Button>
              )
            ) : null}
            {i.status === "sent" && can("payments.record") && i.jobId ? (
              <Button size="sm" variant="secondary" onClick={() => ui.openForm({ form: "payment", jobId: i.jobId, amount: invoiceBalance(i) })}>
                <PoundSterling /> Record payment
              </Button>
            ) : null}
            {i.status === "draft" && can("invoices.draft") ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await actions.deleteInvoiceDraft(i.id);
                  result(r.ok, "Draft deleted", r.ok ? undefined : r.errors);
                }}
              >
                <Trash2 /> Delete draft
              </Button>
            ) : null}
            {i.status === "sent" && i.amountPaid === 0 && can("invoices.send") ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await actions.voidInvoice(i.id);
                  result(r.ok, "Invoice voided in Bob", r.ok ? undefined : r.errors);
                }}
              >
                <Ban /> Void
              </Button>
            ) : null}
          </div>
          {pending ? (
            <ActionCard
              action={pending}
              onDecide={async (d) => {
                const v = await decide(pending.id, d);
                if (v) setPending(v);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function InvoicesPage() {
  return (
    <React.Suspense fallback={null}>
      <InvoicesInner />
    </React.Suspense>
  );
}
