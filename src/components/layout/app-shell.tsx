"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlarmClock, AudioLines, Building2, CalendarDays, CheckSquare, FlaskConical, Package, Store, UsersRound, HardHat, History, Inbox, LayoutGrid, LogOut,
  ReceiptText, Settings, Users,
} from "lucide-react";
import { StoreProvider, api, useStore } from "@/lib/store/store";
import { UIProvider, useUI } from "@/lib/store/ui";
import { BobProvider } from "@/lib/bob/provider";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import { needsReply, tasksDue } from "@/lib/derive";
import { cn } from "@/lib/utils";
import { BobLogo, OrgLogo, OrgWordmark } from "@/components/brand/logo";
import { InstallBob } from "@/components/common/install-bob";
import { Toaster } from "@/components/ui/toaster";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AssistantView } from "@/components/assistant/assistant-view";
import { EnquirySheet } from "@/components/enquiries/enquiry-sheet";
import { CustomerSheet } from "@/components/customers/customer-sheet";
import { FormHost } from "@/components/forms/form-host";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <UIProvider>
        <BobProvider>
          <ShellLayout>{children}</ShellLayout>
          <EnquirySheet />
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

/** Wide pages for schedules and lists; comfortable widths for settings and forms. Same gutters everywhere. */
function pageWidth(p: string) {
  if (p.startsWith("/week")) return "max-w-[1800px] lg:px-8";
  if (["/enquiries", "/jobs", "/materials", "/merchants", "/team", "/tasks", "/invoices", "/customers"].some((x) => p.startsWith(x))) return "max-w-[1560px] lg:px-8";
  return "max-w-5xl lg:px-8";
}

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
        {/* Ask Bob shows demo mode in its own header; phones show it in the top bar. */}
        {!assistant ? <DemoBanner /> : null}
        {!assistant ? <MobileHeader /> : null}
        <main className={cn("min-h-0 flex-1 overscroll-contain", assistant ? "overflow-hidden" : pathname.startsWith("/enquiries") ? "overflow-y-auto bg-inbox" : "overflow-y-auto bg-app")}>
          {assistant ? children : <div className={cn("mx-auto w-full px-4 pb-10 pt-4 lg:pb-10 lg:pt-8", pageWidth(pathname))}>{children}</div>}
        </main>
        {/* Ask Bob has its own back button and bottom controls. */}
        {!assistant ? <BottomNav /> : null}
      </div>

    </div>
  );
}

/**
 * "Demo · sample data": a slim strip above the content on desktop (it sits in
 * the layout, so it never covers what scrolls underneath). Phones show the
 * same label in the top bar instead.
 */
function DemoBanner() {
  const { org } = useStore();
  if (org.dataMode !== "sample") return null;
  return (
    <div role="note" className="hidden h-8 shrink-0 items-center justify-center gap-2 border-b border-line bg-card px-3 text-[13px] text-muted-foreground lg:flex">
      <FlaskConical aria-hidden className="size-3.5 shrink-0 text-subtle" />
      <span>
        <strong className="font-semibold text-foreground">Demo · sample data</strong>
        <span> — {org.isDemo ? "a fictional business" : "fictional customers"}. Nothing is sent to anyone.</span>
      </span>
    </div>
  );
}

/* ------------------------------ Desktop sidebar ------------------------------ */

const SIDEBAR_NAV = [
  { href: "/week", label: "Diary", icon: CalendarDays },
  { href: "/assistant", label: "Ask Bob", icon: AudioLines },
  { href: "/enquiries", label: "Enquiries", icon: Inbox, badge: "unanswered" as const },
  { href: "/jobs", label: "Jobs", icon: HardHat },
  { href: "/materials", label: "Materials", icon: Package },
  { href: "/merchants", label: "Merchants", icon: Store },
  { href: "/team", label: "Team", icon: UsersRound, perm: "schedule.read" as const },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/invoices", label: "Money", icon: ReceiptText, perm: "finance.read" as const },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, badge: "due" as const },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Sidebar() {
  const pathname = usePathname();
  const counts = useNavCounts();
  const { org, can } = useStore();
  return (
    <aside className="theme-dark hidden w-[256px] shrink-0 flex-col border-r border-line bg-card lg:flex">
      <div className="px-5 pb-5 pt-6">
        <OrgWordmark org={org} height={38} />
        <div className="mt-2 flex items-center gap-1.5 text-[13.5px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-copper-400" /> with Bob
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {SIDEBAR_NAV.filter((i) => !i.perm || can(i.perm)).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const count = item.badge ? counts[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-11 items-center gap-3 rounded-xl px-3.5 text-[15.5px] font-medium transition active:bg-surface-3",
                active ? "bg-raised text-heading ring-1 ring-line-strong before:absolute before:inset-y-2.5 before:-left-3 before:w-[3px] before:rounded-r before:bg-copper-400" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
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
  if (r.status === 200) window.location.href = "/";
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
  const sample = org.dataMode === "sample";
  const [moreOpen, setMoreOpen] = React.useState(false);
  return (
    <header className="flex h-[calc(52px+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-line bg-card px-3 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
      <Link href="/week" aria-label="Diary">
        <BobLogo height={24} tone="dark" />
      </Link>
      <div className="flex items-center gap-1.5">
        {sample ? (
          <span role="note" title="Fictional sample data. Nothing is sent to anyone." className="inline-flex h-6 items-center gap-1 rounded-md bg-surface-3 px-2 text-[12px] font-medium text-muted-foreground">
            <FlaskConical aria-hidden className="size-3" /> Demo · sample data
          </span>
        ) : null}
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
    { href: "/week", label: "Diary", icon: CalendarDays, count: 0 },
    ...(can("schedule.read") ? [{ href: "/team", label: "Team", icon: UsersRound, count: 0 }] : []),
    { href: "/customers", label: "Customers", icon: Users, count: 0 },
    { href: "/materials", label: "Materials", icon: Package, count: 0 },
    { href: "/merchants", label: "Merchants", icon: Store, count: 0 },
    { href: "/tasks", label: "Tasks", icon: AlarmClock, count: counts.due },
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
            <Link key={l.href} href={l.href} onClick={() => onOpenChange(false)} className="flex h-13 items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-[16px] ring-1 ring-line hover:bg-surface-2 active:bg-surface-3">
              <l.icon className="size-5 text-accent-icon" />
              <span className="flex-1">{l.label}</span>
              {l.count ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-copper-500 px-1.5 text-[12px] font-semibold text-white">{l.count}</span> : null}
            </Link>
          ))}
        </div>
        <div className="mt-4">
          <InstallBob compact />
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
    { href: "/week", label: "Diary", icon: CalendarDays, count: 0 },
    { href: "/enquiries", label: "Enquiries", icon: Inbox, count: unanswered },
    { href: "/assistant", label: "Ask Bob", icon: AudioLines, count: 0 },
    { href: "/jobs", label: "Jobs", icon: HardHat, count: 0 },
    can("finance.read") ? { href: "/invoices", label: "Money", icon: ReceiptText, count: 0 } : { href: "/tasks", label: "Tasks", icon: CheckSquare, count: due },
  ];
  return (
    <nav aria-label="Main" className="pb-safe shrink-0 border-t border-line bg-card lg:hidden">
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

function AssistantPanel() {
  const ui = useUI();
  return (
    <Sheet open={ui.assistantOpen} onOpenChange={ui.setAssistantOpen}>
      <SheetContent title="Bob" className="theme-dark bg-background sm:w-[480px] [&>button:last-child]:hidden">
        <AssistantView variant="panel" onClose={() => ui.setAssistantOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
