"use client";

/**
 * My work — what an invited employee or subcontractor sees on their phone.
 * Next booking first (when, where, how to get there, what to do), then the
 * rest of their upcoming work, their tasks and the materials for their jobs.
 * Only their own bookings ever reach this screen.
 */
import * as React from "react";
import { AlertTriangle, CalendarOff, Camera, Check, ChevronDown, ClipboardList, FileText, FlaskConical, Loader2, LogOut, MapPin, Package, Phone, Plane, RefreshCw, Users } from "lucide-react";
import { BobLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { toast, Toaster } from "@/components/ui/toaster";
import { formatDayLong, formatDayShort, formatTimeRange, relativeDay, relativeDayInline } from "@/lib/dates";
import { cn, timeAgo } from "@/lib/utils";
import { SiteActions } from "@/components/jobs/job-parts";
import { CalendarLink, type FeedInfo } from "@/components/settings/calendar-links";
import type { MyBooking, MyWork } from "@/server/services/team";
import type { Absence, JobFile, JobUpdate } from "@/lib/types";
import { UploadButtons, UploadQueue } from "@/components/files/upload-queue";
import { AddUpdateDialog, STAGE_LABEL } from "@/components/updates/add-update";
import { FileViewer, Thumb } from "@/components/files/files-panel";
import { CATEGORY_SINGULAR, fileUrl } from "@/lib/files/upload";
import { ABSENCE_LABEL, PART_LABEL } from "@/lib/leave";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/sheet";

const MAT_LABEL = { to_order: "To order", ordered: "Ordered", on_site: "On site" } as const;

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
          {data?.wordmarkOnDark ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed-height brand image */}
              <img src={data.wordmarkOnDark} alt={data.businessName} className="block h-7 w-auto" />
              <p className="mt-1 flex items-center gap-1 text-[12.5px] text-muted-foreground">
                with <BobLogo height={10} />
              </p>
            </>
          ) : (
            <>
              <BobLogo height={20} />
              <p className="mt-1 truncate text-[13px] text-muted-foreground">{data ? data.businessName : " "}</p>
            </>
          )}
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
                <BookingCard b={next} today={data.today} expanded changed={changed(next)} files={(data.files ?? []).filter((f) => f.jobId === next.job.id)} updates={(data.updates ?? []).filter((u) => u.jobId === next.job.id)} onUploaded={load} />
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
                      <BookingCard b={b} today={data.today} changed={changed(b)} files={(data.files ?? []).filter((f) => f.jobId === b.job.id)} updates={(data.updates ?? []).filter((u) => u.jobId === b.job.id)} onUploaded={load} />
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
                        <span className="block text-[13.5px] text-muted-foreground">Due {relativeDayInline(t.dueDate, data.today)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <TimeOff data={data} onChanged={load} />

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

function BookingCard({ b, today, expanded = false, changed, files, updates, onUploaded }: { b: MyBooking; today: string; expanded?: boolean; changed?: boolean; files: JobFile[]; updates: JobUpdate[]; onUploaded: () => Promise<void> | void }) {
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
          <SiteActions compact job={{ siteAddress: b.job.siteAddress, location: b.job.siteAddress, what3words: b.job.what3words, accessNote: b.job.accessNote }} />
          {b.job.contactPhone ? (
            <Button asChild size="sm" variant="secondary">
              <a href={`tel:${b.job.contactPhone.replace(/\s/g, "")}`}>
                <Phone /> Call {b.job.contactName?.split(" ")[0] ?? "customer"}
              </a>
            </Button>
          ) : null}
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
          <WorkerUpdates jobId={b.job.id} jobTitle={b.job.title} updates={updates} files={files} onSaved={onUploaded} />
          <JobFilesForWorker jobId={b.job.id} files={files} onUploaded={onUploaded} />
        </div>
      ) : null}
    </article>
  );
}

