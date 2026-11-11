"use client";

import * as React from "react";
import { BellRing, CheckCircle2, CirclePoundSterling, Copy, PoundSterling, Wallet } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, jobsAwaitingDeposit, jobsWithBalance } from "@/lib/derive";
import type { Job } from "@/lib/types";
import { addDaysKey, cn, copyToClipboard, formatDateKey, gbp, timeAgo, firstName, formatDateInline } from "@/lib/utils";
import { Card, EmptyState, FilterChips, PageHeader } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";

type Tab = "deposits" | "balances" | "received";

export default function PaymentsPage() {
  const { data } = useStore();
  const ui = useUI();
  const [tab, setTab] = React.useState<Tab>("deposits");
  const [chasing, setChasing] = React.useState<{ job: Job; amount: number; kind: "deposit" | "balance" } | null>(null);

  const deposits = jobsAwaitingDeposit(data);
  const balances = jobsWithBalance(data).filter(({ job }) => job.status !== "quoted");
  const received = [...data.payments].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const monthKey = new Date().toISOString().slice(0, 7);
  const receivedThisMonth = data.payments.filter((p) => p.receivedAt.startsWith(monthKey)).reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Deposits, balances and what's come in."
        actions={
          <Button onClick={() => ui.openForm({ form: "payment" })}>
            <PoundSterling /> Record payment
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:gap-4">
        <Summary icon={CirclePoundSterling} label="Deposits due" value={gbp(deposits.reduce((s, d) => s + d.finance.depositOutstanding, 0))} sub={`${deposits.length} job${deposits.length === 1 ? "" : "s"}${deposits.some((d) => d.finance.depositOverdue) ? " · some overdue" : ""}`} highlight />
        <Summary icon={Wallet} label="Balances outstanding" value={gbp(balances.reduce((s, b) => s + b.finance.balance, 0))} sub={`${balances.length} job${balances.length === 1 ? "" : "s"} underway`} />
        <Summary icon={CheckCircle2} label="Received this month" value={gbp(receivedThisMonth)} sub={`${data.payments.filter((p) => p.receivedAt.startsWith(monthKey)).length} payments`} />
      </div>

      <div className="mb-4 mt-8">
        <FilterChips
          label="Payment view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "deposits", label: "Deposits due", count: deposits.length },
            { value: "balances", label: "Balances", count: balances.length },
            { value: "received", label: "Received", count: received.length },
          ]}
        />
      </div>

      {tab === "deposits" ? (
        deposits.length ? (
          <ul className="space-y-3">
            {deposits.map(({ job, finance }) => (
              <PaymentRow
                key={job.id}
                job={job}
                amount={finance.depositOutstanding}
                label="Deposit"
                status={
                  finance.depositOverdue ? (
                    <Badge tone="red">Overdue {Math.abs(finance.depositDaysUntilDue ?? 0)}d</Badge>
                  ) : job.depositDueDate ? (
                    <Badge tone="amber">Due {formatDateInline(job.depositDueDate)}</Badge>
                  ) : (
                    <Badge tone="amber">Due</Badge>
                  )
                }
                onRecord={() => ui.openForm({ form: "payment", jobId: job.id, amount: finance.depositOutstanding })}
                onChase={() => setChasing({ job, amount: finance.depositOutstanding, kind: "deposit" })}
              />
            ))}
          </ul>
        ) : (
          <EmptyState icon={CheckCircle2} title="No deposits outstanding" body="Every active job has its deposit in." />
        )
      ) : null}

      {tab === "balances" ? (
        balances.length ? (
          <ul className="space-y-3">
            {balances.map(({ job, finance }) => (
              <PaymentRow
                key={job.id}
                job={job}
                amount={finance.balance}
                label={`Balance · ${finance.paidPercent}% paid`}
                status={job.status === "snagging" || job.status === "completed" ? <Badge tone="amber">Ready to invoice</Badge> : <Badge tone="neutral">In progress</Badge>}
                onRecord={() => ui.openForm({ form: "payment", jobId: job.id })}
                onChase={() => setChasing({ job, amount: finance.balance, kind: "balance" })}
              />
            ))}
          </ul>
        ) : (
          <EmptyState icon={CheckCircle2} title="Nothing outstanding" body="No balances owed on jobs underway." />
        )
      ) : null}

      {tab === "received" ? (
        <Card className="divide-y divide-white/[0.06]">
          {received.map((p) => {
            const job = data.jobs.find((j) => j.id === p.jobId);
            return (
              <button key={p.id} onClick={() => job && ui.openJob(job.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03]">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25">
                  <CheckCircle2 className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{job ? `${job.customerName} — ${job.title}` : "Unknown job"}</div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {PAYMENT_TYPE_LABEL[p.type]} · {PAYMENT_METHOD_LABEL[p.method]} · {formatDateKey(p.receivedAt)} · recorded by {p.recordedBy}
                  </div>
                </div>
                <div className="tabular text-[15px] font-semibold text-emerald-300">{gbp(p.amount)}</div>
              </button>
            );
          })}
        </Card>
      ) : null}

      <ChaseDialog chasing={chasing} onClose={() => setChasing(null)} />
    </>
  );
}

