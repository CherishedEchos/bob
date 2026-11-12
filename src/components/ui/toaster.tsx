"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

let counter = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Fire-and-forget toast. Only call AFTER a state change has been recorded. */
export function toast(message: string, tone: ToastTone = "success") {
  const item = { id: ++counter, message, tone };
  listeners.forEach((l) => l(item));
}

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((prev) => [...prev.slice(-2), t]);
      window.setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== t.id)), 3200);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[100] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:left-auto lg:right-6 lg:top-auto lg:items-end"
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
          </div>
        );
      })}
    </div>
  );
}
