"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Check, ChevronRight, MessageSquareReply, PoundSterling, ReceiptText, Reply } from "lucide-react";
import type { PriorityItem } from "@/lib/derive";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

const ICON = { reply: Reply, followup: MessageSquareReply, quote: MessageSquareReply, deposit: PoundSterling, invoice: ReceiptText, task: AlarmClock };

/**
 * The single next step for a priority. "Chase" steps ask Bob to draft a
 * message (which then needs approval) — nothing is sent from here.
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
    } else {
      router.push("/tasks");
      onNavigate?.();
    }
  };

  const action: { label: string; run: () => void | Promise<void> } =
    item.kind === "reply"
      ? { label: "Draft reply", run: open }
      : item.kind === "followup"
        ? { label: "Follow up", run: open }
        : item.kind === "quote"
          ? { label: "Chase quote", run: () => onAskBob(`Draft a follow-up to ${item.customerName}`) }
          : item.kind === "deposit"
            ? { label: "Chase deposit", run: () => onAskBob(`Draft a follow-up to ${item.customerName}`) }
            : item.kind === "invoice"
              ? { label: "View invoice", run: open }
              : {
                  label: "Mark done",
                  run: async () => {
                    setBusy(true);
                    const r = await actions.setTaskDone(item.taskId, true);
                    setBusy(false);
                    toast(r.ok ? "Done — reminder cleared" : "Couldn't update", r.ok ? "success" : "error");
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
        <span className="sm:hidden">{action.label.split(" ")[0]}</span>
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
      <Button onClick={() => void action.run()} disabled={busy} className={cn("w-full sm:w-auto")} variant={item.kind === "task" ? "secondary" : "default"}>
        {item.kind === "task" ? <Check /> : null}
        {action.label}
      </Button>
    </div>
  );
}
