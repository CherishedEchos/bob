"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Inbox, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { pageSecondaryClass } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { useIsDesktop } from "@/lib/use-media";
import { ENQUIRY_SOURCES, ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, SOURCE_LABEL, followUpDue, isOpenEnquiry, needsReply, needsWrittenReply, sortEnquiries, wantsCallback } from "@/lib/derive";
import type { Enquiry, EnquirySource, EnquiryStatus } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { EmptyState, StatusText } from "@/components/common/bits";
import { HighPriority, SourceIcon, enquiryState } from "@/components/common/status";
import { EnquiryDetail } from "@/components/enquiries/enquiry-sheet";
import { Input, NativeSelect } from "@/components/ui/input";

type Tab = "reply" | "quote" | "sent" | "follow" | "all";

/** Replied, not quoting, but a follow-up date is set. */
const needsFollowUp = (e: Enquiry) => !needsReply(e) && isOpenEnquiry(e) && e.status !== "quote_required" && e.status !== "quoted" && (followUpDue(e) || !!e.followUpDate);

const TABS: { value: Tab; label: string; short: string; test: (e: Enquiry) => boolean }[] = [
  { value: "reply", label: "Needs reply", short: "Needs reply", test: needsReply },
  { value: "quote", label: "To quote", short: "To quote", test: (e) => e.status === "quote_required" },
  { value: "sent", label: "Quote sent", short: "Quote sent", test: (e) => e.status === "quoted" },
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
  const toDraft = data.enquiries.filter(needsWrittenReply).length;
  const caughtUp = tab === "reply" && !activeFilters;
  // Desktop shows the selected enquiry beside the list (the first one by default).
  // The open enquiry stays open even if a change (e.g. marked won) moves it out of this tab.
  const current = desktop ? (list.find((e) => e.id === selected) ?? data.enquiries.find((e) => e.id === selected) ?? list[0]) : undefined;

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
            <button type="button" onClick={() => ui.openForm({ form: "enquiry" })} className={pageSecondaryClass}>
              <Plus className="size-[18px]" aria-hidden /> <span className="hidden sm:inline">Add enquiry</span>
              <span className="sm:hidden">Add</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-5 xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <div role="tablist" aria-label="Enquiry lists" className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl bg-surface-3 p-1">
              {TABS.map((t) => {
                const count = data.enquiries.filter(t.test).length;
                const active = tab === t.value;
                return (
                  <button
                    key={t.value}
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setTab(t.value);
                      setSelected(null);
                    }}
                    className={cn(
                      "flex h-10 shrink-0 grow items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 text-[14px] font-semibold transition active:bg-surface-2",
                      active ? "bg-card text-heading shadow-[0_1px_2px_rgb(16_24_40/0.08)] ring-1 ring-line" : "text-muted-foreground hover:text-foreground",
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
              className={cn("flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14.5px] font-semibold ring-1 transition", filtersOpen || activeFilters ? "bg-selected text-accent-fg ring-copper-500/40" : "bg-card text-muted-foreground ring-line-strong hover:text-foreground")}
            >
              <SlidersHorizontal className="size-[18px]" />
              <span className="hidden sm:inline lg:hidden 2xl:inline">Filters</span>
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

          {tab === "reply" && toDraft > 0 && can("enquiries.write") ? (
            <Link href="/replies" className="mb-3 flex min-h-[52px] items-center justify-between gap-3 rounded-xl bg-primary px-4 text-[16px] font-semibold text-white shadow-[0_1px_2px_rgb(16_24_40/0.12)] transition hover:bg-copper-600 active:bg-copper-700">
              <span className="flex items-center gap-2">
                <Sparkles className="size-4" aria-hidden /> Draft {toDraft} {toDraft === 1 ? "reply" : "replies"}
              </span>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null}

          {list.length ? (
            <ul className="panel divide-y divide-line overflow-hidden">
              {list.map((e) => (
                <InboxRow key={e.id} e={e} tab={tab} selected={current?.id === e.id} onOpen={(focus) => open(e, focus)} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Inbox} title={caughtUp ? "You're all caught up" : "Nothing here"} body={caughtUp ? "Nobody is waiting for a reply." : "No enquiries match."} />
          )}
        </div>

        {desktop ? (
          <aside aria-label="Selected enquiry" className="panel sticky top-4 hidden h-[calc(100dvh-11rem)] min-h-[520px] flex-col overflow-hidden lg:flex">
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

/**
 * Name first, then the job and town, then only the status that helps decide
 * what to do. In Needs reply every row is waiting, so that line is left out —
 * only High priority, Draft saved and Call back show there.
 */
function InboxRow({ e, tab, selected, onOpen }: { e: Enquiry; tab: Tab; selected: boolean; onOpen: (focus?: "reply") => void }) {
  const preview = e.messages.filter((m) => m.direction === "inbound").at(-1)?.body ?? e.description;
  const waiting = needsReply(e);
  const callback = wantsCallback(e);
  const state = enquiryState(e, !waiting && followUpDue(e));
  const drafted = waiting && !!e.draftReply;
  const showState = tab !== "reply" || drafted;
  return (
    <li className="row-open flex items-start gap-3 px-4 py-3.5" data-selected={selected || undefined}>
      <SourceIcon source={e.source} provider={e.provider} className="mt-0.5" />
      <button
        type="button"
        onClick={() => onOpen(waiting ? "reply" : undefined)}
        aria-current={selected || undefined}
        className="row-target min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-['']"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="t-name truncate">{e.customerName}</span>
          <span className="shrink-0 text-[13px] tabular text-muted-foreground">{timeAgo(e.receivedAt)}</span>
        </span>
        <span className="mt-0.5 block truncate text-[14.5px]">
          <span className="text-foreground">{e.title}</span>
          <span className="text-muted-foreground"> · {e.location}</span>
        </span>
        <span className="mt-0.5 line-clamp-1 text-[14px] text-muted-foreground">{preview}</span>
        {showState || state.high || callback ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {callback ? <StatusText tone="amber">Call back requested</StatusText> : showState ? <StatusText tone={state.main.tone}>{state.main.label}</StatusText> : null}
            {state.high ? <HighPriority /> : null}
          </span>
        ) : null}
      </button>
      <ChevronRight aria-hidden className="row-chevron mt-2.5 size-[18px] shrink-0" />
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
