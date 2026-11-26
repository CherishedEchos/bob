"use client";

/**
 * Team — employees and subcontractors in one planning list. People can be
 * booked before they have a login; inviting them gives them My work.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { HolidaysView, PersonLeave } from "@/components/team/leave";
import { Archive, CalendarDays, CalendarOff, CalendarPlus, Check, Copy, Link2, Mail, Pencil, Phone, Search, ShieldOff, UserPlus, Users } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays, formatDayShort, formatTimeRange, relativeDay, weekStart } from "@/lib/dates";
import { absencesOnDay } from "@/lib/leave";
import { PersonAvatar } from "@/components/common/people";
import { bookingEndDate, bookingsOnDay, initials } from "@/lib/schedule";
import type { Booking, Person, PersonAccess } from "@/lib/types";
import { cn, copyToClipboard, todayKey } from "@/lib/utils";
import { EmptyState, PageHeader, StatusText, Tabs, pageActionClass } from "@/components/common/bits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";

type Filter = "all" | "employee" | "subcontractor" | "archived";

const ACCESS_LABEL: Record<PersonAccess["state"], { label: string; tone: "neutral" | "amber" | "green" | "red" }> = {
  not_invited: { label: "Not invited", tone: "neutral" },
  pending: { label: "Invite pending", tone: "amber" },
  accepted: { label: "Has access", tone: "green" },
  expired: { label: "Invite expired", tone: "red" },
  revoked: { label: "Access removed", tone: "neutral" },
};

export default function TeamPage() {
  return (
    <React.Suspense>
      <TeamInner />
    </React.Suspense>
  );
}

function TeamInner() {
  const { data, can } = useStore();
  const ui = useUI();
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") === "holidays" ? "holidays" : "people";
  const pendingLeave = data.absences.filter((a) => a.status === "pending").length;
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const today = todayKey();
  const manage = can("team.manage");
  const q = query.trim().toLowerCase();
  const list = data.people.filter(
    (p) =>
      (filter === "archived" ? !!p.archivedAt : !p.archivedAt && (filter === "all" || p.kind === filter)) &&
      (!q || [p.name, p.company, p.trade].some((x) => x?.toLowerCase().includes(q))),
  );
  const access = new Map(data.access.map((a) => [a.personId, a]));
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));

  const week = Array.from({ length: 7 }, (_, k) => addDays(weekStart(today), k));
  const active = data.people.filter((p) => !p.archivedAt);
  const onSiteToday = active.filter((p) => bookingsOnDay(data.bookings.filter((b) => b.personIds.includes(p.id)), today).length).length;
  const offToday = active.filter((p) => absencesOnDay(data.absences.filter((x) => x.personId === p.id && x.status === "approved"), today).length).length;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Team"
        subtitle={
          <>
            {active.filter((p) => p.kind === "employee").length} employees · {active.filter((p) => p.kind === "subcontractor").length} subcontractors
          </>
        }
        actions={
          manage && view === "people" ? (
            <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "person" })}>
              <UserPlus className="size-[17px]" aria-hidden /> Add person
            </button>
          ) : null
        }
      />
      <Tabs
        label="Team sections"
        className="self-start"
        value={view}
        onChange={(v) => router.replace(v === "people" ? "/team" : "/team?view=holidays", { scroll: false })}
        options={[
          { value: "people", label: "People & availability" },
          { value: "holidays", label: "Holidays", count: pendingLeave || undefined, highlight: true },
        ]}
      />
      {view === "holidays" ? <HolidaysView /> : (
      <>
      <section aria-label="Today" className="panel grid grid-cols-3 overflow-hidden">
        {[
          { label: "On site today", value: onSiteToday, sub: `of ${active.length} people`, cls: "text-heading" },
          { label: "Off today", value: offToday, sub: "holiday or unavailable", cls: offToday ? "text-violet-800" : "text-subtle" },
          { label: "Free today", value: Math.max(0, active.length - onSiteToday - offToday), sub: "not booked", cls: "text-good-fg" },
        ].map((c, i) => (
          <div key={c.label} className={cn("px-4 py-3.5 sm:px-6", i && "border-l border-line")}>
            <div className="text-[12.5px] font-medium text-subtle">{c.label}</div>
            <div className={cn("t-figure-sm mt-0.5", c.cls)}>{c.value}</div>
            <div className="mt-0.5 truncate text-[12px] text-subtle">{c.sub}</div>
          </div>
        ))}
      </section>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-[360px]">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, company or trade" aria-label="Search team" className="pl-9" />
        </div>
        <Tabs
          label="Team filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "employee", label: "Staff" },
            { value: "subcontractor", label: "Subcontractors" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </div>
      {list.length ? (
        <>
        <TeamTable people={list} today={today} week={week} manage={manage} onOpen={setOpen} />
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">
          {list.map((p) => {
            const mine = data.bookings.filter((b) => b.personIds.includes(p.id));
            const todays = bookingsOnDay(mine, today);
            const a = access.get(p.id) ?? { personId: p.id, state: "not_invited" as const };
            const leave = data.absences.filter((x) => x.personId === p.id && ["approved", "pending"].includes(x.status));
            const nextLeave = leave.filter((x) => x.endDate >= today).sort((x, y) => x.startDate.localeCompare(y.startDate))[0];
            const jobIds = [...new Set(mine.filter((b) => bookingEndDate(b) >= today).map((b) => b.jobId))];
            const nextBk = mine.filter((b) => b.date > today).sort((x, y) => x.date.localeCompare(y.date))[0];
            const workDays = week.slice(0, 5).filter((d) => d >= today);
            const freeDays = workDays.filter((d) => !bookingsOnDay(mine, d).length && !absencesOnDay(leave.filter((x) => x.status === "approved"), d).length);
            return (
              <li key={p.id} className="relative flex flex-col rounded-2xl bg-card p-4 ring-1 ring-line sm:p-5">
                <div className="flex items-start gap-3">
                  <PersonAvatar person={p} size={44} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setOpen(p.id)} className="block w-full truncate text-left text-[15.5px] font-semibold tracking-[-0.01em] text-heading after:absolute after:inset-0 after:content-['']" aria-label={`Open ${p.name}`}>
                      {p.name}
                    </button>
                    <div className="truncate text-[13px] text-subtle">
                      {p.trade || (p.kind === "subcontractor" ? "Subcontractor" : "Employee")}
                      {p.company ? ` · ${p.company}` : ""}
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium", p.kind === "subcontractor" ? "border border-dashed border-black/20 text-muted-foreground" : "bg-surface-3 text-foreground/80")}>
                    {p.kind === "subcontractor" ? "Subcontractor" : "Employee"}
                  </span>
                </div>

                <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5 text-[13.5px]">
                  {todays.length ? (
                    <div className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-heading">Today:</span> {todays.map((b) => `${jobs.get(b.jobId)?.title ?? "Job"}${jobs.get(b.jobId)?.location ? `, ${jobs.get(b.jobId)?.location}` : ""}`).join(" · ")}
                      </span>
                    </div>
                  ) : absencesOnDay(leave.filter((x) => x.status === "approved"), today).length ? (
                    <div className="flex items-center gap-2 text-violet-800">
                      <CalendarOff className="size-3.5 shrink-0" aria-hidden /> Off today
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-subtle">
                      <span className="size-2 shrink-0 rounded-full bg-black/15" aria-hidden /> Free today
                    </div>
                  )}
                </div>

                {/* Plain facts instead of colour bars: next booking, free days, holiday */}
                <dl className="mt-3 space-y-1.5 text-[13.5px]">
                  <div className="flex gap-2">
                    <dt className="w-[92px] shrink-0 text-subtle">Next booking</dt>
                    <dd className="min-w-0 truncate text-heading">
                      {nextBk ? `${relativeDay(nextBk.date, today)} · ${jobs.get(nextBk.jobId)?.title ?? "Job"}${jobs.get(nextBk.jobId)?.location ? `, ${jobs.get(nextBk.jobId)?.location}` : ""}` : <span className="text-subtle">Nothing booked</span>}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-[92px] shrink-0 text-subtle">This week</dt>
                    <dd className="min-w-0 truncate text-heading">{workDays.length === 0 ? "Week finished" : freeDays.length === 0 ? "Fully booked" : freeDays.length === workDays.length ? "Free all week" : `Free ${freeDays.map((d) => formatDayShort(d).split(" ")[0]).join(", ")}`}</dd>
                  </div>
                  {nextLeave ? (
                    <div className="flex gap-2">
                      <dt className="w-[92px] shrink-0 text-subtle">Holiday</dt>
                      <dd className="min-w-0 truncate text-violet-800 dark:text-violet-300">
                        {formatDayShort(nextLeave.startDate)}
                        {nextLeave.endDate !== nextLeave.startDate ? ` – ${formatDayShort(nextLeave.endDate)}` : ""}
                        {nextLeave.status === "pending" ? " (requested)" : ""}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px] text-subtle">
                  <span>{jobIds.length ? `${jobIds.length} job${jobIds.length === 1 ? "" : "s"} booked` : "No upcoming work"} · tap to see their schedule</span>
                  {manage ? <StatusText tone={ACCESS_LABEL[a.state].tone} className="text-[12px]">{ACCESS_LABEL[a.state].label}</StatusText> : null}
                </div>
              </li>
            );
          })}
        </ul>
        </>
      ) : (
        <EmptyState
          icon={Users}
          title={filter === "archived" ? "No one archived" : q ? "No matches" : "No one in your team yet"}
          body={filter === "archived" || q ? undefined : "Add the people you book onto jobs — staff and subcontractors. They don't need a login to be scheduled."}
          action={manage && !q && filter !== "archived" ? <Button onClick={() => ui.openForm({ form: "person" })}><UserPlus /> Add person</Button> : undefined}
        />
      )}
      </>
      )}
      <PersonSheet personId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Desktop: one row per person — where they are today, what's next, free days and holiday. */
