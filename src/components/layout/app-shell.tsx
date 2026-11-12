"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlarmClock, AudioLines, Building2, CheckSquare, FlaskConical, HardHat, History, House, Inbox, LayoutGrid, LogOut,
  ReceiptText, Settings, Users,
} from "lucide-react";
import { StoreProvider, api, useStore } from "@/lib/store/store";
import { UIProvider, useUI } from "@/lib/store/ui";
import { BobProvider } from "@/lib/bob/provider";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import { needsReply, tasksDue } from "@/lib/derive";
import { cn } from "@/lib/utils";
import { BobLogo, OrgLogo } from "@/components/brand/logo";
import { Toaster } from "@/components/ui/toaster";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AssistantView } from "@/components/assistant/assistant-view";
import { OrbAvatar } from "@/components/assistant/orb";
import { EnquirySheet } from "@/components/enquiries/enquiry-sheet";
import { JobSheet } from "@/components/jobs/job-sheet";
import { CustomerSheet } from "@/components/customers/customer-sheet";
import { FormHost } from "@/components/forms/form-host";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <UIProvider>
        <BobProvider>
          <ShellLayout>{children}</ShellLayout>
          <EnquirySheet />
          <JobSheet />
          <CustomerSheet />
          <FormHost />
          <AssistantPanel />
          <Toaster />
        </BobProvider>
      </UIProvider>
    </StoreProvider>
  );
}

function useNavCounts() {
  const { data } = useStore();
  return { unanswered: data.enquiries.filter(needsReply).length, due: tasksDue(data.tasks).length };
}

const isAssistantRoute = (p: string) => p === "/" || p === "/assistant";

function ShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const assistant = isAssistantRoute(pathname);
  const shellRef = React.useRef<HTMLDivElement>(null);
  // Follow the *visible* viewport so bottom controls sit above the iOS
  // keyboard and Safari's toolbar instead of behind them.
  React.useEffect(() => {
    const vv = window.visualViewport;
    const el = shellRef.current;
    if (!vv || !el) return;
    const sync = () => {
      el.style.height = `${vv.height}px`;
      el.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);
  return (
    <div ref={shellRef} className="fixed inset-x-0 top-0 flex h-dvh overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Today and Ask Bob show demo mode in their own headers. */}
        {pathname !== "/today" && !assistant ? <DemoBanner /> : null}
        {!assistant ? <MobileHeader /> : null}
        <main className={cn("min-h-0 flex-1 overscroll-contain", assistant ? "overflow-hidden" : "overflow-y-auto bg-app")}>
          {assistant ? children : <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 lg:px-10 lg:pb-10 lg:pt-8">{children}</div>}
        </main>
        {/* Ask Bob has its own back button and bottom controls. */}
        {!assistant ? <BottomNav /> : null}
      </div>
      {!assistant && pathname !== "/today" ? <AskBobButton /> : null}
    </div>
  );
}

/** Always visible when the workspace holds sample data. */
function DemoBanner() {
  const { org } = useStore();
  if (org.dataMode !== "sample") return null;
  return (
    <div role="note" className="flex shrink-0 items-center justify-center gap-2 bg-sky-500/10 px-3 py-1.5 text-center text-[13px] text-info-fg ring-1 ring-sky-400/20">
      <FlaskConical className="size-3.5 shrink-0" />
      <span>
        <strong className="font-semibold">Demo mode</strong>
        <span className="hidden sm:inline"> — {org.isDemo ? "a fictional business" : "fictional sample data"}. Nothing is sent to real customers.</span>
        <span className="sm:hidden"> · sample data, nothing is sent</span>
      </span>
    </div>
  );
}

/* ------------------------------ Desktop sidebar ------------------------------ */

const SIDEBAR_NAV = [
  { href: "/today", label: "Today", icon: House },
  { href: "/assistant", label: "Ask Bob", icon: AudioLines },
  { href: "/enquiries", label: "Enquiries", icon: Inbox, badge: "unanswered" as const },
  { href: "/jobs", label: "Jobs", icon: HardHat },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/invoices", label: "Invoices", icon: ReceiptText, perm: "finance.read" as const },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, badge: "due" as const },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Sidebar() {
  const pathname = usePathname();
  const counts = useNavCounts();
  const { org, can } = useStore();
  return (
    <aside className="hidden w-[256px] shrink-0 flex-col border-r border-line bg-card lg:flex">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <OrgLogo org={org} size={40} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[16px] font-bold">{org.shortName}</div>
          <div className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-copper-400" /> with Bob
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {SIDEBAR_NAV.filter((i) => !i.perm || can(i.perm)).map((item) => {
          const active = pathname === item.href;
          const count = item.badge ? counts[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-11 items-center gap-3 rounded-xl px-3.5 text-[15.5px] font-medium transition active:bg-surface-3",
                active ? "bg-raised text-[#faf9f6] ring-1 ring-line-strong before:absolute before:inset-y-2.5 before:-left-3 before:w-[3px] before:rounded-r before:bg-copper-400" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <item.icon className={cn("size-[19px]", active && "text-accent-icon")} strokeWidth={1.8} />
              <span className="flex-1">{item.label}</span>
              {count ? <span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-copper-500 px-1.5 text-[12px] font-semibold text-white">{count}</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        <UserMenu />
      </div>
    </aside>
  );
}

function useWorkspaces() {
  const [orgs, setOrgs] = React.useState<{ id: string; name: string; role: string; isDemo: boolean }[]>([]);
  React.useEffect(() => {
    void api<{ orgs: typeof orgs }>("/api/auth/switch-org").then((r) => r.status === 200 && setOrgs(r.body.orgs));
  }, []);
  return orgs;
}

async function switchOrg(orgId: string) {
  const r = await api("/api/auth/switch-org", { json: { orgId } });
  if (r.status === 200) window.location.href = "/today";
}

async function signOut() {
  await api("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

function UserMenu() {
  const { user, org } = useStore();
  const orgs = useWorkspaces();
  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-surface-2 px-3 py-2.5 ring-1 ring-line">
        <div className="truncate text-[15px] font-medium">{user.name}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {ROLE_LABEL[user.role]} · {user.email}
        </div>
      </div>
      {orgs.length > 1 ? (
        <label className="block">
          <span className="sr-only">Switch business</span>
          <select
            value={org.id}
            onChange={(e) => void switchOrg(e.target.value)}
            className="h-9 w-full rounded-lg bg-surface-2 px-2 text-[14px] text-muted-foreground ring-1 ring-line"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.isDemo ? " (demo)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button onClick={() => void signOut()} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[14.5px] text-muted-foreground hover:bg-surface-2 hover:text-foreground">
        <LogOut className="size-4" /> Sign out
      </button>
      <div className="px-3 pt-2 opacity-80">
        <BobLogo height={18} byline />
      </div>
    </div>
  );
}

/* ------------------------------ Mobile chrome ------------------------------ */

function MobileHeader() {
  const { org } = useStore();
  const [moreOpen, setMoreOpen] = React.useState(false);
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line bg-card/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
      <Link href="/today" aria-label="Today">
        <BobLogo height={24} />
      </Link>
      <div className="flex items-center gap-1">
        <OrgLogo org={org} size={28} />
        <button onClick={() => setMoreOpen(true)} aria-label="More" className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-surface-3">
          <LayoutGrid className="size-[22px]" />
        </button>
      </div>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </header>
  );
}

function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user, org, can } = useStore();
  const counts = useNavCounts();
  const orgs = useWorkspaces();
  const links = [
    { href: "/today", label: "Today", icon: House, count: 0 },
    { href: "/customers", label: "Customers", icon: Users, count: 0 },
    { href: "/tasks", label: "Tasks & reminders", icon: AlarmClock, count: counts.due },
    ...(can("activity.read") ? [{ href: "/activity", label: "Activity log", icon: History, count: 0 }] : []),
    { href: "/settings", label: "Settings", icon: Settings, count: 0 },
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" title="More" className="p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mb-4 flex items-center gap-3">
          <OrgLogo org={org} size={40} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{org.name}</div>
            <div className="truncate text-[14px] text-muted-foreground">
              {user.name} · {ROLE_LABEL[user.role]}
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => onOpenChange(false)} className="flex h-13 items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3.5 text-[16px] ring-1 ring-line">
              <l.icon className="size-5 text-accent-icon" />
              <span className="flex-1">{l.label}</span>
              {l.count ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-copper-500 px-1.5 text-[12px] font-semibold">{l.count}</span> : null}
            </Link>
          ))}
        </div>
        {orgs.length > 1 ? (
          <>
            <div className="mt-5 text-[13px] uppercase tracking-wider text-subtle">Switch business</div>
            <div className="mt-2 space-y-1.5">
              {orgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => void switchOrg(o.id)}
                  aria-pressed={o.id === org.id}
                  className={cn("flex h-11 w-full items-center gap-2 rounded-xl px-4 text-left text-[15px] ring-1", o.id === org.id ? "bg-copper-500/15 text-accent-fg ring-copper-500/50" : "bg-surface-2 text-muted-foreground ring-line")}
                >
                  <Building2 className="size-4" /> {o.name}
                  {o.isDemo ? " (demo)" : ""}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <button onClick={() => void signOut()} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] text-muted-foreground ring-1 ring-line">
          <LogOut className="size-4" /> Sign out
        </button>
      </SheetContent>
    </Sheet>
  );
}

function BottomNav() {
  const pathname = usePathname();
  const { unanswered, due } = useNavCounts();
  const { can } = useStore();
  const items = [
    { href: "/today", label: "Today", icon: House, count: 0 },
    { href: "/enquiries", label: "Enquiries", icon: Inbox, count: unanswered },
    { href: "/assistant", label: "Ask Bob", icon: AudioLines, count: 0 },
    { href: "/jobs", label: "Jobs", icon: HardHat, count: 0 },
    can("finance.read") ? { href: "/invoices", label: "Money", icon: ReceiptText, count: 0 } : { href: "/tasks", label: "Tasks", icon: CheckSquare, count: due },
  ];
  return (
    <nav aria-label="Main" className="pb-safe shrink-0 border-t border-line bg-card/95 backdrop-blur lg:hidden">
      <div className="mx-auto grid h-[64px] max-w-lg grid-cols-5">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 text-[12.5px] font-medium transition active:bg-surface-2",
                active ? "text-accent-fg before:absolute before:inset-x-5 before:top-0 before:h-[2px] before:rounded-b before:bg-copper-400" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <item.icon className="size-6" strokeWidth={active ? 2 : 1.7} />
                {item.count ? (
                  <span className="tabular absolute -right-2.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-copper-500 px-1 text-[10.5px] font-semibold text-white ring-2 ring-card">
                    {item.count}
                  </span>
                ) : null}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ------------------------------ Ask Bob (desktop + mobile pages) ------------------------------ */

function AskBobButton() {
  const ui = useUI();
  return (
    <button
      onClick={() => ui.setAssistantOpen(true)}
      aria-label="Ask Bob"
      className="theme-dark fixed bottom-6 right-6 z-40 hidden items-center gap-3 rounded-full bg-ink-800 p-1.5 text-[16px] font-medium text-white shadow-2xl ring-1 ring-copper-500/40 transition hover:ring-copper-400 lg:flex lg:py-2 lg:pl-2 lg:pr-5"
    >
      <OrbAvatar className="size-10" />
      <span className="hidden lg:inline">Ask Bob</span>
    </button>
  );
}

function AssistantPanel() {
  const ui = useUI();
  return (
    <Sheet open={ui.assistantOpen} onOpenChange={ui.setAssistantOpen}>
      <SheetContent title="Bob" className="bg-background sm:w-[480px] [&>button:last-child]:hidden">
        <AssistantView variant="panel" onClose={() => ui.setAssistantOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
