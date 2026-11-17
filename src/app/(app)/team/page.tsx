"use client";

/**
 * Team — employees and subcontractors in one planning list. People can be
 * booked before they have a login; inviting them gives them My work.
 */
import * as React from "react";
import Link from "next/link";
import { Archive, CalendarDays, CalendarPlus, Check, Copy, Link2, Mail, Pencil, Phone, Search, ShieldOff, UserPlus, Users } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays, formatDayShort, formatTimeRange, relativeDay } from "@/lib/dates";
import { bookingEndDate, bookingsOnDay, initials } from "@/lib/schedule";
import type { Booking, Person, PersonAccess } from "@/lib/types";
import { cn, copyToClipboard, todayKey } from "@/lib/utils";
import { EmptyState, ListRow, StatusText, Tabs, pageActionClass } from "@/components/common/bits";
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
  const { data, can } = useStore();
  const ui = useUI();
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

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Team</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">
            {data.people.filter((p) => !p.archivedAt && p.kind === "employee").length} employees · {data.people.filter((p) => !p.archivedAt && p.kind === "subcontractor").length} subcontractors
          </p>
        </div>
        {manage ? (
          <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "person" })}>
            <UserPlus className="size-[18px]" aria-hidden /> Add person
          </button>
        ) : null}
      </div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, company or trade" aria-label="Search team" className="pl-10" />
        </div>
        <Tabs
          label="Team filter"
          className="sm:max-w-md"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "employee", label: "Staff" },
            { value: "subcontractor", label: "Subs" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </div>
      {list.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {list.map((p) => {
            const todays = bookingsOnDay(data.bookings.filter((b) => b.personIds.includes(p.id)), today);
            const a = access.get(p.id) ?? { personId: p.id, state: "not_invited" as const };
            return (
              <ListRow
                key={p.id}
                onOpen={() => setOpen(p.id)}
                openLabel={`Open ${p.name}`}
                leading={<Avatar person={p} />}
                title={p.name}
                aside={manage ? <StatusText tone={ACCESS_LABEL[a.state].tone}>{ACCESS_LABEL[a.state].label}</StatusText> : undefined}
                meta={
                  <>
                    <span className="block truncate">
                      {p.kind === "subcontractor" ? "Subcontractor" : "Employee"}
                      {p.trade ? ` · ${p.trade}` : ""}
                      {p.company ? ` · ${p.company}` : ""}
                    </span>
                    <span className="mt-0.5 block text-[14px]">
                      {todays.length ? (
                        <>
                          <span className="font-semibold text-foreground">Scheduled today:</span>{" "}
                          {todays.map((b) => `${jobs.get(b.jobId)?.title ?? "Job"} ${formatTimeRange(b.startTime, b.endTime)}`).join(" · ")}
                        </>
                      ) : (
                        <span className="text-muted-foreground">No work scheduled today</span>
                      )}
                    </span>
                  </>
                }
              />
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Users}
          title={filter === "archived" ? "No one archived" : q ? "No matches" : "No one in your team yet"}
          body={filter === "archived" || q ? undefined : "Add the people you book onto jobs — staff and subcontractors. They don't need a login to be scheduled."}
          action={manage && !q && filter !== "archived" ? <Button onClick={() => ui.openForm({ form: "person" })}><UserPlus /> Add person</Button> : undefined}
        />
      )}
      <PersonSheet personId={open} onClose={() => setOpen(null)} />
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

function PersonSheet({ personId, onClose }: { personId: string | null; onClose: () => void }) {
  const { data, can, actions } = useStore();
  const ui = useUI();
  const p = data.people.find((x) => x.id === personId);
  const [link, setLink] = React.useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"revoke" | "archive" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setLink(null);
    setConfirm(null);
    setError(null);
  }, [personId]);
  if (!p) return null;
  const manage = can("team.manage");
  const today = todayKey();
  const a = data.access.find((x) => x.personId === p.id) ?? { personId: p.id, state: "not_invited" as const };
  const theirs = data.bookings.filter((b) => b.personIds.includes(p.id));
  const upcoming = theirs.filter((b) => bookingEndDate(b) >= today).sort((x, y) => x.date.localeCompare(y.date));
  const past = theirs.filter((b) => bookingEndDate(b) < today).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 5);
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));

  const invite = async () => {
    setError(null);
    const r = await actions.run<{ path: string; expiresAt: string }>("createInvite", { personId: p.id });
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
                {a.state === "accepted"
                  ? "They sign in to My work: only the jobs they're booked on, the site details and their tasks. No prices, customers list or the wider schedule."
                  : "Invite them to see their own bookings, site addresses and instructions on their phone. They can be booked without it."}
              </p>
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
                {a.state === "accepted" && confirm !== "revoke" ? (
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
