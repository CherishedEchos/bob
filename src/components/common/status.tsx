import { Flag, Mail, Phone, Globe, PenLine } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import {
  ENQUIRY_STATUS_LABEL,
  JOB_STATUS_LABEL,
  PRIORITY_LABEL,
  SOURCE_LABEL,
} from "@/lib/derive";
import type { EnquirySource, EnquiryStatus, JobStatus, Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

const ENQUIRY_TONE: Record<EnquiryStatus, BadgeTone> = {
  new: "copper",
  awaiting_reply: "amber",
  replied: "blue",
  quote_required: "violet",
  quoted: "neutral",
  won: "green",
  lost: "neutral",
};

const JOB_TONE: Record<JobStatus, BadgeTone> = {
  quoted: "neutral",
  awaiting_deposit: "amber",
  scheduled: "blue",
  in_progress: "green",
  snagging: "violet",
  completed: "neutral",
  lost: "neutral",
};

export function EnquiryStatusBadge({ status, className }: { status: EnquiryStatus; className?: string }) {
  return (
    <Badge tone={ENQUIRY_TONE[status]} className={className}>
      {ENQUIRY_STATUS_LABEL[status]}
    </Badge>
  );
}

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <Badge tone={JOB_TONE[status]} className={className}>
      {JOB_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority !== "high") return <Badge tone="neutral">{PRIORITY_LABEL[priority]}</Badge>;
  return (
<HighPriority />
  );
}

export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const SOURCE_ICON = { email: Mail, instagram: InstagramGlyph, phone: Phone, website: Globe, manual: PenLine } as const;

/** Solid, recognisable tiles so the channel reads at a glance. */
const SOURCE_STYLE: Record<EnquirySource, { bg: string; fg: string; chip: string }> = {
  instagram: {
    bg: "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%)",
    fg: "#fff",
    chip: "bg-pink-500/12 text-pink-200 ring-pink-400/30",
  },
  email: { bg: "linear-gradient(160deg, #4f8ff7, #1f5fd6)", fg: "#fff", chip: "bg-sky-500/12 text-sky-200 ring-sky-400/30" },
  phone: { bg: "linear-gradient(160deg, #3fd37e, #17944c)", fg: "#fff", chip: "bg-emerald-500/12 text-emerald-200 ring-emerald-400/30" },
  website: { bg: "linear-gradient(160deg, #9b7bff, #5b3fd6)", fg: "#fff", chip: "bg-violet-500/12 text-violet-200 ring-violet-400/30" },
  manual: { bg: "linear-gradient(160deg, #4a4540, #2f2b28)", fg: "#e9e4de", chip: "bg-surface-3 text-muted-foreground ring-line-strong" },
};

function GmailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M2 6.5v11A1.5 1.5 0 0 0 3.5 19H6V9.8L2 6.5z" fill="#4285F4" />
      <path d="M18 19h2.5a1.5 1.5 0 0 0 1.5-1.5v-11L18 9.8V19z" fill="#34A853" />
      <path d="M18 5.2v4.6l4-3.3V5.6c0-1.3-1.5-2-2.5-1.2L18 5.2z" fill="#FBBC04" />
      <path d="M6 9.8V5.2l6 4.5 6-4.5v4.6l-6 4.5-6-4.5z" fill="#EA4335" />
      <path d="M2 5.6v.9l4 3.3V5.2l-1.5-.8C3.5 3.6 2 4.3 2 5.6z" fill="#C5221F" />
    </svg>
  );
}

/**
 * Channel mark: a white glyph on the channel's colour at about half strength,
 * so Instagram, email and phone are recognisable without shouting.
 */
export function SourceIcon({ source, provider, className }: { source: EnquirySource; provider?: string; className?: string }) {
  const gmail = source === "email" && provider === "gmail";
  const Icon = SOURCE_ICON[source];
  const label = gmail ? "Gmail" : SOURCE_LABEL[source];
  return (
    <span title={`Came in by ${label}`} className={cn("relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-raised", className)}>
      <span aria-hidden className="absolute inset-0 opacity-[0.42]" style={{ background: SOURCE_STYLE[source].bg }} />
      {gmail ? <GmailMark className="relative size-[55%] opacity-90" /> : <Icon className="relative size-[50%] text-white/90" aria-hidden />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Small labelled pill: logo + channel name. */
export function SourceChip({ source, className }: { source: EnquirySource; className?: string }) {
  const Icon = SOURCE_ICON[source];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium ring-1", SOURCE_STYLE[source].chip, className)}>
      <Icon className="size-3.5" aria-hidden />
      {source === "manual" ? "Manual" : SOURCE_LABEL[source]}
    </span>
  );
}

/**
 * One wording and colour for an enquiry's state, used in the inbox list and the
 * detail pane alike. Colour is an extra cue; the words always show.
 */
export function enquiryState(e: { status: EnquiryStatus; draftReply?: string; priority: Priority; followUpDate?: string }, followUpDue: boolean) {
  const waiting = e.status === "new" || e.status === "awaiting_reply";
  const open = e.status !== "won" && e.status !== "lost";
  const main: { label: string; tone: "amber" | "green" | "neutral" } = waiting
    ? e.draftReply
      ? { label: "Draft saved", tone: "green" }
      : { label: "Needs your reply", tone: "amber" }
    : followUpDue
      ? { label: "Follow-up due", tone: "amber" }
      : { label: ENQUIRY_STATUS_LABEL[e.status], tone: e.status === "won" ? "green" : "neutral" };
  return { main, high: open && e.priority === "high" };
}

/** "High priority": a small flag and the word. Red is kept for overdue money. */
export function HighPriority({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[13.5px] font-medium text-foreground/80", className)}>
      <Flag className="size-3.5 fill-current text-[#d9d9de]" aria-hidden /> High priority
    </span>
  );
}
