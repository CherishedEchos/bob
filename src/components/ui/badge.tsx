import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-medium ring-1 ring-inset [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-surface-3 text-muted-foreground ring-line",
        copper: "bg-copper-500/15 text-accent-fg ring-copper-500/35",
        green: "bg-emerald-500/12 text-good-fg ring-emerald-500/30",
        amber: "bg-amber-400/12 text-warn-fg ring-amber-400/30",
        red: "bg-red-500/12 text-danger-fg ring-red-500/30",
        blue: "bg-sky-400/10 text-info-fg ring-sky-400/25",
        violet: "bg-violet-400/10 text-violet-300 ring-violet-400/25",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
