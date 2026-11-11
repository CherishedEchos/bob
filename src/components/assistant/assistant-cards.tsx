"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  MapPin,
  MessageSquareReply,
  PoundSterling,
  Reply,
  XCircle,
} from "lucide-react";
import type { Card, Proposal } from "@/lib/assistant/types";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { jobFinance, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, JOB_STATUS_LABEL } from "@/lib/derive";
import { copyToClipboard, formatDateKey, gbp, timeAgo, cn, formatDateInline } from "@/lib/utils";
import { EnquiryStatusBadge, JobStatusBadge, SourceIcon } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";
import { MoneyRow, ProgressBar } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

const rowCls =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AssistantCard({ card, onNavigate }: { card: Card; onNavigate?: () => void }) {
  const { data } = useStore();
  const ui = useUI();
  const router = useRouter();

  switch (card.type) {
    case "enquiries": {
      const list = card.ids.map((id) => data.enquiries.find((e) => e.id === id)).filter(Boolean) as typeof data.enquiries;
      return (
        <CardShell>
          {list.map((e) => (
            <button key={e.id} className={rowCls} onClick={() => ui.openEnquiry(e.id)}>
              <SourceIcon source={e.source} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{e.customerName}</div>
                <div className="truncate text-[12.5px] text-muted-foreground">
                  {e.title} · {e.location} · {timeAgo(e.receivedAt)}
                </div>
              </div>
              <EnquiryStatusBadge status={e.status} />
            </button>
          ))}
        </CardShell>
      );
    }
    case "jobs": {
      const list = card.ids.map((id) => data.jobs.find((j) => j.id === id)).filter(Boolean) as typeof data.jobs;
      return (
        <CardShell>
          {list.map((j) => {
            const f = jobFinance(j, data.payments);
            return (
              <button key={j.id} className={rowCls} onClick={() => ui.openJob(j.id)}>
                <JobTile kind={j.kind} className="size-11 rounded-xl [&_svg]:size-5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">
                    {j.title} – {j.customerName}
                  </div>
                  {card.show === "progress" ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <ProgressBar value={f.paidPercent} className="flex-1" />
                      <span className="tabular text-[12px] text-muted-foreground">{f.paidPercent}% paid</span>
                    </div>
                  ) : (
                    <div className="truncate text-[12.5px] text-muted-foreground">{j.location}</div>
                  )}
                </div>
                <div className="text-right">
                  {card.show === "deposit" ? (
                    <>
                      <div className="tabular text-[14px] font-semibold">{gbp(f.depositOutstanding)}</div>
                      <div className={cn("text-[12px]", f.depositOverdue ? "text-red-300" : "text-amber-200")}>
                        {f.depositOverdue ? "Overdue" : j.depositDueDate ? `Due ${formatDateInline(j.depositDueDate)}` : "Deposit due"}
                      </div>
                    </>
                  ) : card.show === "balance" ? (
                    <>
                      <div className="tabular text-[14px] font-semibold">{gbp(f.depositOutstanding || f.balance)}</div>
                      <div className="text-[12px] text-muted-foreground">{f.depositOutstanding ? "deposit" : "balance"}</div>
                    </>
                  ) : (
                    <JobStatusBadge status={j.status} />
                  )}
                </div>
              </button>
            );
          })}
        </CardShell>
      );
    }
    case "priorities":
      return (
        <CardShell>
          {card.items.map((p) => {
            const Icon = p.kind === "reply" ? Reply : p.kind === "followup" ? MessageSquareReply : p.kind === "deposit" ? PoundSterling : AlarmClock;
            const open = () => {
              if (p.kind === "reply" || p.kind === "followup") ui.openEnquiry(p.enquiryId);
              else if (p.kind === "deposit") ui.openJob(p.jobId);
              else {
                router.push("/reminders");
                onNavigate?.();
              }
            };
            return (
              <button key={p.id} className={rowCls} onClick={open}>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-copper-500/12 text-copper-300 ring-1 ring-copper-500/25">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{p.title}</div>
                  <div className="truncate text-[12.5px] text-muted-foreground">{p.detail}</div>
                </div>
                <ChevronRight className="size-4 text-subtle" />
              </button>
            );
          })}
        </CardShell>
      );
    case "reminders": {
      const list = card.ids.map((id) => data.reminders.find((r) => r.id === id)).filter(Boolean) as typeof data.reminders;
      return (
        <CardShell>
          {list.map((r) => (
            <Link key={r.id} href="/reminders" onClick={onNavigate} className={rowCls}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-copper-300 ring-1 ring-white/10">
                <AlarmClock className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{r.title}</span>
              <span className="text-[12.5px] text-muted-foreground">{formatDateKey(r.dueDate)}</span>
            </Link>
          ))}
        </CardShell>
      );
    }
    case "draft": {
      const enquiry = data.enquiries.find((e) => e.id === card.enquiryId);
      return (
        <CardShell className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-copper-300">Draft reply · not sent</span>
          </div>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">{card.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const ok = await copyToClipboard(card.text);
                toast(ok ? "Draft copied to clipboard" : "Couldn't copy — select the text instead", ok ? "success" : "error");
              }}
            >
              <Copy /> Copy
            </Button>
            {enquiry ? (
              <Button size="sm" variant="ghost" onClick={() => ui.openEnquiry(enquiry.id)}>
                Open enquiry
              </Button>
            ) : null}
          </div>
        </CardShell>
      );
    }
    case "job_result": {
      const j = data.jobs.find((x) => x.id === card.jobId);
      if (!j) return null;
      const f = jobFinance(j, data.payments);
      return (
        <CardShell className="p-3.5">
          <button className="flex w-full items-center gap-3 text-left" onClick={() => ui.openJob(j.id)}>
            <JobTile kind={j.kind} className="size-14" />
            <div className="min-w-0">
              <div className="line-clamp-2 text-[15px] font-semibold leading-snug">
                {j.title} – {j.customerName}
              </div>
              <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
                <MapPin className="size-3.5 text-copper-400" /> {j.location}
              </div>
            </div>
          </button>
          <div className="mt-2">
            <MoneyRow label="Quote" value={gbp(j.quotedValue)} />
            <MoneyRow label={f.depositPaid > 0 ? "Deposit (paid)" : "Deposit required"} value={gbp(f.depositPaid > 0 ? f.depositPaid : j.depositRequired)} />
            <MoneyRow label="Balance" value={gbp(f.balance)} strong />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[14px] text-emerald-300">
            <CheckCircle2 className="size-5 fill-emerald-500 text-ink-900" /> Job added · {JOB_STATUS_LABEL[j.status]}
          </div>
        </CardShell>
      );
    }
    case "payment_result": {
      const j = data.jobs.find((x) => x.id === card.jobId);
      if (!j) return null;
      const f = jobFinance(j, data.payments);
      return (
        <CardShell className="p-3.5">
          <div className="text-[15px] font-semibold">
            {j.title} – {j.customerName}
          </div>
          <div className="mt-1">
            <MoneyRow label="Recorded now" value={gbp(card.amount)} tone="green" />
            <MoneyRow label="Total paid" value={gbp(f.totalPaid)} />
            <MoneyRow label="Balance remaining" value={gbp(f.balance)} strong />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[14px] text-emerald-300">
            <CheckCircle2 className="size-5 fill-emerald-500 text-ink-900" /> Payment recorded
          </div>
        </CardShell>
      );
    }
  }
}

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-2.5 rounded-2xl bg-black/25 p-1.5 ring-1 ring-white/[0.08]", className)}>{children}</div>;
}

