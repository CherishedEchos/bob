"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        <h1 className="t-page">{title}</h1>
        {subtitle ? <p className="t-meta mt-1 text-[15px]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({
  title,
  href,
  linkLabel = "View all",
  className,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between", className)}>
      <h2 className="t-section">{title}</h2>
      {href ? (
        <Link href={href} className="flex h-9 items-center gap-0.5 rounded-md px-1 text-[14.5px] font-medium text-accent-fg hover:text-copper-700">
          {linkLabel} <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-surface", className)} {...props} />;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card-surface flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-xl bg-selected text-accent-icon ring-1 ring-copper-500/20">
        <Icon className="size-5" />
      </div>
      <p className="t-name">{title}</p>
      {body ? <p className="t-meta mt-1 max-w-xs">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[14px] font-semibold ring-1 transition active:bg-surface-3",
              active
                ? "bg-selected text-accent-fg ring-copper-500/40"
                : "bg-card text-muted-foreground ring-line hover:bg-surface-2 hover:text-foreground",
            )}
          >
            {o.label}
            {typeof o.count === "number" ? (
              <span className={cn("tabular rounded-md px-1.5 text-[12px]", active ? "bg-copper-500/20 text-accent-fg" : "bg-surface-3")}>
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function MoneyRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "green" | "amber" | "red" }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 last:border-0">
      <span className="text-[15px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tabular text-[16px]",
          strong && "font-semibold",
          tone === "green" && "text-good-fg",
          tone === "amber" && "text-warn-fg",
          tone === "red" && "text-danger-fg",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-copper-600 to-copper-400" style={{ width: `${value}%` }} />
    </div>
  );
}

/* ------------------------------ Shared list pieces ------------------------------ */

/** A titled panel holding a divided list. Thin dividers, no boxes per row. */
export function ListPanel({
  id,
  title,
  count,
  action,
  footer,
  children,
  className,
}: {
  id: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("panel overflow-hidden", className)}>
      {/* On narrow screens the action drops to its own line, right under the heading. */}
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:py-2 lg:px-5">
        <h2 id={id} className="t-section">
          {title}
          {typeof count === "number" && count > 0 ? <span className="ml-2 text-[14px] font-normal text-subtle tabular">{count}</span> : null}
        </h2>
        {action ? <div className="basis-full sm:basis-auto">{action}</div> : null}
      </div>
      <div className="border-t border-line">{children}</div>
      {footer ? <div className="flex min-h-12 items-center justify-between gap-3 border-t border-line px-4 lg:px-5">{footer}</div> : null}
    </section>
  );
}

/** Quiet, tappable amber action used at the end of a row ("Draft reply", "Chase deposit"). */
export const rowActionClass =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] bg-copper-500/[0.13] px-3.5 text-[14.5px] font-semibold text-accent-fg transition hover:bg-copper-500/[0.22] active:bg-copper-500/[0.28] disabled:opacity-50";

/** Text link-button for panel headers/footers ("Show all 12", "View all"). */
export const textActionClass =
  "inline-flex h-10 items-center gap-1 rounded-md px-1 text-[14.5px] font-semibold text-accent-fg transition hover:text-copper-700";

/**
 * One record in a list: leading mark, name, a short detail that may wrap, an
 * optional secondary action, and — when the row opens something — a chevron.
 * The whole row is the target (a stretched button), so it's easy to hit on a
 * phone; the secondary action sits above it and does only what its label says.
 */
