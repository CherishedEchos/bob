"use client";

import * as React from "react";
import { AlarmClock, HardHat, Mail, MapPin, Phone, ReceiptText, ShieldAlert } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { invoiceBalance, invoiceStatusLabel, jobFinance } from "@/lib/derive";
import type { Snapshot } from "@/lib/types";
import { addDaysKey, firstName, gbp, timeAgo } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { EnquiryStatusBadge, JobStatusBadge } from "@/components/common/status";
import { NotesPanel } from "@/components/common/notes";
import { Section } from "@/components/jobs/job-sheet";
import { QuotesList } from "@/components/common/quotes-list";

export function CustomerSheet() {
  const ui = useUI();
  const { data } = useStore();
  const c = data.customers.find((x) => x.id === ui.customerId);
  return (
    <Sheet open={!!c} onOpenChange={(o) => !o && ui.closeCustomer()}>
      {c ? (
        <SheetContent title={`Customer: ${c.name}`}>
          <CustomerDetail id={c.id} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function CustomerDetail({ id }: { id: string }) {
  const { data, actions, can, setSnapshot } = useStore();
  const ui = useUI();
  const c = data.customers.find((x) => x.id === id)!;
  const jobs = data.jobs.filter((j) => j.customerId === id);
  const enquiries = data.enquiries.filter((e) => e.customerId === id);
  const invoices = data.invoices.filter((i) => i.customerId === id);
  const owed = invoices.filter((i) => i.status === "sent").reduce((s, i) => s + invoiceBalance(i), 0);
  const [confirmErase, setConfirmErase] = React.useState(false);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <h2 className="pr-12 text-[22px] font-bold leading-tight tracking-tight">{c.name}</h2>
        {c.town || c.address ? (
          <p className="mt-1 flex items-center gap-1 text-[15px] text-muted-foreground">
            <MapPin className="size-3.5 text-accent-icon" /> {c.address ?? c.town}
          </p>
        ) : null}
        <p className="mt-1 text-[13.5px] text-subtle">Customer since {timeAgo(c.createdAt)}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {c.phone ? (
            <Button asChild variant="secondary" size="sm">
              <a href={`tel:${c.phone.replace(/\s/g, "")}`}>
                <Phone /> Call
              </a>
            </Button>
          ) : null}
          {c.email ? (
            <Button asChild variant="secondary" size="sm">
              <a href={`mailto:${c.email}`}>
                <Mail /> Email
              </a>
            </Button>
          ) : null}
          {can("jobs.write") ? (
            <Button size="sm" onClick={() => ui.openForm({ form: "job", customerId: c.id, values: { location: c.town ?? "" } })}>
              <HardHat /> New job
            </Button>
          ) : null}
          {can("invoices.draft") ? (
            <Button size="sm" variant="secondary" onClick={() => ui.openForm({ form: "invoice", customerId: c.id })}>
              <ReceiptText /> Invoice
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => ui.openForm({ form: "reminder", title: `Call ${c.name}`, dueDate: addDaysKey(1), customerId: c.id })}>
            <AlarmClock /> Reminder
          </Button>
        </div>
        <dl className="mt-4 space-y-1 text-[14.5px] text-muted-foreground">
          {c.phone ? <div>Phone: <span className="text-foreground/90">{c.phone}</span></div> : null}
          {c.email ? <div>Email: <span className="text-foreground/90">{c.email}</span></div> : null}
          {can("finance.read") && owed ? <div>Owes on invoices: <span className="font-semibold text-warn-fg">{gbp(owed)}</span></div> : null}
        </dl>
      </div>

      <Section title={`Jobs (${jobs.length})`}>
        {jobs.length ? (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id}>
                <button onClick={() => ui.openJob(j.id)} className="flex w-full items-center justify-between gap-2 py-3 text-left transition hover:text-accent-fg">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium">{j.title}</div>
                    <div className="text-[13.5px] text-muted-foreground">
                      {j.location}
                      {can("finance.read") ? ` · ${gbp(j.quotedValue)} · ${jobFinance(j, data.payments).paidPercent}% paid` : ""}
                    </div>
                  </div>
                  <JobStatusBadge status={j.status} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted-foreground">No jobs yet.</p>
        )}
      </Section>

      <Section title={`Enquiries (${enquiries.length})`}>
        {enquiries.length ? (
          <ul className="divide-y divide-line">
            {enquiries.map((e) => (
              <li key={e.id}>
                <button onClick={() => ui.openEnquiry(e.id)} className="flex w-full items-center justify-between gap-2 py-3 text-left transition hover:text-accent-fg">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium">{e.title}</div>
                    <div className="text-[13.5px] text-muted-foreground">{timeAgo(e.receivedAt)}</div>
                  </div>
                  <EnquiryStatusBadge status={e.status} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted-foreground">No enquiries linked.</p>
        )}
      </Section>

      {can("finance.read") && invoices.length ? (
        <Section title="Invoices">
          <ul className="divide-y divide-line">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[15px] font-medium">{i.number ?? i.draftRef}</div>
                  <div className="text-[13.5px] text-muted-foreground">{invoiceStatusLabel(i)}</div>
                </div>
                <span className="tabular text-[16px] font-semibold">{gbp(i.total)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {data.quotes.some((q) => q.customerId === id) ? (
        <Section title="Quotes">
          <QuotesList quotes={data.quotes.filter((q) => q.customerId === id)} />
        </Section>
      ) : null}
      <Section title="Notes">
        <NotesPanel notes={c.notes} onAdd={(t) => actions.addCustomerNote(c.id, t)} />
      </Section>

      {can("data.delete") ? (
        <Section title="Privacy" className="pb-10">
          {!confirmErase ? (
            <Button variant="ghost" size="sm" className="-ml-2 text-danger-fg hover:text-danger-fg" onClick={() => setConfirmErase(true)}>
              <ShieldAlert /> Erase {firstName(c.name)}&apos;s personal data
            </Button>
          ) : (
            <div className="rounded-2xl bg-red-500/10 p-3.5 ring-1 ring-red-500/30">
              <p className="text-[14.5px]">
                This removes {c.name}&apos;s contact details, notes, enquiries and reminders. Invoices and payments are kept but anonymised, because UK tax rules
                require you to keep financial records. This can&apos;t be undone.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConfirmErase(false)}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  className="bg-red-600 from-red-500 to-red-700"
                  onClick={async () => {
                    const r = await api<{ ok?: boolean; error?: string; snapshot?: Snapshot }>("/api/privacy/erase-customer", { json: { customerId: c.id } });
                    if (r.body.snapshot) setSnapshot(r.body.snapshot);
                    toast(r.body.ok ? "Personal data erased" : r.body.error ?? "Couldn't erase", r.body.ok ? "success" : "error");
                    if (r.body.ok) ui.closeCustomer();
                  }}
                >
                  Erase personal data
                </Button>
              </div>
            </div>
          )}
        </Section>
      ) : null}
    </div>
  );
}
