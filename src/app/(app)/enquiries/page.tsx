"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, Inbox, MapPin, Plus, Search } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { followUpDue, needsReply, sortEnquiries, SOURCE_LABEL } from "@/lib/derive";
import type { Enquiry, EnquirySource } from "@/lib/types";
import { cn, formatDateKey, timeAgo, formatDateInline } from "@/lib/utils";
import { EmptyState, FilterChips, PageHeader } from "@/components/common/bits";
import { EnquiryStatusBadge, PriorityBadge, SourceIcon } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Filter = "all" | "needs_reply" | "new" | "followup" | "replied" | "quoted" | "won" | "closed";

const FILTERS: { value: Filter; label: string; test: (e: Enquiry) => boolean }[] = [
  { value: "all", label: "All open", test: (e) => e.status !== "closed" && e.status !== "won" },
  { value: "needs_reply", label: "Needs reply", test: needsReply },
  { value: "new", label: "New", test: (e) => e.status === "new" },
  { value: "followup", label: "Follow-up due", test: followUpDue },
  { value: "replied", label: "Replied", test: (e) => e.status === "replied" || e.status === "site_visit" },
  { value: "quoted", label: "Quoted", test: (e) => e.status === "quoted" },
  { value: "won", label: "Won", test: (e) => e.status === "won" },
  { value: "closed", label: "Closed", test: (e) => e.status === "closed" },
];

function EnquiriesInner() {
  const { data } = useStore();
  const ui = useUI();
  const params = useSearchParams();
  const initial = (params.get("filter") as Filter) ?? "all";
  const [filter, setFilter] = React.useState<Filter>(FILTERS.some((f) => f.value === initial) ? initial : "all");
  const [source, setSource] = React.useState<EnquirySource | "any">("any");
  const [query, setQuery] = React.useState("");

  const test = FILTERS.find((f) => f.value === filter)!.test;
  const q = query.trim().toLowerCase();
  const list = sortEnquiries(
    data.enquiries.filter(
      (e) =>
        test(e) &&
        (source === "any" || e.source === source) &&
        (!q || [e.customerName, e.title, e.location, e.description].some((s) => s.toLowerCase().includes(q))),
    ),
  );

  return (
    <>
      <PageHeader
        title="Enquiries"
        subtitle={`${data.enquiries.filter(needsReply).length} waiting for a reply`}
        actions={
          <Button onClick={() => ui.openForm({ form: "enquiry" })}>
            <Plus /> Log enquiry
          </Button>
        }
      />

      <div className="mb-4 space-y-3">
        <FilterChips
          label="Filter enquiries"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: data.enquiries.filter(f.test).length }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, job or town" aria-label="Search enquiries" className="pl-10" />
          </div>
          <div className="flex gap-1.5 rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10" role="radiogroup" aria-label="Source">
            {(["any", "email", "instagram", "phone"] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={source === s}
                onClick={() => setSource(s)}
                className={cn(
                  "h-9 flex-1 rounded-lg px-3 text-[13px] font-medium transition sm:flex-none",
                  source === s ? "bg-white/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "any" ? "All" : SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {list.length ? (
        <ul className="space-y-3">
          {list.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => ui.openEnquiry(e.id)}
                className="card-surface flex w-full items-start gap-3.5 rounded-2xl p-4 text-left transition hover:bg-white/[0.05] lg:items-center"
              >
                <SourceIcon source={e.source} className="size-11 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[16px] font-semibold">{e.customerName}</span>
                    {needsReply(e) ? <span className="size-2 rounded-full bg-copper-500" aria-label="Needs reply" /> : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[14px] text-foreground/85">
                    {e.title} <span className="text-subtle">·</span> <MapPin className="size-3.5 text-copper-400" /> {e.location}
                  </div>
                  <p className="mt-1 line-clamp-1 text-[13.5px] text-muted-foreground lg:max-w-2xl">{e.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 lg:hidden">
                    <EnquiryStatusBadge status={e.status} />
                    {e.priority === "high" ? <PriorityBadge priority="high" /> : null}
                    {e.followUpDate ? (
                      <span className={cn("inline-flex items-center gap-1 text-[12px]", followUpDue(e) ? "text-amber-200" : "text-subtle")}>
                        <CalendarCheck className="size-3" /> {formatDateKey(e.followUpDate)}
                      </span>
                    ) : null}
                    <span className="text-[12px] text-subtle">· {timeAgo(e.receivedAt)}</span>
                  </div>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1.5 lg:flex">
                  <div className="flex gap-1.5">
                    {e.priority === "high" ? <PriorityBadge priority="high" /> : null}
                    <EnquiryStatusBadge status={e.status} />
                  </div>
                  <span className="text-[12.5px] text-subtle">
                    {e.followUpDate ? (
                      <span className={cn(followUpDue(e) && "text-amber-200")}>Follow up {formatDateInline(e.followUpDate)} · </span>
                    ) : null}
                    {timeAgo(e.receivedAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Inbox} title="Nothing here" body="No enquiries match these filters." />
      )}
    </>
  );
}

export default function EnquiriesPage() {
  return (
    <React.Suspense>
      <EnquiriesInner />
    </React.Suspense>
  );
}
