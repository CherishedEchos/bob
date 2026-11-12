"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AudioLines, CalendarCheck, Inbox, MapPin, Plus, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useBob } from "@/lib/bob/provider";
import { ENQUIRY_SOURCES, ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, SOURCE_LABEL, followUpDue, isOpenEnquiry, needsReply, sortEnquiries } from "@/lib/derive";
import type { Enquiry, EnquirySource, EnquiryStatus } from "@/lib/types";
import { cn, timeAgo, formatDateInline } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/common/bits";
import { EnquiryStatusBadge, PriorityBadge, SourceIcon } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";

type Tab = "reply" | "follow" | "all";

/** Not waiting on you, but still needs chasing: follow-up date set, or a quote outstanding. */
const needsFollowUp = (e: Enquiry) =>
  !needsReply(e) && isOpenEnquiry(e) && (followUpDue(e) || e.status === "quote_required" || e.status === "quoted" || !!e.followUpDate);

const TABS: { value: Tab; label: string; test: (e: Enquiry) => boolean }[] = [
  { value: "reply", label: "Needs your reply", test: needsReply },
  { value: "follow", label: "Follow up", test: needsFollowUp },
  { value: "all", label: "All", test: () => true },
];

function EnquiriesInner() {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const { send } = useBob();
  const params = useSearchParams();
  const [syncing, setSyncing] = React.useState(false);
  const inbox = data.connections.find((c) => c.kind === "email" && (c.status === "connected" || c.status === "demo"));
  const initial = params.get("tab") as Tab | null;
  const [tab, setTab] = React.useState<Tab>(initial && TABS.some((t) => t.value === initial) ? initial : "reply");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [source, setSource] = React.useState<EnquirySource | "any">("any");
  const [status, setStatus] = React.useState<EnquiryStatus | "any">("any");
  const [query, setQuery] = React.useState("");
  const activeFilters = (source !== "any" ? 1 : 0) + (status !== "any" ? 1 : 0) + (query.trim() ? 1 : 0);

  const test = TABS.find((t) => t.value === tab)!.test;
  const q = query.trim().toLowerCase();
  const list = sortEnquiries(
    data.enquiries.filter(
      (e) =>
        test(e) &&
        (source === "any" || e.source === source) &&
        (status === "any" || e.status === status) &&
        (!q || [e.customerName, e.title, e.location, e.description].some((x) => x.toLowerCase().includes(q))),
    ),
  );
  const waiting = data.enquiries.filter(needsReply).length;
  const caughtUp = tab === "reply" && !activeFilters;

  return (
    <>
      <PageHeader
        title="Enquiries"
        subtitle={waiting ? `${waiting} waiting for your reply` : "Nobody is waiting for a reply"}
        actions={
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {can("enquiries.write") ? (
              <Button className="flex-1 sm:flex-none" onClick={() => ui.openForm({ form: "enquiry" })}>
                <Plus /> Add enquiry
              </Button>
            ) : null}
            <Button
              variant="secondary"
              className="flex-1 sm:flex-none"
              onClick={() => {
                void send("Who haven't I replied to?", "text");
                ui.setAssistantOpen(true);
              }}
            >
              <AudioLines /> Ask Bob who needs a reply
            </Button>
            {inbox && can("enquiries.write") ? (
              <Button
                variant="ghost"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true);
                  const r = await actions.syncInbox();
                  setSyncing(false);
                  if (!r.ok) return toast(Object.values(r.errors)[0] ?? "Couldn't check the inbox", "error");
                  const n = r.value.created.length;
                  toast(`${n ? `${n} new enquir${n === 1 ? "y" : "ies"} imported` : "No new enquiries"}${r.value.flagged.length ? ` · ${r.value.flagged.length} flagged as suspicious` : ""}`);
                }}
              >
                <RefreshCw className={syncing ? "animate-spin" : ""} /> {inbox.status === "demo" ? "Check demo inbox" : "Check inbox"}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Enquiry lists" className="flex w-full gap-1 rounded-2xl bg-surface-3 p-1 sm:w-auto">
          {TABS.map((t) => {
            const count = data.enquiries.filter(t.test).length;
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.value)}
                className={cn(
                  "flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 text-[15px] font-semibold transition sm:flex-none sm:px-4",
                  active ? "bg-card text-foreground shadow-sm ring-1 ring-line" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("tabular rounded-full px-1.5 text-[12px]", active && t.value === "reply" && count ? "bg-primary text-white" : "bg-black/[0.06]")}>{count}</span>
              </button>
            );
          })}
        </div>
        <Button variant="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
          <SlidersHorizontal /> Filters{activeFilters ? ` (${activeFilters})` : ""}
        </Button>
      </div>

      {filtersOpen ? (
        <div className="card-surface mb-4 grid grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, job or town" aria-label="Search enquiries" className="pl-10" />
          </div>
          <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as EnquiryStatus | "any")}>
            <option value="any">Any status</option>
            {ENQUIRY_STATUSES.map((st) => (
              <option key={st} value={st}>
                {ENQUIRY_STATUS_LABEL[st]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as EnquirySource | "any")}>
            <option value="any">Any source</option>
            {ENQUIRY_SOURCES.map((src) => (
              <option key={src} value={src}>
                {SOURCE_LABEL[src]}
              </option>
            ))}
          </NativeSelect>
          {activeFilters ? (
            <button
              className="h-11 text-left text-[15px] font-medium text-accent-fg sm:col-span-3"
              onClick={() => {
                setQuery("");
                setStatus("any");
                setSource("any");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {list.length ? (
        <ul className="space-y-3">
          {list.map((e) => (
            <li key={e.id}>
              <button onClick={() => ui.openEnquiry(e.id)} className="card-surface flex w-full items-start gap-3.5 rounded-2xl p-4 text-left transition hover:bg-surface-2">
                <SourceIcon source={e.source} className="size-11 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[17px] font-semibold">{e.customerName}</span>
                    {needsReply(e) ? <span className="size-2 rounded-full bg-copper-500" aria-label="Needs reply" /> : null}
                    {e.draftReply && needsReply(e) ? <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[12px] font-medium text-info-fg ring-1 ring-sky-500/20">Draft saved</span> : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[15.5px] text-foreground/85">
                    {e.title} <span className="text-subtle">·</span> <MapPin className="size-3.5 text-accent-icon" /> {e.location}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[15px] text-muted-foreground lg:max-w-3xl">{e.messages.filter((m) => m.direction === "inbound").at(-1)?.body ?? e.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <EnquiryStatusBadge status={e.status} />
                    {e.priority === "high" ? <PriorityBadge priority="high" /> : null}
                    {e.followUpDate ? (
                      <span className={cn("inline-flex items-center gap-1 text-[14px]", followUpDue(e) ? "text-warn-fg" : "text-subtle")}>
                        <CalendarCheck className="size-3.5" /> Follow up {formatDateInline(e.followUpDate)}
                      </span>
                    ) : null}
                    <span className="text-[14px] text-subtle">· {SOURCE_LABEL[e.source]} · {timeAgo(e.receivedAt)}</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Inbox} title={caughtUp ? "You're all caught up" : "Nothing here"} body={caughtUp ? "Nobody is waiting for a reply." : "No enquiries match."} />
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
