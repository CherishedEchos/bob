"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AudioLines, Building2, CalendarDays, Check, CheckSquare, ChevronLeft, ChevronsUpDown, FlaskConical, Package, Store, UsersRound, HardHat, History, Inbox, LogOut,
  Gauge, Mic, MoreHorizontal, PanelLeftClose, PanelLeftOpen, ReceiptText, Settings, Users,
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

const isAssistantRoute = (p: string) => p === "/assistant";

/** Schedules and lists use the full width; reading pages (settings, activity) keep a comfortable measure. */
function pageWidth(p: string) {
  if (["/settings", "/activity", "/replies", "/overview", "/today"].some((x) => p.startsWith(x))) return "max-w-[1100px]";
  return "max-w-[1680px]";
}

const COLLAPSE_KEY = "bob.sidebar.collapsed";

function ShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const assistant = isAssistantRoute(pathname);
  // Focused workspaces (the handover) have their own Back / Continue bar, so no tab bar or floating button.
  const focus = /^\/jobs\/[^/]+\/handover/.test(pathname);
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !c;
    });
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
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Ask Bob shows demo mode in its own header; phones show it in the top bar. */}
        {!assistant ? <DemoBanner /> : null}
        {!assistant && !focus ? <MobileHeader /> : null}
        <main className={cn("min-h-0 flex-1 overscroll-contain", assistant ? "overflow-hidden" : "overflow-y-auto bg-app")}>
          {assistant ? (
            children
          ) : (
            <div className={cn("mx-auto w-full px-4 pt-3 sm:px-6 lg:px-8 lg:pt-7 2xl:px-10", focus ? "flex min-h-full flex-col pb-0 lg:pb-0" : "pb-[calc(112px+env(safe-area-inset-bottom))] lg:pb-24", pageWidth(pathname))}>{children}</div>
          )}
        </main>
        {/* Ask Bob has its own back button and bottom controls. */}
        {!assistant && !focus ? <BottomNav /> : null}
        {!assistant && !focus ? <DesktopAskBob /> : null}
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
    <div role="note" className="hidden h-7 shrink-0 items-center justify-center gap-1.5 border-b border-line bg-card px-3 text-[12px] text-subtle lg:flex">
      <FlaskConical aria-hidden className="size-3.5 shrink-0" />
      <span>
        <strong className="font-medium text-foreground">Demo workspace</strong>
        <span> · {org.isDemo ? "a fictional business" : "fictional customers"}. Nothing is sent to anyone.</span>
      </span>
    </div>
  );
}

/* ------------------------------ Desktop sidebar ------------------------------ */

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; badge?: "unanswered" | "due"; perm?: "schedule.read" | "finance.read" };

