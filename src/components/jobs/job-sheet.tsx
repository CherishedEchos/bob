"use client";

import * as React from "react";
import { AlarmClock, Check, Hammer, Inbox, MapPin, Phone, PoundSterling, ReceiptText, Trash2, UserRound } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import {
  EXPENSE_CATEGORY_LABEL, JOB_STATUSES, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, invoiceStatusLabel, jobFinance, paymentsForJob,
} from "@/lib/derive";
import { addDaysKey, cn, firstName, formatDateKey, gbp } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { JobStatusBadge } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";
import { MoneyRow, ProgressBar } from "@/components/common/bits";
import { NotesPanel } from "@/components/common/notes";

export function JobSheet() {
  const ui = useUI();
  const { data } = useStore();
  const job = data.jobs.find((j) => j.id === ui.jobId);
  return (
    <Sheet open={!!job} onOpenChange={(o) => !o && ui.closeJob()}>
      {job ? (
        <SheetContent title={`${job.title} for ${job.customerName}`}>
          <JobDetail id={job.id} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

export function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-line px-5 py-5 sm:px-6", className)}>
      <h3 className="mb-3 text-[14px] font-semibold uppercase tracking-wider text-subtle">{title}</h3>
      {children}
    </section>
  );
}

function JobDetail({ id }: { id: string }) {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const j = data.jobs.find((x) => x.id === id)!;
  const money = can("finance.read");
  const f = jobFinance(j, data.payments, data.expenses, data.invoices);
  const payments = paymentsForJob(data.payments, j.id);
  const expenses = data.expenses.filter((e) => e.jobId === j.id);
  const invoices = data.invoices.filter((i) => i.jobId === j.id);
  const [nextAction, setNextAction] = React.useState(j.nextAction ?? "");

  React.useEffect(() => setNextAction(j.nextAction ?? ""), [j.id, j.nextAction]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <div className="flex items-center gap-4 pr-12">
          <JobTile kind={j.kind} className="size-[72px]" />
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold leading-tight tracking-tight">{j.title}</h2>
            <button className="mt-0.5 text-left text-[16px] text-foreground/85 hover:text-accent-fg" onClick={() => ui.openCustomer(j.customerId)}>
              {j.customerName}
            </button>
            <p className="mt-0.5 flex items-center gap-1 text-[14.5px] text-muted-foreground">
              <MapPin className="size-3.5 text-accent-icon" /> {j.location}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <JobStatusBadge status={j.status} />
          {money && f.depositOverdue ? <span className="rounded-full bg-red-500/12 px-2.5 py-0.5 text-[13px] font-medium text-danger-fg ring-1 ring-red-500/30">Deposit overdue</span> : null}
        </div>

        {money ? (
          <div className="card-surface mt-5 rounded-2xl px-4 py-2">
            <MoneyRow label="Price" value={gbp(j.quotedValue)} strong />
            <MoneyRow label="Deposit required" value={gbp(j.depositRequired)} />
            <MoneyRow
              label="Deposit received"
              value={gbp(Math.min(f.totalPaid, j.depositRequired))}
              tone={f.depositOutstanding === 0 && j.depositRequired > 0 ? "green" : f.depositOverdue ? "red" : "amber"}
            />
            <MoneyRow label="Total paid" value={gbp(f.totalPaid)} />
            <MoneyRow label="Left to pay" value={gbp(f.balance)} strong />
            {f.expenses ? <MoneyRow label="Costs recorded" value={gbp(f.expenses)} /> : null}
            <div className="flex items-center gap-3 py-3">
              <ProgressBar value={f.paidPercent} className="flex-1" />
              <span className="tabular text-[13.5px] text-muted-foreground">{f.paidPercent}% paid</span>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {can("payments.record") ? (
            <Button disabled={f.balance <= 0} onClick={() => ui.openForm({ form: "payment", jobId: j.id })}>
              <PoundSterling /> Record payment
            </Button>
          ) : null}
          {can("invoices.draft") ? (
            <Button variant="secondary" onClick={() => ui.openForm({ form: "invoice", customerId: j.customerId, jobId: j.id })}>
              <ReceiptText /> Create invoice
            </Button>
          ) : null}
          {can("expenses.write") ? (
            <Button variant="secondary" onClick={() => ui.openForm({ form: "expense", jobId: j.id })}>
              <Hammer /> Add a cost
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() =>
              ui.openForm({ form: "reminder", title: j.nextAction ?? `Check in on ${j.customerName}'s ${j.title.toLowerCase()}`, dueDate: addDaysKey(1), customerId: j.customerId, relatedType: "job", relatedId: j.id })
            }
          >
            <AlarmClock /> Set reminder
          </Button>
          {j.customerPhone ? (
            <Button asChild variant="secondary">
              <a href={`tel:${j.customerPhone.replace(/\s/g, "")}`}>
                <Phone /> Call {firstName(j.customerName)}
              </a>
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => ui.openCustomer(j.customerId)}>
            <UserRound /> Customer
          </Button>
          {j.enquiryId ? (
            <Button variant="ghost" onClick={() => ui.openEnquiry(j.enquiryId!)}>
              <Inbox /> Original enquiry
            </Button>
          ) : null}
        </div>
      </div>

      <Section title="Next action">
        <form
          className="flex gap-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            const res = await actions.updateJob(j.id, { nextAction: nextAction.trim() });
            toast(res.ok ? "Next action saved" : Object.values(res.errors)[0] ?? "Couldn't save", res.ok ? "success" : "error");
          }}
        >
          <Input value={nextAction} onChange={(ev) => setNextAction(ev.target.value)} placeholder="What's the next thing to do?" aria-label="Next action" disabled={!can("jobs.write")} />
          <Button type="submit" variant="secondary" size="icon" aria-label="Save next action" disabled={(j.nextAction ?? "") === nextAction || !can("jobs.write")}>
            <Check />
          </Button>
        </form>
      </Section>

      {can("jobs.write") ? (
        <Section title="Job status">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {JOB_STATUSES.map((s) => (
              <button
                key={s}
                onClick={async () => {
                  if (s === j.status) return;
                  const res = await actions.setJobStatus(j.id, s);
                  toast(res.ok ? `Moved to ${JOB_STATUS_LABEL[s]}` : Object.values(res.errors)[0] ?? "Couldn't update", res.ok ? "success" : "error");
                }}
                aria-pressed={j.status === s}
                className={cn(
                  "h-10 rounded-xl text-[14px] font-medium ring-1 transition",
                  j.status === s ? "bg-copper-500/18 text-accent-fg ring-copper-500/60" : "bg-surface-2 text-muted-foreground ring-line hover:bg-surface-3 hover:text-foreground",
                )}
              >
                {JOB_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {money ? (
        <Section title="Invoices">
          {invoices.length ? (
            <ul className="space-y-2">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-line">
                  <div>
                    <div className="text-[15px] font-medium">{i.number ?? i.draftRef}</div>
                    <div className="text-[13.5px] text-muted-foreground">
                      {invoiceStatusLabel(i)}
                      {i.dueDate ? ` · due ${formatDateKey(i.dueDate)}` : ""}
                    </div>
                  </div>
                  <div className="tabular text-[16px] font-semibold">{gbp(i.total)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-muted-foreground">No invoices for this job yet.</p>
          )}
        </Section>
      ) : null}

      {money ? (
        <Section title="Payments">
          {payments.length ? (
            <ul className="space-y-2">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-line">
                  <div>
                    <div className="text-[15px] font-medium">{PAYMENT_TYPE_LABEL[p.type]}</div>
                    <div className="text-[13.5px] text-muted-foreground">
                      {formatDateKey(p.receivedAt)} · {PAYMENT_METHOD_LABEL[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""} · by {p.recordedBy}
                    </div>
                  </div>
                  <div className="tabular text-[16px] font-semibold text-good-fg">{gbp(p.amount)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-muted-foreground">No payments recorded yet.</p>
          )}
        </Section>
      ) : null}

      {money ? (
        <Section title="Costs">
          {expenses.length ? (
            <ul className="space-y-2">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-line">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium">{e.description}</div>
                    <div className="text-[13.5px] text-muted-foreground">
                      {EXPENSE_CATEGORY_LABEL[e.category]} · {formatDateKey(e.incurredOn)} · by {e.recordedBy}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="tabular text-[16px] font-semibold">{gbp(e.amount)}</span>
                    {can("expenses.write") ? (
                      <button
                        aria-label={`Remove ${e.description}`}
                        className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-danger-fg"
                        onClick={async () => {
                          const r = await actions.removeExpense(e.id);
                          toast(r.ok ? "Cost removed" : "Couldn't remove", r.ok ? "success" : "error");
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-muted-foreground">No costs recorded. Tell Bob “add £450 of materials to this job”, or use Add a cost.</p>
          )}
        </Section>
      ) : null}

      <Section title="Details">
        <dl className="space-y-3 text-[15px]">
          <div>
            <dt className="text-muted-foreground">Description</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-foreground/90">{j.description || "—"}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-muted-foreground">Start date</dt>
              <dd className="mt-0.5">{j.startDate ? formatDateKey(j.startDate) : "Not set"}</dd>
            </div>
            {money ? (
              <div>
                <dt className="text-muted-foreground">Deposit due</dt>
                <dd className="mt-0.5">{j.depositDueDate ? formatDateKey(j.depositDueDate) : "Not set"}</dd>
              </div>
            ) : null}
          </div>
          {j.customerPhone || j.customerEmail ? (
            <div>
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="mt-0.5">{[j.customerPhone, j.customerEmail].filter(Boolean).join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
      </Section>

      <Section title="Notes" className="pb-10">
        <NotesPanel notes={j.notes} onAdd={(t) => actions.addJobNote(j.id, t)} />
      </Section>
    </div>
  );
}
