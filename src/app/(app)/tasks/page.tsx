"use client";

import * as React from "react";
import { AlarmClock, Check, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { Task } from "@/lib/types";
import { addDaysKey, cn, daysFromToday, formatDateKey } from "@/lib/utils";
import { tasksDue } from "@/lib/derive";
import { EmptyState, ListPanel, pageActionClass } from "@/components/common/bits";
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
  const due = tasksDue(data.tasks).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Tasks</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">
            {open.length ? `${open.length} open · ${due} due today or overdue` : "Nothing to do — say “Bob, remind me to…” to add one"}
          </p>
        </div>
        {can("tasks.write") ? (
          <button type="button" onClick={() => ui.openForm({ form: "reminder", dueDate: addDaysKey(1) })} className={pageActionClass}>
            <Plus className="size-[18px]" aria-hidden /> Add task
          </button>
        ) : null}
      </div>
      {open.length && due !== open.length ? (
        <p className="-mt-2 mb-3 text-[13.5px] text-muted-foreground">The number beside Tasks in the menu counts only the {due} due today or overdue.</p>
      ) : null}
      {open.length === 0 ? <EmptyState icon={AlarmClock} title="No tasks to do" body="Add a task for yourself or someone in the team, or link it to a job." /> : null}
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
            <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className="flex min-h-14 w-full items-center justify-between px-4 text-left transition hover:bg-surface-2 lg:px-5">
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
  const [busy, setBusy] = React.useState(false);
  const customer = data.customers.find((c) => c.id === t.customerId);
  const person = t.assignedPersonId ? data.people.find((p) => p.id === t.assignedPersonId) : undefined;
  const job = t.relatedType === "job" && t.relatedId ? data.jobs.find((j) => j.id === t.relatedId) : undefined;
  const assignee = data.members.find((m) => m.id === t.assignedUserId);
  const overdue = !t.done && daysFromToday(t.dueDate) < 0;
  return (
    <li>
      <div className="row-open flex items-center gap-3 px-4 py-2.5 lg:px-5">
        {/* Completing is its own control, separate from opening the task. */}
        <button
          type="button"
          aria-label={t.done ? `Reopen: ${t.title}` : `Complete: ${t.title}`}
          aria-pressed={t.done}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await actions.setTaskDone(t.id, !t.done);
            setBusy(false);
            if (!r.ok) return toast("Couldn't update the task", "error");
            if (t.done) return toast("Task back on the list", "info");
            toast(`Done: ${t.title}`, "success", {
              action: {
                label: "Undo",
                run: () => void actions.setTaskDone(t.id, false).then((u) => toast(u.ok ? "Task back on the list" : "Couldn't undo", u.ok ? "info" : "error")),
              },
            });
          }}
          className="row-secondary group -m-1.5 grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-60"
        >
          <span
            className={cn(
              "grid size-7 place-items-center rounded-full ring-2 transition",
              t.done ? "bg-emerald-600 text-white ring-emerald-600" : "bg-card text-transparent ring-[rgb(16_24_40/0.25)] group-hover:text-subtle group-hover:ring-emerald-600",
            )}
          >
            <Check className="size-4" strokeWidth={3} aria-hidden />
          </span>
        </button>
        <button type="button" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} details: ${t.title}`} onClick={() => setOpen((o) => !o)} className="row-target flex min-w-0 flex-1 items-center gap-3 py-0.5 text-left after:absolute after:inset-0 after:content-['']">
          <span className="min-w-0 flex-1">
            <span className={cn("block text-[15.5px] font-medium leading-snug", t.done && "font-normal text-muted-foreground line-through")}>{t.title}</span>
            <span className="mt-0.5 flex flex-wrap gap-x-3 text-[14px] text-muted-foreground">
              <span className={cn(overdue && "font-semibold text-danger-fg", !t.done && daysFromToday(t.dueDate) === 0 && "font-semibold text-warn-fg")}>{when(t)}</span>
              <span>{person ? `For ${person.name}` : "Office"}</span>
              {job ? <span>{job.title} · {job.customerName}</span> : customer ? <span>{customer.name}</span> : null}
            </span>
          </span>
          <ChevronRight aria-hidden className={cn("row-chevron size-[18px] shrink-0", open && "rotate-90")} />
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