function Summary({ icon: Icon, label, value, sub, highlight }: { icon: typeof Wallet; label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-2xl p-3 sm:p-4 lg:p-5", highlight ? "card-copper" : "card-surface")}>
      <div className="flex items-start gap-2 text-[12.5px] leading-tight text-foreground/85 sm:items-center sm:text-[14px]">
        <Icon className={cn("hidden size-5 shrink-0 sm:block", highlight ? "text-copper-200" : "text-copper-400")} strokeWidth={1.7} /> {label}
      </div>
      <div className="tabular mt-2 truncate text-[19px] font-bold tracking-tight sm:text-[30px]">{value}</div>
      <div className="hidden text-[13px] text-muted-foreground sm:block">{sub}</div>
    </div>
  );
}

function PaymentRow({
  job,
  amount,
  label,
  status,
  onRecord,
  onChase,
}: {
  job: Job;
  amount: number;
  label: string;
  status: React.ReactNode;
  onRecord: () => void;
  onChase: () => void;
}) {
  const ui = useUI();
  return (
    <li className="card-surface flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
      <button className="min-w-0 flex-1 text-left" onClick={() => ui.openJob(job.id)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[16px] font-semibold">{job.customerName}</span>
          {status}
        </div>
        <div className="text-[14px] text-muted-foreground">
          {job.title}, {job.location} · {label}
        </div>
        {job.lastChasedAt ? <div className="mt-1 text-[12.5px] text-subtle">Last chased {timeAgo(job.lastChasedAt)}</div> : null}
      </button>
      <div className="tabular text-[22px] font-bold tracking-tight sm:mr-2">{gbp(amount)}</div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button size="sm" variant="secondary" onClick={onChase}>
          <BellRing /> Reminder
        </Button>
        <Button size="sm" onClick={onRecord}>
          <PoundSterling /> Record
        </Button>
      </div>
    </li>
  );
}

function ChaseDialog({ chasing, onClose }: { chasing: { job: Job; amount: number; kind: "deposit" | "balance" } | null; onClose: () => void }) {
  const { actions } = useStore();
  const [text, setText] = React.useState("");

  React.useEffect(() => {
    if (!chasing) return;
    const { job, amount, kind } = chasing;
    const name = job.customerName.startsWith("The ") ? "both" : firstName(job.customerName);
    setText(
      kind === "deposit"
        ? `Hi ${name},\n\nJust a friendly reminder that the ${gbp(amount)} deposit for your ${job.title.toLowerCase()} is now due. Once it's in, we'll lock in your start date.\n\nBank details are on the quote — please use your surname as the reference.\n\nThanks,\nNinety3`
        : `Hi ${name},\n\nThanks again for choosing us for your ${job.title.toLowerCase()}. Just a reminder that the remaining balance of ${gbp(amount)} is now due.\n\nBank details are on the invoice. Any questions, just give me a shout.\n\nThanks,\nNinety3`,
    );
  }, [chasing]);

  if (!chasing) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Payment reminder" description={`For ${chasing.job.customerName} · ${gbp(chasing.amount)} ${chasing.kind}`}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-56 text-[14.5px]" aria-label="Reminder message" />
        <p className="mt-2 text-[12.5px] text-subtle">Messages aren&apos;t sent from the app yet. Copy this into a text or email, then log that you&apos;ve chased.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const ok = await copyToClipboard(text);
              toast(ok ? "Message copied" : "Couldn't copy — select the text instead", ok ? "success" : "error");
            }}
          >
            <Copy /> Copy message
          </Button>
          <Button
            onClick={() => {
              const res = actions.logPaymentChased(chasing.job.id);
              if (!res.ok) return;
              actions.createReminder({
                title: `Check ${chasing.job.customerName} has paid the ${chasing.kind}`,
                dueDate: addDaysKey(3),
                relatedType: "job",
                relatedId: chasing.job.id,
              });
              toast("Logged as chased · reminder set to check in 3 days");
              onClose();
            }}
          >
            <CheckCircle2 /> I&apos;ve sent it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
