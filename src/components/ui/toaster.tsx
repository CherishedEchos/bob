"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
interface ToastAction {
  label: string;
  run: () => void;
}
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

let counter = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Fire-and-forget toast. Only call AFTER a state change has been recorded. */
export function toast(message: string, tone: ToastTone = "success", opts: { action?: ToastAction } = {}) {
  const item = { id: ++counter, message, tone, action: opts.action };
  listeners.forEach((l) => l(item));
}

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((prev) => [...prev.slice(-2), t]);
      // A toast with an action (e.g. Undo) stays a little longer so it can be tapped.
      window.setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== t.id)), t.action ? 6000 : 3200);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[100] flex flex-col items-center gap-2 px-4 lg:left-auto lg:right-6 lg:top-6 lg:items-end"
    >
      {items.map((t) => {
        const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertCircle : Info;
        return (
          <div
            key={t.id}
            className="theme-dark pointer-events-auto flex max-w-sm animate-fade-up items-center gap-2.5 rounded-2xl bg-ink-800 px-4 py-3 text-[16px] text-white shadow-xl ring-1 ring-black/10"
          >
            <Icon
              className={cn(
                "size-4.5 shrink-0",
                t.tone === "success" && "text-good-fg",
                t.tone === "error" && "text-danger-fg",
                t.tone === "info" && "text-accent-icon",
              )}
            />
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  setItems((prev) => prev.filter((p) => p.id !== t.id));
                }}
                className="-my-1 ml-1 h-9 shrink-0 rounded-lg px-3 text-[15px] font-semibold text-accent-fg ring-1 ring-white/20 hover:bg-white/10"
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
