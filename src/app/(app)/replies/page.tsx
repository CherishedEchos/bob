"use client";

/**
 * Batch replies: work through every written reply Bob drafted, one at a time.
 *
 *  - Each step shows who it's to, the channel, the customer's message and the
 *    editable draft together.
 *  - Approve & next (primary) or Skip for now. Previous and the step list let
 *    you move around without deciding; undecided drafts stay "To review".
 *  - Edits are saved to the enquiry as a draft (the same model as the enquiry
 *    screen), so they survive moving around and reloading. Decisions are kept
 *    for this browser tab.
 *  - The last step shows approved / skipped / to-review totals and one button
 *    that sends (or, in a sample workspace, simulates) only the approved ones.
 *    Each reply is its own request, so a failure can be retried without
 *    resending the others, and a reply can't be submitted twice.
 */
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, Copy, FlaskConical, Info, Loader2, Phone, RotateCcw, SendHorizontal, SkipForward, Undo2 } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import { needsReply, wantsCallback } from "@/lib/derive";
import { FLAG_TITLE } from "@/lib/reply-draft";
import { cn, copyToClipboard, firstName, timeAgo } from "@/lib/utils";
import { SourceIcon } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import type { Batch, BatchItem, SendItemResult } from "@/server/services/batch-replies";

type Decision = "review" | "approved" | "skipped";
type SaveState = "saved" | "unsaved" | "saving" | "error";
type ItemState = { body: string; decision: Decision; sending: boolean; save: SaveState; result?: SendItemResult };
type Row = BatchItem & ItemState;

const CHANNEL_LABEL: Record<BatchItem["channel"], string> = { email: "Email", instagram: "Instagram DM", phone: "Text message", other: "No contact details" };
const DONE = new Set(["sent", "simulated", "marked", "already_replied"]);
const isDone = (r: Row) => !!r.result && DONE.has(r.result.status);

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

/** Decisions survive moving around and a reload in this tab (not shared, not sent anywhere). */
const decisionsKey = (ids: string) => `bob.batch.decisions:${ids || "outstanding"}`;
function loadDecisions(ids: string): Record<string, Decision> {
  try {
    return JSON.parse(sessionStorage.getItem(decisionsKey(ids)) ?? "{}") as Record<string, Decision>;
  } catch {
    return {};
  }
}
function storeDecisions(ids: string, rows: Row[]) {
  try {
    sessionStorage.setItem(decisionsKey(ids), JSON.stringify(Object.fromEntries(rows.map((r) => [r.enquiryId, r.decision]))));
  } catch {
    /* private mode: decisions just aren't remembered across reloads */
  }
}

