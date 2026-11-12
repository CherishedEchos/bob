import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Restrained status label: coloured dot + readable text, no box. */
const badgeVariants = cva(
  "inline-flex h-6 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium before:size-1.5 before:shrink-0 before:rounded-full before:content-[''] [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "text-muted-foreground before:bg-subtle",
        copper: "text-accent-fg before:bg-copper-400",
        green: "text-good-fg before:bg-emerald-400",
        amber: "text-warn-fg before:bg-amber-400",
        red: "text-danger-fg before:bg-red-400",
        blue: "text-info-fg before:bg-sky-400",
        violet: "text-violet-300 before:bg-violet-400",
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
