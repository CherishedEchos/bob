"use client";

/**
 * A one-line first-use tip. Shown until dismissed (remembered on this device);
 * never shown again after "Got it".
 */
import * as React from "react";
import { Lightbulb, X } from "lucide-react";

export function Tip({ id, children }: { id: string; children: React.ReactNode }) {
  const key = `bob.tip.${id}`;
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    try {
      setShow(localStorage.getItem(key) !== "1" && localStorage.getItem("bob.tips.off") !== "1");
    } catch {
      setShow(false);
    }
  }, [key]);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-xl bg-selected px-3.5 py-2.5 text-[14px] leading-snug text-foreground ring-1 ring-copper-500/20">
      <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-icon" />
      <span className="min-w-0 flex-1">{children}</span>
      <button type="button" onClick={dismiss} className="-my-1 -mr-1.5 flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-subtle hover:bg-surface-2 hover:text-foreground">
        Got it <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