/** Grouped by how a trade business runs: plan the week, win and run the work, people and supplies, money. */
const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/week", label: "Diary", icon: CalendarDays },
      { href: "/assistant", label: "Ask Bob", icon: AudioLines },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/enquiries", label: "Enquiries", icon: Inbox, badge: "unanswered" },
      { href: "/jobs", label: "Jobs", icon: HardHat },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/tasks", label: "Tasks", icon: CheckSquare, badge: "due" },
    ],
  },
  {
    label: "Resources",
    items: [
      { href: "/team", label: "Team", icon: UsersRound, perm: "schedule.read" },
      { href: "/materials", label: "Materials", icon: Package },
      { href: "/merchants", label: "Merchants", icon: Store },
    ],
  },
  {
    label: "Finance",
    items: [{ href: "/invoices", label: "Money", icon: ReceiptText, perm: "finance.read" }],
  },
];

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const counts = useNavCounts();
  const { org, can } = useStore();
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-line bg-nav transition-[width] duration-200 ease-out lg:flex",
        collapsed ? "w-[64px]" : "w-[248px]",
      )}
    >
      {/* Workspace identity: the business first, Bob second. */}
      <div className={cn("flex h-[60px] shrink-0 items-center border-b border-line", collapsed ? "justify-center px-2" : "gap-2.5 px-4")}>
        {collapsed ? (
          <OrgLogo org={org} size={30} />
        ) : (
          <>
            <OrgLogo org={org} size={30} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold tracking-[-0.01em] text-heading">{org.shortName || org.name}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-subtle">
                with <BobLogo height={9} tone="dark" />
              </span>
            </span>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="grid size-7 place-items-center rounded-md text-subtle transition hover:bg-surface-3 hover:text-foreground"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </>
        )}
      </div>
      <nav className={cn("scrollbar-none flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-2.5")} aria-label="Main">
        {NAV_GROUPS.map((g, gi) => {
          const items = g.items.filter((i) => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div key={gi} className={cn(gi > 0 && "mt-4")}>
              {g.label && !collapsed ? <div className="mb-1 px-2.5 text-[11.5px] font-medium text-subtle">{g.label}</div> : null}
              {g.label && collapsed ? <div className="mx-auto mb-2 h-px w-5 bg-line-strong" /> : null}
              <div className="space-y-px">
                {items.map((item) => (
                  <SideLink key={item.href} item={item} active={isActive(pathname, item.href)} count={item.badge ? counts[item.badge] : 0} collapsed={collapsed} />
                ))}
              </div>
            </div>
          );
        })}
        <div className="mt-4 space-y-px">
          <SideLink item={{ href: "/settings", label: "Settings", icon: Settings }} active={isActive(pathname, "/settings")} count={0} collapsed={collapsed} />
        </div>
      </nav>
      <div className={cn("shrink-0 border-t border-line py-2.5", collapsed ? "px-2" : "px-2.5")}>
        <UserMenu collapsed={collapsed} />
        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="mx-auto mt-2 grid size-8 place-items-center rounded-md text-subtle transition hover:bg-surface-3 hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function SideLink({ item, active, count, collapsed }: { item: NavItem; active: boolean; count: number; collapsed: boolean }) {
  const bob = item.href === "/assistant";
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex h-8 items-center rounded-md text-[13.5px] transition-colors duration-100",
        collapsed ? "justify-center" : "gap-2.5 px-2.5",
        active ? "bg-card font-semibold text-heading shadow-[0_0_0_1px_rgb(24_24_27/0.07),0_1px_2px_rgb(24_24_27/0.05)]" : "font-medium text-foreground/75 hover:bg-surface-3 hover:text-heading",
      )}
    >
      {active && !collapsed ? <span aria-hidden className="absolute inset-y-[7px] -left-2.5 w-[3px] rounded-r-full bg-copper-500" /> : null}
      <item.icon className={cn("size-[17px] shrink-0", active || bob ? "text-copper-600" : "text-foreground/50 group-hover:text-foreground/80")} strokeWidth={1.75} />
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {count ? (
        collapsed ? (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-copper-500" aria-label={`${count} waiting`} />
        ) : (
          <span className="tabular text-[12px] font-medium text-subtle">{count}</span>
        )
      ) : null}
    </Link>
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

