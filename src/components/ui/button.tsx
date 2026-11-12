import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[16px] font-semibold transition-all select-none disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-white hover:bg-copper-600 active:bg-copper-700",
        secondary: "bg-raised text-foreground ring-1 ring-line-strong hover:bg-raised-hover active:bg-surface-3",
        outline: "ring-1 ring-copper-500/55 text-accent-fg hover:bg-copper-500/10 active:bg-copper-500/18",
        ghost: "text-muted-foreground hover:bg-surface-3 hover:text-foreground active:bg-surface-2",
        destructive: "bg-destructive/15 text-danger-fg ring-1 ring-destructive/40 hover:bg-destructive/25",
        success: "bg-success/15 text-good-fg ring-1 ring-success/40 hover:bg-success/25",
        link: "text-accent-icon underline-offset-4 hover:underline rounded-md",
      },
      size: {
        default: "h-12 px-5",
        sm: "h-11 px-4 text-[15px]",
        lg: "h-13 px-6 text-[16px]",
        icon: "size-12",
        "icon-sm": "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
