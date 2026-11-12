"use client";

import * as React from "react";
import { AlarmClock, Check, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { Task } from "@/lib/types";
import { addDaysKey, cn, daysFromToday, formatDateKey } from "@/lib/utils";
import { EmptyState, ListPanel } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";

/** What needs doing and when, grouped by urgency. Details and controls live inside each task. */
export default function TasksPage() {
  const { data, can } = useStore();
  const ui = useUI();
  const open = data.tasks.filter((t) => !t.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const done = data.tasks.filter((t) => t.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")).slice(0, 10);
  const groups: [string, Task[]][] = [
    ["Overdue", open.filter((t) => daysFromToday(t.dueDate) < 0)],
    ["Today", open.filter((t) => daysFromToday(t.dueDate) === 0)],
    ["This week", open.filter((t) => daysFromToday(t.dueDate) > 0 && daysFromToday(t.dueDate) <= 7)],
    ["Later", open.filter((t) => daysFromToday(t.dueDate) > 7)],
  ];
  const [showDone, setShowDone] = React.useState(false);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Tasks</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">{open.length ? `${open.length} to do · say “Bob, remind me to…”` : "Nothing to do — say “Bob, remind me to…” to add one"}</p>
        </div>
        {can("tasks.write") ? (
          <button type="button" onClick={() => ui.openForm({ form: "reminder", dueDate: addDaysKey(1) })} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-raised px-4 text-[15px] font-semibold ring-1 ring-line-strong transition hover:bg-raised-hover">
            <Plus className="size-[18px]" /> Add
          </button>
        ) : null}
      </div>
      {open.length === 0 ? <EmptyState icon={AlarmClock} title="Nothing to remind you about" body="You're all caught up." /> : null}
      <div className="space-y-4">
        {groups
          .filter(([, list]) => list.length)
          .map(([title, list]) => (
            <ListPanel key={title} id={`tasks-${title}`} title={title} count={list.length} className={title === "Overdue" ? "[&_h2]:text-danger-fg" : undefined}>
              <ul className="divide-y divide-line">
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            </ListPanel>
          ))}
        {done.length ? (
          <section className="panel overflow-hidden">
            <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className="flex min-h-14 w-full items-center justify-between px-4 text-left lg:px-5">
              <span className="t-section">
                Recently done <span className="ml-1 text-[14px] font-normal text-subtle">{done.length}</span>
              </span>
              <ChevronRight className={cn("size-5 text-subtle transition", showDone && "rotate-90")} />
            </button>
            {showDone ? (
              <ul className="divide-y divide-line border-t border-line">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function when(t: Task) {
  const d = daysFromToday(t.dueDate);
  if (t.done) return `Done`;
  if (d < -1) return `${-d} days overdue`;
  if (d === -1) return "Yesterday";
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return formatDateKey(t.dueDate);
}

function TaskRow({ task: t }: { task: Task }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const [open, setOpen] = React.useState(false);
  const customer = data.customers.find((c) => c.id === t.customerId);
  const assignee = data.members.find((m) => m.id === t.assignedUserId);
  const overdue = !t.done && daysFromToday(t.dueDate) < 0;
  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3 lg:px-5">
        <button
          aria-label={t.done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
          aria-pressed={t.done}
          onClick={async () => {
            const r = await actions.setTaskDone(t.id, !t.done);
            if (!r.ok) toast("Couldn't update", "error");
          }}
          className="-m-2 grid size-11 shrink-0 place-items-center rounded-full"
        >
          <span className={cn("grid size-7 place-items-center rounded-full ring-1 transition", t.done ? "bg-emerald-500/80 text-ink-950 ring-emerald-400" : "ring-line-strong hover:ring-copper-400")}>
            {t.done ? <Check className="size-4" /> : null}
          </span>
        </button>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className={cn("block text-[15.5px] leading-snug", t.done && "text-muted-foreground line-through")}>{t.title}</span>
            <span className={cn("mt-0.5 block text-[13.5px]", overdue ? "font-medium text-danger-fg" : "text-muted-foreground")}>
              {when(t)}
              {customer ? ` · ${customer.name}` : ""}
            </span>
          </span>
          <ChevronRight className={cn("size-4 shrink-0 text-subtle transition", open && "rotate-90")} />
        </button>
      </div>
      {open ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 pl-[60px] pr-4 text-[14px] text-muted-foreground lg:pl-[64px]">
          <span>
            Due {formatDateKey(t.dueDate)}
            {assignee ? ` · for ${assignee.name}` : ""} · added by {t.createdBy}
          </span>
          {customer ? (
            <button className="h-10 font-medium text-accent-fg" onClick={() => ui.openCustomer(customer.id)}>
              Customer
            </button>
          ) : null}
          {t.relatedType === "job" && t.relatedId ? (
            <button className="h-10 font-medium text-accent-fg" onClick={() => ui.openJob(t.relatedId!)}>
              Open job
            </button>
          ) : t.relatedType === "enquiry" && t.relatedId ? (
            <button className="h-10 font-medium text-accent-fg" onClick={() => ui.openEnquiry(t.relatedId!)}>
              Open enquiry
            </button>
          ) : null}
          <button
            onClick={async () => {
              const r = await actions.deleteTask(t.id);
              toast(r.ok ? "Reminder deleted" : "Couldn't delete", r.ok ? "success" : "error");
            }}
            className="flex h-10 items-center gap-1.5 font-medium text-danger-fg"
          >
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}
