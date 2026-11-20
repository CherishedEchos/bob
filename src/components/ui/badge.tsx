import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Restrained status label: a small soft pill with a coloured dot. */
const badgeVariants = cva(
  "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12.5px] font-medium leading-none before:size-1.5 before:shrink-0 before:rounded-full before:content-[''] [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-surface-3 text-muted-foreground before:bg-subtle",
        copper: "bg-copper-500/12 text-accent-fg before:bg-copper-500",
        green: "bg-success/12 text-good-fg before:bg-success",
        amber: "bg-warning/14 text-warn-fg before:bg-warning",
        red: "bg-destructive/10 text-danger-fg before:bg-destructive",
        blue: "bg-info/10 text-info-fg before:bg-info",
        violet: "bg-violet-500/10 text-violet-fg before:bg-violet-500",
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
