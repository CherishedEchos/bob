"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ExternalLink, Plus, ReceiptText, Send, Trash2, CheckCheck, Ban, PoundSterling } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/input";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { ActionView } from "@/lib/bob/types";
import type { Invoice } from "@/lib/types";
import { invoiceBalance, invoiceStatusLabel, isInvoiceOutstanding, isInvoiceOverdue, jobsAwaitingDeposit } from "@/lib/derive";
import { cn, daysFromToday, formatDateInline, gbp, timeAgo, todayKey } from "@/lib/utils";
import { DemoNote, EmptyState, ListPanel, ListRow, StatusText, Tabs, pageActionClass } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { MoneyRow } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";
import { ActionCard } from "@/components/assistant/assistant-cards";

type Filter = "outstanding" | "overdue" | "draft" | "paid" | "all";

function InvoicesInner() {
  const { data, can, org } = useStore();
  const ui = useUI();
  const params = useSearchParams();
  const router = useRouter();
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

  const view = params.get("view") === "bills" ? "bills" : "owed";
  const setView = (v: string) => router.replace(v === "bills" ? "/invoices?view=bills" : "/invoices", { scroll: false });
  const dueBills = data.bills.filter((b) => b.status === "due");

  const qbLink = org.quickbooksUrl || (data.connections.some((c) => c.provider === "quickbooks" && c.status === "connected") ? "https://qbo.intuit.com/app/homepage" : undefined);

  return (
    <div className="mx-auto max-w-3xl">
      {qbLink ? (
        <div className="mb-2 flex justify-end">
          <a href={qbLink} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[14.5px] font-semibold text-accent-fg hover:bg-surface-2">
            <ExternalLink className="size-4" aria-hidden /> Open QuickBooks
          </a>
        </div>
      ) : null}
      <Tabs
        label="Money"
        className="mb-4"
        value={view}
        onChange={setView}
        options={[
          { value: "owed", label: "Owed to you" },
          { value: "bills", label: "Bills to pay", count: dueBills.length, highlight: true },
        ]}
      />
      {view === "bills" ? <BillsView /> : (
      <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Money owed to you</h1>
          <p className={cn("t-meta mt-0.5 lg:text-[15px]", org.dataMode === "sample" && "hidden sm:block")}>{accounting ? `Invoices sync with ${accounting.accountLabel ?? accounting.provider}` : "Invoices stay as drafts in Bob until Xero or QuickBooks is connected"}</p>
        </div>
        {can("invoices.draft") ? (
          <button type="button" onClick={() => ui.openForm({ form: "invoice" })} className={pageActionClass}>
            <Plus className="size-[18px]" aria-hidden /> <span className="hidden sm:inline">Create invoice draft</span>
            <span className="sm:hidden">Invoice draft</span>
          </button>
        ) : null}
      </div>

      <dl className="panel mb-2 grid grid-cols-3 divide-x divide-line">
        {[
          { label: "Outstanding invoices", value: gbp(owed), tone: "text-heading" },
          { label: "Of which overdue", value: gbp(overdue), tone: overdue ? "text-danger-fg" : "text-subtle" },
          { label: "Deposits due", value: gbp(depositTotal), tone: depositTotal ? "text-warn-fg" : "text-subtle" },
        ].map((x) => (
          <div key={x.label} className="flex flex-col-reverse justify-end px-3 py-3 sm:px-4 lg:px-5">
            <dt className="text-[13px] leading-tight text-muted-foreground sm:text-[13.5px]">{x.label}</dt>
            <dd className={cn("tabular text-[18px] font-semibold sm:text-[22px]", x.tone)}>{x.value}</dd>
          </div>
        ))}
      </dl>
      {org.dataMode === "sample" ? (
        <DemoNote className="mb-4">
          The sent invoices here are sample records. An invoice you create is saved as a draft in Bob — it isn&apos;t sent to anyone{accounting ? " until you approve sending it" : ", and stays a draft until you mark it as sent yourself or connect Xero or QuickBooks"}.
        </DemoNote>
      ) : (
        <div className="mb-4" />
      )}

      <Tabs
        label="Invoices"
        className="mb-3"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "outstanding", label: "Outstanding", count: data.invoices.filter(isInvoiceOutstanding).length },
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
        <EmptyState icon={ReceiptText} title="Nothing here" body={filter === "draft" ? "Tap Create invoice draft, or ask Bob to “invoice Sophie £7,500 for the Copthorne job”." : "Nothing in this list."} />
      )}

      {deposits.length ? (
        <ListPanel id="deposits" title="Deposits due" count={deposits.length} className="mt-5">
          <ul className="divide-y divide-line">
            {deposits.map(({ job, finance }) => (
              <ListRow
                key={job.id}
                onOpen={() => ui.openJob(job.id)}
                openLabel={`Open ${job.title} for ${job.customerName}`}
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
      </>
      )}
    </div>
  );
}

/** Supplier and subcontractor bills the business needs to pay. Bob records payments; it never makes them. */
function BillsView() {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const { org } = useStore();
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [payment, setPayment] = React.useState({ paidOn: todayKey(), paymentMethod: "bank_transfer" });
  const [payError, setPayError] = React.useState<string | null>(null);
  const due = data.bills.filter((b) => b.status === "due").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const paid = data.bills.filter((b) => b.status === "paid").slice(0, 10);
  const overdue = due.filter((b) => daysFromToday(b.dueDate) < 0);
  const week = due.filter((b) => daysFromToday(b.dueDate) >= 0 && daysFromToday(b.dueDate) <= 7);
  const qb = data.connections.find((c) => c.provider === "quickbooks");
  const qbUrl = org.quickbooksUrl || (qb?.status === "connected" ? "https://qbo.intuit.com/app/bills" : undefined);
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const total = (l: typeof due) => gbp(l.reduce((s, b) => s + b.amount, 0));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Bills to pay</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">What the business owes suppliers and subcontractors.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("payments.record") ? (
            <button type="button" onClick={() => ui.openForm({ form: "bill" })} className={pageActionClass}>
              <Plus className="size-[18px]" aria-hidden /> Add bill
            </button>
          ) : null}
        </div>
      </div>
      <dl className="panel mb-2 grid grid-cols-3 divide-x divide-line">
        {[
          { label: "Due", value: total(due), tone: "text-heading" },
          { label: "Overdue", value: total(overdue), tone: overdue.length ? "text-danger-fg" : "text-subtle" },
          { label: "Due in 7 days", value: total(week), tone: week.length ? "text-warn-fg" : "text-subtle" },
        ].map((x) => (
          <div key={x.label} className="flex flex-col-reverse justify-end px-3 py-3 sm:px-4 lg:px-5">
            <dt className="text-[13px] leading-tight text-muted-foreground sm:text-[13.5px]">{x.label}</dt>
            <dd className={cn("tabular text-[18px] font-semibold sm:text-[22px]", x.tone)}>{x.value}</dd>
          </div>
        ))}
      </dl>
      <DemoNote className="mb-1">Bob doesn&apos;t pay bills or move money. Pay as you normally do (bank app, card), then use Record payment to log it here.</DemoNote>
      <p className="mb-4 pl-[22px] text-[13.5px] text-muted-foreground">
        QuickBooks:{" "}
        {qb?.status === "connected"
          ? `connected${qb.accountLabel ? ` (${qb.accountLabel})` : ""}${qb.lastSyncAt ? ` · last synced ${timeAgo(qb.lastSyncAt)}` : ""}. Bills here aren't synced to QuickBooks yet.`
          : qb?.status === "error"
            ? `connection problem — ${qb.error ?? "reconnect in Settings"}.`
            : "not connected — Bills to pay are kept in Bob only."}
        {qbUrl ? "" : " Add your QuickBooks link in Settings to get an Open QuickBooks shortcut."}
      </p>
      {due.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {due.map((b) => {
            const d = daysFromToday(b.dueDate);
            const j = b.jobId ? jobs.get(b.jobId) : undefined;
            return (
              <li key={b.id} className="px-4 py-3.5 lg:px-5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="t-name line-clamp-2 break-words">{b.supplier}</div>
                    <div className="text-[14px] text-muted-foreground">
                      {b.description}
                      {b.reference ? ` · ${b.reference}` : ""}
                      {j ? ` · ${j.title}` : ""}
                    </div>
                  </div>
                  <div className="w-28 shrink-0 text-right">
                    <div className="tabular text-[16px] font-semibold">{gbp(b.amount)}</div>
                    <StatusText tone={d < 0 ? "red" : d <= 3 ? "amber" : "neutral"}>{d < 0 ? `Overdue ${-d}d` : d === 0 ? "Due today" : `Due ${formatDateInline(b.dueDate)}`}</StatusText>
                  </div>
                  {can("payments.record") && confirm !== b.id ? (
                    <Button size="sm" variant="secondary" className="hidden shrink-0 sm:inline-flex" onClick={() => { setPayment({ paidOn: todayKey(), paymentMethod: "bank_transfer" }); setPayError(null); setConfirm(b.id); }}>
                      <CheckCheck /> Record payment
                    </Button>
                  ) : null}
                </div>
                {can("payments.record") ? (
                  confirm === b.id ? (
                    <form
                      className="mt-2 rounded-xl bg-message p-3"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setPayError(null);
                        const r = await actions.run("setBillPaid", { id: b.id, paid: true, payment });
                        if (!r.ok) return setPayError(r.errors._ || r.errors.paidOn || "Couldn't record the payment — nothing changed.");
                        setConfirm(null);
                        toast(`${b.supplier} ${gbp(b.amount)} recorded as paid`, "success", { action: { label: "Undo", run: () => void actions.run("setBillPaid", { id: b.id, paid: false }) } });
                      }}
                    >
                      <p className="text-[14.5px] font-semibold">Record a payment you&apos;ve already made</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-[13.5px] font-medium">
                          Paid on
                          <Input type="date" value={payment.paidOn} max={todayKey()} onChange={(e) => setPayment({ ...payment, paidOn: e.target.value })} className="mt-1 h-11" />
                        </label>
                        <label className="text-[13.5px] font-medium">
                          How
                          <NativeSelect value={payment.paymentMethod} onChange={(e) => setPayment({ ...payment, paymentMethod: e.target.value })} className="mt-1 h-11">
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="card">Card</option>
                            <option value="cash">Cash</option>
                            <option value="cheque">Cheque</option>
                            <option value="other">Other</option>
                          </NativeSelect>
                        </label>
                      </div>
                      {payError ? (
                        <p role="alert" className="mt-2 text-[14px] text-danger-fg">
                          {payError}
                        </p>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => setConfirm(null)}>
                          Cancel
                        </Button>
                        <Button type="submit" size="sm">
                          <CheckCheck /> Record payment of {gbp(b.amount)}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <Button size="sm" variant="secondary" className="mt-2 sm:hidden" onClick={() => { setPayment({ paidOn: todayKey(), paymentMethod: "bank_transfer" }); setPayError(null); setConfirm(b.id); }}>
                      <CheckCheck /> Record payment
                    </Button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={ReceiptText} title="No bills due" body="Add supplier and subcontractor bills so you know what's going out." />
      )}
      {paid.length ? (
        <ListPanel id="paid-bills" title="Recently paid" count={paid.length} className="mt-5">
          <ul className="divide-y divide-line">
            {paid.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{b.supplier}</span>
                  <span className="block text-[13.5px] text-muted-foreground">{b.description}</span>
                </span>
                <span className="text-right">
                  <span className="tabular block text-[15px]">{gbp(b.amount)}</span>
                  <StatusText tone="green">Paid{b.paidOn ? ` ${formatDateInline(b.paidOn)}` : ""}</StatusText>
                </span>
              </li>
            ))}
          </ul>
        </ListPanel>
      ) : null}
    </>
  );
}

function InvoiceRow({ invoice: i, expanded, onToggle }: { invoice: Invoice; expanded: boolean; onToggle: () => void }) {
  const { data, actions, can, propose, decide, org } = useStore();
  const ui = useUI();
  const [pending, setPending] = React.useState<ActionView | null>(null);
  const customer = data.customers.find((c) => c.id === i.customerId);
  const job = data.jobs.find((j) => j.id === i.jobId);
  const label = invoiceStatusLabel(i);
  const accounting = data.connections.some((c) => c.kind === "accounting" && (c.status === "connected" || c.status === "demo"));
  const result = (ok: boolean, msg: string, err?: Record<string, string>) => toast(ok ? msg : Object.values(err ?? {})[0] ?? "Couldn't do that", ok ? "success" : "error");

  return (
    <li className={cn(expanded && "bg-surface-2")}>
      <button onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface-2 active:bg-surface-3 lg:px-5">
        <div className="min-w-0 flex-1">
          <div className="t-name line-clamp-2 break-words">{customer?.name ?? "Customer"}</div>
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
        <ChevronDown aria-hidden className={cn("size-[18px] shrink-0 text-subtle transition-transform", expanded && "rotate-180")} />
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
              {i.sentAt ? <div>Sent {timeAgo(i.sentAt)}{i.provider ? ` via ${i.provider === "demo_accounting" ? "demo accounting (simulated)" : i.provider}` : org.dataMode === "sample" ? " · sample record" : " (outside Bob)"}</div> : null}
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