/* ------------------------------ Confirmation ------------------------------ */

export function ConfirmCard({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: Proposal;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { data } = useStore();
  const a = proposal.action;
  let rows: [string, string][] = [];
  let confirmLabel = "Confirm";
  let note: string | null = null;

  if (a.type === "create_job") {
    rows = [
      ["Customer", a.job.customerName],
      ["Job", a.job.title],
      ["Location", a.job.location],
      ["Quote", gbp(a.job.quotedValue)],
      ["Deposit required", a.job.depositRequired ? gbp(a.job.depositRequired) : "Not set"],
      ...(a.depositPaid ? ([["Deposit paid today", gbp(a.depositPaid)]] as [string, string][]) : []),
      ["Status", JOB_STATUS_LABEL[a.job.status]],
    ];
    confirmLabel = "Add job";
  } else if (a.type === "record_payment") {
    const j = data.jobs.find((x) => x.id === a.jobId);
    rows = [
      ["Customer", j?.customerName ?? "Unknown job"],
      ["Job", j?.title ?? "—"],
      ["Amount", gbp(a.amount)],
      ["Type", PAYMENT_TYPE_LABEL[a.paymentType]],
      ["Method", PAYMENT_METHOD_LABEL[a.method]],
      ["Received", "Today"],
    ];
    confirmLabel = "Record payment";
    note = "This logs money you've already received. It doesn't charge the customer.";
  } else if (a.type === "mark_replied" || a.type === "save_draft") {
    const e = data.enquiries.find((x) => x.id === a.enquiryId);
    rows = [
      ["Customer", e?.customerName ?? "Unknown"],
      ["Enquiry", e ? `${e.title}, ${e.location}` : "—"],
    ];
    confirmLabel = a.type === "mark_replied" ? "Mark as replied" : "Save draft";
    note = a.type === "save_draft" ? "The draft is stored on the enquiry. Nothing is sent." : "Only confirm once you've actually replied.";
  } else if (a.type === "create_reminder") {
    const related =
      a.relatedType === "job"
        ? data.jobs.find((j) => j.id === a.relatedId)
        : a.relatedType === "enquiry"
          ? data.enquiries.find((e) => e.id === a.relatedId)
          : undefined;
    rows = [
      ["Reminder", a.title],
      ["When", formatDateKey(a.dueDate)],
      ...(related ? ([["Linked to", `${related.customerName} — ${related.title}`]] as [string, string][]) : []),
    ];
    confirmLabel = "Set reminder";
  }

  return (
    <div className="mt-2.5 rounded-2xl bg-black/25 p-3.5 ring-1 ring-copper-500/30">
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-4 border-b border-white/[0.06] py-2 last:border-0">
            <dt className="text-[13.5px] text-muted-foreground">{k}</dt>
            <dd className="tabular text-right text-[14px] font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="mt-2 text-[12.5px] text-subtle">{note}</p> : null}
      {proposal.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" className="flex-1" onClick={onConfirm}>
            <Check /> {confirmLabel}
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 text-[13.5px]",
            proposal.status === "confirmed" && "text-emerald-300",
            proposal.status === "cancelled" && "text-muted-foreground",
            proposal.status === "failed" && "text-red-300",
          )}
        >
          {proposal.status === "confirmed" ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {proposal.status === "confirmed" ? "Confirmed" : proposal.status === "cancelled" ? "Cancelled" : `Failed: ${proposal.error}`}
        </div>
      )}
    </div>
  );
}
