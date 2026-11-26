import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[15px] font-semibold tracking-[-0.005em] transition-all duration-150 select-none disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50 active:scale-[0.98] lg:text-[15px] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-white shadow-[0_1px_2px_rgb(180_82_15/0.25),inset_0_1px_0_rgb(255_255_255/0.15)] hover:bg-copper-600 active:bg-copper-700",
        secondary: "bg-card text-foreground ring-1 ring-line-strong hover:bg-raised-hover active:bg-surface-3",
        dark: "bg-[#1a1a1a] text-white hover:bg-black active:bg-black",
        outline: "bg-card ring-1 ring-line-strong text-foreground hover:bg-raised-hover active:bg-surface-3",
        ghost: "text-muted-foreground hover:bg-surface-3 hover:text-foreground active:bg-surface-2",
        destructive: "bg-destructive/10 text-danger-fg ring-1 ring-destructive/35 hover:bg-destructive/15",
        success: "bg-success/10 text-good-fg ring-1 ring-success/35 hover:bg-success/15",
        link: "text-accent-icon underline-offset-4 hover:underline rounded-md",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-10 px-3.5 text-[15px]",
        lg: "h-12 px-6 text-[16.5px]",
        icon: "size-11",
        "icon-sm": "size-10",
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
