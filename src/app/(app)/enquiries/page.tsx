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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";

type Tab = "reply" | "follow" | "all";

/** Not waiting on you, but still needs chasing: follow-up date set, or a quote outstanding. */
const needsFollowUp = (e: Enquiry) =>
  !needsReply(e) && isOpenEnquiry(e) && (followUpDue(e) || e.status === "quote_required" || e.status === "quoted" || !!e.followUpDate);

const TABS: { value: Tab; label: string; short: string; test: (e: Enquiry) => boolean }[] = [
  { value: "reply", label: "Needs your reply", short: "Reply", test: needsReply },
  { value: "follow", label: "Follow up", short: "Follow up", test: needsFollowUp },
  { value: "all", label: "All", short: "All", test: () => true },
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
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="hidden sm:inline-flex"
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
                aria-label={inbox.status === "demo" ? "Check demo inbox" : "Check inbox"}
                className="h-10 px-3 sm:h-12 sm:px-5"
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
                <RefreshCw className={syncing ? "animate-spin" : ""} /> <span className="hidden sm:inline">{inbox.status === "demo" ? "Check demo inbox" : "Check inbox"}</span>
              </Button>
            ) : null}
            {can("enquiries.write") ? (
              <Button aria-label="Add enquiry" className="h-10 px-3.5 sm:h-12 sm:px-5" onClick={() => ui.openForm({ form: "enquiry" })}>
                <Plus /> <span className="sm:hidden">Add</span>
                <span className="hidden sm:inline">Add enquiry</span>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <div role="tablist" aria-label="Enquiry lists" className="flex min-w-0 flex-1 gap-1 rounded-xl bg-card p-1 ring-1 ring-line sm:flex-none">
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
                  "flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 text-[14px] font-semibold sm:text-[14.5px] transition active:bg-surface-2 sm:flex-none sm:px-4",
                  active ? "bg-raised text-[#faf9f6] ring-1 ring-line-strong" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
                <span className={cn("tabular rounded-md px-1.5 text-[12px]", active && t.value === "reply" && count ? "bg-copper-500/20 text-accent-fg" : "bg-surface-3 text-muted-foreground")}>{count}</span>
              </button>
            );
          })}
        </div>
        <Button
          variant="secondary"
          aria-label={`Filters${activeFilters ? ` (${activeFilters} on)` : ""}`}
          aria-expanded={filtersOpen}
          className="h-12 shrink-0 px-3.5 sm:px-5"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <SlidersHorizontal /> <span className="hidden sm:inline">Filters</span>
          {activeFilters ? <span className="tabular rounded-md bg-copper-500/20 px-1.5 text-[12px] text-accent-fg">{activeFilters}</span> : null}
        </Button>
      </div>

      {filtersOpen ? (
        <div className="card-surface mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
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
        <ul className="panel divide-y divide-line overflow-hidden">
          {list.map((e) => {
            const preview = e.messages.filter((m) => m.direction === "inbound").at(-1)?.body ?? e.description;
            const waiting = needsReply(e);
            return (
              <li key={e.id}>
                <button onClick={() => ui.openEnquiry(e.id)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-surface-2 active:bg-raised sm:px-5">
                  <SourceIcon source={e.source} provider={e.provider} className="mt-0.5 size-10 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="t-name truncate">{e.customerName}</span>
                        {waiting ? <span className="size-2 shrink-0 rounded-full bg-copper-400" aria-label="Needs reply" /> : null}
                      </span>
                      <span className={cn("shrink-0 text-[13px] tabular", waiting ? "font-medium text-accent-fg" : "text-subtle")}>{timeAgo(e.receivedAt)}</span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[14px] text-foreground/85">
                      <span className="truncate">{e.title}</span>
                      <span className="shrink-0 text-subtle">·</span>
                      <MapPin className="size-3.5 shrink-0 text-subtle" />
                      <span className="truncate">{e.location}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[14px] text-muted-foreground lg:max-w-3xl">{preview}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <EnquiryStatusBadge status={e.status} />
                      {e.priority === "high" ? <PriorityBadge priority="high" /> : null}
                      {e.draftReply && waiting ? <Badge tone="blue">Draft saved</Badge> : null}
                      {e.followUpDate ? (
                        <span className={cn("inline-flex items-center gap-1 text-[13px]", followUpDue(e) ? "font-medium text-warn-fg" : "text-subtle")}>
                          <CalendarCheck className="size-3.5" /> Follow up {formatDateInline(e.followUpDate)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
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
