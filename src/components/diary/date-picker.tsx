"use client";

/** A compact month calendar in a popover: pick any day to jump the diary there. */
import * as React from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, rangeKeys, weekStart } from "@/lib/dates";
import { cn } from "@/lib/utils";

const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
const shiftMonth = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};
const monthName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function DatePicker({ value, today, label, onChange, highlight }: { value: string; today: string; label: string; onChange: (key: string) => void; highlight?: string[] }) {
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(monthStart(value));
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (open) setMonth(monthStart(value));
  }, [open, value]);
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
  const first = weekStart(month);
  const last = addDays(weekStart(addDays(shiftMonth(month, 1), -1)), 6);
  const days = rangeKeys(first, last);
  const marked = new Set(highlight ?? []);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-10 items-center gap-2 rounded-lg px-2.5 text-[15px] font-semibold tracking-[-0.012em] text-heading transition hover:bg-surface-3 lg:h-9"
      >
        <CalendarDays className="size-4 text-subtle" aria-hidden />
        <span className="tabular">{label}</span>
        <ChevronDown className={cn("size-3.5 text-subtle transition", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div role="dialog" aria-label="Choose a date" className="absolute left-0 top-full z-40 mt-1.5 w-[288px] rounded-xl border border-line-strong bg-popover p-3 shadow-[var(--shadow-lg)]">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-3">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-[14px] font-semibold text-heading">{monthName(month)}</span>
            <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-3">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11.5px] font-medium text-subtle">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="py-1">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {days.map((d) => {
              const inMonth = d.slice(0, 7) === month.slice(0, 7);
              const sel = d === value;
              const isToday = d === today;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    onChange(d);
                    setOpen(false);
                  }}
                  aria-label={new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
                  aria-current={isToday ? "date" : undefined}
                  className={cn(
                    "relative mx-auto grid size-9 place-items-center rounded-md text-[13px] tabular transition",
                    sel ? "bg-heading font-semibold text-white" : isToday ? "font-semibold text-brand-fg hover:bg-surface-3" : inMonth ? "text-foreground hover:bg-surface-3" : "text-subtle/60 hover:bg-surface-3",
                  )}
                >
                  {Number(d.slice(8))}
                  {marked.has(d) && !sel ? <span aria-hidden className="absolute bottom-1 size-1 rounded-full bg-copper-500" /> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-line pt-2">
            <button type="button" onClick={() => { onChange(today); setOpen(false); }} className="h-8 rounded-md px-2 text-[13px] font-semibold text-brand-fg hover:bg-surface-3">
              Today
            </button>
            <button type="button" onClick={() => { onChange(addDays(today, 1)); setOpen(false); }} className="h-8 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-surface-3">
              Tomorrow
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
