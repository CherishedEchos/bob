import { Mail, Phone, Flame } from "lucide-react";
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
  site_visit: "violet",
  quoted: "neutral",
  won: "green",
  closed: "neutral",
};

const JOB_TONE: Record<JobStatus, BadgeTone> = {
  quoted: "neutral",
  awaiting_deposit: "amber",
  scheduled: "blue",
  in_progress: "green",
  snagging: "violet",
  completed: "neutral",
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
    <Badge tone="red">
      <Flame /> High
    </Badge>
  );
}

export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

const SOURCE_ICON = { email: Mail, instagram: InstagramGlyph, phone: Phone } as const;

export function SourceIcon({ source, className }: { source: EnquirySource; className?: string }) {
  const Icon = SOURCE_ICON[source];
  return (
    <span
      title={SOURCE_LABEL[source]}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl ring-1",
        source === "email" && "bg-sky-400/10 text-sky-300 ring-sky-400/20",
        source === "instagram" && "bg-pink-400/10 text-pink-300 ring-pink-400/20",
        source === "phone" && "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{SOURCE_LABEL[source]}</span>
    </span>
  );
}