function TeamTable({ people, today, week, manage, onOpen }: { people: Person[]; today: string; week: string[]; manage: boolean; onOpen: (id: string) => void }) {
  const { data } = useStore();
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const access = new Map(data.access.map((a) => [a.personId, a]));
  const cols = manage ? "grid-cols-[minmax(0,1.5fr)_minmax(0,1.8fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_120px]" : "grid-cols-[minmax(0,1.5fr)_minmax(0,1.8fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)]";
  const head = "text-[12px] font-medium text-subtle";
  const where = (jobId: string) => `${jobs.get(jobId)?.title ?? "Job"}${jobs.get(jobId)?.location ? `, ${jobs.get(jobId)?.location}` : ""}`;
  return (
    <div className="panel hidden overflow-hidden xl:block">
      <div className={cn("grid items-center gap-4 border-b border-line bg-[#faf9f6] px-5 py-2", cols)}>
        <span className={head}>Person</span>
        <span className={head}>Today</span>
        <span className={head}>Next booking</span>
        <span className={head}>This week</span>
        <span className={head}>Holiday</span>
        {manage ? <span className={head}>Bob access</span> : null}
      </div>
      <ul className="divide-y divide-line">
        {people.map((p) => {
          const mine = data.bookings.filter((b) => b.personIds.includes(p.id));
          const todays = bookingsOnDay(mine, today);
          const leave = data.absences.filter((x) => x.personId === p.id && ["approved", "pending"].includes(x.status));
          const off = absencesOnDay(leave.filter((x) => x.status === "approved"), today).length > 0;
          const nextLeave = leave.filter((x) => x.endDate >= today).sort((x, y) => x.startDate.localeCompare(y.startDate))[0];
          const nextBk = mine.filter((b) => b.date > today).sort((x, y) => x.date.localeCompare(y.date))[0];
          const workDays = week.slice(0, 5).filter((d) => d >= today);
          const freeDays = workDays.filter((d) => !bookingsOnDay(mine, d).length && !absencesOnDay(leave.filter((x) => x.status === "approved"), d).length);
          const a = access.get(p.id) ?? { personId: p.id, state: "not_invited" as const };
          return (
            <li key={p.id} className={cn("row-open grid items-center gap-4 px-5 py-3", cols)}>
              <button type="button" onClick={() => onOpen(p.id)} aria-label={`Open ${p.name}`} className="row-target flex min-w-0 items-center gap-3 text-left after:absolute after:inset-0 after:content-['']">
                <PersonAvatar person={p} size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-heading">{p.name}</span>
                  <span className="block truncate text-[12.5px] text-subtle">
                    {p.trade || (p.kind === "subcontractor" ? "Subcontractor" : "Employee")}
                    {p.company ? ` · ${p.company}` : ""}
                  </span>
                </span>
              </button>
              <span className="flex min-w-0 items-center gap-2 text-[13.5px]">
                {todays.length ? (
                  <>
                    <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                    <span className="truncate text-heading" title={todays.map((b) => where(b.jobId)).join(" · ")}>{todays.map((b) => where(b.jobId)).join(" · ")}</span>
                  </>
                ) : off ? (
                  <span className="flex items-center gap-1.5 text-violet-800">
                    <CalendarOff className="size-3.5" aria-hidden /> Off today
                  </span>
                ) : (
                  <span className="text-subtle">Free today</span>
                )}
              </span>
              <span className="min-w-0 truncate text-[13.5px] text-heading">{nextBk ? `${relativeDay(nextBk.date, today)} · ${where(nextBk.jobId)}` : <span className="text-subtle">Nothing booked</span>}</span>
              <span className={cn("min-w-0 truncate text-[13.5px]", freeDays.length ? "text-good-fg" : "text-muted-foreground")}>
                {workDays.length === 0 ? "Week finished" : freeDays.length === 0 ? "Fully booked" : freeDays.length === workDays.length ? "Free all week" : `Free ${freeDays.map((d) => formatDayShort(d).split(" ")[0]).join(", ")}`}
              </span>
              <span className="min-w-0 truncate text-[13.5px] text-violet-800">
                {nextLeave ? (
                  <>
                    {formatDayShort(nextLeave.startDate)}
                    {nextLeave.endDate !== nextLeave.startDate ? ` – ${formatDayShort(nextLeave.endDate)}` : ""}
                    {nextLeave.status === "pending" ? <span className="text-subtle"> · requested</span> : null}
                  </>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </span>
              {manage ? <StatusText tone={ACCESS_LABEL[a.state].tone} className="text-[12.5px]">{ACCESS_LABEL[a.state].label}</StatusText> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Avatar({ person }: { person: Person }) {
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold", person.kind === "subcontractor" ? "bg-sky-500/10 text-info-fg" : "bg-selected text-accent-fg")}>
      {initials(person.name)}
    </span>
  );
}

const a_role = (a?: PersonAccess) => (a?.state === "accepted" ? a.role : undefined);

function PersonSheet({ personId, onClose }: { personId: string | null; onClose: () => void }) {
  const { data, can, actions } = useStore();
  const ui = useUI();
  const p = data.people.find((x) => x.id === personId);
  const [link, setLink] = React.useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"revoke" | "archive" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteRole, setInviteRole] = React.useState<"worker" | "office">("worker");
  React.useEffect(() => {
    setInviteRole("worker");
    setLink(null);
    setConfirm(null);
    setError(null);
  }, [personId]);
  if (!p) return null;
  const manage = can("team.manage");
  const today = todayKey();
  const a = data.access.find((x) => x.personId === p.id) ?? { personId: p.id, state: "not_invited" as const };
  // Only the owner holds settings.manage, and only the owner can make or remove admins.
  const isOwner = can("settings.manage");
  const admin = a_role(a);
  const theirs = data.bookings.filter((b) => b.personIds.includes(p.id));
  const upcoming = theirs.filter((b) => bookingEndDate(b) >= today).sort((x, y) => x.date.localeCompare(y.date));
  const past = theirs.filter((b) => bookingEndDate(b) < today).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 5);
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));

  const invite = async () => {
    setError(null);
    const r = await actions.run<{ path: string; expiresAt: string }>("createInvite", { personId: p.id, role: inviteRole });
    if (!r.ok) return setError(r.errors._ || "Couldn't create the invite");
    setLink({ url: `${window.location.origin}${r.value.path}`, expiresAt: r.value.expiresAt });
    toast(`Invite link ready for ${p.name}`);
  };
  const copy = async () => {
    if (!link) return;
    const ok = await copyToClipboard(link.url);
    if (!ok) return toast("Couldn't copy — select the link and copy it", "error");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const BookingLine = ({ b }: { b: Booking }) => {
    const j = jobs.get(b.jobId);
    return (
      <li>
        <button type="button" onClick={() => (can("schedule.manage") ? ui.openForm({ form: "booking", bookingId: b.id }) : j && ui.openJob(j.id, { tab: "schedule" }))} className="flex w-full items-center justify-between gap-3 rounded-lg py-2.5 text-left hover:bg-surface-2">
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium">{j ? `${j.title} · ${j.customerName}` : "Job"}</span>
            <span className="block text-[13.5px] text-muted-foreground">
              {relativeDay(b.date, today)}
              {b.endDate ? ` – ${formatDayShort(b.endDate)}` : ""} · {formatTimeRange(b.startTime, b.endTime)} · {j?.location}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <Sheet open={!!personId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={`Team: ${p.name}`}>
        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6 sm:px-6">
          <div className="flex items-center gap-3 pr-12">
            <Avatar person={p} />
            <div className="min-w-0">
              <h2 className="text-[22px] font-bold leading-tight tracking-tight">{p.name}</h2>
              <p className="text-[15px] text-muted-foreground">
                {p.kind === "subcontractor" ? "Subcontractor" : "Employee"}
                {p.trade ? ` · ${p.trade}` : ""}
                {p.company ? ` · ${p.company}` : ""}
              </p>
            </div>
          </div>
          {p.archivedAt ? <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[14.5px] text-muted-foreground">Archived — kept for history. They can&apos;t be booked or sign in.</p> : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {p.phone ? (
              <Button asChild size="sm" variant="secondary">
                <a href={`tel:${p.phone.replace(/\s/g, "")}`}>
                  <Phone /> Call
                </a>
              </Button>
            ) : null}
            {p.email ? (
              <Button asChild size="sm" variant="secondary">
                <a href={`mailto:${p.email}`}>
                  <Mail /> Email
                </a>
              </Button>
            ) : null}
            {can("schedule.manage") && !p.archivedAt ? (
              <Button size="sm" onClick={() => ui.openForm({ form: "booking", personIds: [p.id] })}>
                <CalendarPlus /> Schedule work
              </Button>
            ) : null}
            <Button asChild size="sm" variant="secondary">
              <Link href={`/week?person=${p.id}`} onClick={onClose}>
                <CalendarDays /> Their schedule
              </Link>
            </Button>
          </div>
          <dl className="mt-3 space-y-0.5 text-[14.5px] text-muted-foreground">
            {p.phone ? <div>Mobile: <span className="text-foreground">{p.phone}</span></div> : null}
            {p.email ? <div>Email: <span className="break-all text-foreground">{p.email}</span></div> : null}
          </dl>

          <section className="mt-6">
            <h3 className="t-eyebrow">Booked</h3>
            {upcoming.length ? <ul className="mt-1 divide-y divide-line">{upcoming.map((b) => <BookingLine key={b.id} b={b} />)}</ul> : <p className="mt-2 text-[15px] text-muted-foreground">No work scheduled.</p>}
          </section>
          <PersonLeave person={p} />
          {past.length ? (
            <section className="mt-5">
              <h3 className="t-eyebrow">Recent work</h3>
              <ul className="mt-1 divide-y divide-line">{past.map((b) => <BookingLine key={b.id} b={b} />)}</ul>
            </section>
          ) : null}

          {manage ? (
            <section className="mt-6 rounded-2xl bg-card p-4 ring-1 ring-line">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[15.5px] font-semibold">Access to Bob</h3>
                <StatusText tone={ACCESS_LABEL[a.state].tone}>{ACCESS_LABEL[a.state].label}</StatusText>
              </div>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {a.state === "accepted" && admin === "owner"
                  ? "Owner: full access, including Settings and connected accounts."
                  : a.state === "accepted" && admin === "office"
                    ? "Admin: Diary, Jobs, Team, Enquiries, Customers, Materials, Merchants, Tasks and Money. Can schedule work and invite staff. Can't change Settings or connected accounts."
                    : a.state === "accepted"
                      ? "They sign in to My work: only the jobs they're booked on, the site details and their tasks. No prices, customers list or the wider schedule."
                      : a.state === "pending" && a.role === "office"
                        ? "Admin invite sent. Once accepted they'll see the whole business, except Settings and connected accounts."
                        : "Invite them to see their own bookings, site addresses and instructions on their phone. They can be booked without it."}
              </p>
              {isOwner && !p.archivedAt && a.state !== "accepted" && !link ? (
                <fieldset className="mt-3">
                  <legend className="text-[13.5px] font-semibold">Access when they accept</legend>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {([
                      ["worker", "My work only", "Their own bookings, site details and tasks"],
                      ["office", "Admin", "The whole business, except Settings"],
                    ] as const).map(([value, label, hint]) => (
                      <label key={value} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1", inviteRole === value ? "bg-selected ring-accent/40" : "ring-line hover:bg-surface-2")}>
                        <input type="radio" name="invite-role" value={value} checked={inviteRole === value} onChange={() => setInviteRole(value)} className="mt-1 accent-[var(--color-accent)]" />
                        <span>
                          <span className="block text-[14.5px] font-medium">{label}</span>
                          <span className="block text-[13px] text-muted-foreground">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {error ? (
                <p role="alert" className="mt-2 text-[14px] text-danger-fg">
                  {error}
                </p>
              ) : null}
              {link ? (
                <div className="mt-3 rounded-xl bg-message p-3">
                  <label htmlFor="invite-link" className="text-[13.5px] font-semibold">
                    Invite link for {a.email ?? p.email}
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <Input id="invite-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="h-11 text-[14px]" />
                    <Button size="sm" onClick={() => void copy()}>
                      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Bob doesn&apos;t email this — send it by text, WhatsApp or email. It works once, only for {a.email ?? p.email}, and expires {formatDayShort(link.expiresAt.slice(0, 10))}. Save it now: it isn&apos;t shown again.
                  </p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {!p.archivedAt && a.state !== "accepted" ? (
                  <Button size="sm" variant={a.state === "pending" ? "secondary" : "default"} onClick={() => void invite()}>
                    <Link2 /> {a.state === "pending" ? "New invite link" : a.state === "not_invited" ? "Invite to Bob" : "Invite again"}
                  </Button>
                ) : null}
                {a.state === "pending" && a.inviteId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const r = await actions.run("revokeInvite", { inviteId: a.inviteId });
                      setLink(null);
                      toast(r.ok ? "Invite cancelled — the link no longer works" : r.errors._ || "Couldn't cancel", r.ok ? "success" : "error");
                    }}
                  >
                    Cancel invite
                  </Button>
                ) : null}
                {a.state === "accepted" && confirm !== "revoke" && admin !== "owner" && (admin !== "office" || isOwner) ? (
                  <Button size="sm" variant="ghost" className="text-danger-fg" onClick={() => setConfirm("revoke")}>
                    <ShieldOff /> Remove access
                  </Button>
                ) : null}
              </div>
              {confirm === "revoke" ? (
                <ConfirmBox
                  text={`${p.name} will be signed out and can't see any jobs. Their bookings and history stay.`}
                  action="Remove access"
                  onCancel={() => setConfirm(null)}
                  onConfirm={async () => {
                    const r = await actions.run("revokeAccess", { personId: p.id });
                    setConfirm(null);
                    toast(r.ok ? `${p.name}'s access removed` : r.errors._ || "Couldn't remove access", r.ok ? "success" : "error");
                  }}
                />
              ) : null}
            </section>
          ) : null}

          {manage ? (
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              <Button size="sm" variant="secondary" onClick={() => ui.openForm({ form: "person", personId: p.id })}>
                <Pencil /> Edit details
              </Button>
              {p.archivedAt ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const r = await actions.run("archivePerson", { id: p.id, archived: false });
                    toast(r.ok ? `${p.name} restored` : "Couldn't restore", r.ok ? "success" : "error");
                  }}
                >
                  Restore
                </Button>
              ) : confirm !== "archive" ? (
                <Button size="sm" variant="ghost" onClick={() => setConfirm("archive")}>
                  <Archive /> Archive
                </Button>
              ) : null}
            </div>
          ) : null}
          {confirm === "archive" ? (
            <ConfirmBox
              text={`Archive ${p.name}? They drop off the planner and lose any access. Past bookings stay, and you can restore them later.${upcoming.length ? ` They still have ${upcoming.length} upcoming ${upcoming.length === 1 ? "booking" : "bookings"} — reassign ${upcoming.length === 1 ? "it" : "them"} first.` : ""}`}
              action="Archive"
              onCancel={() => setConfirm(null)}
              onConfirm={async () => {
                const r = await actions.run("archivePerson", { id: p.id });
                setConfirm(null);
                toast(r.ok ? `${p.name} archived` : "Couldn't archive", r.ok ? "success" : "error");
              }}
            />
          ) : null}
          <p className="mt-6 text-[12.5px] text-subtle">Added {formatDayShort(p.createdAt.slice(0, 10))}. Next 7 days: {upcoming.filter((b) => b.date <= addDays(today, 7)).length} bookings.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ConfirmBox({ text, action, onCancel, onConfirm }: { text: string; action: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="mt-3 rounded-xl bg-red-500/[0.06] p-3 ring-1 ring-red-500/25">
      <p className="text-[14.5px]">{text}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Keep
        </Button>
        <Button size="sm" variant="destructive" onClick={onConfirm}>
          {action}
        </Button>
      </div>
    </div>
  );
}
