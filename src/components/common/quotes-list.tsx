"use client";

import * as React from "react";
import { FileText, Send } from "lucide-react";
import type { Quote } from "@/lib/types";
import { useStore } from "@/lib/store/store";
import { gbp, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";

const TONE = { draft: "neutral", sent: "blue", accepted: "green", declined: "red" } as const;
const LABEL = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined" } as const;

/** Quotes for a customer or enquiry. Drafts can be marked as sent once you've sent them yourself. */
export function QuotesList({ quotes }: { quotes: Quote[] }) {
  const { actions, can } = useStore();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!quotes.length) return null;
  const sorted = [...quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl bg-card ring-1 ring-line">
      {sorted.map((q) => (
        <li key={q.id} className="flex items-start gap-3 px-3.5 py-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-raised text-accent-icon ring-1 ring-line-strong">
            <FileText className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="t-name tabular">{gbp(q.amount)}</span>
              <Badge tone={TONE[q.status]}>{LABEL[q.status]}</Badge>
            </div>
            <p className="mt-0.5 text-[14px] text-foreground/85">{q.description}</p>
            <p className="mt-0.5 text-[12.5px] text-subtle">
              {q.status === "draft" ? `Drafted ${timeAgo(q.createdAt)} · not sent` : q.sentAt ? `Sent ${timeAgo(q.sentAt)}` : `Added ${timeAgo(q.createdAt)}`}
            </p>
            {q.status === "draft" && can("quotes.write") ? (
              <button
                type="button"
                disabled={busy === q.id}
                onClick={async () => {
                  setBusy(q.id);
                  const r = await actions.setQuoteStatus(q.id, "sent");
                  setBusy(null);
                  toast(r.ok ? "Marked as sent" : "Couldn't update the quote", r.ok ? "success" : "error");
                }}
                className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13.5px] font-medium text-accent-fg ring-1 ring-copper-500/40 hover:bg-copper-500/10 disabled:opacity-50"
              >
                <Send className="size-3.5" /> I&apos;ve sent it — mark as sent
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
