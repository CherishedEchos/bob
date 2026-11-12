"use client";

/**
 * One enquiry, as a workspace you can work through quickly:
 *  - a compact header (who, what, channel, when) with Contact details behind a toggle;
 *  - one scroll area: the customer's message in full, then the reply editor,
 *    which grows with its content; less-used tools folded underneath;
 *  - a sticky action bar: Copy reply, Save draft, Mark as replied (and Send…
 *    only when a mailbox is connected — that always needs approval).
 * Used beside the inbox on desktop, as a full screen on phones, and as a
 * sheet when opened from elsewhere (Today, Bob, a customer).
 */
import * as React from "react";
import { AlarmClock, AlertTriangle, ArrowLeft, CalendarCheck, CheckCheck, ChevronDown, Copy, FileText, HardHat, Mail, Phone, Save, Send, UserRound } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, PRIORITY_LABEL, SOURCE_LABEL, followUpDue, needsReply } from "@/lib/derive";
import { buildDraft, latestInbound } from "@/lib/reply-draft";
import type { ActionView } from "@/lib/bob/types";
import type { Enquiry, Priority } from "@/lib/types";
import { addDaysKey, cn, copyToClipboard, firstName, formatDateInline, timeAgo } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { HighPriority, InstagramGlyph, SourceIcon, enquiryState } from "@/components/common/status";
import { StatusText } from "@/components/common/bits";
import { NotesPanel } from "@/components/common/notes";
import { PhotoGrid } from "@/components/common/photos";
import { QuotesList } from "@/components/common/quotes-list";
import { ActionCard } from "@/components/assistant/assistant-cards";
import { Fold } from "@/components/jobs/job-sheet";
import { useVisualViewport } from "@/lib/use-media";

/** Same heuristic the server uses — shown as a warning only. */
const SUSPICIOUS = /\b(ignore|disregard)\b.{0,40}\binstructions?\b|\byou are now\b|\badmin mode\b|\bsystem prompt\b|\bmark\b.{0,40}\bpaid\b/i;

