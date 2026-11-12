"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Right-hand panel on desktop, full-height sheet on mobile.
 * Built on Radix Dialog (focus trap, Esc to close, aria wiring).
 */
export function SheetContent({
  className,
  children,
  title,
  description,
  side = "right",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  side?: "right" | "bottom";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col bg-background shadow-2xl outline-none ring-1 ring-line",
          side === "right" &&
            "inset-y-0 right-0 w-full sm:w-[540px] sm:rounded-l-3xl",
          side === "bottom" && "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl sm:left-1/2 sm:bottom-6 sm:w-[520px] sm:-translate-x-1/2 sm:rounded-3xl",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-card text-muted-foreground ring-1 ring-line-strong transition hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close"
        >
          <X className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Centred modal dialog for short forms and confirmations. */
export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string; description?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-[60] max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl outline-none ring-1 ring-line sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(480px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6",
          className,
        )}
        {...props}
      >
        <div className="mb-5 pr-10">
          <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className={cn("mt-1 text-sm text-muted-foreground", !description && "sr-only")}>
            {description ?? title}
          </DialogPrimitive.Description>
        </div>
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 grid size-10 place-items-center rounded-full text-muted-foreground transition hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close"
        >
          <X className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const Dialog = DialogPrimitive.Root;
