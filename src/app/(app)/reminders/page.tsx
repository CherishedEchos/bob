"use client";

import * as React from "react";
import { AlarmClock, Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { Reminder } from "@/lib/types";
import { can } from "@/lib/auth/permissions";
import { cn, daysFromToday, formatDateKey } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

export default function RemindersPage() {
  const { data } = useStore();
  const ui = useUI();
  const open = data.reminders.filter((r) => !r.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const groups: [string, Reminder[]][] = [
    ["Overdue", open.filter((r) => daysFromToday(r.dueDate) < 0)],
    ["Today", open.filter((r) => daysFromToday(r.dueDate) === 0)],
    ["Coming up", open.filter((r) => daysFromToday(r.dueDate) > 0)],
    ["Done", data.reminders.filter((r) => r.done)],
  ];

  return (
    <>
      <PageHeader
        title="Reminders"
        subtitle={`${open.length} open`}
        actions={
          <Button onClick={() => ui.openForm({ form: "reminder" })}>
            <Plus /> New reminder
          </Button>
        }
      />
      {data.reminders.length === 0 ? (
        <EmptyState icon={AlarmClock} title="No reminders" body="Ask the assistant: “Remind me to call Dave tomorrow.”" />
      ) : (
        <div className="space-y-7">
          {groups.map(([title, items]) =>
            items.length ? (
              <section key={title}>
                <h2 className={cn("mb-2 text-[13px] font-semibold uppercase tracking-wider", title === "Overdue" ? "text-red-300" : "text-subtle")}>
                  {title} · {items.length}
                </h2>
                <ul className="card-surface divide-y divide-white/[0.06] rounded-2xl">
                  {items.map((r) => (
                    <ReminderRow key={r.id} r={r} />
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}
    </>
  );
}

function ReminderRow({ r }: { r: Reminder }) {
  const { data, actions, user } = useStore();
  const ui = useUI();
  const related =
    r.relatedType === "job" ? data.jobs.find((j) => j.id === r.relatedId) : r.relatedType === "enquiry" ? data.enquiries.find((e) => e.id === r.relatedId) : undefined;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button
        onClick={() => {
          const res = actions.toggleReminder(r.id);
          if (res.ok) toast(res.value.done ? "Marked as done" : "Reopened");
        }}
        aria-label={r.done ? `Reopen: ${r.title}` : `Mark done: ${r.title}`}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full ring-1.5 transition",
          r.done ? "bg-emerald-500/80 text-ink-950 ring-emerald-400" : "ring-white/25 hover:ring-copper-400",
        )}
        style={{ boxShadow: r.done ? undefined : "inset 0 0 0 1.5px rgb(255 255 255 / 0.25)" }}
      >
        {r.done ? <Check className="size-4" strokeWidth={3} /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("text-[15px]", r.done && "text-muted-foreground line-through")}>{r.title}</div>
        <div className="text-[12.5px] text-muted-foreground">
          <span className={cn(!r.done && daysFromToday(r.dueDate) < 0 && "text-red-300")}>{formatDateKey(r.dueDate)}</span>
          {related ? (
            <>
              {" · "}
              <button
                className="text-copper-300 hover:underline"
                onClick={() => (r.relatedType === "job" ? ui.openJob(related.id) : ui.openEnquiry(related.id))}
              >
                {related.customerName}
              </button>
            </>
          ) : null}
          {" · "}by {r.createdBy}
        </div>
      </div>
      {r.done ? (
        <Button size="icon-sm" variant="ghost" aria-label="Reopen" onClick={() => actions.toggleReminder(r.id)}>
          <RotateCcw />
        </Button>
      ) : null}
      {can(user.role, "records.delete") ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete reminder: ${r.title}`}
          onClick={() => {
            const res = actions.deleteReminder(r.id);
            if (res.ok) toast("Reminder deleted");
          }}
        >
          <Trash2 />
        </Button>
      ) : null}
    </li>
  );
}
