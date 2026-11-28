"use client";

/**
 * Home — the morning starting point. A personal greeting with Ask Bob and the
 * day's briefing, today's work, the business at a glance (each figure opens the
 * right list), the four everyday actions and what's coming up. Built from the
 * same data and permissions as the rest of the workspace.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, CalendarDays, CalendarOff, CalendarPlus, Check, CheckSquare, ChevronRight, ClipboardPlus, HardHat, Inbox, ListPlus, Mic, Package, Play, PoundSterling, Plus, UsersRound,
} from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { prime, stopSpeaking } from "@/lib/voice/speech-output";
import { addDays, formatTimeRange } from "@/lib/dates";
import { byStartTime, jobTown, liveAbsence } from "@/lib/diary";
import { bookingEndDate } from "@/lib/schedule";
import { invoiceBalance, isInvoiceOutstanding, isInvoiceOverdue, needsReply } from "@/lib/derive";
import type { Booking, Task } from "@/lib/types";
import { cn, daysFromToday, gbp, todayKey } from "@/lib/utils";
import { toast } from "@/components/ui/toaster";
import { PeopleStack, jobTone } from "@/components/common/people";
import { firstName } from "@/components/diary/shared";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const dayName = (d: string, today: string) => (d === addDays(today, 1) ? "Tomorrow" : new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" }));
const onDay = (b: Pick<Booking, "date" | "endDate">, d: string) => b.date <= d && bookingEndDate(b) >= d;

export default function HomePage() {
  const { data, can, user, org } = useStore();
  const ui = useUI();
  const bob = useBob();
  const router = useRouter();
  const today = todayKey();
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const people = new Map(data.people.map((p) => [p.id, p]));
  const manage = can("schedule.manage");
  const name = /^(owner|office|site team)$/i.test(user.name) ? "" : `, ${firstName(user.name)}`;

  // Today's work (or, on a quiet day, the next day with work booked).
  const todays = data.bookings.filter((b) => onDay(b, today)).sort(byStartTime);
  const nextDay = todays.length ? null : [1, 2, 3, 4, 5, 6, 7].map((n) => addDays(today, n)).find((d) => data.bookings.some((b) => onDay(b, d)));
  const shownDay = todays.length ? today : nextDay;
  const shown = shownDay ? data.bookings.filter((b) => onDay(b, shownDay)).sort(byStartTime) : [];

  // At a glance.
  const activeJobs = data.jobs.filter((j) => !["quoted", "completed", "lost"].includes(j.status));
  const inProgress = activeJobs.filter((j) => j.status === "in_progress" || j.status === "snagging").length;
  const waiting = data.enquiries.filter(needsReply);
  const openTasks = data.tasks.filter((t) => !t.done);
  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < today).length;
  const dueToday = openTasks.filter((t) => t.dueDate === today).length;
  const toOrder = data.materials.filter((m) => m.status === "to_order");
  const owed = data.invoices.filter(isInvoiceOutstanding).reduce((s, i) => s + invoiceBalance(i), 0);
  const overdue = data.invoices.filter(isInvoiceOverdue).reduce((s, i) => s + invoiceBalance(i), 0);
  const team = data.people.filter((p) => !p.archivedAt);
  const working = new Set(todays.flatMap((b) => b.personIds)).size;
  const offToday = data.absences.filter((a) => a.status === "approved" && a.startDate <= today && a.endDate >= today);

  // Coming up: the next few days (not today) and holidays.
  const nextDays = [1, 2, 3].map((n) => addDays(today, n)).map((d) => ({ d, list: data.bookings.filter((b) => onDay(b, d)).sort(byStartTime) }));
  const holidays = data.absences.filter((a) => liveAbsence(a) && a.endDate >= today && a.startDate <= addDays(today, 21)).sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 4);

  const openBooking = (b: Booking) => (manage ? ui.openForm({ form: "booking", bookingId: b.id }) : ui.openJob(b.jobId, { tab: "schedule" }));
  const hearBriefing = () => {
    prime();
    stopSpeaking();
    ui.setAssistantOpen(true);
    void bob.send("Hear today's briefing", "text", { speak: true });
  };
  const askBob = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) ui.setAssistantOpen(true);
    else router.push("/assistant?listen=1");
  };

  const tiles = [
    { key: "jobs", icon: HardHat, label: "Active jobs", value: String(activeJobs.length), sub: `${inProgress} in progress`, href: "/jobs", show: true },
    { key: "enq", icon: Inbox, label: "Enquiries", value: String(waiting.length), sub: waiting.length ? `${waiting.length === 1 ? "customer" : "customers"} waiting for a reply` : "Nobody waiting", href: "/enquiries", show: true, alert: waiting.length > 0 },
    { key: "tasks", icon: CheckSquare, label: "Team to-dos", value: String(openTasks.length), sub: [overdueTasks ? `${overdueTasks} overdue` : "", dueToday ? `${dueToday} due today` : ""].filter(Boolean).join(" · ") || "Nothing due today", href: "/tasks", show: true, alert: overdueTasks > 0 },
    { key: "mat", icon: Package, label: "Materials", value: String(toOrder.length), sub: toOrder.length ? `${toOrder.length === 1 ? "item" : "items"} to order` : "Nothing to order", href: "/materials?status=to_order", show: true },
    { key: "money", icon: PoundSterling, label: "Money owed", value: gbp(owed), sub: overdue ? `${gbp(overdue)} overdue` : "Nothing overdue", href: overdue ? "/invoices?filter=overdue" : "/invoices", show: can("finance.read"), alert: overdue > 0 },
    { key: "team", icon: UsersRound, label: "Team today", value: `${working}/${team.length}`, sub: offToday.length ? `${offToday.length} off — ${offToday.map((a) => firstName(people.get(a.personId)?.name)).join(", ")}` : "working · nobody off", href: "/week?view=team", show: can("schedule.read") },
  ].filter((t) => t.show);

  const quick = [
    can("jobs.write") ? { label: "Add job", icon: Plus, run: () => ui.openForm({ form: "job" }) } : null,
    manage ? { label: "Schedule work", icon: CalendarPlus, run: () => ui.openForm({ form: "booking", date: today }) } : null,
    { label: "Add task", icon: ListPlus, run: () => ui.openForm({ form: "reminder" }) },
    can("enquiries.write") ? { label: "Add enquiry", icon: ClipboardPlus, run: () => ui.openForm({ form: "enquiry" }) } : null,
  ].filter(Boolean) as { label: string; icon: typeof Plus; run: () => void }[];

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting: who, what day, and Bob */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[15.5px] font-medium text-subtle">{longDate(today)}</p>
          <h1 className="t-page mt-1">
            {greeting()}
            {name}.
          </h1>
          <p className="mt-1.5 text-[16px] text-muted-foreground">
            {todays.length ? `${todays.length} ${todays.length === 1 ? "job" : "jobs"} on today, ${working} ${working === 1 ? "person" : "people"} out on site.` : "Nothing booked today."}
            {waiting.length ? ` ${waiting.length} ${waiting.length === 1 ? "enquiry needs" : "enquiries need"} a reply.` : ""}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <button type="button" onClick={hearBriefing} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-card px-4 text-[15.5px] font-semibold text-foreground ring-1 ring-line-strong transition-colors hover:bg-raised-hover">
            <Play className="size-[18px] text-copper-600" aria-hidden /> <span className="sm:hidden">Hear briefing</span>
            <span className="hidden sm:inline">Hear today&apos;s briefing</span>
          </button>
          <button type="button" onClick={askBob} className="flex h-12 items-center justify-center gap-2.5 rounded-xl bg-[#1d1b19] pl-2 pr-5 text-[15.5px] font-semibold text-white shadow-[0_8px_20px_-10px_rgb(0_0_0/0.5)] transition-colors hover:bg-[#262320]">
            <span className="grid size-8 place-items-center rounded-full bg-copper-500 shadow-[0_0_0_3px_rgb(243_135_53/0.2)]">
              <Mic className="size-4" strokeWidth={2.2} aria-hidden />
            </span>
            Ask Bob
          </button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* Left column. With no to-dos, Today's work fills it, exactly as before the list existed. */}
        <div className="flex min-w-0 flex-col gap-6 [&>section:only-child]:flex-1">
          {/* Today's work */}
          <section aria-labelledby="today-h" className="panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <h2 id="today-h" className="t-section">
                {shownDay === today ? "Today's work" : shownDay ? `Next up: ${dayName(shownDay, today)}` : "Today's work"}
              </h2>
              <Link href="/week?view=team" className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[15px] font-semibold text-accent-fg hover:bg-copper-500/[0.08]">
                View diary <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            {shown.length ? (
              <ul className="divide-y divide-line">
                {shown.map((b) => {
                  const job = jobs.get(b.jobId);
                  const who = b.personIds.map((id) => people.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof people.get>>[];
                  const tone = jobTone(b.jobId);
                  return (
                    <li key={b.id}>
                      <button type="button" onClick={() => openBooking(b)} className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2 sm:px-6">
                        <span aria-hidden className={cn("h-12 w-1.5 shrink-0 rounded-full", who.length ? tone.bar : "bg-warning")} />
                        <span className="hidden w-[96px] shrink-0 text-[14.5px] font-semibold tabular text-heading sm:block">{formatTimeRange(b.startTime, b.endTime)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-semibold tabular text-subtle sm:hidden">{formatTimeRange(b.startTime, b.endTime)}</span>
                          <span className="block text-[16.5px] font-bold leading-snug text-heading">{job?.title ?? "Job"}</span>
                          <span className="block truncate text-[14.5px] text-muted-foreground">
                            {job?.customerName}
                            {jobTown(job) ? ` · ${jobTown(job)}` : ""}
                          </span>
                          <span className="mt-0.5 block truncate text-[14px] font-medium text-foreground/80 sm:hidden">{who.length ? who.map((p) => firstName(p.name)).join(", ") : <span className="text-warn-fg">Needs someone</span>}</span>
                        </span>
                        <span className="hidden min-w-0 items-center gap-2 sm:flex">
                          {who.length ? (
                            <>
                              <PeopleStack people={who} size={28} max={3} />
                              <span className="max-w-[150px] truncate text-[14.5px] text-foreground/80">{who.map((p) => firstName(p.name)).join(", ")}</span>
                            </>
                          ) : (
                            <span className="rounded-md bg-warning/15 px-2 py-1 text-[13.5px] font-semibold text-warn-fg">Needs someone</span>
                          )}
                        </span>
                        <ChevronRight className="size-5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <CalendarDays className="size-7 text-subtle" aria-hidden />
                <p className="text-[16px] font-semibold text-heading">Nothing booked this week</p>
                {manage ? (
                  <button type="button" onClick={() => ui.openForm({ form: "booking", date: today })} className="h-11 rounded-lg bg-primary px-5 text-[15.5px] font-semibold text-white">
                    Schedule work
                  </button>
                ) : null}
              </div>
            )}
          </section>

          {/* Your own overdue and due-today tasks; hidden when there are none */}
          <YourTodos />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {/* Your business at a glance: every figure opens the list behind it */}
          <section aria-labelledby="glance-h">
            <h2 id="glance-h" className="t-section mb-3">
              Your business at a glance
            </h2>
            <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-line [&>a]:bg-card">
              {tiles.map((t) => (
                <Link key={t.key} href={t.href} className="group flex min-h-[124px] flex-col px-4 py-4 transition-colors hover:bg-[#fffaf5] sm:px-5">
                  <span className="flex items-center gap-2 text-[14.5px] font-semibold text-muted-foreground">
                    <t.icon className={cn("size-[18px]", t.alert ? "text-copper-600" : "text-subtle")} aria-hidden /> {t.label}
                  </span>
                  <span className={cn("mt-1.5 text-[30px] font-bold leading-none tabular tracking-[-0.03em]", t.alert && t.key === "money" ? "text-danger-fg" : "text-heading")}>{t.value}</span>
                  <span className={cn("mt-1.5 line-clamp-2 text-[13.5px] leading-snug", t.alert ? "font-medium text-warn-fg" : "text-subtle")}>{t.sub}</span>
                </Link>
              ))}
            </div>
          </section>

          {/* The everyday actions */}
          {quick.length ? (
            <section aria-label="Quick actions" className="grid grid-cols-2 gap-2">
              {quick.map((q, i) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={q.run}
                  className={cn(
                    "flex h-14 items-center gap-2.5 rounded-xl px-4 text-left text-[15.5px] font-semibold transition-colors",
                    i === 0 ? "bg-primary text-white shadow-[0_1px_2px_rgb(180_82_15/0.25)] hover:bg-copper-600" : "bg-card text-foreground ring-1 ring-line-strong hover:bg-raised-hover",
                  )}
                >
                  <q.icon className={cn("size-5 shrink-0", i === 0 ? "text-white" : "text-copper-600")} aria-hidden /> {q.label}
                </button>
              ))}
            </section>
          ) : null}
        </div>
      </div>

      {/* Coming up: the next few days and holidays */}
      <section aria-labelledby="coming-h" className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <h2 id="coming-h" className="t-section">
            Coming up
          </h2>
          <Link href="/week?view=team" className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[15px] font-semibold text-accent-fg hover:bg-copper-500/[0.08]">
            Open diary <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="grid gap-px bg-line md:grid-cols-4 [&>div]:bg-card">
          {nextDays.map(({ d, list }) => (
            <div key={d} className="px-5 py-4">
              <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-subtle">{dayName(d, today)}</p>
              {list.length ? (
                <ul className="mt-2 space-y-2">
                  {list.slice(0, 4).map((b) => (
                    <li key={b.id}>
                      <button type="button" onClick={() => openBooking(b)} className="flex w-full items-start gap-2 text-left">
                        <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", b.personIds.length ? jobTone(b.jobId).dot : "bg-warning")} />
                        <span className="min-w-0 text-[15px] font-medium leading-snug text-heading hover:text-accent-fg">{jobs.get(b.jobId)?.title ?? "Job"}</span>
                      </button>
                    </li>
                  ))}
                  {list.length > 4 ? <li className="pl-4 text-[14px] text-subtle">+{list.length - 4} more</li> : null}
                </ul>
              ) : (
                <p className="mt-2 text-[15px] text-subtle">Nothing booked</p>
              )}
            </div>
          ))}
          <div className="px-5 py-4">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold uppercase tracking-[0.04em] text-subtle">
              <CalendarOff className="size-4" aria-hidden /> Holidays
            </p>
            {holidays.length ? (
              <ul className="mt-2 space-y-2">
                {holidays.map((a) => (
                  <li key={a.id} className="text-[15px] leading-snug">
                    <span className="font-semibold text-violet-800">{firstName(people.get(a.personId)?.name)}</span>{" "}
                    <span className="text-muted-foreground">
                      {new Date(`${a.startDate}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      {a.endDate !== a.startDate ? ` – ${new Date(`${a.endDate}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                      {a.status === "pending" ? " · requested" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[15px] text-subtle">Nobody off soon</p>
            )}
          </div>
        </div>
      </section>
      <p className="sr-only">{org.name}</p>
    </div>
  );
}

/** Tasks for the signed-in person: assigned to their login, or to their Team entry. */
function isMine(t: Task, userId: string, myPersonIds: Set<string>) {
  return t.assignedUserId === userId || (!!t.assignedPersonId && myPersonIds.has(t.assignedPersonId));
}

/**
 * "Your to-do list": up to three of the signed-in person's incomplete tasks that
 * are overdue (oldest first) or due today, each ticked off in one tap with the
 * same action as the Tasks page. Not shown at all when nothing is due.
 */
function YourTodos() {
  const { data, user, can, actions } = useStore();
  const [saving, setSaving] = React.useState<Set<string>>(() => new Set());
  const [failed, setFailed] = React.useState<Set<string>>(() => new Set());
  const myPersons = data.people.filter((p) => p.userId === user.id);
  const myPersonIds = new Set(myPersons.map((p) => p.id));
  const due = data.tasks
    .filter((t) => !t.done && isMine(t, user.id, myPersonIds) && daysFromToday(t.dueDate) <= 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 3);
  if (!due.length) return null;
  const write = can("tasks.write");
  const who = myPersons[0]?.id ?? user.id;
  const mark = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    set((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const complete = async (t: Task) => {
    mark(setFailed, t.id, false);
    mark(setSaving, t.id, true);
    const r = await actions.setTaskDone(t.id, true);
    mark(setSaving, t.id, false);
    // Once saved the store drops the task from the list and the next one moves up.
    if (r.ok) toast(`Done: ${t.title}`, "success");
    else mark(setFailed, t.id, true);
  };

  return (
    <section aria-labelledby="todo-h" className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
        <h2 id="todo-h" className="t-section">
          Your to-do list
        </h2>
        <Link href={`/tasks?who=${encodeURIComponent(who)}`} className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[15px] font-semibold text-subtle hover:bg-surface-2 hover:text-foreground">
          View all <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {due.map((t) => {
          const overdue = daysFromToday(t.dueDate) < 0;
          const busy = saving.has(t.id);
          const error = failed.has(t.id);
          return (
            <li key={t.id} className="flex items-start gap-3 px-5 py-1.5 sm:px-6">
              {write ? (
                <button
                  type="button"
                  aria-label={`Complete: ${t.title}`}
                  disabled={busy}
                  onClick={() => void complete(t)}
                  className="group -ml-2 grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-60"
                >
                  <span className={cn("grid size-6 place-items-center rounded-md ring-2 transition", busy ? "bg-emerald-600 text-white ring-emerald-600" : "bg-card text-transparent ring-[rgb(16_24_40/0.25)] group-hover:text-subtle group-hover:ring-emerald-600")}>
                    <Check className="size-4" strokeWidth={3} aria-hidden />
                  </span>
                </button>
              ) : null}
              <div className="min-w-0 flex-1 py-2.5">
                <p className="text-[16px] font-medium leading-snug text-heading">{t.title}</p>
                {/* On a phone the label sits under the title so the wording gets the full width. */}
                <p className={cn("mt-0.5 text-[14px] font-semibold sm:hidden", overdue ? "text-danger-fg" : "text-warn-fg")}>{overdue ? "Overdue" : "Due today"}</p>
                {error ? (
                  <p role="alert" className="mt-0.5 text-[14px] text-danger-fg">
                    Couldn&apos;t save.{" "}
                    <button type="button" onClick={() => void complete(t)} className="font-semibold underline underline-offset-2">
                      Try again
                    </button>
                  </p>
                ) : null}
              </div>
              <span className={cn("hidden shrink-0 py-2.5 text-[14px] font-semibold leading-snug sm:block", overdue ? "text-danger-fg" : "text-warn-fg")}>{overdue ? "Overdue" : "Due today"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