export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full bg-[#2b2b30] font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials}
    </span>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, org, data } = useStore();
  const orgs = useWorkspaces();
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn("flex w-full items-center rounded-md text-left transition hover:bg-surface-3", collapsed ? "justify-center p-1" : "gap-2.5 px-1.5 py-1.5")}
      >
        <Avatar name={user.name} size={28} />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold text-heading">{user.name}</span>
              <span className="block truncate text-[11.5px] text-subtle">{ROLE_LABEL[user.role]}</span>
            </span>
            <ChevronsUpDown className="size-3.5 text-subtle" />
          </>
        )}
      </button>
      {open ? (
        <div role="menu" className={cn("absolute bottom-full z-50 mb-2 w-[248px] rounded-lg border border-line-strong bg-popover p-1 shadow-[var(--shadow-lg)]", collapsed ? "left-0" : "left-0 right-0 w-auto")}>
          <div className="px-2.5 pb-2 pt-1.5">
            <div className="truncate text-[13px] font-medium text-heading">{user.name}</div>
            <div className="truncate text-[12px] text-subtle">{user.email}</div>
          </div>
          {orgs.length > 1 ? (
            <>
              <div className="my-1 h-px bg-line" />
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-subtle">Business</div>
              {orgs.map((o) => (
                <button
                  key={o.id}
                  role="menuitemradio"
                  aria-checked={o.id === org.id}
                  onClick={() => void switchOrg(o.id)}
                  className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-foreground/85 hover:bg-surface-3 hover:text-heading"
                >
                  <Building2 className="size-4 text-subtle" />
                  <span className="flex-1 truncate">
                    {o.name}
                    {o.isDemo ? " (demo)" : ""}
                  </span>
                  {o.id === org.id ? <Check className="size-4 text-copper-400" /> : null}
                </button>
              ))}
            </>
          ) : null}
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/85 hover:bg-surface-3 hover:text-heading">
            <Settings className="size-4 text-subtle" /> Settings
          </Link>
          {data?.mode.platformAdmin ? (
            <Link role="menuitem" href="/cresaro" onClick={() => setOpen(false)} className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground/85 hover:bg-surface-3 hover:text-heading">
              <Gauge className="size-4 text-subtle" /> Cresaro admin
            </Link>
          ) : null}
          <button role="menuitem" onClick={() => void signOut()} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-foreground/85 hover:bg-surface-3 hover:text-heading">
            <LogOut className="size-4 text-subtle" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Mobile chrome ------------------------------ */

/** Detail pages get a back link to their list on phones (the browser back button still works too). */
function backTarget(p: string): { href: string; label: string } | null {
  if (/^\/jobs\/[^/]+\/handover/.test(p)) return null; // the handover has its own back and Save & exit
  if (p.startsWith("/jobs/")) return { href: "/jobs", label: "Jobs" };
  if (p.startsWith("/cresaro")) return { href: "/settings", label: "Settings" };
  if (p.startsWith("/activity")) return { href: "/settings", label: "Settings" };
  if (p.startsWith("/replies")) return { href: "/enquiries", label: "Enquiries" };
  return null;
}

function MobileHeader() {
  const { org, user } = useStore();
  const sample = org.dataMode === "sample";
  const [moreOpen, setMoreOpen] = React.useState(false);
  const pathname = usePathname();
  const parent = backTarget(pathname);
  return (
    <header className="flex h-[calc(52px+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-2 bg-background/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-6 lg:hidden">
      {parent ? (
        <Link href={parent.href} className="-ml-2 flex h-11 min-w-0 items-center gap-1 rounded-lg pr-2 text-[15px] font-semibold text-heading">
          <ChevronLeft className="size-5" aria-hidden /> {parent.label}
        </Link>
      ) : (
      <Link href="/week" aria-label="Diary" className="flex min-w-0 items-center gap-2.5">
        <OrgLogo org={org} size={30} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[14px] font-semibold text-heading">{org.shortName || org.name}</span>
          <span className="flex items-center gap-1 text-[11.5px] text-subtle">
            with <BobLogo height={9.5} tone="dark" />
          </span>
        </span>
      </Link>
      )}
      <div className="flex items-center gap-1.5">
        {sample ? (
          <span role="note" title="Fictional sample data. Nothing is sent to anyone." className="inline-flex h-6 items-center gap-1 rounded-full bg-surface-3 px-2 text-[11.5px] font-medium text-muted-foreground">
            <FlaskConical aria-hidden className="size-3" /> Demo
          </span>
        ) : null}
        <button onClick={() => setMoreOpen(true)} aria-label="Account and more" className="grid size-11 place-items-center rounded-full">
          <Avatar name={user.name} size={32} />
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
  const pathname = usePathname();
  const links = [
    { href: "/assistant", label: "Ask Bob", icon: AudioLines, count: 0 },
    { href: "/enquiries", label: "Enquiries", icon: Inbox, count: counts.unanswered },
    { href: "/customers", label: "Customers", icon: Users, count: 0 },
    ...(can("schedule.read") ? [{ href: "/team", label: "Team", icon: UsersRound, count: 0 }] : []),
    { href: "/materials", label: "Materials", icon: Package, count: 0 },
    { href: "/merchants", label: "Merchants", icon: Store, count: 0 },
    ...(can("finance.read") ? [{ href: "/invoices", label: "Money", icon: ReceiptText, count: 0 }] : []),
    ...(can("activity.read") ? [{ href: "/activity", label: "Activity", icon: History, count: 0 }] : []),
    { href: "/settings", label: "Settings", icon: Settings, count: 0 },
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" title="More" className="p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mb-5 flex items-center gap-3">
          <Avatar name={user.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold">{user.name}</div>
            <div className="truncate text-[13.5px] text-subtle">
              {ROLE_LABEL[user.role]} · {org.name}
            </div>
          </div>
          <OrgLogo org={org} size={36} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {links.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => onOpenChange(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex aspect-[1.15] flex-col items-center justify-center gap-2 rounded-2xl text-[13.5px] font-medium ring-1 transition active:scale-[0.97]",
                  active ? "bg-copper-500/10 text-accent-fg ring-copper-500/40" : "bg-card text-foreground ring-line shadow-[var(--shadow-xs)]",
                )}
              >
                <l.icon className={cn("size-[22px]", active ? "text-accent-icon" : "text-foreground/70")} />
                {l.label}
                {l.count ? <span className="tabular absolute right-2 top-2 grid h-5 min-w-5 place-items-center rounded-full bg-copper-500 px-1.5 text-[11px] font-semibold text-white">{l.count}</span> : null}
              </Link>
            );
          })}
        </div>
        <div className="mt-4">
          <InstallBob compact />
        </div>
        {orgs.length > 1 ? (
          <>
            <div className="mt-5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-subtle">Switch business</div>
            <div className="mt-2 space-y-1.5">
              {orgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => void switchOrg(o.id)}
                  aria-pressed={o.id === org.id}
                  className={cn("flex h-11 w-full items-center gap-2 rounded-xl px-4 text-left text-[15px] ring-1", o.id === org.id ? "bg-copper-500/10 text-accent-fg ring-copper-500/40" : "bg-card text-muted-foreground ring-line")}
                >
                  <Building2 className="size-4" /> <span className="flex-1">{o.name}{o.isDemo ? " (demo)" : ""}</span>
                  {o.id === org.id ? <Check className="size-4" /> : null}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <button onClick={() => void signOut()} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] text-muted-foreground ring-1 ring-line">
          <LogOut className="size-4" /> Sign out
        </button>
        <div className="mt-5 flex justify-center opacity-70">
          <BobLogo height={14} tone="dark" byline />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Floating dark tab bar: Diary · Jobs · Bob's microphone · Tasks · More. */
function BottomNav() {
  const pathname = usePathname();
  const { due } = useNavCounts();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const side = (href: string, label: string, Icon: NavItem["icon"], count = 0) => {
    const active = isActive(pathname, href);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn("relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", active ? "text-copper-400" : "text-white/60 active:text-white")}
      >
        <span className="relative">
          <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.7} />
          {count ? <span className="tabular absolute -right-2 -top-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-copper-500 px-1 text-[10px] font-semibold text-white ring-2 ring-sidebar">{count}</span> : null}
        </span>
        {label}
      </Link>
    );
  };
  const onMore = !["/week", "/jobs", "/tasks"].some((h) => isActive(pathname, h));
  return (
    <nav aria-label="Main" className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 pb-[max(10px,env(safe-area-inset-bottom))] lg:hidden">
      <div className="pointer-events-auto relative mx-auto grid h-[66px] max-w-md grid-cols-5 rounded-[26px] bg-sidebar/95 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.45),0_0_0_1px_rgb(255_255_255/0.06)_inset] backdrop-blur-xl">
        {side("/week", "Diary", CalendarDays)}
        {side("/jobs", "Jobs", HardHat)}
        <div className="relative flex items-center justify-center">
          <Link
            href="/assistant?listen=1"
            aria-label="Ask Bob — tap to talk"
            className="relative -mt-7 grid size-[62px] place-items-center rounded-full bg-copper-500 text-white shadow-[0_0_0_5px_#19191b,0_4px_14px_rgb(243_135_53/0.3)] transition active:scale-95"
          >
            <span aria-hidden className="absolute inset-0 rounded-full ring-1 ring-white/25 motion-safe:animate-breathe" />
            <Mic className="size-[26px]" strokeWidth={2} />
          </Link>
        </div>
        {side("/tasks", "Tasks", CheckSquare, due)}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          className={cn("flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium", onMore ? "text-copper-400" : "text-white/60")}
        >
          <MoreHorizontal className="size-[22px]" strokeWidth={onMore ? 2 : 1.7} />
          More
        </button>
      </div>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </nav>
  );
}

/** Desktop: Ask Bob from any page, in a side panel that knows which record is on screen. */
function DesktopAskBob() {
  const ui = useUI();
  if (ui.assistantOpen) return null;
  return (
    <button
      type="button"
      onClick={() => ui.setAssistantOpen(true)}
      aria-label={ui.pageContext ? `Ask Bob about ${ui.pageContext.label}` : "Ask Bob"}
      className="absolute bottom-5 right-5 z-30 hidden h-11 items-center gap-2 rounded-full bg-sidebar pl-1.5 pr-4 text-[14px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(0_0_0/0.4)] transition hover:bg-[#232326] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none lg:flex"
    >
      <span className="grid size-8 place-items-center rounded-full bg-copper-500">
        <Mic className="size-4" aria-hidden />
      </span>
      Ask Bob
    </button>
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
