"use client";

/**
 * A small dropdown menu (e.g. "+ Add"). Closes on outside tap, Esc or after a
 * choice. Arrow keys move between items.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect?: () => void;
  /** Render as a <label> for a file input (e.g. Add photo), so the picker opens from a real tap. */
  htmlFor?: string;
  hint?: string;
}

export function Menu({
  label,
  trigger,
  items,
  align = "end",
  triggerClassName,
}: {
  label: string;
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  triggerClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        (root.current?.querySelector("[data-menu-trigger]") as HTMLElement | null)?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const itemCls =
    "flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 text-left text-[15.5px] font-medium text-foreground outline-none transition hover:bg-raised-hover focus-visible:bg-raised-hover";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        data-menu-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute top-[calc(100%+6px)] z-40 w-64 overflow-hidden rounded-2xl bg-raised py-1.5 shadow-[0_18px_48px_-12px_rgb(0_0_0/0.85)] ring-1 ring-line-strong",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((it) => {
            const Icon = it.icon;
            const content = (
              <>
                {Icon ? <Icon className="size-[18px] shrink-0 text-accent-icon" /> : null}
                <span className="min-w-0">
                  <span className="block">{it.label}</span>
                  {it.hint ? <span className="block text-[13px] font-normal text-muted-foreground">{it.hint}</span> : null}
                </span>
              </>
            );
            return it.htmlFor ? (
              <label
                key={it.label}
                role="menuitem"
                tabIndex={-1}
                htmlFor={it.htmlFor}
                className={itemCls}
                onClick={() => setTimeout(() => setOpen(false), 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    document.getElementById(it.htmlFor!)?.click();
                    setOpen(false);
                  }
                }}
              >
                {content}
              </label>
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={itemCls}
                onClick={() => {
                  setOpen(false);
                  it.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
