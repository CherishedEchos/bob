"use client";

import { Check, Phone } from "lucide-react";
import type { PriorityItem } from "@/lib/derive";
import { cn } from "@/lib/utils";
import { usePriorityAction } from "@/components/common/priority-card";
import { SourceIcon } from "@/components/common/status";
import { ListRow, rowActionClass } from "@/components/common/bits";

/** One "Needs attention" item: opens the record; its button does exactly what it says. */
export function AttentionRow({ item, onAskBob }: { item: PriorityItem; onAskBob: (t: string) => void }) {
  const { open, action, busy, Icon } = usePriorityAction(item, onAskBob);
  const urgent = item.kind === "invoice" || (item.kind === "deposit" && item.title.includes("overdue"));
  const label = (
    <>
      {item.kind === "task" ? <Check className="size-4" aria-hidden /> : null}
      {action.href ? <Phone className="size-4" aria-hidden /> : null}
      <span className="sm:hidden">{action.short}</span>
      <span className="hidden sm:inline">{action.label}</span>
    </>
  );
  return (
    <ListRow
      onOpen={open}
      openLabel={`Open ${item.who}: ${item.why}`}
      leading={
        "source" in item ? (
          <SourceIcon source={item.source} provider={item.provider} />
        ) : (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", urgent ? "bg-red-500/10 text-danger-fg" : "bg-copper-500/10 text-accent-icon")}>
            <Icon className="size-[17px]" />
          </span>
        )
      }
      title={item.who}
      meta={item.why}
      action={
        action.href ? (
          <a href={action.href} aria-label={`${action.label} on ${item.kind === "reply" ? (item.callback?.phone ?? "") : ""}`} className={rowActionClass}>
            {label}
          </a>
        ) : (
          <button type="button" onClick={() => void action.run()} disabled={busy} aria-label={`${action.label}: ${item.who}`} className={rowActionClass}>
            {label}
          </button>
        )
      }
    />
  );
}

