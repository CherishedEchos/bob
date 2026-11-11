"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AudioLines,
  Bell,
  CirclePoundSterling,
  HardHat,
  History,
  House,
  Inbox,
  LayoutGrid,
  AlarmClock,
  Settings,
  UserRound,
} from "lucide-react";
import { StoreProvider, useStore, DEMO_USERS } from "@/lib/store/store";
import { UIProvider, useUI } from "@/lib/store/ui";
import { AssistantProvider } from "@/lib/assistant/provider";
import { needsReply, remindersDue } from "@/lib/derive";
import { cn } from "@/lib/utils";
import { Logo, LogoMark } from "@/components/brand/logo";
import { Toaster } from "@/components/ui/toaster";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AssistantView } from "@/components/assistant/assistant-view";
import { OrbAvatar } from "@/components/assistant/orb";
import { EnquirySheet } from "@/components/enquiries/enquiry-sheet";
import { JobSheet } from "@/components/jobs/job-sheet";
import { FormHost } from "@/components/forms/form-host";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <UIProvider>
        <AssistantProvider>
          <ShellLayout>{children}</ShellLayout>
          <EnquirySheet />
          <JobSheet />
          <FormHost />
          <AssistantPanel />
          <Toaster />
        </AssistantProvider>
      </UIProvider>
    </StoreProvider>
  );
}

function useNavCounts() {
  const { data } = useStore();
  return {
    unanswered: data.enquiries.filter(needsReply).length,
    due: remindersDue(data.reminders).length,
  };
}

const isAssistantRoute = (p: string) => p === "/" || p === "/assistant";

function ShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const assistant = isAssistantRoute(pathname);
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {!assistant ? <MobileHeader /> : null}
        <main className={cn("min-h-0 flex-1", assistant ? "overflow-hidden" : "overflow-y-auto bg-app")}>
          {assistant ? (
            children
          ) : (
            <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 lg:px-10 lg:pt-10">{children}</div>
          )}
        </main>
        <BottomNav />
      </div>
      {!assistant ? <AssistantFab /> : null}
    </div>
  );
}

/* ------------------------------ Desktop sidebar ------------------------------ */

const SIDEBAR_NAV = [
  { href: "/overview", label: "Overview", icon: House },
  { href: "/assistant", label: "Assistant", icon: AudioLines },
  { href: "/enquiries", label: "Enquiries", icon: Inbox, badge: "unanswered" as const },
  { href: "/jobs", label: "Jobs", icon: HardHat },
  { href: "/payments", label: "Payments", icon: CirclePoundSterling },
  { href: "/reminders", label: "Reminders", icon: AlarmClock, badge: "due" as const },
  { href: "/activity", label: "Activity", icon: History },
];

