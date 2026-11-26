import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Restrained status label: a small soft pill with a coloured dot. */
const badgeVariants = cva(
  "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap text-[13px] font-medium leading-none before:size-1.5 before:shrink-0 before:rounded-full before:content-[''] [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "text-muted-foreground before:bg-subtle",
        copper: "text-brand-fg before:bg-copper-500",
        green: "text-good-fg before:bg-success",
        amber: "text-warn-fg before:bg-warning",
        red: "text-danger-fg before:bg-destructive",
        blue: "text-info-fg before:bg-info",
        violet: "text-violet-fg before:bg-violet-500",
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