export function ListRow({
  leading,
  title,
  meta,
  aside,
  action,
  onOpen,
  openLabel,
  selected,
  className,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  aside?: React.ReactNode;
  action?: React.ReactNode;
  onOpen?: () => void;
  openLabel?: string;
  selected?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="t-name line-clamp-2 min-w-0 break-words">{title}</span>
          {aside ? <span className="shrink-0 text-[13.5px] tabular text-muted-foreground">{aside}</span> : null}
        </span>
        {meta ? <span className="mt-0.5 block text-[14.5px] leading-snug text-muted-foreground">{meta}</span> : null}
      </span>
    </>
  );
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3 lg:px-5", onOpen && "row-open", className)} data-selected={selected || undefined}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          aria-current={selected || undefined}
          className="row-target flex min-w-0 flex-1 items-center gap-3 text-left after:absolute after:inset-0 after:content-['']"
        >
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {action ? <span className="row-secondary shrink-0">{action}</span> : null}
      {onOpen ? <ChevronRight aria-hidden className="row-chevron -mr-1 size-[18px] shrink-0" /> : null}
    </li>
  );
}

/** Primary page action ("Add new…", "Create invoice draft"): orange, compact. */
export const pageActionClass =
  "flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgb(16_24_40/0.12)] transition hover:bg-copper-600 active:bg-copper-700";

/** Secondary page action: white, bordered. */
export const pageSecondaryClass =
  "flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-card px-4 text-[15px] font-semibold text-foreground ring-1 ring-line-strong transition hover:bg-raised-hover active:bg-surface-3";

/**
 * "Demo · sample data" — one compact label used across the workspace. Pass
 * `detail` to explain what a particular action does in the demo.
 */
export function DemoTag({ detail, className }: { detail?: string; className?: string }) {
  return (
    <span
      title={detail ?? "Fictional sample data. Nothing is sent to real customers."}
      className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md bg-surface-3 px-2 text-[12.5px] font-medium text-muted-foreground", className)}
    >
      <FlaskConical aria-hidden className="size-3" /> Demo · sample data
    </span>
  );
}

/** A specific explanation of a simulated action ("Simulated — nothing is sent"). */
export function DemoNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-[13.5px] leading-snug text-muted-foreground", className)}>
      <FlaskConical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-subtle" />
      <span>{children}</span>
    </p>
  );
}

/** A collapsed section ("Business at a glance"). The heading is the toggle. */
export function Disclosure({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
  className,
}: {
  id: string;
  title: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className={cn("panel overflow-hidden", className)}>
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          id={id}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-surface-2 active:bg-surface-3 lg:px-5"
        >
          <span className="min-w-0 flex-1">
            <span className="t-section block">{title}</span>
            {summary && !open ? <span className="mt-0.5 block truncate text-[14px] text-muted-foreground">{summary}</span> : null}
          </span>
          <ChevronRight className={cn("size-5 shrink-0 text-subtle transition-transform", open && "rotate-90")} />
        </button>
      </h2>
      {open ? (
        <div id={`${id}-body`} role="region" aria-labelledby={id} className="border-t border-line">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Plain-text status with a small coloured dot — readable without the colour. */
export function StatusText({ tone, children, className }: { tone: "neutral" | "amber" | "green" | "red" | "blue" | "violet"; children: React.ReactNode; className?: string }) {
  const dot = { neutral: "bg-subtle", amber: "bg-amber-500", green: "bg-emerald-500", red: "bg-red-500", blue: "bg-sky-500", violet: "bg-violet-500" }[tone];
  const text = { neutral: "text-muted-foreground", amber: "text-warn-fg", green: "text-good-fg", red: "text-danger-fg", blue: "text-info-fg", violet: "text-violet-fg" }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13.5px] font-medium", text, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      {children}
    </span>
  );
}

/** Simple segmented tabs for a page's main lists (2–4 options). */
export function Tabs<T extends string>({ label, value, onChange, options, className }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number; highlight?: boolean }[]; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex min-w-0 max-w-full gap-0.5 rounded-xl bg-surface-3 p-1", className)}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[14.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-surface-2",
              active ? "bg-card text-heading shadow-[0_1px_2px_rgb(16_24_40/0.08)] ring-1 ring-line" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {typeof o.count === "number" ? <span className={cn("tabular text-[12.5px]", active && o.highlight && o.count ? "text-accent-fg" : "text-subtle")}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
