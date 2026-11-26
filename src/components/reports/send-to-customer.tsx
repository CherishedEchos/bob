"use client";

/**
 * "Send to customer": the thank-you email with the finished handover PDF and,
 * if switched on, one honest Google review request. Prepared from the
 * business's template; the person checks and edits it, then approves.
 *
 * With a connected mailbox it goes through Bob's approval (the same action
 * engine as everything else Bob sends). Without one, it's saved as a draft to
 * copy into their own email — then "I've sent it myself" records it.
 */
import * as React from "react";
import { Check, Copy, Download, Loader2, Mail, Paperclip, Send, Star, X } from "lucide-react";
import type { CustomerFollowUp, Job } from "@/lib/types";
import { useStore } from "@/lib/store/store";
import { fileUrl } from "@/lib/files/upload";
import { cn, copyToClipboard } from "@/lib/utils";
import { toast } from "@/components/ui/toaster";

interface Composed {
  to: string;
  subject: string;
  body: string;
  includeReview: boolean;
  reviewAvailable: boolean;
  reviewAlreadyRequested?: string;
  attachment?: { filename: string; fileId: string; version: number };
  alreadySent?: { at: string; version?: number; by?: string };
  mailbox: { connected: boolean; simulated: boolean; label?: string };
  draftId?: string;
}

const field = "block h-12 w-full rounded-xl border border-line-strong bg-field px-4 text-[16px] text-foreground outline-none transition placeholder:text-subtle focus:border-copper-500 focus:ring-[3px] focus:ring-copper-500/15";
const btn = "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-5 text-[16px] font-semibold transition disabled:opacity-55 [&_svg]:size-5";

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : "");