export function EnquirySheet() {
  const ui = useUI();
  const { data } = useStore();
  const vv = useVisualViewport();
  const enquiry = data.enquiries.find((e) => e.id === ui.enquiryId);
  return (
    <Sheet open={!!enquiry} onOpenChange={(o) => !o && ui.closeEnquiry()}>
      {enquiry ? (
        <SheetContent
          title={`Enquiry from ${enquiry.customerName}`}
          className="overflow-hidden bg-card sm:w-[min(760px,96vw)] [&>button:last-child]:hidden"
          // Follow the visible screen on phones so the actions sit above the keyboard.
          style={vv ? { height: vv.height, top: vv.offsetTop, bottom: "auto" } : undefined}
        >
          <EnquiryDetail id={enquiry.id} onBack={() => ui.closeEnquiry()} backLabel="Close" />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

export function EnquiryDetail({ id, onBack, backLabel = "Back to inbox", inline = false }: { id: string; onBack?: () => void; backLabel?: string; inline?: boolean }) {
  const { data } = useStore();
  const e = data.enquiries.find((x) => x.id === id);
  if (!e) return null;
  return <Workspace key={e.id} e={e} onBack={onBack} backLabel={backLabel} inline={inline} />;
}

function Workspace({ e, onBack, backLabel, inline }: { e: Enquiry; onBack?: () => void; backLabel: string; inline: boolean }) {
  const { data, actions, can, propose, decide } = useStore();
  const ui = useUI();
  const write = can("enquiries.write");
  const replied = !needsReply(e);
  const suggestion = React.useMemo(() => buildDraft(e), [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reply, setReply] = React.useState(e.draftReply ?? suggestion.draft);
  const [saved, setSaved] = React.useState<"saved" | "unsaved" | "saving">(e.draftReply ? "saved" : "unsaved");
  const [contactOpen, setContactOpen] = React.useState(false);
  const [confirmReplied, setConfirmReplied] = React.useState(false);
  const [pending, setPending] = React.useState<ActionView | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<HTMLTextAreaElement>(null);
  const emailConnected = data.connections.some((c) => c.kind === "email" && (c.status === "connected" || c.status === "demo"));
  const canSend = emailConnected && !!e.email && can("email.send") && !replied;
  const state = enquiryState(e, !needsReply(e) && followUpDue(e));
  const inbound = e.messages.filter((m) => m.direction === "inbound");
  const latest = latestInbound(e);
  const earlier = e.messages.filter((m) => m !== latest);
  const [showEarlier, setShowEarlier] = React.useState(false);
  const flagged = inbound.some((m) => SUSPICIOUS.test(m.body));
  const channel = e.source === "instagram" ? "Instagram" : e.email ? "your email" : e.source === "phone" ? "a text message" : "your usual app";

  // A draft saved elsewhere (e.g. by Bob or the batch screen) replaces what's shown — unless you're mid-edit.
  const lastServerDraft = React.useRef(e.draftReply);
  React.useEffect(() => {
    if (e.draftReply === lastServerDraft.current) return;
    const untouched = saved !== "unsaved" || reply === (lastServerDraft.current ?? suggestion.draft);
    lastServerDraft.current = e.draftReply;
    if (untouched && e.draftReply !== undefined) {
      setReply(e.draftReply);
      setSaved("saved");
    }
  }, [e.draftReply]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Draft reply" from Today or Bob lands on the reply.
  React.useEffect(() => {
    if (ui.enquiryFocus !== "reply") return;
    const t = setTimeout(() => editor.current?.scrollIntoView({ block: "center" }), 120);
    return () => clearTimeout(t);
  }, [ui.enquiryFocus]);

  // The editor grows with its content; the one scroll area handles the rest.
  React.useLayoutEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight + 2, 168)}px`;
  }, [reply]);

  const save = async (quiet = false) => {
    if (!write || (saved === "saved" && reply === (e.draftReply ?? ""))) return true;
    setSaved("saving");
    const res = await actions.saveDraftReply(e.id, reply);
    setSaved(res.ok ? "saved" : "unsaved");
    if (!quiet || !res.ok) toast(res.ok ? "Draft saved — not sent" : Object.values(res.errors)[0] ?? "Couldn't save", res.ok ? "success" : "error");
    return res.ok;
  };
  const setFollowUp = async (date: string | null) => {
    const res = await actions.updateEnquiry(e.id, { followUpDate: date });
    toast(res.ok ? (date ? `Follow-up set for ${formatDateInline(date)}` : "Follow-up cleared") : Object.values(res.errors)[0] ?? "Couldn't save", res.ok ? "success" : "error");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ---------------- Compact header ---------------- */}
      <header className="shrink-0 border-b border-line px-4 pb-3 pt-3 sm:px-5">
        <div className="flex items-start gap-3">
          {onBack ? (
            <button type="button" onClick={onBack} aria-label={backLabel} className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-foreground/90 hover:bg-surface-3">
              <ArrowLeft className="size-5" />
            </button>
          ) : null}
          <SourceIcon source={e.source} provider={e.provider} className={cn("hidden shrink-0 sm:grid", onBack ? "mt-1" : "mt-0.5")} />
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 break-words text-[19px] font-semibold leading-tight tracking-tight">{e.customerName}</h2>
            <p className="mt-0.5 truncate text-[14.5px] text-muted-foreground">
              <span className="text-foreground/85">{e.title}</span> · {e.location}
            </p>
            <p className="mt-0.5 text-[13.5px] text-subtle">
              {SOURCE_LABEL[e.source]} · {timeAgo(e.receivedAt)}
            </p>
          </div>
          <button
            type="button"
            aria-expanded={contactOpen}
            aria-controls={`contact-${e.id}`}
            onClick={() => setContactOpen((o) => !o)}
            className="flex h-10 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[14px] font-semibold text-muted-foreground ring-1 ring-line-strong transition hover:text-foreground sm:gap-1.5 sm:px-3"
          >
            <span className="hidden sm:inline">Contact details</span>
            <span className="sm:hidden">Contact</span>
            <ChevronDown className={cn("size-4 transition", contactOpen && "rotate-180")} />
          </button>
        </div>
        <div className={cn("mt-2 flex flex-wrap items-center gap-x-4 gap-y-1", onBack && "pl-9 sm:pl-[96px]")}>
          <StatusText tone={state.main.tone}>{state.main.label}</StatusText>
          {state.high ? <HighPriority /> : null}
          {e.followUpDate ? (
            <span className="inline-flex items-center gap-1 text-[13.5px] text-muted-foreground">
              <CalendarCheck className="size-3.5" /> Follow up {formatDateInline(e.followUpDate)}
            </span>
          ) : null}
        </div>
        {contactOpen ? (
          <div id={`contact-${e.id}`} className="mt-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-line">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14.5px]">
              {e.phone ? (
                <>
                  <dt className="text-subtle">Phone</dt>
                  <dd className="text-foreground/90">{e.phone}</dd>
                </>
              ) : null}
              {e.email ? (
                <>
                  <dt className="text-subtle">Email</dt>
                  <dd className="break-all text-foreground/90">{e.email}</dd>
                </>
              ) : null}
              {e.instagramHandle ? (
                <>
                  <dt className="text-subtle">Instagram</dt>
                  <dd className="text-foreground/90">{e.instagramHandle}</dd>
                </>
              ) : null}
              {!e.phone && !e.email && !e.instagramHandle ? <dd className="col-span-2 text-muted-foreground">No contact details recorded.</dd> : null}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {e.phone ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={`tel:${e.phone.replace(/\s/g, "")}`}>
                    <Phone /> Call
                  </a>
                </Button>
              ) : null}
              {e.email ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={`mailto:${e.email}`}>
                    <Mail /> Email
                  </a>
                </Button>
              ) : null}
              {e.instagramHandle ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    const ok = await copyToClipboard(e.instagramHandle!);
                    toast(ok ? "Instagram handle copied" : "Couldn't copy", ok ? "success" : "error");
                  }}
                >
                  <InstagramGlyph className="size-4" /> Copy handle
                </Button>
              ) : null}
              {e.customerId ? (
                <Button variant="ghost" size="sm" onClick={() => ui.openCustomer(e.customerId!)}>
                  <UserRound /> Customer record
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      {/* ---------------- One scroll area: message → reply → more ---------------- */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className={cn("mx-auto w-full px-4 py-4 sm:px-5", inline ? "max-w-[760px]" : "max-w-none")}>
          <section aria-labelledby={`msg-${e.id}`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <h3 id={`msg-${e.id}`} className="text-[14px] font-semibold text-muted-foreground">
                Customer message
              </h3>
              <span className="text-[13px] text-subtle">{latest ? timeAgo(latest.at) : ""}</span>
            </div>
            {earlier.length ? (
              <button type="button" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} className="mb-2 h-9 text-[14px] font-medium text-accent-fg">
                {showEarlier ? "Hide" : "Show"} {earlier.length} earlier {earlier.length === 1 ? "message" : "messages"}
              </button>
            ) : null}
            {showEarlier ? (
              <ol className="mb-3 space-y-2">
                {earlier.map((m) => (
                  <li key={m.id} className={cn("rounded-xl px-3.5 py-2.5 text-[15px]", m.direction === "inbound" ? "bg-white/[0.03]" : "ml-6 bg-copper-500/[0.07]")}>
                    <div className="mb-0.5 text-[13px] text-subtle">
                      {m.direction === "inbound" ? firstName(e.customerName) : "You"} · {timeAgo(m.at)}
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">{m.body}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="rounded-2xl border-l-2 border-white/15 bg-white/[0.03] px-4 py-3.5">
              {latest?.subject ? <div className="mb-1 text-[14px] font-medium text-muted-foreground">{latest.subject}</div> : null}
              {flagged ? (
                <div className="mb-2 flex items-center gap-1.5 text-[14px] text-warn-fg">
                  <AlertTriangle className="size-4" /> Contains instructions aimed at an assistant — Bob ignores them.
                </div>
              ) : null}
              <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-foreground/90" data-testid="customer-message">
                {latest?.body ?? (e.description || "No message recorded.")}
              </p>
            </div>
          </section>

          <section aria-labelledby={`reply-label-${e.id}`} className="mt-5">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label id={`reply-label-${e.id}`} htmlFor={`reply-${e.id}`} className="text-[14px] font-semibold text-muted-foreground">
                {replied ? "Your reply" : e.draftReply || saved === "saved" ? "Your draft" : "Suggested reply"}
              </label>
              <span aria-live="polite">
                {replied ? (
                  <StatusText tone="green">Replied{e.lastContactAt ? ` ${timeAgo(e.lastContactAt)}` : ""}</StatusText>
                ) : saved === "saving" ? (
                  <StatusText tone="neutral">Saving…</StatusText>
                ) : saved === "saved" ? (
                  <StatusText tone="green">Draft saved</StatusText>
                ) : write ? (
                  <StatusText tone="neutral">Not saved yet</StatusText>
                ) : null}
              </span>
            </div>
            {!replied && suggestion.flags.length && !suggestion.savedDraft ? (
              <ul className="mb-2 space-y-1.5">
                {suggestion.flags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[14px] text-warn-fg">
                    <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span>
                      <span className="font-semibold">Check {f.kind === "commitment" ? "the promise" : f.kind}:</span> {f.text}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <textarea
              id={`reply-${e.id}`}
              ref={editor}
              value={reply}
              readOnly={!write}
              onChange={(ev) => {
                setReply(ev.target.value);
                setSaved("unsaved");
              }}
              onBlur={() => void save(true)}
              className="block w-full resize-none overflow-hidden rounded-2xl bg-[#0f0f11] px-4 py-3.5 text-[16px] leading-relaxed text-foreground outline-none ring-1 ring-white/[0.12] transition placeholder:text-subtle focus:ring-2 focus:ring-copper-400 focus:ring-offset-2 focus:ring-offset-card"
            />
            <p className="mt-2 text-[14px] text-subtle">
              {canSend
                ? "Send… goes through your connected mailbox and always asks you to approve it first."
                : `Nothing is sent from Bob. Copy the reply into ${channel}, send it yourself, then tap Mark as replied.`}
            </p>
            {pending ? (
              <ActionCard
                action={pending}
                onDecide={async (d, edits) => {
                  const v = await decide(pending.id, d, edits);
                  if (v) setPending(v);
                }}
              />
            ) : null}
          </section>

          <div className="-mx-4 mt-6 sm:-mx-5">
            {write ? (
              <Fold title="Follow-up" summary={e.followUpDate ? `Follow up ${formatDateInline(e.followUpDate)}` : "Not set"}>
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="date" aria-label="Follow-up date" value={e.followUpDate ?? ""} onChange={(ev) => setFollowUp(ev.target.value || null)} className="w-auto" />
                  <Button size="sm" variant="secondary" onClick={() => setFollowUp(addDaysKey(1))}>Tomorrow</Button>
                  <Button size="sm" variant="secondary" onClick={() => setFollowUp(addDaysKey(3))}>In 3 days</Button>
                  <Button size="sm" variant="secondary" onClick={() => setFollowUp(addDaysKey(7))}>Next week</Button>
                  {e.followUpDate ? <Button size="sm" variant="ghost" onClick={() => setFollowUp(null)}>Clear</Button> : null}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="-ml-2 mt-3"
                  onClick={() => ui.openForm({ form: "reminder", title: `Follow up with ${e.customerName} about the ${e.title.toLowerCase()}`, dueDate: e.followUpDate ?? addDaysKey(1), customerId: e.customerId, relatedType: "enquiry", relatedId: e.id })}
                >
                  <AlarmClock /> Also add a reminder
                </Button>
              </Fold>
            ) : null}
            <Fold title="Notes" summary={e.notes.length ? `${e.notes.length} ${e.notes.length === 1 ? "note" : "notes"}` : "None yet"}>
              <NotesPanel notes={e.notes} onAdd={(t) => actions.addEnquiryNote(e.id, t)} />
            </Fold>
            <Fold title="Photos" summary={`${data.photos.filter((p) => p.relatedType === "enquiry" && p.relatedId === e.id).length || "No"} photos`}>
              <PhotoGrid relatedType="enquiry" relatedId={e.id} />
            </Fold>
            {write ? (
              <Fold title="Quote & job" summary={e.jobId ? "Turned into a job" : data.quotes.some((q) => q.enquiryId === e.id) ? "Quote recorded" : "Record a quote or turn it into a job"}>
                {data.quotes.some((q) => q.enquiryId === e.id) ? (
                  <div className="mb-3">
                    <QuotesList quotes={data.quotes.filter((q) => q.enquiryId === e.id)} />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {e.jobId ? (
                    <Button variant="secondary" onClick={() => ui.openJob(e.jobId!)}>
                      <HardHat /> View job
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        ui.openForm({
                          form: "job",
                          enquiryId: e.id,
                          customerId: e.customerId,
                          values: { customerName: e.customerName, customerPhone: e.phone ?? "", customerEmail: e.email ?? "", title: e.title, location: e.location, description: e.description },
                        })
                      }
                    >
                      <HardHat /> Turn into a job
                    </Button>
                  )}
                  {can("quotes.write") && e.customerId && e.status !== "won" ? (
                    <Button variant="secondary" onClick={() => ui.openForm({ form: "quote", customerId: e.customerId, enquiryId: e.id })}>
                      <FileText /> Record a quote
                    </Button>
                  ) : null}
                </div>
              </Fold>
            ) : null}
            {write ? (
              <Fold title="Status & priority" summary={`${ENQUIRY_STATUS_LABEL[e.status]} · ${PRIORITY_LABEL[e.priority]} priority`} last>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ENQUIRY_STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={async () => {
                        if (s === e.status) return;
                        const res = await actions.setEnquiryStatus(e.id, s);
                        if (res.ok) toast(`Moved to ${ENQUIRY_STATUS_LABEL[s]}`);
                      }}
                      aria-pressed={e.status === s}
                      className={cn("h-10 rounded-xl text-[14px] font-medium transition", e.status === s ? "bg-copper-500/18 text-accent-fg" : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground")}
                    >
                      {ENQUIRY_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[14px] font-medium text-muted-foreground">Priority</div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {(["high", "medium", "low"] as Priority[]).map((p) => (
                        <button
                          key={p}
                          onClick={async () => {
                            if (p === e.priority) return;
                            const res = await actions.updateEnquiry(e.id, { priority: p });
                            if (res.ok) toast(`Priority set to ${PRIORITY_LABEL[p].toLowerCase()}`);
                          }}
                          aria-pressed={e.priority === p}
                          className={cn("h-10 rounded-xl text-[14px] font-medium transition", e.priority === p ? "bg-copper-500/18 text-accent-fg" : "bg-surface-2 text-muted-foreground hover:bg-surface-3")}
                        >
                          {PRIORITY_LABEL[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-[14px] font-medium text-muted-foreground">Assigned to</span>
                    <NativeSelect
                      className="mt-2"
                      value={e.assignedUserId ?? ""}
                      onChange={async (ev) => {
                        const res = await actions.updateEnquiry(e.id, { assignedUserId: ev.target.value || null });
                        if (res.ok) toast("Assignee updated");
                      }}
                    >
                      <option value="">Nobody</option>
                      {data.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
              </Fold>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---------------- Sticky action bar ---------------- */}
      {write ? (
        <div className="shrink-0 border-t border-line bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5" role="toolbar" aria-label="Reply actions">
          {confirmReplied ? (
            <div className="mb-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-line">
              <p className="text-[15.5px]">Have you sent your reply to {firstName(e.customerName)} yourself?</p>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConfirmReplied(false)}>
                  Not yet
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    await save(true);
                    const res = await actions.markEnquiryReplied(e.id);
                    setConfirmReplied(false);
                    toast(res.ok ? `${firstName(e.customerName)} marked as replied` : "Couldn't update", res.ok ? "success" : "error");
                  }}
                >
                  Yes, mark as replied
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {canSend ? (
              <Button
                size="sm"
                onClick={async () => {
                  await save(true);
                  const r = await propose("send_email", { to: e.email, subject: `Re: ${e.title}`, body: reply, enquiryId: e.id, customerId: e.customerId, purpose: "reply" });
                  if (r.ok) {
                    setPending(r.action);
                    setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }), 50);
                  } else toast(r.error, "error");
                }}
              >
                <Send /> Send…
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 sm:flex-none"
              onClick={async () => {
                await save(true);
                const ok = await copyToClipboard(reply);
                toast(ok ? `Reply copied — paste it into ${channel}` : "Couldn't copy — select the text instead", ok ? "success" : "error");
              }}
            >
              <Copy /> Copy reply
            </Button>
            <Button size="sm" variant="secondary" className="flex-1 sm:flex-none" disabled={saved === "saved" || replied} onClick={() => void save()}>
              <Save /> {saved === "saved" ? "Saved" : "Save draft"}
            </Button>
            {!replied && !confirmReplied ? (
              <Button size="sm" variant="ghost" className="w-full sm:ml-auto sm:w-auto" onClick={() => setConfirmReplied(true)}>
                <CheckCheck /> Mark as replied
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