function Sidebar() {
  const pathname = usePathname();
  const counts = useNavCounts();
  const { user, setUser } = useStore();
  return (
    <aside className="hidden w-[264px] shrink-0 flex-col border-r border-white/[0.06] bg-ink-900 lg:flex">
      <div className="px-6 pb-6 pt-7">
        <Logo size={42} />
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {SIDEBAR_NAV.map((item) => {
          const active = pathname === item.href || (item.href === "/assistant" && pathname === "/");
          const count = item.badge ? counts[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-xl px-3.5 text-[15px] font-medium transition",
                active
                  ? "bg-copper-500/14 text-copper-200 ring-1 ring-copper-500/40"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
              )}
            >
              <item.icon className={cn("size-[19px]", active && "text-copper-400")} strokeWidth={1.8} />
              <span className="flex-1">{item.label}</span>
              {count ? (
                <span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-copper-500 px-1.5 text-[11px] font-semibold text-white">
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-3 border-t border-white/[0.06] p-4">
        <div className="rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/[0.06]" role="radiogroup" aria-label="Signed in as (demo)">
          <div className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wider text-subtle">Signed in as · demo</div>
          <div className="grid grid-cols-2 gap-1">
            {DEMO_USERS.map((u) => (
              <button
                key={u.id}
                role="radio"
                aria-checked={user.id === u.id}
                onClick={() => setUser(u.id)}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition",
                  user.id === u.id ? "bg-white/[0.09] text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <UserRound className="size-3.5" /> {u.displayName}
              </button>
            ))}
          </div>
        </div>
        <Link
          href="/settings"
          className={cn(
            "flex h-10 items-center gap-3 rounded-xl px-3.5 text-[14px] text-muted-foreground transition hover:bg-white/[0.05] hover:text-foreground",
            pathname === "/settings" && "text-foreground",
          )}
        >
          <Settings className="size-[18px]" /> Settings & demo data
        </Link>
      </div>
    </aside>
  );
}

/* ------------------------------ Mobile chrome ------------------------------ */

function MobileHeader() {
  const counts = useNavCounts();
  const [moreOpen, setMoreOpen] = React.useState(false);
  return (
    <header className="flex h-[68px] shrink-0 items-center justify-between bg-background/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
      <button
        onClick={() => setMoreOpen(true)}
        aria-label="More"
        className="grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06]"
      >
        <LayoutGrid className="size-[22px]" />
      </button>
      <Link href="/" aria-label="Assistant home">
        <Logo size={38} />
      </Link>
      <Link
        href="/reminders"
        aria-label={`Reminders${counts.due ? `, ${counts.due} due` : ""}`}
        className="relative grid size-11 place-items-center rounded-full text-foreground/90 hover:bg-white/[0.06]"
      >
        <Bell className="size-[22px]" />
        {counts.due ? <span className="absolute right-2.5 top-2.5 size-2.5 rounded-full bg-copper-500 ring-2 ring-background" /> : null}
      </Link>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </header>
  );
}

function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user, setUser } = useStore();
  const counts = useNavCounts();
  const links = [
    { href: "/reminders", label: "Reminders", icon: AlarmClock, count: counts.due },
    { href: "/activity", label: "Recent activity", icon: History, count: 0 },
    { href: "/settings", label: "Settings & demo data", icon: Settings, count: 0 },
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" title="More" className="p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mb-5 flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <div className="font-semibold">NINETY3</div>
            <div className="text-[13px] text-muted-foreground">Signed in as {user.displayName} (demo)</div>
          </div>
        </div>
        <div className="space-y-1.5">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => onOpenChange(false)}
              className="flex h-14 items-center gap-3 rounded-2xl bg-white/[0.04] px-4 text-[15px] ring-1 ring-white/[0.08]"
            >
              <l.icon className="size-5 text-copper-400" />
              <span className="flex-1">{l.label}</span>
              {l.count ? (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-copper-500 px-1.5 text-[11px] font-semibold">{l.count}</span>
              ) : null}
            </Link>
          ))}
        </div>
        <div className="mt-5 text-[12px] uppercase tracking-wider text-subtle">Switch demo user</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {DEMO_USERS.map((u) => (
            <button
              key={u.id}
              onClick={() => setUser(u.id)}
              aria-pressed={user.id === u.id}
              className={cn(
                "h-11 rounded-xl text-[14px] font-medium ring-1",
                user.id === u.id ? "bg-copper-500/15 text-copper-200 ring-copper-500/50" : "bg-white/[0.04] text-muted-foreground ring-white/10",
              )}
            >
              {u.displayName}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const BOTTOM_NAV = [
  { href: "/", label: "Assistant", icon: AudioLines },
  { href: "/overview", label: "Overview", icon: House },
  { href: "/enquiries", label: "Enquiries", icon: Inbox, badge: true },
  { href: "/jobs", label: "Jobs", icon: HardHat },
  { href: "/payments", label: "Payments", icon: CirclePoundSterling },
];

function BottomNav() {
  const pathname = usePathname();
  const { unanswered } = useNavCounts();
  return (
    <nav
      aria-label="Main"
      className="pb-safe shrink-0 border-t border-white/[0.07] bg-ink-900/95 backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid h-[68px] max-w-lg grid-cols-5">
        {BOTTOM_NAV.map((item) => {
          const active = item.href === "/" ? isAssistantRoute(pathname) : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 text-[11.5px] font-medium transition",
                active ? "text-copper-400" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <item.icon className="size-6" strokeWidth={active ? 2 : 1.7} />
                {item.badge && unanswered ? (
                  <span className="tabular absolute -right-2.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-copper-500 px-1 text-[10.5px] font-semibold text-white ring-2 ring-ink-900">
                    {unanswered}
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

/* ------------------------------ Desktop assistant panel ------------------------------ */

function AssistantFab() {
  const ui = useUI();
  return (
    <button
      onClick={() => ui.setAssistantOpen(true)}
      className="fixed bottom-6 right-6 z-40 hidden items-center gap-3 rounded-full bg-ink-800/95 py-2 pl-2 pr-5 text-[15px] font-medium shadow-2xl ring-1 ring-copper-500/40 backdrop-blur transition hover:ring-copper-400 lg:flex"
    >
      <OrbAvatar className="size-10" />
      Ask Ninety3
    </button>
  );
}

function AssistantPanel() {
  const ui = useUI();
  return (
    <Sheet open={ui.assistantOpen} onOpenChange={ui.setAssistantOpen}>
      <SheetContent title="Ninety3 Assistant" className="bg-ink-950 sm:w-[460px] [&>button:last-child]:hidden">
        <AssistantView variant="panel" onClose={() => ui.setAssistantOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
