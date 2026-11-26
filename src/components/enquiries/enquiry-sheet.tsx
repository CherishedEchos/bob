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
import { AlarmClock, AlertTriangle, ArrowLeft, CalendarCheck, Check, CheckCheck, ChevronDown, Copy, FileText, HardHat, Info, Mail, Phone, PhoneCall, MapPinned, Reply, Save, Send, UserRound } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { ENQUIRY_STATUS_LABEL, PRIORITY_LABEL, SOURCE_LABEL, followUpDue, needsReply, wantsCallback } from "@/lib/derive";
import { FLAG_TITLE, buildDraft, latestInbound } from "@/lib/reply-draft";
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
import { FilesPanel } from "@/components/files/files-panel";
import { QuotesList } from "@/components/common/quotes-list";
import { ActionCard } from "@/components/assistant/assistant-cards";
import { Fold } from "@/components/jobs/job-sheet";
import { useVisualViewport } from "@/lib/use-media";

/** Same heuristic the server uses — shown as a warning only. */
const SUSPICIOUS = /\b(ignore|disregard)\b.{0,40}\binstructions?\b|\byou are now\b|\badmin mode\b|\bsystem prompt\b|\bmark\b.{0,40}\bpaid\b/i;


/** Stages in the order work moves through them (awaiting reply / replied are the reply states). */
const STAGE_ORDER = ["new", "awaiting_reply", "replied", "site_visit", "quote_required", "quoted", "won", "lost"] as const;

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
  // Ask Bob knows which enquiry is open ("draft a reply", "book a site visit"); the page's own context comes back on close.
  const { setPageContext } = ui;
  const prevContext = React.useRef(ui.pageContext);
  React.useEffect(() => {
    const prev = prevContext.current;
    setPageContext({ type: "enquiry", id: e.id, label: `${e.customerName}'s enquiry` });
    return () => setPageContext(prev?.type === "enquiry" ? null : prev);
  }, [e.id, e.customerName, setPageContext]);
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
  const callback = wantsCallback(e);
  const first = firstName(e.customerName);
  const [copied, setCopied] = React.useState(false);
  // Where the reply actually goes, and what to do with it — in plain words.
  const route =
    e.email
      ? { channel: "email", toast: `paste it into your reply to ${first}'s email`, how: `Copy the reply, paste it into your reply to ${first}'s email (${e.email}) and send it. Then tap I've replied.` }
      : e.instagramHandle || e.source === "instagram"
        ? { channel: "Instagram", toast: `paste it into your Instagram DM with ${e.instagramHandle ?? first}`, how: `Copy the reply, open Instagram and paste it into your DM with ${e.instagramHandle ?? first}. Then tap I've replied. Instagram isn't connected to Bob, so nothing is sent from here.` }
        : e.phone
          ? { channel: "a text message", toast: `paste it into a text to ${e.phone}`, how: `Copy the message and paste it into a text to ${e.phone}. Then tap I've replied.` }
          : { channel: "your usual app", toast: "paste it wherever you reply to them", how: "Copy the reply and send it from your email or phone. Then tap I've replied." };
  const channel = route.channel;

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
          <SourceIcon source={e.source} provider={e.provider} name={e.customerName} className={cn("hidden shrink-0 sm:grid", onBack ? "mt-1" : "mt-0.5")} />
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 break-words text-[19px] font-semibold leading-tight tracking-tight">{e.customerName}</h2>
            <p className="mt-0.5 truncate text-[14.5px] text-muted-foreground">
              <span className="text-foreground/85">{e.title}</span> · {e.location}
            </p>
            <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground">
              {SOURCE_LABEL[e.source]}
              {e.email ? ` · ${e.email}` : e.instagramHandle ? ` · ${e.instagramHandle}` : e.phone ? ` · ${e.phone}` : ""} · {timeAgo(e.receivedAt)}
            </p>
          </div>
          <button
            type="button"
            aria-expanded={contactOpen}
            aria-controls={`contact-${e.id}`}
            onClick={() => setContactOpen((o) => !o)}
            className="flex h-10 shrink-0 items-center gap-1 rounded-xl bg-card px-2.5 text-[14px] font-semibold text-foreground ring-1 ring-line-strong transition hover:bg-raised-hover sm:gap-1.5 sm:px-3"
          >
            <span className="hidden sm:inline">Contact details</span>
            <span className="sm:hidden">Contact</span>
            <ChevronDown className={cn("size-4 transition", contactOpen && "rotate-180")} />
          </button>
        </div>
        <div className={cn("mt-2 flex flex-wrap items-center gap-x-4 gap-y-1", onBack && "pl-9 sm:pl-[96px]")}>
          {callback ? <StatusText tone="amber">Asked for a call back</StatusText> : <StatusText tone={state.main.tone}>{state.main.label}</StatusText>}
          {state.high ? <HighPriority /> : null}
          {e.followUpDate ? (
            <span className="inline-flex items-center gap-1 text-[13.5px] text-muted-foreground">
              <CalendarCheck className="size-3.5" /> Follow up {formatDateInline(e.followUpDate)}
            </span>
          ) : null}
        </div>
        {contactOpen ? (
          <div id={`contact-${e.id}`} className="mt-3 rounded-xl bg-message p-3">
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
          {write ? (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="toolbar" aria-label="Enquiry actions">
              <Button size="sm" variant="secondary" className="justify-center" onClick={() => { editor.current?.focus(); editor.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                <Reply /> Reply
              </Button>
              {can("quotes.write") ? (
                <Button size="sm" variant="secondary" className="justify-center" onClick={() => ui.openForm({ form: "quote", customerId: e.customerId, enquiryId: e.id })}>
                  <FileText /> Create quote
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                className="justify-center"
                onClick={() => {
                  if (e.status !== "site_visit") void actions.setEnquiryStatus(e.id, "site_visit");
                  ui.openForm({ form: "reminder", title: `Site visit: ${e.customerName}${e.location ? `, ${e.location}` : ""}`, dueDate: addDaysKey(2), customerId: e.customerId, relatedType: "enquiry", relatedId: e.id });
                }}
              >
                <MapPinned /> Book site visit
              </Button>
              <Button size="sm" variant="secondary" className="justify-center" onClick={() => ui.openForm({ form: "reminder", title: `Follow up with ${e.customerName} about the ${e.title.toLowerCase()}`, dueDate: e.followUpDate ?? addDaysKey(3), customerId: e.customerId, relatedType: "enquiry", relatedId: e.id })}>
                <AlarmClock /> Follow up
              </Button>
            </div>
          ) : null}
          <section aria-labelledby={`msg-${e.id}`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <h3 id={`msg-${e.id}`} className="text-[14px] font-semibold text-foreground">
                {callback && e.source === "phone" ? "Voicemail summary" : "Customer message"}
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
                  <li key={m.id} className={cn("rounded-xl px-3.5 py-2.5 text-[15px]", m.direction === "inbound" ? "bg-message" : "ml-6 bg-selected")}>
                    <div className="mb-0.5 text-[13px] text-subtle">
                      {m.direction === "inbound" ? firstName(e.customerName) : "You"} · {timeAgo(m.at)}
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">{m.body}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="rounded-2xl border-l-[3px] border-[rgb(16_24_40/0.18)] bg-message px-4 py-3.5">
              {latest?.subject ? <div className="mb-1 text-[14px] font-medium text-muted-foreground">{latest.subject}</div> : null}
              {flagged ? (
                <div className="mb-2 flex items-center gap-1.5 text-[14px] text-warn-fg">
                  <AlertTriangle className="size-4" /> Contains instructions aimed at an assistant — Bob ignores them.
                </div>
              ) : null}
              <p className="whitespace-pre-wrap break-words text-[16px] leading-relaxed text-foreground" data-testid="customer-message">
                {latest?.body ?? (e.description || "No message recorded.")}
              </p>
            </div>
          </section>

          {callback && !replied ? (
            <section aria-label="Next step" className="mt-4 rounded-2xl bg-selected px-4 py-3.5 ring-1 ring-copper-500/25">
              <p className="text-[15.5px] font-semibold text-heading">Next step: call {first} back</p>
              <p className="mt-0.5 text-[14.5px] text-muted-foreground">
                {first} asked for a call back{e.phone ? ` on ${e.phone}` : ""}. Bob doesn&apos;t promise a price or a start date — talk it through, then tap I&apos;ve called {first}.
              </p>
              {e.phone ? (
                <Button asChild className="mt-3 w-full sm:w-auto">
                  <a href={`tel:${e.phone.replace(/\s/g, "")}`}>
                    <PhoneCall /> Call {first} back
                  </a>
                </Button>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby={`reply-label-${e.id}`} className="mt-5">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label id={`reply-label-${e.id}`} htmlFor={`reply-${e.id}`} className="text-[14px] font-semibold text-foreground">
                {replied ? "Your reply" : callback ? `Optional: text ${first} instead` : e.draftReply || saved === "saved" ? "Edit your draft" : "Edit Bob's draft"}
              </label>
              <span aria-live="polite">
                {replied ? (
                  <StatusText tone="green">{replyStateLabel(e)}</StatusText>
                ) : saved === "saving" ? (
                  <StatusText tone="neutral">Saving…</StatusText>
                ) : saved === "saved" ? (
                  <StatusText tone="green">Draft saved</StatusText>
                ) : write ? (
                  <StatusText tone="neutral">Not saved yet</StatusText>
                ) : null}
              </span>
            </div>
            {!replied && suggestion.flags.length ? (
              <ul className="mb-2 space-y-1.5">
                {suggestion.flags.map((f, i) => (
                  <li
                    key={i}
                    className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[14px] leading-snug", f.deferred ? "bg-message text-muted-foreground" : "bg-amber-500/10 text-warn-fg")}
                  >
                    {f.deferred ? <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />}
                    <span>
                      <span className={cn("font-semibold", f.deferred && "text-foreground")}>{FLAG_TITLE[f.kind]}.</span> {f.text}
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
              className="block w-full resize-none overflow-hidden rounded-2xl bg-field px-4 py-3.5 text-[16px] leading-relaxed text-foreground shadow-[0_1px_2px_rgb(16_24_40/0.05)] outline-none ring-1 ring-input transition placeholder:text-subtle hover:ring-foreground/30 focus:ring-2 focus:ring-copper-500 read-only:bg-message read-only:shadow-none"
            />
            {!replied ? (
              <p className="mt-2 flex items-start gap-2 text-[14px] leading-snug text-muted-foreground">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" />
                <span>
                  {canSend
                    ? "Send… goes through your connected mailbox and always asks you to approve it first."
                    : callback
                      ? `Prefer to text? Copy the message and paste it into a text to ${e.phone}. Nothing is sent from Bob.`
                      : route.how}
                </span>
              </p>
            ) : null}
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
            <Fold title="Photos & attachments" summary={`${data.files.filter((f) => f.enquiryId === e.id && !f.deletedAt).length || "No"} files`}>
              <FilesPanel enquiryId={e.id} compact />
            </Fold>
            {write ? (
              <Fold title="Quote & job" defaultOpen={e.status === "quoted" || e.status === "won" || e.status === "quote_required" || e.status === "site_visit"} summary={e.jobId ? "Won — job created" : data.quotes.some((q) => q.enquiryId === e.id) ? "Quote recorded" : "Record a quote or mark it won"}>
                {data.quotes.some((q) => q.enquiryId === e.id) ? (
                  <div className="mb-3">
                    <QuotesList quotes={data.quotes.filter((q) => q.enquiryId === e.id)} />
                  </div>
                ) : null}
                <WonToJob e={e} />
              </Fold>
            ) : null}
            {write ? (
              <Fold title="Status & priority" summary={`${ENQUIRY_STATUS_LABEL[e.status]} · ${PRIORITY_LABEL[e.priority]} priority`} last>
                <div className="text-[14px] font-medium text-muted-foreground">Stage</div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {STAGE_ORDER.map((s) => (
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
            <div className="mb-3 rounded-xl bg-message p-3">
              <p className="text-[15.5px]">
                {callback ? `Have you spoken to ${first}?` : `Have you sent your reply to ${first} in ${channel === "email" ? "your email" : channel}?`}
              </p>
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
                    toast(res.ok ? `${first} moved out of Needs reply` : "Couldn't update", res.ok ? "success" : "error");
                  }}
                >
                  <Check /> {callback ? `Yes, I've called ${first}` : "Yes, I've replied"}
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
            {callback && e.phone && !replied ? (
              <Button asChild size="sm" className="flex-1 sm:flex-none">
                <a href={`tel:${e.phone.replace(/\s/g, "")}`}>
                  <PhoneCall /> Call {first} back
                </a>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={canSend || callback || replied ? "secondary" : "default"}
              className="flex-1 sm:flex-none"
              disabled={!reply.trim()}
              onClick={async () => {
                const ok = await copyToClipboard(reply);
                if (!ok) return toast("Couldn't copy — select the text and copy it instead", "error");
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
                toast(`Copied — now ${route.toast}`, "success");
                void save(true);
              }}
            >
              {copied ? <Check /> : <Copy />} <span aria-live="polite">{copied ? "Copied" : callback ? "Copy text" : "Copy reply"}</span>
            </Button>
            {!replied ? (
              <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" disabled={saved !== "unsaved"} onClick={() => void save()}>
                <Save /> {saved === "saved" ? "Draft saved" : saved === "saving" ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
            {!replied && !confirmReplied ? (
              <Button size="sm" variant="secondary" className="w-full sm:ml-auto sm:w-auto" onClick={() => setConfirmReplied(true)}>
                <CheckCheck /> {callback ? `I've called ${first}` : "I've replied"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The path from quote to job: record a quote, then mark the enquiry won. The
 * job carries the customer, site and price across; doing it twice returns the
 * same job. The success state offers Schedule work straight away.
 */
function WonToJob({ e }: { e: Enquiry }) {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justCreated, setJustCreated] = React.useState<string | null>(null);
  const job = e.jobId ? data.jobs.find((j) => j.id === e.jobId) : undefined;
  const quote = data.quotes.find((q) => q.enquiryId === e.id && q.status !== "declined");
  const win = async () => {
    setBusy(true);
    setError(null);
    const r = await actions.run<{ id: string; existed: boolean }>("convertToJob", { enquiryId: e.id });
    setBusy(false);
    if (!r.ok) return setError(r.errors._ || "Couldn't create the job. Nothing was changed.");
    setJustCreated(r.value.id);
    toast(r.value.existed ? "This enquiry already has a job — opened it" : `Won! Job created for ${e.customerName}`, "success");
  };
  if (job) {
    return (
      <div className={cn("rounded-2xl p-4 ring-1", justCreated ? "bg-emerald-500/[0.07] ring-emerald-500/25" : "bg-message ring-line")}>
        <p className="text-[15.5px] font-semibold">{justCreated ? "Job created" : "Won — this is a job now"}</p>
        <p className="mt-0.5 text-[14px] text-muted-foreground">
          {job.title} for {job.customerName} · {job.siteAddress || job.location}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {can("schedule.manage") ? (
            <Button size="sm" onClick={() => ui.openForm({ form: "booking", jobId: job.id })}>
              <CalendarCheck /> Schedule work
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => ui.openJob(job.id)}>
            <HardHat /> Open job
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {quote ? (
        <p className="text-[14.5px] text-muted-foreground">
          Quote {quote.status === "sent" ? "sent" : quote.status} · the job will use this price.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[14px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {can("jobs.write") ? (
          <Button size="sm" disabled={busy} onClick={() => void win()}>
            <HardHat /> {busy ? "Creating job…" : "Won — create job"}
          </Button>
        ) : null}
        {can("quotes.write") && e.customerId && !quote ? (
          <Button size="sm" variant="secondary" onClick={() => ui.openForm({ form: "quote", customerId: e.customerId, enquiryId: e.id })}>
            <FileText /> Record a quote
          </Button>
        ) : null}
      </div>
      <p className="text-[13px] text-muted-foreground">Creating the job carries {e.customerName.split(" ")[0]}&apos;s details and the site ({e.location}) across. You can change them on the job.</p>
    </div>
  );
}

/** Which kind of reply was recorded: sent by Bob, simulated in the demo, or sent elsewhere and recorded by hand. */
function replyStateLabel(e: Enquiry): string {
  const last = [...e.messages].reverse().find((m) => m.direction === "outbound");
  const when = e.lastContactAt ? ` ${timeAgo(e.lastContactAt)}` : "";
  if (!last || last.channel === "manual") return `Reply recorded (sent outside Bob)${when}`;
  if (last.channel === "simulated" || last.channel === "demo_inbox") return `Recorded as sent — demo, nothing left Bob${when}`;
  if (last.channel === "gmail" || last.channel === "outlook") return `Sent from ${last.channel === "gmail" ? "Gmail" : "Outlook"}${when}`;
  return `Replied${when}`;
}
