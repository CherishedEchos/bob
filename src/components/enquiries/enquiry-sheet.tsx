"use client";

import * as React from "react";
import { AlarmClock, CalendarCheck, Copy, HardHat, Mail, MapPin, Phone, Save, Send } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, PRIORITY_LABEL, SOURCE_LABEL } from "@/lib/derive";
import type { Priority } from "@/lib/types";
import { addDaysKey, cn, copyToClipboard, timeAgo, firstName, formatDateInline } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { EnquiryStatusBadge, PriorityBadge, SourceIcon, InstagramGlyph } from "@/components/common/status";
import { NotesPanel } from "@/components/common/notes";

export function EnquirySheet() {
  const ui = useUI();
  const { data } = useStore();
  const enquiry = data.enquiries.find((e) => e.id === ui.enquiryId);
  return (
    <Sheet open={!!enquiry} onOpenChange={(o) => !o && ui.closeEnquiry()}>
      {enquiry ? (
        <SheetContent title={`Enquiry from ${enquiry.customerName}`}>
          <EnquiryDetail id={enquiry.id} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-white/[0.06] px-5 py-5 sm:px-6", className)}>
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-subtle">{title}</h3>
      {children}
    </section>
  );
}

function EnquiryDetail({ id }: { id: string }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const e = data.enquiries.find((x) => x.id === id)!;
  const [reply, setReply] = React.useState(e.draftReply ?? e.suggestedReply);
  const [confirmReplied, setConfirmReplied] = React.useState(false);

  React.useEffect(() => {
    setReply(e.draftReply ?? e.suggestedReply);
    setConfirmReplied(false);
  }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFollowUp = (date: string | undefined) => {
    const res = actions.updateEnquiry(e.id, { followUpDate: date });
    if (res.ok) toast(date ? `Follow-up set for ${formatDateInline(date)}` : "Follow-up cleared");
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <div className="flex items-start gap-3 pr-12">
          <SourceIcon source={e.source} className="size-11 rounded-2xl" />
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold leading-tight tracking-tight">{e.customerName}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[14px] text-muted-foreground">
              {e.title}
              <span aria-hidden>·</span>
              <MapPin className="size-3.5 text-copper-400" />
              {e.location}
            </p>
            <p className="mt-1 text-[13px] text-subtle">
              {SOURCE_LABEL[e.source]} · received {timeAgo(e.receivedAt)}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <EnquiryStatusBadge status={e.status} />
          <PriorityBadge priority={e.priority} />
          {e.followUpDate ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[12px] text-muted-foreground ring-1 ring-white/10">
              <CalendarCheck className="size-3" /> Follow up {formatDateInline(e.followUpDate)}
            </span>
          ) : null}
        </div>

        {/* Contact */}
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
        </div>
        <dl className="mt-3 space-y-1 text-[13.5px] text-muted-foreground">
          {e.phone ? <div>Phone: <span className="text-foreground/90">{e.phone}</span></div> : null}
          {e.email ? <div>Email: <span className="text-foreground/90">{e.email}</span></div> : null}
        </dl>
      </div>

      <Section title="What they asked for">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{e.description || "No details recorded."}</p>
      </Section>

      <Section title="Status">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ENQUIRY_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => {
                const res = actions.setEnquiryStatus(e.id, s);
                if (res.ok && s !== e.status) toast(`Moved to ${ENQUIRY_STATUS_LABEL[s]}`);
              }}
              aria-pressed={e.status === s}
              className={cn(
                "h-10 rounded-xl text-[13px] font-medium ring-1 transition",
                e.status === s
                  ? "bg-copper-500/18 text-copper-200 ring-copper-500/60"
                  : "bg-white/[0.03] text-muted-foreground ring-white/10 hover:bg-white/[0.07] hover:text-foreground",
              )}
            >
              {ENQUIRY_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="mt-4 text-[13px] font-medium text-muted-foreground">Priority</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(["high", "medium", "low"] as Priority[]).map((p) => (
            <button
              key={p}
              onClick={() => {
                if (p === e.priority) return;
                const res = actions.updateEnquiry(e.id, { priority: p });
                if (res.ok) toast(`Priority set to ${PRIORITY_LABEL[p].toLowerCase()}`);
              }}
              aria-pressed={e.priority === p}
              className={cn(
                "h-10 rounded-xl text-[13px] font-medium ring-1 transition",
                e.priority === p
                  ? "bg-copper-500/18 text-copper-200 ring-copper-500/60"
                  : "bg-white/[0.03] text-muted-foreground ring-white/10 hover:bg-white/[0.07]",
              )}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Follow-up">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Follow-up date"
            value={e.followUpDate ?? ""}
            onChange={(ev) => setFollowUp(ev.target.value || undefined)}
            className="w-auto"
          />
          <Button size="sm" variant="secondary" onClick={() => setFollowUp(addDaysKey(1))}>Tomorrow</Button>
          <Button size="sm" variant="secondary" onClick={() => setFollowUp(addDaysKey(3))}>In 3 days</Button>
          <Button size="sm" variant="secondary" onClick={() => setFollowUp(addDaysKey(7))}>Next week</Button>
          {e.followUpDate ? (
            <Button size="sm" variant="ghost" onClick={() => setFollowUp(undefined)}>Clear</Button>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="mt-3 -ml-2"
          onClick={() =>
            ui.openForm({ form: "reminder", title: `Follow up with ${e.customerName} about the ${e.title.toLowerCase()}`, dueDate: e.followUpDate ?? addDaysKey(1) })
          }
        >
          <AlarmClock /> Also add a reminder
        </Button>
      </Section>

      <Section title={e.draftReply ? "Your saved draft reply" : "Suggested reply"}>
        <Textarea
          value={reply}
          onChange={(ev) => setReply(ev.target.value)}
          aria-label="Reply text"
          className="min-h-48 text-[14.5px]"
        />
        <p className="mt-2 text-[12.5px] text-subtle">
          Sending isn&apos;t connected yet — copy this into {e.source === "instagram" ? "Instagram" : e.source === "email" ? "your email" : "a text message"}, then mark as replied.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const ok = await copyToClipboard(reply);
              toast(ok ? "Reply copied" : "Couldn't copy — select the text instead", ok ? "success" : "error");
            }}
          >
            <Copy /> Copy
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const res = actions.saveDraftReply(e.id, reply);
              toast(res.ok ? "Draft saved (not sent)" : Object.values(res.errors)[0], res.ok ? "success" : "error");
            }}
          >
            <Save /> Save draft
          </Button>
          {!confirmReplied ? (
            <Button size="sm" variant="outline" onClick={() => setConfirmReplied(true)}>
              <Send /> Mark as replied
            </Button>
          ) : null}
        </div>
        {confirmReplied ? (
          <div className="mt-3 rounded-2xl bg-copper-500/10 p-3.5 ring-1 ring-copper-500/35">
            <p className="text-[14px]">Have you sent your reply to {firstName(e.customerName)}?</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConfirmReplied(false)}>Not yet</Button>
              <Button
                size="sm"
                onClick={() => {
                  const res = actions.markEnquiryReplied(e.id);
                  setConfirmReplied(false);
                  if (res.ok) toast(`${firstName(e.customerName)} marked as replied`);
                }}
              >
                Yes, mark as replied
              </Button>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Next step">
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
                values: {
                  customerName: e.customerName,
                  customerPhone: e.phone ?? "",
                  customerEmail: e.email ?? "",
                  title: e.title,
                  location: e.location,
                  description: e.description,
                },
              })
            }
          >
            <HardHat /> Turn into a job
          </Button>
        )}
      </Section>

      <Section title="Notes" className="pb-10">
        <NotesPanel notes={e.notes} onAdd={(t) => actions.addEnquiryNote(e.id, t)} />
      </Section>
    </div>
  );
}
