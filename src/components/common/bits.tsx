import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
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
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">{title}</h1>
        {subtitle ? <p className="mt-1 text-[16px] text-muted-foreground">{subtitle}</p> : null}
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
      <h2 className="text-[19px] font-semibold tracking-tight">{title}</h2>
      {href ? (
        <Link href={href} className="flex items-center gap-1 rounded-md text-[15px] font-medium text-accent-icon hover:text-accent-fg">
          {linkLabel} <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-surface rounded-2xl", className)} {...props} />;
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
    <div className="card-surface flex flex-col items-center rounded-2xl px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-copper-500/10 text-accent-icon ring-1 ring-copper-500/25">
        <Icon className="size-5" />
      </div>
      <p className="font-medium">{title}</p>
      {body ? <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p> : null}
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
              "flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium ring-1 transition",
              active
                ? "bg-copper-500/18 text-accent-fg ring-copper-500/60"
                : "bg-surface-2 text-muted-foreground ring-line hover:bg-surface-3 hover:text-foreground",
            )}
          >
            {o.label}
            {typeof o.count === "number" ? (
              <span className={cn("tabular rounded-full px-1.5 text-[12px]", active ? "bg-copper-500/30" : "bg-surface-3")}>
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
