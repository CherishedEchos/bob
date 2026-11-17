"use client";

/**
 * My work — what an invited employee or subcontractor sees on their phone.
 * Next booking first (when, where, how to get there, what to do), then the
 * rest of their upcoming work, their tasks and the materials for their jobs.
 * Only their own bookings ever reach this screen.
 */
import * as React from "react";
import { AlertTriangle, Check, ChevronDown, ClipboardList, FlaskConical, Loader2, LogOut, MapPin, Navigation, Package, Phone, RefreshCw, Users } from "lucide-react";
import { BobLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { toast, Toaster } from "@/components/ui/toaster";
import { formatDayLong, formatDayShort, formatTimeRange, relativeDay } from "@/lib/dates";
import { cn, timeAgo } from "@/lib/utils";
import { SiteActions } from "@/components/jobs/job-parts";
import { CalendarLink, type FeedInfo } from "@/components/settings/calendar-links";
import type { MyBooking, MyWork } from "@/server/services/team";

const MAT_LABEL = { to_order: "To order", ordered: "Ordered", on_site: "On site" } as const;
const directions = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

export default function MyWorkPage() {
  const [data, setData] = React.useState<MyWork | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [seen, setSeen] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/my-work", { cache: "no-store" });
      if (res.status === 401) return void (window.location.href = "/login");
      const body = (await res.json()) as { value?: MyWork; error?: string };
      if (!res.ok || !body.value) throw new Error(body.error ?? "Couldn't load your work");
      setData(body.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your work");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    try {
      setSeen(JSON.parse(localStorage.getItem("bob.mywork.seen") ?? "{}"));
    } catch {
      /* ignore */
    }
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Remember what they've seen, so changes made by the office stand out next time.
  React.useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem("bob.mywork.seen", JSON.stringify(Object.fromEntries(data.bookings.map((b) => [b.id, b.updatedAt]))));
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [data]);

  const toggleTask = async (taskId: string, done: boolean) => {
    const res = await fetch("/api/my-work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, done }) });
    const body = (await res.json().catch(() => ({}))) as { value?: MyWork; error?: string };
    if (!res.ok || !body.value) return toast(body.error ?? "Couldn't update the task", "error");
    setData(body.value);
    toast(done ? "Task done" : "Task reopened", "success");
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const [next, ...rest] = data?.bookings ?? [];
  const changed = (b: MyBooking) => !!seen[b.id] && seen[b.id] !== b.updatedAt;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="theme-dark sticky top-0 z-10 flex items-center justify-between gap-2 bg-card px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <BobLogo height={20} />
          <p className="mt-1 truncate text-[13px] text-muted-foreground">{data ? data.businessName : " "}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh" className="grid size-11 place-items-center rounded-full text-foreground hover:bg-surface-3">
            <RefreshCw className={cn("size-5", loading && "animate-spin")} />
          </button>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="grid size-11 place-items-center rounded-full text-foreground hover:bg-surface-3">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="t-page">My work</h1>
            {data?.person ? (
              <p className="t-meta mt-0.5">
                {data.person.name}
                {data.person.company ? ` · ${data.person.company}` : ""}
              </p>
            ) : null}
          </div>
          {data?.sample ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-md bg-surface-3 px-2 text-[12.5px] font-medium text-muted-foreground">
              <FlaskConical className="size-3" aria-hidden /> Demo · sample data
            </span>
          ) : null}
        </div>

        {error ? (
          <div role="alert" className="mt-4 rounded-2xl bg-red-500/10 p-4 text-[15px] text-danger-fg ring-1 ring-red-500/25">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
            </p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}

        {!data && !error ? (
          <p className="mt-10 flex items-center justify-center gap-2 text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin" /> Loading your work…
          </p>
        ) : null}

        {data && !data.person ? (
          <div className="panel mt-4 p-5">
            <p className="t-section">Nothing linked to your account yet</p>
            <p className="t-meta mt-1">Ask {data.businessName} to book you onto a job. It will show here.</p>
          </div>
        ) : null}

        {data?.person ? (
          <>
            {next ? (
              <section aria-labelledby="next-title" className="mt-4">
                <h2 id="next-title" className="t-eyebrow mb-2">
                  Next
                </h2>
                <BookingCard b={next} today={data.today} expanded changed={changed(next)} />
              </section>
            ) : (
              <div className="panel mt-4 p-5 text-center">
                <p className="t-section">No work booked</p>
                <p className="t-meta mt-1">When {data.businessName} books you on a job, it shows here.</p>
              </div>
            )}

            {rest.length ? (
              <section aria-labelledby="up-title" className="mt-6">
                <h2 id="up-title" className="t-eyebrow mb-2">
                  Coming up
                </h2>
                <ul className="flex flex-col gap-2">
                  {rest.map((b) => (
                    <li key={b.id}>
                      <BookingCard b={b} today={data.today} changed={changed(b)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.tasks.length ? (
              <section aria-labelledby="tasks-title" className="mt-6">
                <h2 id="tasks-title" className="t-eyebrow mb-2 flex items-center gap-1.5">
                  <ClipboardList className="size-3.5" aria-hidden /> Your tasks
                </h2>
                <ul className="panel divide-y divide-line overflow-hidden">
                  {data.tasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                      <button type="button" aria-label={`Complete: ${t.title}`} onClick={() => void toggleTask(t.id, true)} className="-m-1.5 grid size-11 shrink-0 place-items-center rounded-full">
                        <span className="grid size-7 place-items-center rounded-full bg-card text-transparent ring-2 ring-[rgb(16_24_40/0.25)] hover:text-subtle">
                          <Check className="size-4" strokeWidth={3} aria-hidden />
                        </span>
                      </button>
                      <span className="min-w-0">
                        <span className="block text-[15.5px] font-medium leading-snug">{t.title}</span>
                        <span className="block text-[13.5px] text-muted-foreground">Due {relativeDay(t.dueDate, data.today).toLowerCase()}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="mt-6 text-center text-[12.5px] text-subtle">
              Updated {timeAgo(data.generatedAt)}. Changes from the office show here when you open or refresh.
            </p>
          </>
        ) : null}
      </main>
      {data ? <Materials data={data} /> : null}
      {data?.person ? <MyCalendar /> : null}
      <Toaster />
    </div>
  );
}

function BookingCard({ b, today, expanded = false, changed }: { b: MyBooking; today: string; expanded?: boolean; changed?: boolean }) {
  const [open, setOpen] = React.useState(expanded);
  const when = `${relativeDay(b.date, today)}${b.endDate ? ` – ${formatDayShort(b.endDate)}` : ""}`;
  return (
    <article className={cn("panel overflow-hidden", expanded && "ring-2 ring-copper-500/40")}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-surface-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-accent-fg">
            {when} · {formatTimeRange(b.startTime, b.endTime)}
            {changed ? <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[12px] font-semibold text-warn-fg">Changed</span> : null}
          </p>
          <h3 className={cn("mt-0.5 font-bold leading-tight text-heading", expanded ? "text-[21px]" : "text-[17px]")}>{b.job.title}</h3>
          <p className="mt-1 flex items-start gap-1.5 text-[15px] text-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0 text-accent-icon" aria-hidden /> {b.job.siteAddress}
          </p>
          {!open ? <p className="mt-0.5 text-[13px] text-muted-foreground">{formatDayLong(b.date)}</p> : null}
        </div>
        <ChevronDown className={cn("mt-1 size-5 shrink-0 text-subtle transition", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          <SiteActions job={{ siteAddress: b.job.siteAddress, location: b.job.siteAddress, what3words: b.job.what3words, accessNote: b.job.accessNote }} />
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={directions(b.job.siteAddress)} target="_blank" rel="noreferrer">
                <Navigation /> Directions
              </a>
            </Button>
            {b.job.contactPhone ? (
              <Button asChild size="sm" variant="secondary">
                <a href={`tel:${b.job.contactPhone.replace(/\s/g, "")}`}>
                  <Phone /> Call {b.job.contactName?.split(" ")[0] ?? "customer"}
                </a>
              </Button>
            ) : null}
          </div>
          {b.notes || b.job.instructions ? (
            <div className="rounded-xl bg-message px-3.5 py-3">
              <h4 className="text-[13.5px] font-semibold">Instructions</h4>
              {b.notes ? <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{b.notes}</p> : null}
              {b.job.instructions ? <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{b.job.instructions}</p> : null}
            </div>
          ) : null}
          {b.withPeople.length ? (
            <p className="flex items-center gap-1.5 text-[14px] text-muted-foreground">
              <Users className="size-4" aria-hidden /> With {b.withPeople.join(", ")}
            </p>
          ) : null}
          {b.job.contactName ? <p className="text-[14px] text-muted-foreground">Customer: {b.job.contactName}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function Materials({ data }: { data: MyWork }) {
  if (!data.materials.length) return null;
  const titles = new Map(data.bookings.map((b) => [b.job.id, b.job.title]));
  const byJob = new Map<string, MyWork["materials"]>();
  for (const m of data.materials) byJob.set(m.jobId, [...(byJob.get(m.jobId) ?? []), m]);
  return (
    <section aria-labelledby="mat-title" className="mt-6 px-4">
      <h2 id="mat-title" className="t-eyebrow mb-2 flex items-center gap-1.5">
        <Package className="size-3.5" aria-hidden /> Materials for your jobs
      </h2>
      <div className="flex flex-col gap-2">
        {[...byJob].map(([jobId, items]) => (
          <div key={jobId} className="panel overflow-hidden">
            <p className="border-b border-line px-4 py-2 text-[14px] font-semibold">{titles.get(jobId) ?? "Job"}</p>
            <ul className="divide-y divide-line">
              {items.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14.5px]">
                  <span className="min-w-0">
                    {m.quantity} × {m.item}
                  </span>
                  <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium", m.status === "on_site" ? "bg-emerald-500/10 text-good-fg" : m.status === "ordered" ? "bg-sky-500/10 text-info-fg" : "bg-amber-500/10 text-warn-fg")}>
                    {MAT_LABEL[m.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function MyCalendar() {
  const [feeds, setFeeds] = React.useState<FeedInfo[]>([]);
  const load = React.useCallback(async () => {
    const r = await fetch("/api/my-calendar", { cache: "no-store" });
    if (r.ok) setFeeds(((await r.json()) as { feeds: FeedInfo[] }).feeds);
  }, []);
  React.useEffect(() => void load(), [load]);
  return (
    <section aria-label="Calendar" className="mt-6 px-4">
      <CalendarLink
        scope="person"
        title="Add my bookings to my calendar"
        body="Your bookings in your phone's calendar. Changes made in Bob show up when your calendar next checks."
        feed={feeds.find((f) => f.scope === "person")}
        create={async () => {
          const r = await fetch("/api/my-calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const body = (await r.json().catch(() => ({}))) as { value?: { path: string }; error?: string };
          void load();
          return r.ok && body.value ? { ok: true as const, path: body.value.path } : { ok: false as const, error: body.error ?? "Couldn't create the link" };
        }}
        revoke={async (id) => {
          const r = await fetch("/api/my-calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke", id }) });
          void load();
          return r.ok;
        }}
      />
    </section>
  );
}
