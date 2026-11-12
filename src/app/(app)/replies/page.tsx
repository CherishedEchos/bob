"use client";

/**
 * Review replies: one screen for every draft Bob prepared.
 * Approve, edit or skip each one, then a single Send button authorises
 * sending the approved versions. Each reply is sent on its own request, so a
 * failure can be retried without resending the others.
 */
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Check, CheckCheck, Copy, FlaskConical, Handshake, Loader2, PoundSterling, RotateCcw, SendHorizontal, Undo2, X } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { needsReply } from "@/lib/derive";
import { cn, copyToClipboard, firstName, timeAgo } from "@/lib/utils";
import { SourceIcon } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import type { Batch, BatchItem, FlagKind, SendItemResult } from "@/server/services/batch-replies";

type Decision = "review" | "approved" | "skipped";
type ItemState = { body: string; decision: Decision; sending: boolean; result?: SendItemResult };
type Row = BatchItem & ItemState;

const FLAG_ICON: Record<FlagKind, React.ComponentType<{ className?: string }>> = { date: CalendarClock, price: PoundSterling, commitment: Handshake };
const FLAG_LABEL: Record<FlagKind, string> = { date: "Date", price: "Price", commitment: "Promise" };
const CHANNEL_LABEL: Record<BatchItem["channel"], string> = { email: "Email", instagram: "Instagram", phone: "Phone", other: "No contact details" };
const DONE = new Set(["sent", "simulated", "marked", "already_replied"]);

export default function RepliesPage() {
  return (
    <React.Suspense fallback={<Loading />}>
      <ReviewReplies />
    </React.Suspense>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-16 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Bob is drafting your replies…
    </div>
  );
}

