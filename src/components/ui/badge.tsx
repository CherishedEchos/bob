import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1 ring-inset [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-white/[0.06] text-muted-foreground ring-white/10",
        copper: "bg-copper-500/15 text-copper-300 ring-copper-500/35",
        green: "bg-emerald-500/12 text-emerald-300 ring-emerald-500/30",
        amber: "bg-amber-400/12 text-amber-200 ring-amber-400/30",
        red: "bg-red-500/12 text-red-300 ring-red-500/30",
        blue: "bg-sky-400/10 text-sky-200 ring-sky-400/25",
        violet: "bg-violet-400/10 text-violet-200 ring-violet-400/25",
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
