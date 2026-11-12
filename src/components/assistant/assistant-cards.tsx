"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClock, AlertTriangle, Check, CheckCircle2, ChevronRight, Copy, FlaskConical, Info, Loader2, MessageSquareReply,
  Pencil, PoundSterling, ReceiptText, Reply, RotateCcw, UserRound, XCircle,
} from "lucide-react";
import type { ActionView, Card } from "@/lib/bob/types";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { JOB_STATUS_LABEL, invoiceBalance, invoiceStatusLabel, jobFinance } from "@/lib/derive";
import { copyToClipboard, formatDateKey, gbp, timeAgo, cn, formatDateInline } from "@/lib/utils";
import { EnquiryStatusBadge, JobStatusBadge, SourceIcon } from "@/components/common/status";
import { JobTile } from "@/components/common/job-tile";
import { MoneyRow, ProgressBar } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

const rowCls =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AssistantCard({ card, onNavigate }: { card: Card; onNavigate?: () => void }) {
  const { data, can } = useStore();
  const ui = useUI();
  const router = useRouter();
  const go = (href: string) => {
    router.push(href);
    onNavigate?.();
  };

  switch (card.type) {
    case "enquiries": {
      const list = card.ids.map((id) => data.enquiries.find((e) => e.id === id)).filter(Boolean) as typeof data.enquiries;
      if (!list.length) return null;
      return (
        <CardShell>
          {list.map((e) => (
            <button key={e.id} className={rowCls} onClick={() => ui.openEnquiry(e.id)}>
              <SourceIcon source={e.source} provider={e.provider} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{e.customerName}</div>
                <div className="truncate text-[13.5px] text-muted-foreground">
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
      if (!list.length) return null;
      const money = can("finance.read");
      return (
        <CardShell>
          {list.map((j) => {
            const f = jobFinance(j, data.payments);
            return (
              <button key={j.id} className={rowCls} onClick={() => ui.openJob(j.id)}>
                <JobTile kind={j.kind} className="size-11 rounded-xl [&_svg]:size-5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">
                    {j.title} – {j.customerName}
                  </div>
                  {card.show === "progress" && money ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <ProgressBar value={f.paidPercent} className="flex-1" />
                      <span className="tabular text-[13px] text-muted-foreground">{f.paidPercent}% paid</span>
                    </div>
                  ) : (
                    <div className="truncate text-[13.5px] text-muted-foreground">
                      {j.location}
                      {j.startDate ? ` · starts ${formatDateInline(j.startDate)}` : ""}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  {card.show === "deposit" && money ? (
                    f.depositOutstanding > 0 ? (
                      <>
                        <div className="tabular text-[15px] font-semibold">{gbp(f.depositOutstanding)}</div>
                        <div className={cn("text-[13px]", f.depositOverdue ? "text-danger-fg" : "text-warn-fg")}>
                          {f.depositOverdue ? "Overdue" : j.depositDueDate ? `Due ${formatDateInline(j.depositDueDate)}` : "Deposit due"}
                        </div>
                      </>
                    ) : (
                      <div className="text-[13.5px] text-good-fg">Deposit paid</div>
                    )
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
    case "job_detail": {
      const j = data.jobs.find((x) => x.id === card.jobId);
      if (!j) return null;
      const f = jobFinance(j, data.payments, data.expenses);
      return (
        <CardShell className="p-3.5">
          <button className="flex w-full items-center gap-3 text-left" onClick={() => ui.openJob(j.id)}>
            <JobTile kind={j.kind} className="size-12" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold">
                {j.title} – {j.customerName}
              </div>
              <div className="text-[14px] text-muted-foreground">
                {j.location} · {JOB_STATUS_LABEL[j.status]}
              </div>
            </div>
            <ChevronRight className="size-4 text-subtle" />
          </button>
          {can("finance.read") ? (
            <div className="mt-2">
              <MoneyRow label="Price" value={gbp(j.quotedValue)} />
              <MoneyRow label="Paid so far" value={gbp(f.totalPaid)} tone="green" />
              {f.expenses ? <MoneyRow label="Costs recorded" value={gbp(f.expenses)} /> : null}
              <MoneyRow label="Left to pay" value={gbp(f.balance)} strong />
            </div>
          ) : null}
        </CardShell>
      );
    }
    case "invoices": {
      const list = card.ids.map((id) => data.invoices.find((i) => i.id === id)).filter(Boolean) as typeof data.invoices;
      if (!list.length) return null;
      return (
        <CardShell>
          {list.map((i) => {
            const c = data.customers.find((x) => x.id === i.customerId);
            const label = invoiceStatusLabel(i);
            return (
              <button key={i.id} className={rowCls} onClick={() => go(`/invoices?open=${i.id}`)}>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-accent-fg ring-1 ring-line">
                  <ReceiptText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{c?.name ?? "Customer"}</div>
                  <div className="truncate text-[13.5px] text-muted-foreground">
                    {i.number ?? i.draftRef}
                    {i.dueDate ? ` · due ${formatDateInline(i.dueDate)}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular text-[15px] font-semibold">{gbp(i.status === "draft" ? i.total : invoiceBalance(i))}</div>
                  <div className={cn("text-[13px]", label === "Overdue" ? "text-danger-fg" : label === "Paid" ? "text-good-fg" : "text-muted-foreground")}>{label}</div>
                </div>
              </button>
            );
          })}
        </CardShell>
      );
    }
    case "customers": {
      const list = card.ids.map((id) => data.customers.find((c) => c.id === id)).filter(Boolean) as typeof data.customers;
      if (!list.length) return null;
      return (
        <CardShell>
          {list.map((c) => (
            <button key={c.id} className={rowCls} onClick={() => ui.openCustomer(c.id)}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-accent-fg ring-1 ring-line">
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{c.name}</div>
                <div className="truncate text-[13.5px] text-muted-foreground">{[c.town, c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</div>
              </div>
              <ChevronRight className="size-4 text-subtle" />
            </button>
          ))}
        </CardShell>
      );
    }
    case "priorities":
      return (
        <CardShell>
          {card.items.map((p) => {
            const Icon =
              p.kind === "reply" ? Reply : p.kind === "followup" || p.kind === "quote" ? MessageSquareReply : p.kind === "deposit" || p.kind === "invoice" ? PoundSterling : AlarmClock;
            const open = () => {
              if (p.kind === "reply" || p.kind === "followup") ui.openEnquiry(p.enquiryId);
              else if (p.kind === "quote") {
                if (p.enquiryId) ui.openEnquiry(p.enquiryId);
                else go("/enquiries");
              } else if (p.kind === "deposit") ui.openJob(p.jobId);
              else if (p.kind === "invoice") go(`/invoices?open=${p.invoiceId}`);
              else go("/tasks");
            };
            return (
              <button key={p.id} className={rowCls} onClick={open}>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-copper-500/12 text-accent-fg ring-1 ring-copper-500/25">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{p.title}</div>
                  <div className="truncate text-[13.5px] text-muted-foreground">{p.detail}</div>
                </div>
                <ChevronRight className="size-4 text-subtle" />
              </button>
            );
          })}
        </CardShell>
      );
    case "tasks": {
      const list = card.ids.map((id) => data.tasks.find((r) => r.id === id)).filter(Boolean) as typeof data.tasks;
      if (!list.length) return null;
      return (
        <CardShell>
          {list.map((r) => (
            <Link key={r.id} href="/tasks" onClick={onNavigate} className={rowCls}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-accent-fg ring-1 ring-line">
                <AlarmClock className="size-4" />
              </span>
              <span className={cn("min-w-0 flex-1 truncate text-[15px]", r.done && "text-muted-foreground line-through")}>{r.title}</span>
              <span className="text-[13.5px] text-muted-foreground">{formatDateKey(r.dueDate)}</span>
            </Link>
          ))}
        </CardShell>
      );
    }
    case "stats":
      return (
        <CardShell className="p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] font-semibold uppercase tracking-wider text-accent-fg">{card.title}</span>
            {card.period ? <span className="text-right text-[13px] text-subtle">{card.period}</span> : null}
          </div>
          <dl className="mt-2">
            {card.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between border-b border-line py-1.5 last:border-0">
                <dt className="text-[14.5px] text-muted-foreground">{r.label}</dt>
                <dd className={cn("tabular text-[15px] font-semibold", r.tone === "warn" && "text-warn-fg", r.tone === "good" && "text-good-fg")}>{r.value}</dd>
              </div>
            ))}
          </dl>
          {card.footnote ? <p className="mt-2 text-[13px] leading-snug text-subtle">{card.footnote}</p> : null}
        </CardShell>
      );
    case "warning":
      return (
        <div role="note" className="mt-2.5 flex gap-2.5 rounded-2xl bg-amber-400/10 p-3 text-[14px] leading-snug text-warn-fg ring-1 ring-amber-400/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn-fg" />
          <span>{card.text}</span>
        </div>
      );
    case "draft":
      return (
        <CardShell className="p-4">
          <div className="mb-1 text-[13px] font-medium uppercase tracking-wider text-accent-fg">Draft · not sent</div>
          {card.to ? <div className="text-[13.5px] text-muted-foreground">To: {card.to}</div> : null}
          <div className="mb-2 text-[13.5px] text-muted-foreground">Subject: {card.subject}</div>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{card.body}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={async () => {
              const ok = await copyToClipboard(card.body);
              toast(ok ? "Copied" : "Couldn't copy — select the text instead", ok ? "success" : "error");
            }}
          >
            <Copy /> Copy
          </Button>
          {card.note ? <p className="mt-2 text-[13px] text-subtle">{card.note}</p> : null}
        </CardShell>
      );
  }
}

export function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-2.5 rounded-2xl bg-surface-2 p-1.5 ring-1 ring-line", className)}>{children}</div>;
}

/* ------------------------------ Action card ------------------------------ */

/**
 * Confirmation card for anything Bob (or the dashboard) wants to change.
 * Success is only ever shown from the server's recorded status.
 */
export function ActionCard({
  action,
  onDecide,
  onNavigate,
}: {
  action: ActionView;
  onDecide: (decision: "approve" | "cancel" | "undo", edits?: Record<string, string>) => Promise<unknown>;
  onNavigate?: () => void;
}) {
  const ui = useUI();
  const router = useRouter();
  const [busy, setBusy] = React.useState<null | "approve" | "cancel" | "undo">(null);
  const [editing, setEditing] = React.useState(false);
  const email = action.preview?.kind === "email" ? action.preview : null;
  const invoice = action.preview?.kind === "invoice" ? action.preview : null;
  const [subject, setSubject] = React.useState(email?.subject ?? "");
  const [body, setBody] = React.useState(email?.body ?? "");
  const editableEmail = !!email && action.status === "pending" && (action.tool === "send_email" || action.tool === "save_email_draft");

  const run = async (d: "approve" | "cancel" | "undo") => {
    setBusy(d);
    try {
      const edits = d === "approve" && editableEmail && (body !== email!.body || subject !== email!.subject) ? { body, subject } : undefined;
      await onDecide(d, edits);
      setEditing(false);
    } finally {
      setBusy(null);
    }
  };

  const openLink = (l: NonNullable<ActionView["links"]>[number]) => {
    if (l.kind === "job") ui.openJob(l.id);
    else if (l.kind === "enquiry") ui.openEnquiry(l.id, { focus: "reply" });
    else if (l.kind === "customer") ui.openCustomer(l.id);
    else if (l.kind === "invoice") {
      router.push(`/invoices?open=${l.id}`);
      onNavigate?.();
    } else {
      router.push(l.id);
      onNavigate?.();
    }
  };

  const external = action.category === "external";
  return (
    <div
      className={cn(
        "mt-2.5 overflow-hidden rounded-2xl bg-surface-2 ring-1",
        action.status === "pending" ? (external ? "ring-copper-500/60" : "ring-copper-500/35") : "ring-line",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <span className="text-[14px] font-semibold">{action.title}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[12px] font-medium ring-1",
            external ? "bg-copper-500/15 text-accent-fg ring-copper-500/40" : "bg-surface-2 text-muted-foreground ring-line",
          )}
        >
          {external ? "Needs your approval" : action.status === "pending" ? "Check & confirm" : "Internal change"}
        </span>
      </div>
      <div className="px-3.5 pb-3.5 pt-1.5">
        {action.lines.length ? (
          <dl>
            {action.lines.map((l) => (
              <div key={l.label} className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-0">
                <dt className="text-[14.5px] text-muted-foreground">{l.label}</dt>
                <dd className={cn("tabular text-right text-[15px]", l.emphasis ? "font-semibold" : "font-medium")}>{l.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {invoice ? (
          <div className="mt-2 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
            <div className="text-[14.5px]">{invoice.description}</div>
            <MoneyRow label={invoice.amountsAre === "no_vat" ? "Amount (no VAT)" : "Net"} value={gbp(invoice.subtotal)} />
            {invoice.amountsAre !== "no_vat" ? <MoneyRow label={`VAT ${invoice.vatRate}%`} value={gbp(invoice.vat)} /> : null}
            <MoneyRow label="Total" value={gbp(invoice.total)} strong />
          </div>
        ) : null}

        {email ? (
          <div className="mt-2 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
            {editing ? (
              <>
                <label className="text-[13px] text-muted-foreground" htmlFor={`subj-${action.id}`}>
                  Subject
                </label>
                <input
                  id={`subj-${action.id}`}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mb-2 mt-1 h-9 w-full rounded-lg bg-surface-2 px-2.5 text-[15px] outline-none ring-1 ring-line focus:ring-copper-500/60"
                />
                <label className="text-[13px] text-muted-foreground" htmlFor={`body-${action.id}`}>
                  Message
                </label>
                <textarea
                  id={`body-${action.id}`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded-lg bg-surface-2 p-2.5 text-[15px] leading-relaxed outline-none ring-1 ring-line focus:ring-copper-500/60"
                />
              </>
            ) : (
              <>
                <div className="text-[13.5px] text-muted-foreground">Subject: {subject}</div>
                <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{body}</p>
              </>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {editableEmail && !editing ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await copyToClipboard(body);
                  toast(ok ? "Copied" : "Couldn't copy — select the text instead", ok ? "success" : "error");
                }}
              >
                <Copy /> Copy text
              </Button>
            </div>
            {email.channelNote ? <p className="mt-1 text-[13px] text-subtle">{email.channelNote}</p> : null}
          </div>
        ) : null}

        {action.notices.map((n, i) => (
          <div
            key={i}
            className={cn(
              "mt-2 flex gap-2 rounded-xl px-3 py-2 text-[13.5px] leading-snug ring-1",
              n.tone === "warning"
                ? "bg-amber-400/10 text-warn-fg ring-amber-400/25"
                : n.tone === "demo"
                  ? "bg-sky-400/10 text-info-fg ring-sky-400/25"
                  : "bg-surface-2 text-muted-foreground ring-line",
            )}
          >
            {n.tone === "warning" ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            ) : n.tone === "demo" ? (
              <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <Info className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>{n.text}</span>
          </div>
        ))}

        {action.status === "pending" ? (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" disabled={!!busy} onClick={() => run("cancel")}>
              Cancel
            </Button>
            <Button size="sm" className="flex-[1.6]" disabled={!!busy} onClick={() => run("approve")}>
              {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} {action.approveLabel}
            </Button>
          </div>
        ) : action.status === "executing" ? (
          <div className="mt-3 flex items-center gap-2 text-[14.5px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Working on it…
          </div>
        ) : (
          <div className="mt-3">
            <div
              className={cn(
                "flex items-start gap-2 text-[14.5px]",
                action.status === "executed" && "text-good-fg",
                (action.status === "cancelled" || action.status === "expired" || action.status === "undone") && "text-muted-foreground",
                action.status === "failed" && "text-danger-fg",
              )}
            >
              {action.status === "executed" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              ) : action.status === "undone" ? (
                <RotateCcw className="mt-0.5 size-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0" />
              )}
              <span>
                {action.status === "executed"
                  ? action.resultMessage ?? "Done"
                  : action.status === "cancelled"
                    ? "Cancelled — nothing was changed."
                    : action.status === "expired"
                      ? "This expired before it was approved — nothing was changed. Ask again if you still need it."
                      : action.status === "undone"
                        ? action.resultMessage ?? "Undone."
                        : `Not done: ${action.error ?? "something went wrong"}`}
              </span>
            </div>
            {action.error && action.status === "executed" ? <p className="mt-1 text-[13.5px] text-danger-fg">{action.error}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {action.status === "executed"
                ? action.links?.map((l) => (
                    <Button key={l.label} size="sm" variant="secondary" onClick={() => openLink(l)}>
                      {l.label}
                    </Button>
                  ))
                : null}
              {action.canUndo ? (
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("undo")}>
                  {busy === "undo" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Undo
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
