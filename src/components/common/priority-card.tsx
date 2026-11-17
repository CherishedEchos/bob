"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Check, ChevronRight, Landmark, MessageSquareReply, Package, PoundSterling, ReceiptText, Reply } from "lucide-react";
import type { PriorityItem } from "@/lib/derive";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

const ICON = { reply: Reply, followup: MessageSquareReply, quote: MessageSquareReply, deposit: PoundSterling, invoice: ReceiptText, task: AlarmClock, bill: Landmark, materials: Package };

/**
 * The single next step for a priority, labelled for what it actually does:
 *  - Review draft: opens the enquiry at Bob's draft reply.
 *  - Call <name>: a phone link (they asked for a call back).
 *  - Draft follow-up / Draft deposit reminder: asks Bob to prepare a message
 *    for you to review — nothing is sent from here.
 *  - View invoice / Mark done (with Undo).
 */
export function usePriorityAction(item: PriorityItem, onAskBob: (text: string) => void, onNavigate?: () => void) {
  const ui = useUI();
  const router = useRouter();
  const { actions } = useStore();
  const [busy, setBusy] = React.useState(false);

  const open = () => {
    if (item.kind === "reply" || item.kind === "followup") ui.openEnquiry(item.enquiryId, { focus: "reply" });
    else if (item.kind === "quote" && item.enquiryId) ui.openEnquiry(item.enquiryId, { focus: "reply" });
    else if (item.kind === "deposit") ui.openJob(item.jobId);
    else if (item.kind === "invoice") {
      router.push(`/invoices?open=${item.invoiceId}`);
      onNavigate?.();
    } else if (item.kind === "bill") {
      router.push("/invoices?view=bills");
      onNavigate?.();
    } else if (item.kind === "materials") ui.openJob(item.jobId, { tab: "materials" });
    else {
      router.push("/tasks");
      onNavigate?.();
    }
  };

  const action: { label: string; short: string; run: () => void | Promise<void>; href?: string } =
    item.kind === "reply" && item.callback
      ? { label: `Call ${item.callback.firstName}`, short: "Call", href: `tel:${item.callback.phone.replace(/\s/g, "")}`, run: () => undefined }
      : item.kind === "reply"
        ? { label: "Review draft", short: "Review", run: open }
        : item.kind === "followup"
          ? { label: "Draft follow-up", short: "Follow up", run: () => onAskBob(`Draft a follow-up to ${item.who}`) }
          : item.kind === "quote"
            ? { label: "Draft follow-up", short: "Follow up", run: () => onAskBob(`Draft a follow-up to ${item.customerName}`) }
            : item.kind === "deposit"
              ? { label: "Draft deposit reminder", short: "Reminder", run: () => onAskBob(`Draft a follow-up to ${item.customerName}`) }
              : item.kind === "invoice"
                ? { label: "View invoice", short: "View", run: open }
                : item.kind === "bill"
                  ? { label: "Review bill", short: "Review", run: open }
                  : item.kind === "materials"
                    ? { label: "Order materials", short: "Order", run: open }
                : {
                    label: "Mark done",
                    short: "Done",
                    run: async () => {
                      setBusy(true);
                      const r = await actions.setTaskDone(item.taskId, true);
                      setBusy(false);
                      if (!r.ok) return toast("Couldn't update the reminder", "error");
                      toast("Reminder done", "success", {
                        action: {
                          label: "Undo",
                          run: () =>
                            void actions.setTaskDone(item.taskId, false).then((u) => toast(u.ok ? "Reminder back on the list" : "Couldn't undo", u.ok ? "info" : "error")),
                        },
                      });
                    },
                  };
  return { open, action, busy, Icon: ICON[item.kind] };
}

/** Divided-list row (Today). */
export function PriorityRow({ item, onAskBob, onNavigate }: { item: PriorityItem; onAskBob: (text: string) => void; onNavigate?: () => void }) {
  const { open, action, busy, Icon } = usePriorityAction(item, onAskBob, onNavigate);
  return (
    <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <button onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-copper-500/12 text-accent-icon ring-1 ring-copper-500/25">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold leading-snug">{item.title}</span>
          <span className="mt-0.5 block text-[14.5px] leading-snug text-muted-foreground">{item.detail}</span>
        </span>
      </button>
      <button
        onClick={() => void action.run()}
        disabled={busy}
        className="flex h-11 shrink-0 items-center gap-1 rounded-lg px-3 text-[14.5px] font-medium text-accent-fg ring-1 ring-copper-500/35 transition hover:bg-copper-500/12 disabled:opacity-50"
      >
        {item.kind === "task" ? <Check className="size-4" /> : null}
        <span className="hidden sm:inline">{action.label}</span>
        <span className="sm:hidden">{action.short}</span>
        {item.kind !== "task" ? <ChevronRight className="size-4" /> : null}
      </button>
    </div>
  );
}

/** Card version (Ask Bob home). */
export function PriorityCard({ item, onAskBob, onNavigate }: { item: PriorityItem; rank?: number; onAskBob: (text: string) => void; onNavigate?: () => void }) {
  const { open, action, busy, Icon } = usePriorityAction(item, onAskBob, onNavigate);
  return (
    <div className="card-surface flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
      <button onClick={open} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-copper-500/12 text-accent-icon ring-1 ring-copper-500/25">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[17px] font-semibold leading-snug">{item.title}</span>
          <span className="mt-0.5 block text-[15px] leading-snug text-muted-foreground">{item.detail}</span>
        </span>
      </button>
      {action.href ? (
        <Button asChild className="w-full sm:w-auto">
          <a href={action.href}>{action.label}</a>
        </Button>
      ) : (
        <Button onClick={() => void action.run()} disabled={busy} className={cn("w-full sm:w-auto")} variant={item.kind === "task" ? "secondary" : "default"}>
          {item.kind === "task" ? <Check /> : null}
          {action.label}
        </Button>
      )}
    </div>
  );
}
