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
import { AlertTriangle, ArrowLeft, CalendarClock, Check, CheckCheck, Copy, FlaskConical, Handshake, Loader2, PoundSterling, RotateCcw, SendHorizontal, Undo2, X } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { needsReply } from "@/lib/derive";
import { cn, copyToClipboard, timeAgo } from "@/lib/utils";
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

  const flagged = rows.filter((r) => r.flags.length && !r.result).length;
  const finished = rows.length > 0 && rows.every((r) => r.decision === "skipped" || (r.result && DONE.has(r.result.status)));

  return (
    <div className="pb-4">
      <div className="mb-5">
        <Link href="/today" className="-ml-1 inline-flex h-10 items-center gap-1.5 px-1 text-[14.5px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Today
        </Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="t-page">Review replies</h1>
            <p className="t-meta mt-1 text-[15px]">
              {rows.length ? (
                <>
                  {rows.length} {rows.length === 1 ? "draft" : "drafts"}
                  {flagged ? ` · ${flagged} ${flagged === 1 ? "needs" : "need"} a decision` : ""} · Nothing is sent until you approve it and tap Send.
                </>
              ) : (
                "Nothing to draft."
              )}
            </p>
          </div>
          <div className="raised flex items-center gap-2 rounded-xl px-3 py-2" aria-live="polite">
            <span className="text-[13.5px] text-muted-foreground">Awaiting reply</span>
            <span className={cn("tabular text-[22px] font-semibold leading-none", outstanding ? "text-amber-300" : "text-good-fg")} data-testid="outstanding-count">
              {outstanding}
            </span>
          </div>
        </div>
      </div>

      {mode !== "send" ? (
        <div className={cn("mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-[14.5px] ring-1", mode === "simulate" ? "bg-violet-500/10 text-violet-100 ring-violet-400/25" : "bg-surface-2 text-muted-foreground ring-line")}>
          <FlaskConical className="mt-0.5 size-4 shrink-0" />
          <p>
            {mode === "simulate"
              ? "No inbox is connected. In this sample workspace you can simulate sending — Bob records the reply and updates the count, but nothing leaves Bob. Or copy any draft to send it yourself."
              : "No inbox is connected, so Bob can't send these. Copy each draft, send it yourself, then mark it as replied."}
          </p>
        </div>
      ) : (
        <p className="mb-4 text-[14px] text-muted-foreground">Sending from {batch.providerLabel}.</p>
      )}

      {batch.alreadyReplied.length ? (
        <p className="mb-4 text-[14px] text-muted-foreground">Left out — already replied: {batch.alreadyReplied.map((a) => a.customerName).join(", ")}.</p>
      ) : null}

      <ul className="space-y-4">
        {rows.map((row) => (
          <ReplyCard
            key={row.enquiryId}
            row={row}
            mode={mode}
            busy={running}
            onChange={(body) => patch(row.enquiryId, { body })}
            onDecide={(decision) => patch(row.enquiryId, { decision })}
            onRetry={() => void retry(row)}
            onMarkReplied={() => void markReplied(row)}
          />
        ))}
      </ul>

      <div className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-line bg-background/92 px-4 pb-3 pt-3 backdrop-blur lg:mx-0 lg:rounded-2xl lg:border lg:px-5">
        {finished ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[15px]">
              <CheckCheck className="size-5 text-good-fg" />
              {outstanding ? `Done. ${outstanding} still waiting for a reply.` : "All caught up — nobody's waiting for a reply."}
            </p>
            <Button asChild>
              <Link href="/today">Back to Today</Link>
            </Button>
          </div>
        ) : mode === "copy" || !rows.some((r) => r.sendable && r.decision !== "skipped" && !(r.result && DONE.has(r.result.status))) ? (
          <p className="text-[14.5px] text-muted-foreground">Copy each draft, send it yourself, then tap Mark as replied.</p>
        ) : (
          <>
            <Button className="w-full" size="lg" disabled={!approvedCount || running} onClick={() => void sendApproved()}>
              {running ? <Loader2 className="animate-spin" /> : mode === "simulate" ? <FlaskConical /> : <SendHorizontal />}
              {running
                ? "Sending…"
                : approvedCount
                  ? `${mode === "simulate" ? "Simulate sending" : "Send"} ${approvedCount} approved ${approvedCount === 1 ? "reply" : "replies"}`
                  : "Approve a reply to send it"}
            </Button>
            {mode === "simulate" ? <p className="mt-1.5 text-center text-[12.5px] text-muted-foreground">Demo — nothing is sent. Instagram and phone replies are copied and marked by you.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}

function ReplyCard({
  row,
  mode,
  busy,
  onChange,
  onDecide,
  onRetry,
  onMarkReplied,
}: {
  row: Row;
  mode: Batch["mode"];
  busy: boolean;
  onChange: (body: string) => void;
  onDecide: (d: Decision) => void;
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
    el.style.height = `${Math.min(el.scrollHeight + 2, 420)}px`;
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
        <figure className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-line">
          <figcaption className="t-eyebrow mb-1">
            Their message{row.history.length ? ` · ${row.history.length} earlier` : ""}
          </figcaption>
          <blockquote className="whitespace-pre-line text-[14.5px] leading-relaxed text-foreground/90">{row.original.body}</blockquote>
        </figure>

        {row.flags.length && !done ? (
          <ul className="space-y-2">
            {row.flags.map((f, i) => {
              const Icon = FLAG_ICON[f.kind];
              return (
                <li key={i} className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-[14px] text-amber-100 ring-1 ring-amber-400/30">
                  <Icon className="mt-0.5 size-4 shrink-0 text-amber-300" />
                  <span>
                    <span className="font-semibold text-amber-200">Decide: {FLAG_LABEL[f.kind]}. </span>
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
              {done ? "What was sent" : "Your reply"}
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
            className="block w-full resize-none rounded-xl bg-[#0f0e0c] px-3.5 py-3 text-[15.5px] leading-relaxed text-foreground outline-none ring-1 ring-line-strong focus:ring-2 focus:ring-copper-400/80 read-only:text-muted-foreground"
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
            ) : manual || mode === "copy" ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => void copy()}>
                  <Copy /> Copy draft
                </Button>
                <Button size="sm" variant="outline" onClick={onMarkReplied} disabled={row.sending || !row.body.trim()}>
                  {row.sending ? <Loader2 className="animate-spin" /> : <Check />} Mark as replied
                </Button>
              </>
            ) : row.decision === "approved" ? (
              <Button size="sm" variant="success" onClick={() => onDecide("review")} disabled={row.sending || busy} aria-pressed>
                {row.sending ? <Loader2 className="animate-spin" /> : <Check />} Approved
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onDecide("approved")} disabled={row.decision === "skipped" || !row.body.trim()}>
                <Check /> Approve
              </Button>
            )}
            {!failed && !manual && mode !== "copy" ? (
              <Button size="sm" variant="ghost" onClick={() => area.current?.focus()} disabled={row.decision === "skipped"}>
                Edit
              </Button>
            ) : null}
            {!failed && !manual && mode !== "copy" ? (
              <Button size="sm" variant="ghost" onClick={() => void copy()}>
                <Copy /> Copy
              </Button>
            ) : null}
            {row.decision === "skipped" ? (
              <Button size="sm" variant="ghost" onClick={() => onDecide("review")}>
                <Undo2 /> Undo skip
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onDecide("skipped")} disabled={row.sending || busy}>
                <X /> Skip
              </Button>
            )}
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
