"use client";

import { PhotoGrid } from "@/components/common/photos";

import * as React from "react";
import { AlarmClock, AlertTriangle, CalendarCheck, CheckCheck, Copy, FileText, HardHat, Mail, MapPin, Phone, Save, Send, UserRound } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, PRIORITY_LABEL, SOURCE_LABEL, needsReply } from "@/lib/derive";
import type { ActionView } from "@/lib/bob/types";
import type { Priority } from "@/lib/types";
import { addDaysKey, cn, copyToClipboard, timeAgo, firstName, formatDateInline } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { EnquiryStatusBadge, PriorityBadge, SourceIcon, InstagramGlyph } from "@/components/common/status";
import { NotesPanel } from "@/components/common/notes";
import { ActionCard } from "@/components/assistant/assistant-cards";
import { Section } from "@/components/jobs/job-sheet";
import { QuotesList } from "@/components/common/quotes-list";

/** Same heuristic the server uses — shown as a warning only. */
const SUSPICIOUS = /\b(ignore|disregard)\b.{0,40}\binstructions?\b|\byou are now\b|\badmin mode\b|\bsystem prompt\b|\bmark\b.{0,40}\bpaid\b/i;

export function EnquirySheet() {
  const ui = useUI();
  const { data } = useStore();
  const enquiry = data.enquiries.find((e) => e.id === ui.enquiryId);
  return (
    <Sheet open={!!enquiry} onOpenChange={(o) => !o && ui.closeEnquiry()}>
      {enquiry ? (
        <SheetContent title={`Enquiry from ${enquiry.customerName}`} className="lg:w-[min(1000px,94vw)]">
          <EnquiryDetail id={enquiry.id} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

export function EnquiryDetail({ id, inline = false }: { id: string; inline?: boolean }) {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const replyRef = React.useRef<HTMLDivElement>(null);
  // "Draft reply" from Today or Bob lands straight on the reply, not the contact details.
  React.useEffect(() => {
    if (ui.enquiryFocus !== "reply") return;
    const t = setTimeout(() => replyRef.current?.scrollIntoView({ block: "start" }), 150);
    return () => clearTimeout(t);
  }, [id, ui.enquiryFocus]);
  const e = data.enquiries.find((x) => x.id === id)!;
  const write = can("enquiries.write");

  const setFollowUp = async (date: string | null) => {
    const res = await actions.updateEnquiry(e.id, { followUpDate: date });
    toast(res.ok ? (date ? `Follow-up set for ${formatDateInline(date)}` : "Follow-up cleared") : Object.values(res.errors)[0] ?? "Couldn't save", res.ok ? "success" : "error");
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <div className={cn("flex items-start gap-3", !inline && "pr-12")}>
          <SourceIcon source={e.source} provider={e.provider} className="size-11 rounded-xl" />
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold leading-tight tracking-tight">{e.customerName}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[15px] text-muted-foreground">
              {e.title}
              <span aria-hidden>·</span>
              <MapPin className="size-3.5 text-accent-icon" />
              {e.location}
            </p>
            <p className="mt-1 text-[14px] text-subtle">
              {SOURCE_LABEL[e.source]}
              {e.provider ? ` (${e.provider === "demo_inbox" ? "demo inbox" : e.provider})` : ""} · received {timeAgo(e.receivedAt)}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <EnquiryStatusBadge status={e.status} />
          <PriorityBadge priority={e.priority} />
          {e.followUpDate ? (
            <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
              <CalendarCheck className="size-3" /> Follow up {formatDateInline(e.followUpDate)}
            </span>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              <InstagramGlyph className="size-4" /> {e.instagramHandle}
            </Button>
          ) : null}
          {e.customerId ? (
            <Button variant="ghost" size="sm" onClick={() => ui.openCustomer(e.customerId!)}>
              <UserRound /> Customer
            </Button>
          ) : null}
        </div>
        <dl className="mt-3 space-y-1 text-[14.5px] text-muted-foreground">
          {e.phone ? <div>Phone: <span className="text-foreground/90">{e.phone}</span></div> : null}
          {e.email ? <div>Email: <span className="text-foreground/90">{e.email}</span></div> : null}
        </dl>
      </div>

      <div ref={replyRef} className="scroll-mt-2">
        <ReplyPanel id={e.id} />
      </div>

      {e.messages.length > 1 ? (
        <Section title="Full conversation">
          <ol className="space-y-2.5">
            {e.messages.map((m) => (
              <li key={m.id} className={cn("rounded-2xl px-3.5 py-3 ring-1", m.direction === "inbound" ? "bg-card ring-line" : "ml-6 bg-copper-500/8 ring-copper-500/20")}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[13px] text-subtle">
                  <span>
                    {m.direction === "inbound" ? firstName(e.customerName) : "You"}
                    {m.subject ? ` · ${m.subject}` : ""}
                  </span>
                  <span>{timeAgo(m.at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[15.5px] leading-relaxed text-foreground/90">{m.body}</p>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {write ? (
        <Section title="Status">
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
                className={cn(
                  "h-10 rounded-xl text-[14px] font-medium ring-1 transition",
                  e.status === s ? "bg-copper-500/18 text-accent-fg ring-copper-500/60" : "bg-surface-2 text-muted-foreground ring-line hover:bg-surface-3 hover:text-foreground",
                )}
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
                    className={cn(
                      "h-10 rounded-xl text-[14px] font-medium ring-1 transition",
                      e.priority === p ? "bg-copper-500/18 text-accent-fg ring-copper-500/60" : "bg-surface-2 text-muted-foreground ring-line hover:bg-surface-3",
                    )}
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
        </Section>
      ) : null}

      {write ? (
        <Section title="Follow-up">
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
        </Section>
      ) : null}

      {write ? (
        <Section title="Next step">
          <div className="flex flex-wrap gap-2">
            {e.jobId ? (
              <Button variant="secondary" onClick={() => ui.openJob(e.jobId!)}>
                <HardHat /> View job
              </Button>
            ) : (
              <Button
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
        </Section>
      ) : null}

      {data.quotes.some((q) => q.enquiryId === e.id) ? (
        <Section title="Quotes">
          <QuotesList quotes={data.quotes.filter((q) => q.enquiryId === e.id)} />
        </Section>
      ) : null}

      <Section title="Photos">
        <PhotoGrid relatedType="enquiry" relatedId={e.id} />
      </Section>

      <Section title="Notes" className="pb-10">
        <NotesPanel notes={e.notes} onAdd={(t) => actions.addEnquiryNote(e.id, t)} />
      </Section>
    </div>
  );
}

/**
 * Reply workspace: the customer's message beside the draft (stacked on
 * phones). Drafts save when you leave the box or copy. Copying never changes
 * the status — only "Mark as replied" does.
 */
function ReplyPanel({ id }: { id: string }) {
  const { data, actions, can, propose, decide } = useStore();
  const e = data.enquiries.find((x) => x.id === id)!;
  const [reply, setReply] = React.useState(e.draftReply ?? e.suggestedReply);
  const [saved, setSaved] = React.useState<"saved" | "unsaved" | "saving">(e.draftReply ? "saved" : "unsaved");
  const [confirmReplied, setConfirmReplied] = React.useState(false);
  const [pending, setPending] = React.useState<ActionView | null>(null);
  const emailConnected = data.connections.some((c) => c.kind === "email" && (c.status === "connected" || c.status === "demo"));
  const write = can("enquiries.write");
  const inbound = e.messages.filter((m) => m.direction === "inbound");
  const latest = inbound.at(-1);
  const flagged = inbound.some((m) => SUSPICIOUS.test(m.body));
  const channel = e.source === "instagram" ? "Instagram" : e.source === "email" ? "your email" : e.source === "phone" ? "a text message" : "your usual app";
  const replied = !needsReply(e);

  React.useEffect(() => {
    setReply(e.draftReply ?? e.suggestedReply);
    setSaved(e.draftReply ? "saved" : "unsaved");
    setConfirmReplied(false);
    setPending(null);
  }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A draft saved elsewhere (e.g. by Bob) replaces what's shown — unless you're mid-edit.
  const lastServerDraft = React.useRef(e.draftReply);
  React.useEffect(() => {
    if (e.draftReply === lastServerDraft.current) return;
    const untouched = saved !== "unsaved" || reply === (lastServerDraft.current ?? e.suggestedReply);
    lastServerDraft.current = e.draftReply;
    if (untouched && e.draftReply !== undefined) {
      setReply(e.draftReply);
      setSaved("saved");
    }
  }, [e.draftReply]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (quiet = false) => {
    if (!write || (saved === "saved" && reply === (e.draftReply ?? ""))) return true;
    setSaved("saving");
    const res = await actions.saveDraftReply(e.id, reply);
    setSaved(res.ok ? "saved" : "unsaved");
    if (!quiet || !res.ok) toast(res.ok ? "Draft saved (not sent)" : Object.values(res.errors)[0] ?? "Couldn't save", res.ok ? "success" : "error");
    return res.ok;
  };

  return (
    <section className="border-t border-line px-5 py-5 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold uppercase tracking-wider text-subtle">{replied ? "Your reply" : "Reply"}</h3>
        {replied ? (
          <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[13px] font-medium text-good-fg ring-1 ring-emerald-500/30">
            Replied{e.lastContactAt ? ` ${timeAgo(e.lastContactAt)}` : ""}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[14px] font-medium text-muted-foreground">
            What {firstName(e.customerName)} said{latest ? ` · ${timeAgo(latest.at)}` : ""}
          </div>
          <div className="rounded-2xl bg-card p-4 ring-1 ring-line">
            {latest?.subject ? <div className="mb-1 text-[14px] font-medium text-muted-foreground">{latest.subject}</div> : null}
            {flagged ? (
              <div className="mb-2 flex items-center gap-1.5 text-[14px] text-warn-fg">
                <AlertTriangle className="size-4" /> Contains instructions aimed at an assistant — Bob ignores them.
              </div>
            ) : null}
            <p className="whitespace-pre-wrap text-[16px] leading-relaxed">{latest?.body ?? (e.description || "No message recorded.")}</p>
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[14px] font-medium text-muted-foreground">
            <label htmlFor={`reply-${e.id}`}>{e.draftReply ? "Your draft" : "Suggested reply"}</label>
            <span aria-live="polite" className={cn("text-[13px]", saved === "saved" ? "text-good-fg" : "text-subtle")}>
              {saved === "saving" ? "Saving…" : saved === "saved" ? "Draft saved" : write ? "Not saved yet" : ""}
            </span>
          </div>
          <Textarea
            id={`reply-${e.id}`}
            value={reply}
            readOnly={!write}
            onChange={(ev) => {
              setReply(ev.target.value);
              setSaved("unsaved");
            }}
            onBlur={() => void save(true)}
            className="min-h-48 text-[16px] sm:min-h-56"
          />
          <p className="mt-2 text-[14px] text-subtle">
            {emailConnected && e.email ? "Sending goes through your connected mailbox and needs your approval." : `Nothing is sent from Bob here. Copy it into ${channel}, then mark it replied.`}
          </p>
          <div className="sticky bottom-0 z-10 -mx-5 mt-3 grid grid-cols-2 gap-2 border-t border-line bg-ink-900/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:flex sm:flex-wrap sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            {emailConnected && e.email && can("email.send") ? (
              <Button
                onClick={async () => {
                  const r = await propose("send_email", { to: e.email, subject: `Re: ${e.title}`, body: reply, enquiryId: e.id, customerId: e.customerId, purpose: "reply" });
                  if (r.ok) setPending(r.action);
                  else toast(r.error, "error");
                }}
              >
                <Send /> Send…
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={async () => {
                await save(true);
                const ok = await copyToClipboard(reply);
                toast(ok ? "Copied — it stays in Needs your reply until you mark it replied" : "Couldn't copy — select the text instead", ok ? "success" : "error");
              }}
            >
              <Copy /> Copy
            </Button>
            {write ? (
              <Button variant="secondary" disabled={saved === "saved"} onClick={() => void save()}>
                <Save /> Save draft
              </Button>
            ) : null}
            {write && !replied && !confirmReplied ? (
              <Button variant="outline" className="col-span-2" onClick={() => setConfirmReplied(true)}>
                <CheckCheck /> Mark as replied
              </Button>
            ) : null}
          </div>
          {pending ? (
            <ActionCard
              action={pending}
              onDecide={async (d, edits) => {
                const v = await decide(pending.id, d, edits);
                if (v) setPending(v);
              }}
            />
          ) : null}
          {confirmReplied ? (
            <div className="mt-3 rounded-2xl bg-copper-500/10 p-4 ring-1 ring-copper-500/35">
              <p className="text-[16px]">Have you sent your reply to {firstName(e.customerName)}?</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => setConfirmReplied(false)}>
                  Not yet
                </Button>
                <Button
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
        </div>
      </div>
    </section>
  );
}
