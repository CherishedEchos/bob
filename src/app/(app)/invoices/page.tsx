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
import { Card, EmptyState, FilterChips, PageHeader } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { MoneyRow } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";
import { ActionCard } from "@/components/assistant/assistant-cards";

type Filter = "outstanding" | "overdue" | "draft" | "paid" | "all";

function InvoicesInner() {
  const { data, can } = useStore();
  const ui = useUI();
  const params = useSearchParams();
  const [filter, setFilter] = React.useState<Filter>("outstanding");
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
    <>
      <PageHeader
        title="Invoices"
        subtitle={accounting ? `Connected: ${accounting.accountLabel ?? accounting.provider}` : "No accounting system connected — invoices are drafts in Bob until Xero or QuickBooks is connected."}
        actions={
          can("invoices.draft") ? (
            <Button onClick={() => ui.openForm({ form: "invoice" })}>
              <Plus /> New invoice draft
            </Button>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: "Owed on invoices", value: gbp(owed), tone: "" },
          { label: "Overdue", value: gbp(overdue), tone: overdue ? "text-red-300" : "" },
          { label: "Deposits awaited", value: gbp(depositTotal), tone: depositTotal ? "text-amber-200" : "" },
        ].map((s) => (
          <Card key={s.label} className="p-3 sm:p-4">
            <div className="text-[12px] text-muted-foreground sm:text-[13px]">{s.label}</div>
            <div className={cn("tabular mt-1 text-[18px] font-bold sm:text-[24px]", s.tone)}>{s.value}</div>
          </Card>
        ))}
      </div>

      <div className="mb-4">
        <FilterChips
          label="Filter invoices"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "outstanding", label: "Outstanding", count: data.invoices.filter(isInvoiceOutstanding).length },
            { value: "overdue", label: "Overdue", count: data.invoices.filter(isInvoiceOverdue).length },
            { value: "draft", label: "Drafts", count: data.invoices.filter((i) => i.status === "draft").length },
            { value: "paid", label: "Paid" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {list.length ? (
        <ul className="space-y-3">
          {list.map((i) => (
            <InvoiceRow key={i.id} invoice={i} expanded={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={ReceiptText} title="Nothing here" body={filter === "draft" ? "Ask Bob to “invoice Sophie £7,500 for the Copthorne job”." : "Try another filter."} />
      )}

      {deposits.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-[19px] font-semibold tracking-tight">Deposits awaited</h2>
          <Card className="divide-y divide-white/[0.05]">
            {deposits.map(({ job, finance }) => (
              <button key={job.id} onClick={() => ui.openJob(job.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]">
                <PoundSterling className="size-4 text-copper-300" />
                <span className="min-w-0 flex-1 truncate text-[14px]">
                  {job.customerName} — {job.title}
                </span>
                <span className="text-right">
                  <span className="tabular block text-[14px] font-semibold">{gbp(finance.depositOutstanding)}</span>
                  <span className={cn("block text-[12px]", finance.depositOverdue ? "text-red-300" : "text-muted-foreground")}>
                    {finance.depositOverdue ? "Overdue" : job.depositDueDate ? `Due ${formatDateInline(job.depositDueDate)}` : "No due date"}
                  </span>
                </span>
              </button>
            ))}
          </Card>
        </section>
      ) : null}
    </>
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
    <li className="card-surface overflow-hidden rounded-2xl">
      <button onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 p-4 text-left hover:bg-white/[0.03]">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-copper-300 ring-1 ring-white/10">
          <ReceiptText className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{customer?.name ?? "Customer"}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            {i.number ? `${i.number} · ` : ""}
            {i.draftRef} · {i.lines[0]?.description}
          </div>
        </div>
        <div className="text-right">
          <div className="tabular text-[15px] font-semibold">{gbp(i.status === "draft" || i.status === "paid" ? i.total : invoiceBalance(i))}</div>
          <div className={cn("text-[12.5px]", label === "Overdue" ? "text-red-300" : label === "Paid" ? "text-emerald-300" : label === "Draft" ? "text-sky-200" : "text-muted-foreground")}>
            {label}
            {i.dueDate && i.status === "sent" ? ` · due ${formatDateInline(i.dueDate)}` : ""}
          </div>
        </div>
      </button>
      {expanded ? (
        <div className="border-t border-white/[0.06] px-4 pb-4 pt-2">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <div>
              <MoneyRow label={i.amountsAre === "no_vat" ? "Amount (no VAT)" : "Net"} value={gbp(i.subtotal)} />
              {i.vat ? <MoneyRow label={`VAT ${i.vatRate}%`} value={gbp(i.vat)} /> : null}
              <MoneyRow label="Total" value={gbp(i.total)} strong />
              {i.amountPaid ? <MoneyRow label="Paid" value={gbp(i.amountPaid)} tone="green" /> : null}
            </div>
            <dl className="mt-2 space-y-1 text-[13px] text-muted-foreground sm:mt-0">
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
              {i.status === "draft" ? <div className="text-sky-200">Draft — not sent. Bob ref {i.draftRef} is not an invoice number.</div> : null}
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
