import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-lg bg-field px-3.5 text-[16px] text-foreground ring-1 ring-input placeholder:text-subtle outline-none transition-shadow hover:ring-foreground/30 focus:ring-2 focus:ring-copper-500/60 lg:text-[15.5px] disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:ring-destructive/70";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, "h-11", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

/**
 * A native select that looks editable: border, white field and a visible
 * chevron (drawn as an icon — Tailwind doesn't generate CSS for an inline SVG
 * background, which left every dropdown without its arrow).
 */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <span className="relative block w-full min-w-0">
      <select ref={ref} className={cn(fieldBase, "h-11 cursor-pointer appearance-none pr-10 disabled:cursor-not-allowed [&>option]:bg-card", className)} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden className={cn("pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground", props.disabled && "opacity-40")} />
    </span>
  ),
);
NativeSelect.displayName = "NativeSelect";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[14.5px] font-medium text-foreground/85", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-[15px] text-danger-fg">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[14px] text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