/** "Add update" from site, and the latest few updates on the job. */
function WorkerUpdates({ jobId, jobTitle, updates, files, onSaved }: { jobId: string; jobTitle: string; updates: JobUpdate[]; files: JobFile[]; onSaved: () => Promise<void> | void }) {
  const [open, setOpen] = React.useState(false);
  const recent = [...updates].sort((a, c) => c.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  return (
    <div className="border-t border-line pt-3">
      <Button className="h-13 w-full text-[16px]" onClick={() => setOpen(true)}>
        <Camera /> Add update
      </Button>
      {recent.length ? (
        <ul className="mt-3 space-y-2">
          {recent.map((u) => {
            const n = files.filter((f) => f.updateId === u.id).length;
            return (
              <li key={u.id} className="text-[14px]">
                <span className="font-semibold">{formatDayShort(u.createdAt.slice(0, 10))}</span>
                <span className="text-muted-foreground"> · {u.authorName}{u.stage ? ` · ${STAGE_LABEL[u.stage]}` : ""}{n ? ` · ${n} photo${n === 1 ? "" : "s"}` : ""}</span>
                {u.note ? <span className="block text-foreground/90">{u.note}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {open ? <AddUpdateDialog jobId={jobId} jobTitle={jobTitle} onClose={() => setOpen(false)} onSaved={onSaved} /> : null}
    </div>
  );
}

/** Drawings and documents shared on the job (current revisions), photos, and a big Add photo button. */
function JobFilesForWorker({ jobId, files, onUploaded }: { jobId: string; files: JobFile[]; onUploaded: () => Promise<void> | void }) {
  const [picked, setPicked] = React.useState<File[] | null>(null);
  const [viewing, setViewing] = React.useState<{ list: JobFile[]; index: number } | null>(null);
  const latest = new Map<string, JobFile>();
  for (const f of [...files].sort((a, c) => a.createdAt.localeCompare(c.createdAt))) latest.set(f.groupId, f);
  const current = [...latest.values()];
  const docs = current.filter((f) => f.category === "drawing" || f.category === "other");
  const photos = current.filter((f) => f.category === "progress" || f.category === "completion").sort((a, c) => c.createdAt.localeCompare(a.createdAt));
  const open = (f: JobFile, list: JobFile[]) => (f.previewable ? setViewing({ list: list.filter((x) => x.previewable), index: list.filter((x) => x.previewable).indexOf(f) }) : window.open(fileUrl(f.id, { download: true }), "_blank", "noopener"));
  return (
    <div className="border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[14px] font-semibold">Drawings, files &amp; photos</h4>
      </div>
      <UploadButtons onPick={setPicked} primaryLabel="Add photo or file" className="[&>label]:flex-1 [&>label]:justify-center" />
      {docs.length ? (
        <ul className="mt-3 divide-y divide-line rounded-xl ring-1 ring-line">
          {docs.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => open(f, docs)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-surface-2">
                <FileText className="size-5 shrink-0 text-accent-icon" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {f.title ?? f.filename}
                    {f.revision ? <span className="ml-1.5 rounded bg-surface-3 px-1.5 text-[12.5px] font-semibold">{f.revision}</span> : null}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {CATEGORY_SINGULAR[f.category]}
                    {f.category === "drawing" ? " · current version" : ""}
                    {f.description ? ` · ${f.description}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {photos.length ? (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {photos.slice(0, 9).map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => open(f, photos)} className="block w-full overflow-hidden rounded-lg ring-1 ring-line" aria-label={`View ${f.title ?? f.filename}`}>
                <Thumb file={f} className="aspect-square w-full" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!docs.length && !photos.length ? <p className="mt-2 text-[14px] text-muted-foreground">No files shared on this job yet.</p> : null}
      {picked ? (
        <UploadQueue
          worker
          target={{ jobId }}
          files={picked}
          onClose={() => setPicked(null)}
          onSaved={async (saved) => {
            toast(`${saved.length} file${saved.length === 1 ? "" : "s"} added to the job`, "success");
            await onUploaded();
          }}
        />
      ) : null}
      {viewing ? <FileViewer list={viewing.list} index={viewing.index} onIndex={(i) => setViewing({ ...viewing, index: i })} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

/** Their own holidays / unavailable dates, and a request form. */
function TimeOff({ data, onChanged }: { data: MyWork; onChanged: () => Promise<void> | void }) {
  const [adding, setAdding] = React.useState(false);
  const sub = data.person?.kind === "subcontractor";
  const list = (data.absences ?? []).filter((a) => a.endDate >= data.today && (a.status === "pending" || a.status === "approved")).sort((a, c) => a.startDate.localeCompare(c.startDate));
  const recent = (data.absences ?? []).filter((a) => a.status === "declined" && a.endDate >= data.today);
  const cancel = async (a: Absence) => {
    const r = await fetch("/api/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", id: a.id }) });
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) return toast(body.error ?? "Couldn't cancel", "error");
    toast("Cancelled", "success");
    await onChanged();
  };
  return (
    <section aria-labelledby="off-title" className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="off-title" className="t-eyebrow flex items-center gap-1.5">
          <CalendarOff className="size-3.5" aria-hidden /> {sub ? "Dates you can't work" : "Holidays"}
        </h2>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <Plane /> {sub ? "Add unavailable dates" : "Request time off"}
        </Button>
      </div>
      {list.length || recent.length ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {[...list, ...recent].map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block text-[15px] font-medium">
                  {formatDayShort(a.startDate)}
                  {a.endDate !== a.startDate ? ` – ${formatDayShort(a.endDate)}` : ""}
                  {a.part ? ` · ${PART_LABEL[a.part]}` : ""}
                </span>
                <span className={cn("block text-[13.5px]", a.status === "pending" ? "text-warn-fg" : a.status === "declined" ? "text-danger-fg" : "text-good-fg")}>
                  {ABSENCE_LABEL[a.kind]} · {a.status === "pending" ? "Waiting for approval" : a.status === "declined" ? "Declined" : "Approved"}
                </span>
              </span>
              {a.status !== "declined" ? (
                <Button size="sm" variant="ghost" onClick={() => void cancel(a)}>
                  Cancel
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel px-4 py-3 text-[15px] text-muted-foreground">{sub ? "No unavailable dates added." : "No time off booked."}</p>
      )}
      {adding ? <TimeOffForm sub={sub} today={data.today} onClose={() => setAdding(false)} onSaved={onChanged} /> : null}
    </section>
  );
}

function TimeOffForm({ sub, today, onClose, onSaved }: { sub: boolean; today: string; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const [v, setV] = React.useState({ startDate: today, endDate: "", part: "full", reason: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const single = !v.endDate || v.endDate === v.startDate;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={sub ? "Dates you can't work" : "Request time off"} description={sub ? "The office sees these on the diary straight away." : "Luke or Ryan will approve it. The answer shows here."}>
        <form
          className="space-y-3"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErrors({});
            const r = await fetch("/api/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: { kind: sub ? "unavailable" : "holiday", startDate: v.startDate, endDate: v.endDate || v.startDate, part: single ? v.part : "full", reason: v.reason } }) }).catch(() => null);
            setBusy(false);
            const body = (await r?.json().catch(() => ({}))) as { error?: string; fieldErrors?: Record<string, string>; value?: Absence } | undefined;
            if (!r?.ok || !body?.value) return setErrors({ _: body?.error ?? "Couldn't send — check your signal and try again. Your dates are still here.", ...(body?.fieldErrors ?? {}) });
            toast(body.value.status === "pending" ? "Request sent" : "Saved", "success");
            await onSaved();
            onClose();
          }}
        >
          {errors._ ? (
            <p role="alert" className="text-[14px] text-danger-fg">
              {errors._}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day" htmlFor="to-start" error={errors.startDate}>
              <Input id="to-start" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
            </Field>
            <Field label="Last day" htmlFor="to-end" error={errors.endDate} hint="Blank for one day">
              <Input id="to-end" type="date" min={v.startDate} value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
            </Field>
          </div>
          {single ? (
            <fieldset>
              <legend className="mb-1.5 text-[14px] font-medium">How long</legend>
              <div className="inline-flex gap-1 rounded-xl bg-surface-3 p-1">
                {([["full", "Full day"], ["am", "Morning"], ["pm", "Afternoon"]] as const).map(([val, label]) => (
                  <label key={val} className={cn("flex h-10 cursor-pointer items-center rounded-lg px-3 text-[14.5px] font-semibold", v.part === val ? "bg-card text-heading ring-1 ring-line" : "text-muted-foreground")}>
                    <input type="radio" name="to-part" checked={v.part === val} onChange={() => setV({ ...v, part: val })} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <Field label="Reason (optional, private)" htmlFor="to-reason" hint="Only you and Luke/Ryan see this.">
            <Textarea id="to-reason" rows={2} maxLength={300} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : sub ? "Save dates" : "Send request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
