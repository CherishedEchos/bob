"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Inbox, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useIsDesktop } from "@/lib/use-media";
import { ENQUIRY_SOURCES, ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, SOURCE_LABEL, followUpDue, isOpenEnquiry, needsReply, sortEnquiries } from "@/lib/derive";
import type { Enquiry, EnquirySource, EnquiryStatus } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { EmptyState, StatusText } from "@/components/common/bits";
import { HighPriority, SourceIcon, enquiryState } from "@/components/common/status";
import { EnquiryDetail } from "@/components/enquiries/enquiry-sheet";
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
  const params = useSearchParams();
  const desktop = useIsDesktop();
  const [syncing, setSyncing] = React.useState(false);
  const inbox = data.connections.find((c) => c.kind === "email" && (c.status === "connected" || c.status === "demo"));
  const initial = params.get("tab") as Tab | null;
  const [tab, setTab] = React.useState<Tab>(initial && TABS.some((t) => t.value === initial) ? initial : "reply");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [source, setSource] = React.useState<EnquirySource | "any">("any");
  const [status, setStatus] = React.useState<EnquiryStatus | "any">("any");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(params.get("open"));
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
  // Desktop shows the selected enquiry beside the list (the first one by default).
  const current = desktop ? (list.find((e) => e.id === selected) ?? list[0]) : undefined;

  // Phones: the enquiry opens full screen over the inbox (which stays put
  // underneath, so the tab and scroll position are kept). It's a real history
  // entry, so the phone's back gesture returns to the inbox too.
  const mobileId = !desktop ? params.get("open") : null;
  const pushed = React.useRef(false);
  const open = (e: Enquiry, focus?: "reply") => {
    ui.setEnquiryFocus(focus ?? null);
    if (desktop) return setSelected(e.id);
    pushed.current = true;
    window.history.pushState(null, "", `/enquiries?tab=${tab}&open=${e.id}`);
  };
  const closeMobile = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else window.history.replaceState(null, "", `/enquiries?tab=${tab}`);
  };

  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">Enquiries</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">{waiting ? `${waiting} waiting for your reply` : "Nobody is waiting for a reply"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {inbox && can("enquiries.write") ? (
            <button
              type="button"
              aria-label={inbox.status === "demo" ? "Check demo inbox" : "Check inbox"}
              title={inbox.status === "demo" ? "Check demo inbox" : "Check inbox"}
              className="grid size-11 place-items-center rounded-xl text-muted-foreground transition hover:bg-surface-3 hover:text-foreground disabled:opacity-50"
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
              <RefreshCw className={cn("size-5", syncing && "animate-spin")} />
            </button>
          ) : null}
          {can("enquiries.write") ? (
            <button type="button" aria-label="Add enquiry" onClick={() => ui.openForm({ form: "enquiry" })} className="flex h-11 items-center gap-1.5 rounded-xl bg-raised px-4 text-[15px] font-semibold ring-1 ring-line-strong transition hover:bg-raised-hover">
              <Plus className="size-[18px]" /> Add
            </button>
          ) : null}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <div role="tablist" aria-label="Enquiry lists" className="flex min-w-0 flex-1 gap-1 rounded-xl bg-card p-1 ring-1 ring-line">
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
                      "flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 text-[14.5px] font-semibold transition active:bg-surface-2",
                      active ? "bg-raised text-[#faf9f6]" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.short}
                    <span className={cn("tabular text-[12.5px]", active && t.value === "reply" && count ? "text-accent-fg" : "text-subtle")}>{count}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-label={`Filters${activeFilters ? ` (${activeFilters} on)` : ""}`}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
              className={cn("flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14.5px] font-semibold ring-1 transition", filtersOpen || activeFilters ? "bg-raised text-foreground ring-line-strong" : "bg-card text-muted-foreground ring-line hover:text-foreground")}
            >
              <SlidersHorizontal className="size-[18px]" />
              <span className="hidden sm:inline lg:hidden xl:inline">Filters</span>
              {activeFilters ? <span className="tabular text-[12.5px] text-accent-fg">{activeFilters}</span> : null}
            </button>
          </div>

          {filtersOpen ? (
            <div className="panel mb-3 grid grid-cols-1 gap-3 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, job or town" aria-label="Search enquiries" className="pl-10" />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
              {activeFilters ? (
                <button
                  className="h-10 text-left text-[15px] font-medium text-accent-fg"
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

          {tab === "reply" && waiting > 1 && can("enquiries.write") ? (
            <Link href="/replies" className="mb-3 flex min-h-[52px] items-center justify-between gap-3 rounded-xl bg-[#f28c3c] px-4 text-[16px] font-semibold text-[#1b1007] shadow-[0_6px_20px_-10px_rgb(242_140_60/0.7)] transition hover:bg-[#f69a50] active:bg-[#e47d2e]">
              <span className="flex items-center gap-2">
                <Sparkles className="size-4" /> Draft all {waiting} replies
              </span>
              <ChevronRight className="size-4" />
            </Link>
          ) : null}

          {list.length ? (
            <ul className="panel divide-y divide-line overflow-hidden">
              {list.map((e) => (
                <InboxRow key={e.id} e={e} selected={current?.id === e.id} onOpen={(focus) => open(e, focus)} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Inbox} title={caughtUp ? "You're all caught up" : "Nothing here"} body={caughtUp ? "Nobody is waiting for a reply." : "No enquiries match."} />
          )}
        </div>

        {desktop ? (
          <aside aria-label="Selected enquiry" className="panel sticky top-0 hidden h-[calc(100dvh-9.5rem)] min-h-[520px] flex-col overflow-hidden lg:flex">
            {current ? (
              <EnquiryDetail key={current.id} id={current.id} inline />
            ) : (
              <div className="grid flex-1 place-items-center p-8 text-center text-[15px] text-muted-foreground">Select an enquiry to see the full message, history and reply.</div>
            )}
          </aside>
        ) : null}
      </div>

      {mobileId && data.enquiries.some((x) => x.id === mobileId) ? (
        <div role="dialog" aria-modal="true" aria-label="Enquiry" className="absolute inset-0 z-40 flex flex-col bg-card lg:hidden">
          <EnquiryDetail id={mobileId} onBack={closeMobile} backLabel="Back to inbox" />
        </div>
      ) : null}
    </>
  );
}

/** Who's waiting, what it's about, and their state. Tap to open (straight at the reply if they're waiting). */
function InboxRow({ e, selected, onOpen }: { e: Enquiry; selected: boolean; onOpen: (focus?: "reply") => void }) {
  const preview = e.messages.filter((m) => m.direction === "inbound").at(-1)?.body ?? e.description;
  const waiting = needsReply(e);
  const state = enquiryState(e, !waiting && followUpDue(e));
  return (
    <li className={cn("relative transition-colors", selected ? "bg-raised" : "hover:bg-surface-2")}>
      {selected ? <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-copper-500" /> : null}
      <button type="button" onClick={() => onOpen(waiting ? "reply" : undefined)} aria-current={selected || undefined} className="flex w-full items-start gap-3 px-4 py-3.5 text-left">
        <SourceIcon source={e.source} provider={e.provider} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="t-name truncate">{e.customerName}</span>
            <span className="shrink-0 text-[13px] tabular text-subtle">{timeAgo(e.receivedAt)}</span>
          </span>
          <span className="mt-0.5 block truncate text-[14.5px]">
            <span className="text-foreground/85">{e.title}</span>
            <span className="text-muted-foreground"> · {e.location}</span>
          </span>
          <span className="mt-0.5 line-clamp-1 text-[14px] text-subtle">{preview}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusText tone={state.main.tone}>{state.main.label}</StatusText>
            {state.high ? <HighPriority /> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

export default function EnquiriesPage() {
  return (
    <React.Suspense>
      <EnquiriesInner />
    </React.Suspense>
  );
}