function ReviewReplies() {
  const params = useSearchParams();
  const ids = params.get("ids") ?? "";
  const { data, refresh, actions, can } = useStore();
  const [batch, setBatch] = React.useState<Batch | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [running, setRunning] = React.useState(false);
  const runningRef = React.useRef(false);
  const [index, setIndex] = React.useState(0);
  const [confirmLive, setConfirmLive] = React.useState(false);
  const [outcome, setOutcome] = React.useState<{ ok: number; failed: number; before: number } | null>(null);

  React.useEffect(() => {
    let live = true;
    void api<{ ok?: boolean; value?: Batch; error?: string }>(`/api/replies${ids ? `?ids=${encodeURIComponent(ids)}` : ""}`)
      .catch(() => ({ status: 0, body: { error: "Couldn't reach Bob — check your signal and reload." } as { value?: Batch; error?: string } }))
      .then((r) => {
        if (!live) return;
        if (r.status !== 200 || !r.body.value) return setError(r.body.error ?? "Couldn't prepare the drafts.");
        const remembered = loadDecisions(ids);
        setBatch(r.body.value);
        setRows(r.body.value.items.map((i) => ({ ...i, body: i.draft, decision: remembered[i.enquiryId] ?? "review", sending: false, save: "saved" })));
      });
    return () => {
      live = false;
    };
  }, [ids]);

  React.useEffect(() => {
    if (rows.length) storeDecisions(ids, rows);
  }, [ids, rows]);

  const outstanding = data.enquiries.filter(needsReply).length;
  const callbacks = data.enquiries.filter(wantsCallback);
  const patch = (id: string, p: Partial<ItemState>) => setRows((rs) => rs.map((r) => (r.enquiryId === id ? { ...r, ...p } : r)));

  /** Save an edited draft to the enquiry (not sent). */
  const saveEdit = async (row: Row) => {
    if (row.save !== "unsaved" || !row.body.trim() || !can("enquiries.write")) return;
    patch(row.enquiryId, { save: "saving" });
    const r = await actions.saveDraftReply(row.enquiryId, row.body);
    patch(row.enquiryId, { save: r.ok ? "saved" : "error" });
  };

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
  const sendable = (r: Row) => r.sendable && mode !== "copy" && !isDone(r);
  const queue = rows.filter((r) => r.decision === "approved" && sendable(r));
  const approvedCount = queue.length;

  const sendApproved = async () => {
    // A ref, not just state: two quick taps can't start two runs.
    if (runningRef.current || !approvedCount || mode === "copy") return;
    runningRef.current = true;
    setRunning(true);
    setOutcome(null);
    const before = outstanding;
    let failed = 0;
    let done = 0;
    for (const row of queue) {
      if (await sendOne(row, mode === "simulate" ? "simulate" : "send")) done++;
      else failed++;
    }
    await refresh();
    runningRef.current = false;
    setRunning(false);
    setOutcome({ ok: done, failed, before });
    if (failed) toast(`${done} recorded · ${failed} failed — the failed ${failed === 1 ? "draft is" : "drafts are"} kept so you can retry.`, "error");
    else toast(mode === "simulate" ? `${done} ${done === 1 ? "reply" : "replies"} recorded as sent (simulated)` : `${done} ${done === 1 ? "reply" : "replies"} sent`, "success");
  };

  const retry = async (row: Row) => {
    if (runningRef.current) return;
    const ok = await sendOne(row, mode === "simulate" ? "simulate" : "send");
    await refresh();
    toast(ok ? `Reply to ${row.customerName} ${mode === "simulate" ? "recorded (simulated)" : "sent"}` : `Still couldn't send to ${row.customerName}. The draft is kept.`, ok ? "success" : "error");
  };

  const markReplied = async (row: Row) => {
    const ok = await sendOne(row, "replied_elsewhere");
    await refresh();
    if (ok) toast(`${firstName(row.customerName)} moved out of Needs reply`, "success");
  };

  if (error) {
    return (
      <div className="panel p-6" role="alert">
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
  const go = (i: number) => {
    if (row) void saveEdit(row);
    setConfirmLive(false);
    setIndex(Math.max(0, Math.min(n, i)));
    document.querySelector("main")?.scrollTo({ top: 0 });
  };
  const counts = {
    approved: rows.filter((r) => r.decision === "approved" && !isDone(r)).length,
    skipped: rows.filter((r) => r.decision === "skipped" && !isDone(r)).length,
    review: rows.filter((r) => r.decision === "review" && !isDone(r)).length,
    done: rows.filter(isDone).length,
  };
  const modeNote =
    mode === "simulate"
      ? "Demo · sample data. Nothing is sent to anyone: approved email replies are recorded in Bob as simulated on the last step. Instagram replies you copy across yourself."
      : mode === "copy"
        ? "No inbox is connected, so Bob can't send these. Copy each reply, send it yourself, then tap I've replied."
        : `Live sending from ${batch.providerLabel}. Nothing is sent until you approve replies and confirm on the last step.`;

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/enquiries" className="-ml-1 inline-flex h-10 items-center gap-1.5 rounded-lg px-1 text-[14.5px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden /> Enquiries
          </Link>
          <div className="flex items-center gap-2" aria-live="polite">
            <span className="text-[13.5px] text-muted-foreground">Needs reply</span>
            <span className={cn("tabular text-[20px] font-semibold leading-none", outstanding ? "text-warn-fg" : "text-good-fg")} data-testid="outstanding-count">
              {outstanding}
            </span>
          </div>
        </div>
        <h1 className="t-page mt-1" aria-live="polite" data-testid="queue-position">
          {n === 0 ? "Nothing to draft" : inSummary ? "Review and finish" : `Draft ${index + 1} of ${n}`}
        </h1>
        {n ? (
          <>
            <ol className="mt-3 flex gap-1.5" aria-label="Drafts — tap one to jump to it">
              {rows.map((r, i) => (
                <li key={r.enquiryId} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Draft ${i + 1}: ${r.customerName}, ${isDone(r) ? "done" : r.decision === "approved" ? "approved" : r.decision === "skipped" ? "skipped" : "to review"}`}
                    aria-current={(i === index && !inSummary) || undefined}
                    className="group block w-full py-2"
                  >
                    <span
                      className={cn(
                        "block h-1.5 rounded-full transition",
                        isDone(r) ? "bg-emerald-500" : r.result?.status === "failed" ? "bg-red-500" : r.decision === "approved" ? "bg-copper-500" : r.decision === "skipped" ? "bg-[rgb(16_24_40/0.12)]" : "bg-[rgb(16_24_40/0.25)]",
                        i === index && !inSummary && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
                      )}
                    />
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-1 text-[13.5px] text-muted-foreground" aria-live="polite">
              {counts.approved} approved · {counts.skipped} skipped · {counts.review} to review{counts.done ? ` · ${counts.done} done` : ""}
            </p>
          </>
        ) : null}
        <p className="mt-2 flex items-start gap-2 text-[14px] leading-snug text-muted-foreground">
          <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" /> {modeNote}
        </p>
        {batch.alreadyReplied.length ? <p className="mt-1 text-[14px] text-muted-foreground">Left out — already replied: {batch.alreadyReplied.map((a) => a.customerName).join(", ")}.</p> : null}
        {callbacks.length ? (
          <p className="mt-1 flex items-start gap-2 text-[14px] leading-snug text-muted-foreground">
            <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" />
            <span>
              Not in this batch: {callbacks.map((c) => firstName(c.customerName)).join(", ")} asked for a call back — {callbacks.length === 1 ? "it's" : "they're"} on Today as a call.
            </span>
          </p>
        ) : null}
      </div>

      {n && !inSummary ? (
        <ReplyCard
          key={row.enquiryId}
          row={row}
          mode={mode}
          busy={running}
          onChange={(body) => patch(row.enquiryId, { body, save: "unsaved" })}
          onBlur={() => void saveEdit(row)}
          onRetry={() => void retry(row)}
          onMarkReplied={() => void markReplied(row)}
        />
      ) : null}

      {n && inSummary ? (
        <>
          <dl className="panel mb-3 grid grid-cols-3 divide-x divide-line">
            {[
              { label: "Approved", value: counts.approved, cls: counts.approved ? "text-accent-fg" : "text-subtle" },
              { label: "Skipped", value: counts.skipped, cls: "text-foreground" },
              { label: "To review", value: counts.review, cls: counts.review ? "text-warn-fg" : "text-subtle" },
            ].map((x) => (
              <div key={x.label} className="px-4 py-3 lg:px-5">
                <dd className={cn("tabular text-[24px] font-semibold leading-tight", x.cls)} data-testid={`total-${x.label.toLowerCase().replace(" ", "-")}`}>
                  {x.value}
                </dd>
                <dt className="text-[13.5px] text-muted-foreground">{x.label}</dt>
              </div>
            ))}
          </dl>
          <ul className="panel divide-y divide-line overflow-hidden">
            {rows.map((r, i) => (
              <li key={r.enquiryId} className={cn("flex items-center gap-3 px-4 py-3 lg:px-5", !isDone(r) && r.result?.status !== "failed" && "row-open")}>
                <SourceIcon source={r.source} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    {!isDone(r) && r.result?.status !== "failed" ? (
                      <button type="button" onClick={() => go(i)} className="row-target t-name truncate text-left after:absolute after:inset-0 after:content-['']">
                        {r.customerName}
                      </button>
                    ) : (
                      <span className="t-name truncate">{r.customerName}</span>
                    )}
                    <StatusPill row={r} mode={mode} />
                  </div>
                  <div className="truncate text-[14px] text-muted-foreground">
                    {r.result?.status === "failed" ? `Couldn't send: ${r.result.message}. Draft kept.` : r.result ? r.result.message : `${CHANNEL_LABEL[r.channel]}${r.to ? ` · ${r.to}` : ""}${sendable(r) ? "" : " — copy and send yourself"}`}
                  </div>
                </div>
                {r.result?.status === "failed" ? (
                  <Button size="sm" variant="secondary" onClick={() => void retry(r)} disabled={r.sending || running}>
                    {r.sending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {outcome ? (
            <div role="status" className={cn("mt-3 rounded-2xl px-4 py-3 text-[15px] ring-1", outcome.failed ? "bg-red-500/10 text-danger-fg ring-red-500/25" : "bg-emerald-500/10 text-good-fg ring-emerald-500/25")}>
              <p className="flex items-start gap-2 font-semibold">
                {outcome.failed ? <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> : <CheckCheck aria-hidden className="mt-0.5 size-4 shrink-0" />}
                {outcome.failed
                  ? `${outcome.ok} recorded, ${outcome.failed} failed. Failed drafts are kept — tap Retry.`
                  : mode === "simulate"
                    ? `${outcome.ok} ${outcome.ok === 1 ? "reply" : "replies"} recorded as sent (simulated). Nothing was sent to anyone.`
                    : `${outcome.ok} ${outcome.ok === 1 ? "reply" : "replies"} sent.`}
              </p>
              <p className="mt-0.5 pl-6 text-[14px] text-foreground">
                Needs reply: {outcome.before} → {outstanding}. Skipped and unreviewed drafts haven&apos;t changed.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {n ? (
        <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-line bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_20px_-12px_rgb(16_24_40/0.2)] lg:mx-0 lg:rounded-2xl lg:border lg:px-5">
          {!inSummary ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" className="h-12 w-12 px-0 sm:w-auto sm:px-4" disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous draft">
                <ArrowLeft /> <span className="hidden sm:inline">Previous</span>
              </Button>
              <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
                {isDone(row) ? (
                  <Button className="flex-1 sm:flex-none" onClick={() => go(index + 1)}>
                    {index === n - 1 ? "Review and finish" : "Next draft"}
                  </Button>
                ) : row.decision === "skipped" ? (
                  <>
                    <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => patch(row.enquiryId, { decision: "review" })}>
                      <Undo2 /> Undo skip
                    </Button>
                    <Button className="flex-1 sm:flex-none" onClick={() => go(index + 1)}>
                      {index === n - 1 ? "Review and finish" : "Next draft"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      className="flex-1 sm:flex-none"
                      onClick={() => {
                        patch(row.enquiryId, { decision: "skipped" });
                        go(index + 1);
                      }}
                    >
                      <SkipForward className="hidden sm:block" /> Skip for now
                    </Button>
                    {sendable(row) ? (
                      <Button
                        className="flex-1 sm:flex-none"
                        disabled={!row.body.trim() || row.sending}
                        onClick={() => {
                          patch(row.enquiryId, { decision: "approved" });
                          go(index + 1);
                        }}
                      >
                        <Check className="hidden sm:block" /> {row.decision === "approved" ? "Approved — next" : "Approve & next"}
                      </Button>
                    ) : (
                      <Button className="flex-1 sm:flex-none" onClick={() => go(index + 1)}>
                        {index === n - 1 ? "Review and finish" : "Next draft"}
                      </Button>
                    )}
                  </>
                )}
              </div>
              {sendable(row) && row.decision === "approved" && !isDone(row) ? (
                <button type="button" onClick={() => patch(row.enquiryId, { decision: "review" })} className="w-full text-left text-[13.5px] font-medium text-accent-fg sm:w-auto">
                  Undo approval
                </button>
              ) : null}
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
                  disabled={running}
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
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" className="-ml-2" onClick={() => go(n - 1)}>
                  <ArrowLeft /> Back to drafts
                </Button>
                {mode === "copy" || !rows.some((r) => r.sendable) ? (
                  <Button asChild className="ml-auto">
                    <Link href="/enquiries">Back to Enquiries</Link>
                  </Button>
                ) : approvedCount || running ? (
                  <Button className="ml-auto flex-1 sm:flex-none" disabled={running} onClick={() => (mode === "send" ? setConfirmLive(true) : void sendApproved())}>
                    {running ? <Loader2 className="animate-spin" /> : mode === "simulate" ? <FlaskConical /> : <SendHorizontal />}
                    {running
                      ? mode === "simulate"
                        ? "Recording…"
                        : "Sending…"
                      : mode === "simulate"
                        ? `Simulate sending ${approvedCount} ${approvedCount === 1 ? "reply" : "replies"}`
                        : `Send ${approvedCount} approved ${approvedCount === 1 ? "email" : "emails"}…`}
                  </Button>
                ) : (
                  <Button asChild variant={outcome ? "default" : "secondary"} className="ml-auto">
                    <Link href="/enquiries">Back to Enquiries</Link>
                  </Button>
                )}
              </div>
              {mode === "simulate" && approvedCount && !running ? (
                <p className="text-[13.5px] leading-snug text-muted-foreground">
                  Records each approved email reply in Bob as sent (simulated), adds it to the enquiry&apos;s history and moves it out of Needs reply. Nothing is sent to anyone. Skipped and unreviewed drafts stay as they are.
                </p>
              ) : !approvedCount && !outcome && mode !== "copy" ? (
                <p className="text-[13.5px] text-muted-foreground">Nothing approved yet. Go back to a draft and tap Approve & next to include it.</p>
              ) : null}
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
  onBlur,
  onRetry,
  onMarkReplied,
}: {
  row: Row;
  mode: Batch["mode"];
  busy: boolean;
  onChange: (body: string) => void;
  onBlur: () => void;
  onRetry: () => void;
  onMarkReplied: () => void;
}) {
  const area = React.useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = React.useState(false);
  const done = isDone(row);
  const failed = row.result?.status === "failed";
  const edited = row.body.trim() !== row.draft.trim();
  const manual = !row.sendable || mode === "copy";
  const titleId = `reply-${row.enquiryId}`;
  const first = firstName(row.customerName);

  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight + 2, 168)}px`;
  }, [row.body, row.decision]);

  const copy = async () => {
    const ok = await copyToClipboard(row.body);
    if (!ok) return toast("Couldn't copy — select the text and copy it instead", "error");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    toast(row.channel === "instagram" ? `Copied — paste it into your Instagram DM with ${row.to ?? first}` : `Copied — paste it into your reply to ${first}`, "success");
  };

  return (
    <article
      aria-labelledby={titleId}
      data-enquiry={row.enquiryId}
      className={cn("panel overflow-hidden transition", row.decision === "approved" && !done && "ring-2 ring-copper-500/40", failed && "ring-2 ring-red-500/40")}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4 lg:px-5">
        <SourceIcon source={row.source} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 id={titleId} className="t-name break-words">
              {row.customerName}
            </h2>
            <StatusPill row={row} mode={mode} />
          </div>
          <div className="mt-0.5 text-[14px] text-muted-foreground">
            {row.title} · {row.location} · {timeAgo(row.receivedAt)}
          </div>
          <div className="mt-1 text-[14px] text-muted-foreground">
            <span className="font-medium text-foreground">To: {CHANNEL_LABEL[row.channel]}</span>
            {row.to ? <span className="break-words"> · {row.to}</span> : null}
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4 lg:px-5">
        <figure className="rounded-2xl border-l-[3px] border-[rgb(16_24_40/0.18)] bg-message px-4 py-3.5">
          <figcaption className="mb-1 text-[14px] font-semibold text-foreground">
            Customer message{row.history.length ? ` · ${row.history.length} earlier` : ""}
          </figcaption>
          <blockquote className="whitespace-pre-line break-words text-[16px] leading-relaxed text-foreground">{row.original.body}</blockquote>
        </figure>

        {row.flags.length && !done ? (
          <ul className="space-y-1.5">
            {row.flags.map((f, i) => (
              <li key={i} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[14px] leading-snug", f.deferred ? "bg-message text-muted-foreground" : "bg-amber-500/10 text-warn-fg")}>
                {f.deferred ? <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />}
                <span>
                  <span className={cn("font-semibold", f.deferred && "text-foreground")}>{FLAG_TITLE[f.kind]}.</span> {f.text}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[14px]">
            <label htmlFor={`draft-${row.enquiryId}`} className="font-semibold text-foreground">
              {done ? "What was recorded" : row.savedDraft || edited ? "Edit your draft" : "Edit Bob's draft"}
            </label>
            {!done ? (
              <span aria-live="polite" className="text-[13.5px] text-muted-foreground">
                {row.save === "saving" ? "Saving…" : row.save === "error" ? <span className="text-danger-fg">Couldn&apos;t save — your edit is still here</span> : row.save === "unsaved" ? "Editing…" : edited || row.savedDraft ? <span className="text-good-fg">Edit saved as draft</span> : null}
              </span>
            ) : null}
          </div>
          <textarea
            id={`draft-${row.enquiryId}`}
            ref={area}
            value={row.body}
            readOnly={done || row.sending}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className="block w-full resize-none overflow-hidden rounded-2xl bg-field px-4 py-3.5 text-[16px] leading-relaxed text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.05)] outline-none ring-1 ring-input hover:ring-foreground/30 focus:ring-2 focus:ring-copper-500 read-only:bg-message read-only:text-muted-foreground read-only:shadow-none"
          />
        </div>

        {row.result ? (
          <p className={cn("flex items-start gap-2 text-[14px]", failed ? "text-danger-fg" : row.result.status === "already_replied" ? "text-muted-foreground" : "text-good-fg")} role={failed ? "alert" : undefined}>
            {failed ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}
            <span>{failed ? `Couldn't send: ${row.result.message}. Your draft is kept — nothing else was resent.` : row.result.message}</span>
          </p>
        ) : null}

        {!done ? (
          <>
            {manual ? (
              <p className="flex items-start gap-2 text-[14px] leading-snug text-muted-foreground">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" />
                <span>
                  {row.channel === "instagram"
                    ? `Bob can't send Instagram messages. Copy the reply, paste it into your DM with ${row.to ?? first}, then tap I've replied.`
                    : row.channel === "phone"
                      ? `Copy the reply and text it to ${row.to}, then tap I've replied.`
                      : "Copy the reply and send it yourself, then tap I've replied."}
                </span>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {failed ? (
                <Button size="sm" onClick={onRetry} disabled={row.sending || busy}>
                  {row.sending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry this reply
                </Button>
              ) : null}
              <Button size="sm" variant={manual ? "default" : "secondary"} onClick={() => void copy()} disabled={!row.body.trim()}>
                {copied ? <Check /> : <Copy />} <span aria-live="polite">{copied ? "Copied" : "Copy reply"}</span>
              </Button>
              {manual ? (
                <Button size="sm" variant="secondary" onClick={onMarkReplied} disabled={row.sending || !row.body.trim()}>
                  {row.sending ? <Loader2 className="animate-spin" /> : <CheckCheck />} I&apos;ve replied
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}

function StatusPill({ row, mode }: { row: Row; mode: Batch["mode"] }) {
  const s = row.result?.status;
  const manual = !row.sendable || mode === "copy";
  const [label, cls] =
    s === "sent"
      ? ["Sent", "bg-emerald-500/10 text-good-fg ring-emerald-500/25"]
      : s === "simulated"
        ? ["Recorded (simulated)", "bg-violet-500/10 text-violet-fg ring-violet-500/25"]
        : s === "marked"
          ? ["Replied", "bg-emerald-500/10 text-good-fg ring-emerald-500/25"]
          : s === "already_replied"
            ? ["Already replied", "bg-surface-2 text-muted-foreground ring-line"]
            : s === "failed"
              ? ["Failed", "bg-red-500/10 text-danger-fg ring-red-500/25"]
              : row.decision === "approved"
                ? ["Approved", "bg-selected text-accent-fg ring-copper-500/35"]
                : row.decision === "skipped"
                  ? ["Skipped", "bg-surface-2 text-muted-foreground ring-line"]
                  : manual
                    ? ["Copy & send yourself", "bg-surface-2 text-muted-foreground ring-line"]
                    : ["To review", "bg-amber-500/10 text-warn-fg ring-amber-500/25"];
  return <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 text-[12.5px] font-medium ring-1", cls)}>{label}</span>;
}