function ReviewReplies() {
  const params = useSearchParams();
  const ids = params.get("ids") ?? "";
  const { data, refresh } = useStore();
  const [batch, setBatch] = React.useState<Batch | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [running, setRunning] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const [confirmLive, setConfirmLive] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void api<{ ok?: boolean; value?: Batch; error?: string }>(`/api/replies${ids ? `?ids=${encodeURIComponent(ids)}` : ""}`).then((r) => {
      if (!live) return;
      if (r.status !== 200 || !r.body.value) return setError(r.body.error ?? "Couldn't prepare the drafts.");
      setBatch(r.body.value);
      setRows(r.body.value.items.map((i) => ({ ...i, body: i.draft, decision: "review", sending: false })));
    });
    return () => {
      live = false;
    };
  }, [ids]);

  const outstanding = data.enquiries.filter(needsReply).length;
  const patch = (id: string, p: Partial<ItemState>) => setRows((rs) => rs.map((r) => (r.enquiryId === id ? { ...r, ...p } : r)));

  const sendOne = async (row: Row, mode: "send" | "simulate" | "replied_elsewhere"): Promise<boolean> => {
    patch(row.enquiryId, { sending: true });
    const r = await api<{ ok?: boolean; value?: SendItemResult; error?: string }>("/api/replies/send", {
      json: { enquiryId: row.enquiryId, body: row.body, subject: row.subject, mode },
    }).catch(() => ({ status: 0, body: { error: "Couldn't reach Bob — check your signal." } as { ok?: boolean; value?: SendItemResult; error?: string } }));
    const result: SendItemResult = r.body.value ?? { status: "failed", enquiryId: row.enquiryId, message: r.body.error ?? "Couldn't send", retryable: r.status === 0 || r.status >= 500 };
    patch(row.enquiryId, { sending: false, result });
    return result.status !== "failed";
  };

  const mode = batch?.mode ?? "copy";
  const queue = rows.filter((r) => r.decision === "approved" && r.sendable && !(r.result && DONE.has(r.result.status)));
  const approvedCount = queue.length;

  const sendApproved = async () => {
    if (running || !approvedCount || mode === "copy") return;
    setRunning(true);
    let failed = 0;
    let done = 0;
    for (const row of queue) {
      // One at a time, in order: each reply is its own request.
      if (await sendOne(row, mode === "simulate" ? "simulate" : "send")) done++;
      else failed++;
    }
    setRunning(false);
    await refresh();
    if (failed) toast(`${done} sent · ${failed} failed — the failed ${failed === 1 ? "draft is" : "drafts are"} kept so you can retry.`, "error");
    else toast(mode === "simulate" ? `${done} ${done === 1 ? "reply" : "replies"} simulated — nothing was sent` : `${done} ${done === 1 ? "reply" : "replies"} sent`, "success");
  };

  const retry = async (row: Row) => {
    const ok = await sendOne(row, mode === "simulate" ? "simulate" : "send");
    await refresh();
    toast(ok ? `Reply to ${row.customerName} ${mode === "simulate" ? "simulated" : "sent"}` : `Still couldn't send to ${row.customerName}. The draft is kept.`, ok ? "success" : "error");
  };

  const markReplied = async (row: Row) => {
    const ok = await sendOne(row, "replied_elsewhere");
    await refresh();
    if (ok) toast(`${row.customerName} marked as replied`, "success");
  };

  if (error) {
    return (
      <div className="panel p-6">
        <p className="text-[15px]">{error}</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link href="/today">Back to Today</Link>
        </Button>
      </div>
    );
  }
  if (!batch) return <Loading />;

  const n = rows.length;
  const inSummary = index >= n;
  const row = rows[Math.min(index, n - 1)];
  const isDone = (r: Row) => !!r.result && DONE.has(r.result.status);
  // Finished when Bob has nothing left to send: the rest are skipped, or are Instagram/phone replies you send yourself.
  const finished = n > 0 && rows.some(isDone) && rows.every((r) => isDone(r) || r.decision === "skipped" || !r.sendable || mode === "copy");
  const leftToCopy = rows.filter((r) => !isDone(r) && r.decision !== "skipped" && (!r.sendable || mode === "copy"));
  const go = (i: number) => {
    setConfirmLive(false);
    setIndex(Math.max(0, Math.min(n, i)));
    window.scrollTo?.({ top: 0 });
    document.querySelector("main")?.scrollTo({ top: 0 });
  };
  const sendable = (r: Row) => r.sendable && mode !== "copy" && !(r.result && DONE.has(r.result.status));
  const modeNote =
    mode === "simulate"
      ? "Demo workspace — no inbox is connected. Approve the replies you're happy with; on the last step Simulate records each one in Bob and updates the count. Nothing is sent to anyone."
      : mode === "copy"
        ? "No inbox is connected, so Bob can't send these. Copy each reply, send it yourself, then mark it as replied."
        : `Live sending from ${batch.providerLabel}. Nothing is sent until you approve replies and confirm on the last step.`;

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/enquiries" className="-ml-1 inline-flex h-10 items-center gap-1.5 px-1 text-[14.5px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Enquiries
          </Link>
          <div className="flex items-center gap-2" aria-live="polite">
            <span className="text-[13.5px] text-muted-foreground">Awaiting reply</span>
            <span className={cn("tabular text-[20px] font-semibold leading-none", outstanding ? "text-warn-fg" : "text-good-fg")} data-testid="outstanding-count">
              {outstanding}
            </span>
          </div>
        </div>
        <h1 className="t-page mt-1" aria-live="polite" data-testid="queue-position">
          {n === 0 ? "Nothing to draft" : inSummary ? "Ready to send" : `Draft ${index + 1} of ${n}`}
        </h1>
        {n ? (
          <ol className="mt-3 flex gap-1.5" aria-label="Drafts">
            {rows.map((r, i) => {
              const done = r.result && DONE.has(r.result.status);
              return (
                <li key={r.enquiryId} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Draft ${i + 1}: ${r.customerName}${r.decision === "approved" ? ", approved" : r.decision === "skipped" ? ", skipped" : ""}`}
                    aria-current={i === index || undefined}
                    className="group block w-full py-2"
                  >
                    <span
                      className={cn(
                        "block h-1.5 rounded-full transition",
                        done ? "bg-emerald-400/80" : r.result?.status === "failed" ? "bg-red-400" : r.decision === "approved" ? "bg-copper-400" : r.decision === "skipped" ? "bg-white/15" : "bg-white/25",
                        i === index && !inSummary && "ring-2 ring-white/70 ring-offset-2 ring-offset-background",
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
        <p className="mt-2 flex items-start gap-2 text-[14px] text-muted-foreground">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-subtle" /> {modeNote}
        </p>
        {batch.alreadyReplied.length ? <p className="mt-1 text-[14px] text-muted-foreground">Left out — already replied: {batch.alreadyReplied.map((a) => a.customerName).join(", ")}.</p> : null}
      </div>

      {n && !inSummary ? (
        <ul>
          <ReplyCard
            key={row.enquiryId}
            row={row}
            mode={mode}
            busy={running}
            onChange={(body) => patch(row.enquiryId, { body })}
            onRetry={() => void retry(row)}
            onMarkReplied={() => void markReplied(row)}
          />
        </ul>
      ) : null}

      {n && inSummary ? (
        <ul className="panel divide-y divide-line overflow-hidden">
          {rows.map((r, i) => (
            <li key={r.enquiryId} className="flex items-center gap-3 px-4 py-3 lg:px-5">
              <SourceIcon source={r.source} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="t-name truncate">{r.customerName}</span>
                  <StatusPill row={r} />
                </div>
                <div className="truncate text-[14px] text-muted-foreground">
                  {r.result?.status === "failed" ? `Couldn't send: ${r.result.message}. Draft kept.` : sendable(r) ? CHANNEL_LABEL[r.channel] + (r.to ? ` · ${r.to}` : "") : r.result ? r.result.message : `${CHANNEL_LABEL[r.channel]} — copy and send yourself`}
                </div>
              </div>
              {r.result?.status === "failed" ? (
                <Button size="sm" variant="secondary" onClick={() => void retry(r)} disabled={r.sending || running}>
                  {r.sending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
                </Button>
              ) : !(r.result && DONE.has(r.result.status)) ? (
                <button type="button" onClick={() => go(i)} className="h-10 px-2 text-[14.5px] font-semibold text-muted-foreground hover:text-accent-fg">
                  Open
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {n ? (
        <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-line bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:mx-0 lg:rounded-2xl lg:border lg:px-5">
          {!inSummary ? (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <Button variant="ghost" className="sm:mr-auto" disabled={index === 0} onClick={() => go(index - 1)}>
                <ArrowLeft /> Previous
              </Button>
              {sendable(row) ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    patch(row.enquiryId, { decision: row.decision === "skipped" ? "review" : "skipped" });
                    if (row.decision !== "skipped") go(index + 1);
                  }}
                >
                  {row.decision === "skipped" ? <Undo2 /> : <X />} {row.decision === "skipped" ? "Undo skip" : "Skip"}
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}
              {sendable(row) ? (
                <>
                  <Button variant="secondary" onClick={() => go(index + 1)}>
                    {index === n - 1 ? "Review & send" : "Next draft"} <ArrowRight />
                  </Button>
                  <Button
                    disabled={!row.body.trim() || row.sending}
                    onClick={() => {
                      patch(row.enquiryId, { decision: "approved" });
                      go(index + 1);
                    }}
                  >
                    <Check /> {row.decision === "approved" ? "Approved — next" : index === n - 1 ? "Approve & review" : "Approve & next"}
                  </Button>
                </>
              ) : (
                <Button className="col-span-2 sm:col-span-1" onClick={() => go(index + 1)}>
                  {index === n - 1 ? "Review & send" : "Next draft"} <ArrowRight />
                </Button>
              )}
            </div>
          ) : finished ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-[15px]">
                  <CheckCheck className="size-5 text-good-fg" />
                  {outstanding ? `Done. ${outstanding} still waiting for a reply.` : "All caught up — nobody's waiting for a reply."}
                </p>
                {leftToCopy.length ? (
                  <p className="mt-1 text-[14px] text-muted-foreground">
                    {leftToCopy.map((r) => firstName(r.customerName)).join(", ")}: copy the reply into {leftToCopy.length === 1 ? CHANNEL_LABEL[leftToCopy[0].channel] : "their app"}, then mark it replied.
                  </p>
                ) : null}
              </div>
              <Button asChild>
                <Link href="/enquiries">Back to Enquiries</Link>
              </Button>
            </div>
          ) : confirmLive ? (
            <div>
              <p className="text-[15.5px] font-semibold">
                Send {approvedCount} {approvedCount === 1 ? "email" : "emails"} from {batch.providerLabel}?
              </p>
              <p className="mt-1 text-[14px] text-muted-foreground">These go to real customers: {queue.map((r) => `${r.customerName} (${r.to})`).join(", ")}.</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => setConfirmLive(false)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    setConfirmLive(false);
                    void sendApproved();
                  }}
                >
                  <SendHorizontal /> Yes, send {approvedCount} {approvedCount === 1 ? "email" : "emails"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => go(n - 1)}>
                <ArrowLeft /> Back to drafts
              </Button>
              {mode === "copy" || !rows.some(sendable) ? (
                <p className="text-[14.5px] text-muted-foreground">Copy each reply, send it yourself, then tap Mark as replied in the draft.</p>
              ) : (
                <Button className="flex-1" size="lg" disabled={!approvedCount || running} onClick={() => (mode === "send" ? setConfirmLive(true) : void sendApproved())}>
                  {running ? <Loader2 className="animate-spin" /> : mode === "simulate" ? <FlaskConical /> : <SendHorizontal />}
                  {running
                    ? "Sending…"
                    : !approvedCount
                      ? "Approve a reply to send it"
                      : mode === "simulate"
                        ? `Simulate ${approvedCount} approved ${approvedCount === 1 ? "reply" : "replies"} (demo)`
                        : `Send ${approvedCount} approved ${approvedCount === 1 ? "email" : "emails"}…`}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReplyCard({
  row,
  mode,
  busy,
  onChange,
  onRetry,
  onMarkReplied,
}: {
  row: Row;
  mode: Batch["mode"];
  busy: boolean;
  onChange: (body: string) => void;
  onRetry: () => void;
  onMarkReplied: () => void;
}) {
  const area = React.useRef<HTMLTextAreaElement>(null);
  const done = !!row.result && DONE.has(row.result.status);
  const failed = row.result?.status === "failed";
  const edited = row.body.trim() !== row.draft.trim();
  const manual = !row.sendable;
  const titleId = `reply-${row.enquiryId}`;

  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight + 2, 168)}px`;
  }, [row.body, row.decision]);

  const copy = async () => {
    const ok = await copyToClipboard(row.body);
    toast(ok ? `Draft for ${row.customerName} copied` : "Couldn't copy — select the text and copy it instead", ok ? "success" : "error");
  };

  return (
    <li
      aria-labelledby={titleId}
      data-enquiry={row.enquiryId}
      className={cn(
        "panel overflow-hidden transition",
        row.decision === "approved" && !done && "ring-1 ring-copper-500/45",
        row.decision === "skipped" && "opacity-60",
        failed && "ring-1 ring-red-400/50",
      )}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4 lg:px-5">
        <SourceIcon source={row.source} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 id={titleId} className="t-name">
              {row.customerName}
            </h2>
            <StatusPill row={row} />
          </div>
          <div className="mt-0.5 text-[14px] text-muted-foreground">
            {row.title} · {row.location} · {timeAgo(row.receivedAt)}
          </div>
          <div className="mt-1 text-[13.5px] text-muted-foreground">
            <span className="font-medium text-foreground/85">{CHANNEL_LABEL[row.channel]}</span>
            {row.to ? <> · {row.to}</> : null}
            {manual ? <span className="text-subtle"> · {row.channel === "instagram" ? "reply in Instagram" : row.channel === "phone" ? "call or text" : "copy and send yourself"}</span> : null}
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4 lg:px-5">
        <figure className="rounded-2xl border-l-2 border-white/15 bg-white/[0.03] px-4 py-3.5">
          <figcaption className="mb-1 text-[14px] font-semibold text-muted-foreground">
            Customer message{row.history.length ? ` · ${row.history.length} earlier` : ""}
          </figcaption>
          <blockquote className="whitespace-pre-line text-[16px] leading-relaxed text-foreground/90">{row.original.body}</blockquote>
        </figure>

        {row.flags.length && !done ? (
          <ul className="space-y-2">
            {row.flags.map((f, i) => {
              const Icon = FLAG_ICON[f.kind];
              return (
                <li key={i} className="flex items-start gap-2.5 text-[14.5px] text-warn-fg">
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="font-semibold">Decide: {FLAG_LABEL[f.kind]}. </span>
                    {f.text}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div>
          <label htmlFor={`draft-${row.enquiryId}`} className="mb-1.5 flex items-center justify-between text-[13.5px] font-medium text-foreground/85">
            <span>
              {done ? "What was sent" : "Suggested reply"}
              {edited && !done ? <span className="ml-2 font-normal text-accent-fg">Edited</span> : null}
            </span>
            {row.savedDraft ? <span className="font-normal text-muted-foreground">Your saved draft</span> : null}
          </label>
          <textarea
            id={`draft-${row.enquiryId}`}
            ref={area}
            value={row.body}
            readOnly={done || row.sending}
            onChange={(e) => onChange(e.target.value)}
            className="block w-full resize-none overflow-hidden rounded-2xl bg-[#0f0f11] px-4 py-3.5 text-[16px] leading-relaxed text-foreground outline-none ring-1 ring-white/[0.12] focus:ring-2 focus:ring-copper-400 focus:ring-offset-2 focus:ring-offset-card read-only:text-muted-foreground"
          />
        </div>

        {row.result ? (
          <p className={cn("flex items-start gap-2 text-[14px]", failed ? "text-danger-fg" : row.result.status === "already_replied" ? "text-muted-foreground" : "text-good-fg")} role={failed ? "alert" : undefined}>
            {failed ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}
            <span>
              {failed ? `Couldn't send: ${row.result.message}. Your draft is kept — nothing else was resent.` : row.result.message}
            </span>
          </p>
        ) : null}

        {!done ? (
          <div className="flex flex-wrap gap-2">
            {failed ? (
              <Button size="sm" onClick={onRetry} disabled={row.sending || busy}>
                {row.sending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry this reply
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <Copy /> Copy reply
            </Button>
            {manual || mode === "copy" ? (
              <Button size="sm" variant="secondary" onClick={onMarkReplied} disabled={row.sending || !row.body.trim()}>
                {row.sending ? <Loader2 className="animate-spin" /> : <Check />} I&apos;ve sent it — mark as replied
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function StatusPill({ row }: { row: Row }) {
  const s = row.result?.status;
  const [label, cls] =
    s === "sent"
      ? ["Sent", "bg-emerald-500/15 text-good-fg ring-emerald-400/30"]
      : s === "simulated"
        ? ["Simulated", "bg-violet-500/15 text-violet-200 ring-violet-400/30"]
        : s === "marked"
          ? ["Marked replied", "bg-emerald-500/15 text-good-fg ring-emerald-400/30"]
          : s === "already_replied"
            ? ["Already replied", "bg-surface-2 text-muted-foreground ring-line"]
            : s === "failed"
              ? ["Failed", "bg-red-500/15 text-danger-fg ring-red-400/35"]
              : row.decision === "approved"
                ? ["Approved", "bg-copper-500/15 text-accent-fg ring-copper-500/35"]
                : row.decision === "skipped"
                  ? ["Skipped", "bg-surface-2 text-muted-foreground ring-line"]
                  : row.flags.length
                    ? ["Needs a decision", "bg-amber-500/12 text-amber-200 ring-amber-400/30"]
                    : ["Ready to review", "bg-surface-2 text-muted-foreground ring-line"];
  return <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-[12.5px] font-medium ring-1", cls)}>{label}</span>;
}
