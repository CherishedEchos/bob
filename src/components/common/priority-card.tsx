"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Check, MessageSquareReply, PoundSterling, ReceiptText, Reply } from "lucide-react";
import type { PriorityItem } from "@/lib/derive";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

const ICON = { reply: Reply, followup: MessageSquareReply, quote: MessageSquareReply, deposit: PoundSterling, invoice: ReceiptText, task: AlarmClock };

/**
 * One priority with ONE obvious next step. "Chase" actions ask Bob to draft a
 * message (it then needs approval) — nothing is sent from here.
 */
export function PriorityCard({
  item,
  rank,
  onAskBob,
  onNavigate,
}: {
  item: PriorityItem;
  rank?: number;
  onAskBob: (text: string) => void;
  onNavigate?: () => void;
}) {
  const ui = useUI();
  const router = useRouter();
  const { actions } = useStore();
  const [busy, setBusy] = React.useState(false);
  const Icon = ICON[item.kind];

  const open = () => {
    if (item.kind === "reply" || item.kind === "followup") ui.openEnquiry(item.enquiryId);
    else if (item.kind === "quote" && item.enquiryId) ui.openEnquiry(item.enquiryId);
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
      ? { label: "Write reply", run: open }
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

  return (
    <div className="card-surface flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
      <button onClick={open} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-copper-500/12 text-accent-icon ring-1 ring-copper-500/25">
          <Icon className="size-5" />
          {rank ? (
            <span className="absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ink-800 text-[11px] font-bold text-white">{rank}</span>
          ) : null}
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