export function SendToCustomer({ job, onClose }: { job: Job; onClose: () => void }) {
  const { data, actions, propose, decide } = useStore();
  const [c, setC] = React.useState<Composed | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [to, setTo] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [review, setReview] = React.useState(false);
  const [edited, setEdited] = React.useState(false);
  const [busy, setBusy] = React.useState<null | "send" | "draft" | "manual">(null);
  const draft = data.followUps.find((f) => f.jobId === job.id && f.status === "draft");

  const load = React.useCallback(
    async (includeReview?: boolean) => {
      const r = await actions.run<Composed>("composeFollowUp", { jobId: job.id, includeReview });
      if (!r.ok) return setError(r.errors._ || "Couldn't prepare the email.");
      setC(r.value);
      setTo((t) => t || r.value.to);
      setSubject(r.value.subject);
      setBody(r.value.body);
      setReview(r.value.includeReview);
      setEdited(false);
    },
    [actions, job.id],
  );
  React.useEffect(() => {
    void load();
  }, [load]);

  const toggleReview = async (on: boolean) => {
    if (edited && !window.confirm("Switching the review link rewrites the message from your template. Your edits to the message will be replaced. Continue?")) return;
    await load(on);
  };

  /** Through Bob's action engine: prepare (checks, duplicates) then approve. */
  const run = async (draftOnly: boolean) => {
    setBusy(draftOnly ? "draft" : "send");
    const p = await propose("send_handover_email", { jobId: job.id, to, subject, body, includeReview: review, draftOnly });
    if (!p.ok) {
      setBusy(null);
      return toast(p.error, "error");
    }
    if (p.action.status !== "pending") {
      setBusy(null);
      return toast(p.action.error || "Couldn't prepare the email", "error");
    }
    const v = await decide(p.action.id, "approve");
    setBusy(null);
    if (!v || v.status !== "executed") return toast(v?.error || "The email didn't go. Nothing was recorded as sent.", "error");
    toast(v.resultMessage ?? (draftOnly ? "Draft saved" : "Sent"), "success");
    if (!draftOnly) onClose();
  };

  const markSent = async (f: CustomerFollowUp) => {
    setBusy("manual");
    const r = await actions.run("markFollowUpSent", { id: f.id });
    setBusy(null);
    if (!r.ok) return toast(r.errors._ || "Couldn't record it", "error");
    toast("Recorded as sent", "success");
    onClose();
  };

  if (error)
    return (
      <Panel onClose={onClose}>
        <p className="text-[15px] text-warn-fg">{error}</p>
      </Panel>
    );
  if (!c)
    return (
      <Panel onClose={onClose}>
        <p className="flex items-center gap-2 text-[15px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparing the email…
        </p>
      </Panel>
    );

  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <Panel onClose={onClose}>
      {c.alreadySent ? (
        <p role="status" className="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-[14.5px] text-good-fg ring-1 ring-emerald-500/25">
          Version {c.alreadySent.version} was already sent on {day(c.alreadySent.at)}{c.alreadySent.by ? ` (approved by ${c.alreadySent.by})` : ""}. To send an update, edit the handover and finish it again.
        </p>
      ) : null}
      <div className="space-y-3">
        <div>
          <label htmlFor="stc-to" className="mb-1 block text-[14px] font-medium">To</label>
          <input id="stc-to" className={field} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
        </div>
        <div>
          <label htmlFor="stc-subject" className="mb-1 block text-[14px] font-medium">Subject</label>
          <input id="stc-subject" className={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <label htmlFor="stc-body" className="mb-1 block text-[14px] font-medium">Message</label>
          <textarea
            id="stc-body"
            rows={11}
            className="block w-full rounded-xl border border-line-strong bg-field px-4 py-3 text-[15.5px] leading-relaxed text-foreground outline-none transition focus:border-copper-500 focus:ring-[3px] focus:ring-copper-500/15"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setEdited(true);
            }}
          />
        </div>
        {c.attachment ? (
          <a href={fileUrl(c.attachment.fileId, { download: true })} className="flex min-h-12 items-center gap-2.5 rounded-xl bg-surface-2 px-3.5 text-[14.5px] ring-1 ring-line hover:bg-surface-3">
            <Paperclip className="size-4 shrink-0 text-subtle" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{c.attachment.filename}</span>
            <Download className="size-4 shrink-0 text-subtle" aria-hidden />
          </a>
        ) : null}
        {c.reviewAvailable ? (
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl bg-card px-3.5 py-2.5 ring-1 ring-line">
            <input type="checkbox" className="size-6 shrink-0 accent-[var(--color-copper-500)]" checked={review} onChange={(e) => void toggleReview(e.target.checked)} />
            <Star className="size-5 shrink-0 text-accent-icon" aria-hidden />
            <span className="min-w-0 text-[14.5px]">
              <span className="block font-semibold text-heading">Ask for a Google review</span>
              <span className="block text-muted-foreground">An honest review, the same wording for every customer. Bob only asks once.</span>
            </span>
          </label>
        ) : c.reviewAlreadyRequested ? (
          <p className="text-[13.5px] text-muted-foreground">A review was already requested on {day(c.reviewAlreadyRequested)}, so this email won&apos;t ask again.</p>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">Review requests are off. Switch them on in Settings → Customer follow-ups.</p>
        )}
      </div>

      {c.mailbox.connected ? (
        <div className="mt-5">
          <button type="button" disabled={!!busy || !!c.alreadySent} onClick={() => void run(false)} className={cn(btn, "w-full bg-copper-500 text-white hover:bg-copper-600")}>
            {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />} {c.mailbox.simulated ? "Approve & send (demo)" : "Approve & send"}
          </button>
          <p className="mt-2 text-[13px] text-subtle">
            {c.mailbox.simulated ? "Demo workspace: nothing is really sent — the send is simulated and recorded." : `Sends from your ${c.mailbox.label} account with the PDF attached. Your name is recorded as approving it.`}
          </p>
          <button type="button" disabled={!!busy} onClick={() => void run(true)} className="mt-1 h-11 text-[14.5px] font-semibold text-accent-fg">
            Save as draft instead
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-3 rounded-xl bg-surface-2 px-4 py-3 text-[14px] text-muted-foreground">No email account is connected, so Bob doesn&apos;t send it. Save the draft, then send it from your own email with the PDF attached.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={!!busy} onClick={() => void run(true)} className={cn(btn, "bg-copper-500 text-white hover:bg-copper-600")}>
              {busy === "draft" ? <Loader2 className="animate-spin" /> : <Check />} {draft ? "Update draft" : "Save draft"}
            </button>
            <a href={mailto} className={cn(btn, "bg-card text-foreground ring-1 ring-line-strong hover:bg-surface-2")}>
              <Mail /> Open in my email app
            </a>
            <button
              type="button"
              onClick={async () => {
                const okCopy = await copyToClipboard(`To: ${to}\nSubject: ${subject}\n\n${body}`);
                toast(okCopy ? "Email copied" : "Couldn't copy — select the text instead", okCopy ? "success" : "error");
              }}
              className={cn(btn, "bg-card text-foreground ring-1 ring-line-strong hover:bg-surface-2")}
            >
              <Copy /> Copy email
            </button>
            {draft ? (
              <button type="button" disabled={!!busy || !!c.alreadySent} onClick={() => void markSent(draft)} className={cn(btn, "bg-card text-foreground ring-1 ring-line-strong hover:bg-surface-2")}>
                {busy === "manual" ? <Loader2 className="animate-spin" /> : <Check />} I&apos;ve sent it myself
              </button>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Panel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <section aria-label="Send to customer" className="mt-4 rounded-2xl bg-card p-5 ring-1 ring-line-strong">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold text-heading">Send to customer</h3>
          <p className="text-[14px] text-muted-foreground">A thank-you email with the handover report. Check it, change anything, then send.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 shrink-0 place-items-center rounded-xl text-subtle hover:bg-surface-2">
          <X className="size-5" />
        </button>
      </div>
      {children}
    </section>
  );
}

/** The follow-up trail on the job: handover → email → review request → reminder. */
export function FollowUpTrail({ job }: { job: Job }) {
  const { data, actions } = useStore();
  const [busy, setBusy] = React.useState<string | null>(null);
  const report = data.reports.find((r) => r.jobId === job.id);
  const fus = data.followUps.filter((f) => f.jobId === job.id);
  const sent = fus.filter((f) => f.status === "sent").sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))[0];
  const draft = fus.find((f) => f.status === "draft");
  const review = fus.find((f) => f.status === "sent" && f.reviewRequested);
  const via = (f: CustomerFollowUp) => (f.sentVia === "demo" ? "demo — simulated, nothing really sent" : f.sentVia === "manual" ? "sent from their own email" : `via ${f.sentVia === "gmail" ? "Gmail" : "Outlook"}`);
  const act = async (op: string, id: string, done: string) => {
    setBusy(op);
    const r = await actions.run(op, { id });
    setBusy(null);
    toast(r.ok ? done : r.errors._ || "Couldn't do that", r.ok ? "success" : "error");
  };
  const Row = ({ ok, label, children }: { ok: boolean | null; label: string; children: React.ReactNode }) => (
    <li className="flex gap-3 py-2">
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", ok ? "bg-emerald-600 text-white" : ok === null ? "bg-copper-500/15 text-accent-fg" : "bg-surface-3 text-subtle")}>{ok ? <Check className="size-3.5" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-current" />}</span>
      <span className="min-w-0 flex-1 text-[14.5px]">
        <span className="block font-medium text-heading">{label}</span>
        <span className="block text-muted-foreground">{children}</span>
      </span>
    </li>
  );
  if (!report?.completedAt) return null;
  return (
    <ol aria-label="Customer follow-up" className="mt-4 divide-y divide-line border-t border-line pt-1">
      <Row ok label="Handover completed">
        {day(report.completedAt)} by {report.completedBy}
      </Row>
      <Row ok={sent ? true : draft ? null : false} label="Customer email">
        {sent ? `Sent ${day(sent.sentAt)} — approved by ${sent.approvedBy}, ${via(sent)}` : draft ? "Draft saved — not sent yet" : "Not sent yet"}
      </Row>
      <Row ok={review ? true : false} label="Review request">
        {review ? `Requested ${day(review.sentAt)}` : "Not requested"}
      </Row>
      {review ? (
        <Row ok={review.reminderStatus === "sent" ? true : review.reminderStatus === "scheduled" ? null : false} label="Follow-up reminder">
          {review.reminderStatus === "scheduled" ? (
            <>
              Scheduled for {day(review.reminderDueAt)}{" "}
              <span className="mt-1 flex flex-wrap gap-3">
                <button type="button" disabled={!!busy} onClick={() => void act("sendFollowUpReminder", review.id, "Reminder sent")} className="h-9 font-semibold text-accent-fg">
                  Send now
                </button>
                <button type="button" disabled={!!busy} onClick={() => void act("cancelFollowUpReminder", review.id, "Reminder cancelled")} className="h-9 font-semibold text-muted-foreground">
                  Cancel reminder
                </button>
              </span>
            </>
          ) : review.reminderStatus === "sent" ? (
            `Sent ${day(review.reminderSentAt)}`
          ) : review.reminderStatus === "cancelled" ? (
            "Cancelled"
          ) : (
            "None (switched off in Settings)"
          )}
        </Row>
      ) : null}
    </ol>
  );
}
