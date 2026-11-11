"use client";

import * as React from "react";
import { AlarmClock, Check, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { Task } from "@/lib/types";
import { addDaysKey, cn, daysFromToday, formatDateKey } from "@/lib/utils";
import { Card, EmptyState, PageHeader } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

export default function TasksPage() {
  const { data } = useStore();
  const ui = useUI();
  const open = data.tasks.filter((t) => !t.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const done = data.tasks.filter((t) => t.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")).slice(0, 10);
  const groups: [string, Task[]][] = [
    ["Overdue", open.filter((t) => daysFromToday(t.dueDate) < 0)],
    ["Today", open.filter((t) => daysFromToday(t.dueDate) === 0)],
    ["Coming up", open.filter((t) => daysFromToday(t.dueDate) > 0)],
  ];

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Reminders and follow-ups. Say “Bob, remind me to…” to add one hands-free."
        actions={
          <Button onClick={() => ui.openForm({ form: "reminder", dueDate: addDaysKey(1) })}>
            <Plus /> Add reminder
          </Button>
        }
      />
      {open.length === 0 ? <EmptyState icon={AlarmClock} title="Nothing to remind you about" body="You're all caught up." /> : null}
      <div className="space-y-6">
        {groups
          .filter(([, list]) => list.length)
          .map(([title, list]) => (
            <section key={title}>
              <h2 className={cn("mb-2 text-[13px] font-semibold uppercase tracking-wider", title === "Overdue" ? "text-red-300" : "text-subtle")}>{title}</h2>
              <Card className="divide-y divide-white/[0.05]">
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </Card>
            </section>
          ))}
        {done.length ? (
          <section>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-subtle">Recently done</h2>
            <Card className="divide-y divide-white/[0.05]">
              {done.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}

function TaskRow({ task: t }: { task: Task }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const customer = data.customers.find((c) => c.id === t.customerId);
  const assignee = data.members.find((m) => m.id === t.assignedUserId);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        aria-label={t.done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
        aria-pressed={t.done}
        onClick={async () => {
          const r = await actions.setTaskDone(t.id, !t.done);
          if (!r.ok) toast("Couldn't update", "error");
        }}
        className={cn("grid size-7 shrink-0 place-items-center rounded-full ring-1 transition", t.done ? "bg-emerald-500/80 text-ink-950 ring-emerald-400" : "ring-white/25 hover:ring-copper-400")}
      >
        {t.done ? <Check className="size-4" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("text-[14.5px]", t.done && "text-muted-foreground line-through")}>{t.title}</div>
        <div className="text-[12.5px] text-muted-foreground">
          {formatDateKey(t.dueDate)}
          {customer ? (
            <>
              {" · "}
              <button className="underline-offset-2 hover:underline" onClick={() => ui.openCustomer(customer.id)}>
                {customer.name}
              </button>
            </>
          ) : null}
          {assignee ? ` · for ${assignee.name}` : ""} · added by {t.createdBy}
        </div>
      </div>
      {t.relatedType === "job" && t.relatedId ? (
        <Button size="sm" variant="ghost" onClick={() => ui.openJob(t.relatedId!)}>
          Job
        </Button>
      ) : t.relatedType === "enquiry" && t.relatedId ? (
        <Button size="sm" variant="ghost" onClick={() => ui.openEnquiry(t.relatedId!)}>
          Enquiry
        </Button>
      ) : null}
      <button
        aria-label={`Delete ${t.title}`}
        onClick={async () => {
          const r = await actions.deleteTask(t.id);
          toast(r.ok ? "Reminder deleted" : "Couldn't delete", r.ok ? "success" : "error");
        }}
        className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-white/[0.06] hover:text-red-300"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
