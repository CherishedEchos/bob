"use client";

import { PhotoGrid } from "@/components/common/photos";

import * as React from "react";
import { AlarmClock, Check, ChevronRight, Hammer, Inbox, MapPin, MoreHorizontal, Phone, PoundSterling, ReceiptText, Trash2, UserRound } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import {
  EXPENSE_CATEGORY_LABEL, JOB_STATUSES, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, invoiceStatusLabel, jobFinance, jobNextStep, paymentsForJob,
} from "@/lib/derive";
import { addDaysKey, cn, firstName, formatDateKey, gbp } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { JobStatusBadge } from "@/components/common/status";
import { Badge } from "@/components/ui/badge";
import { Menu, type MenuItem } from "@/components/ui/menu";
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

/** A folded section inside a record: title + one-line summary, tap to open. */
export function Fold({ title, summary, children, defaultOpen = false, last = false }: { title: string; summary?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; last?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <section className={cn("border-t border-line", last && "pb-8")}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-surface-2 sm:px-6">
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold">{title}</span>
          {summary && !open ? <span className="mt-0.5 block truncate text-[14px] text-muted-foreground">{summary}</span> : null}
        </span>
        <ChevronRight className={cn("size-5 shrink-0 text-subtle transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div id={id} className="px-5 pb-5 sm:px-6">
          {children}
        </div>
      ) : null}
    </section>
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

  const reminder = () =>
    ui.openForm({ form: "reminder", title: j.nextAction ?? `Check in on ${j.customerName}'s ${j.title.toLowerCase()}`, dueDate: addDaysKey(1), customerId: j.customerId, relatedType: "job", relatedId: j.id });
  const invoice = () => ui.openForm({ form: "invoice", customerId: j.customerId, jobId: j.id });
  const payment = () => ui.openForm({ form: "payment", jobId: j.id });
  // The one action most likely needed next.
  const primary =
    money && can("payments.record") && f.depositOutstanding > 0 && j.status !== "quoted"
      ? { label: "Record deposit", icon: PoundSterling, run: payment }
      : money && can("invoices.draft") && f.balance > 0 && (j.status === "snagging" || j.status === "completed") && !invoices.some((i) => i.status !== "void")
        ? { label: "Create invoice", icon: ReceiptText, run: invoice }
        : money && can("payments.record") && f.balance > 0 && j.status !== "quoted"
          ? { label: "Record payment", icon: PoundSterling, run: payment }
          : { label: "Set reminder", icon: AlarmClock, run: reminder };
  const more: MenuItem[] = [
    ...(money && can("payments.record") && f.balance > 0 && primary.run !== payment ? [{ label: "Record payment", icon: PoundSterling, onSelect: payment }] : []),
    ...(money && can("invoices.draft") && primary.run !== invoice ? [{ label: "Create invoice", icon: ReceiptText, onSelect: invoice }] : []),
    ...(can("expenses.write") ? [{ label: "Add a cost", icon: Hammer, onSelect: () => ui.openForm({ form: "expense", jobId: j.id }) }] : []),
    ...(primary.run !== reminder ? [{ label: "Set reminder", icon: AlarmClock, onSelect: reminder }] : []),
    { label: "Customer details", icon: UserRound, onSelect: () => ui.openCustomer(j.customerId) },
    ...(j.enquiryId ? [{ label: "Original enquiry", icon: Inbox, onSelect: () => ui.openEnquiry(j.enquiryId!) }] : []),
  ];

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
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <JobStatusBadge status={j.status} />
          {money && f.depositOverdue ? <Badge tone="red">Deposit overdue</Badge> : null}
        </div>

        {/* The next step and the one action most likely needed */}
        <div className="mt-5 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-line">
          <div className="t-eyebrow">Next step</div>
          <p className="mt-1 text-[16px] font-medium leading-snug">{jobNextStep(j, data, money)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={primary.run}>
              <primary.icon /> {primary.label}
            </Button>
            {j.customerPhone ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`tel:${j.customerPhone.replace(/\s/g, "")}`}>
                  <Phone /> Call {firstName(j.customerName)}
                </a>
              </Button>
            ) : null}
            <Menu
              label="More actions"
              align="start"
              items={more}
              triggerClassName="flex h-11 items-center gap-1.5 rounded-xl px-3.5 text-[15px] font-medium text-muted-foreground transition hover:bg-surface-3 hover:text-foreground"
              trigger={
                <>
                  <MoreHorizontal className="size-5" /> More
                </>
              }
            />
          </div>
        </div>

        {money ? (
          <div className="mt-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Price", gbp(j.quotedValue), ""],
                ["Paid", gbp(f.totalPaid), "text-good-fg"],
                ["Left", gbp(f.balance), f.balance > 0 ? "text-foreground" : "text-good-fg"],
              ].map(([l, v, cls]) => (
                <div key={l}>
                  <div className={cn("tabular text-[19px] font-semibold", cls)}>{v}</div>
                  <div className="text-[13px] text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <ProgressBar value={f.paidPercent} className="flex-1" />
              <span className="tabular text-[13px] text-muted-foreground">{f.paidPercent}% paid</span>
            </div>
          </div>
        ) : null}
      </div>

      <Section title="Photos">
        <PhotoGrid relatedType="job" relatedId={j.id} />
      </Section>

      <Section title="Notes">
        <NotesPanel notes={j.notes} onAdd={(t) => actions.addJobNote(j.id, t)} />
      </Section>

      {money ? (
        <Fold title="Payments" summary={payments.length ? `${payments.length} · ${gbp(f.totalPaid)} received` : "None yet"}>
          <MoneyRow label="Deposit required" value={gbp(j.depositRequired)} />
          <MoneyRow
            label="Deposit received"
            value={gbp(Math.min(f.totalPaid, j.depositRequired))}
            tone={f.depositOutstanding === 0 && j.depositRequired > 0 ? "green" : f.depositOverdue ? "red" : "amber"}
          />
          {payments.length ? (
            <ul className="mt-2 divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
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
            <p className="mt-2 text-[15px] text-muted-foreground">No payments recorded yet.</p>
          )}
        </Fold>
      ) : null}

      {money ? (
        <Fold title="Invoices" summary={invoices.length ? invoices.map((i) => `${i.number ?? i.draftRef} ${invoiceStatusLabel(i).toLowerCase()}`).join(" · ") : "None yet"}>
          {invoices.length ? (
            <ul className="divide-y divide-line">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
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
        </Fold>
      ) : null}

      {money ? (
        <Fold title="Costs" summary={expenses.length ? `${expenses.length} · ${gbp(f.expenses)}` : "None recorded"}>
          {expenses.length ? (
            <ul className="divide-y divide-line">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2.5">
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
                        className="grid size-9 place-items-center rounded-lg text-subtle hover:bg-surface-3 hover:text-danger-fg"
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
            <p className="text-[15px] text-muted-foreground">No costs recorded. Tell Bob “add £450 of materials to this job”, or use More → Add a cost.</p>
          )}
        </Fold>
      ) : null}

      <Fold title="Next action & status" summary={`${JOB_STATUS_LABEL[j.status]}${j.nextAction ? ` · ${j.nextAction}` : ""}`}>
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
        {can("jobs.write") ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                  "h-10 rounded-xl text-[14px] font-medium transition",
                  j.status === s ? "bg-copper-500/18 text-accent-fg" : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
                )}
              >
                {JOB_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        ) : null}
      </Fold>

      <Fold title="Details & contact" summary={[j.startDate ? `Starts ${formatDateKey(j.startDate)}` : null, j.customerPhone].filter(Boolean).join(" · ") || "Description and dates"} last>
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
      </Fold>
    </div>
  );
}
