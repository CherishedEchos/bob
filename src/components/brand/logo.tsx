import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * NINETY3 logo mark.
 * NOTE: public/brand/ninety3-logo.png is cropped from the supplied reference
 * mock-up as a stand-in. Replace it with the original vector artwork from
 * Ninety3 (same filename, or update the src) — nothing else needs to change.
 */
export function LogoMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/ninety3-logo.png"
      alt="Ninety3"
      width={size}
      height={size}
      priority
      className={cn("shrink-0 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_4px_18px_-4px_rgb(236_122_46/0.45)]", className)}
    />
  );
}

export function Logo({ size = 44, subtitle = "Assistant", className }: { size?: number; subtitle?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark size={size} />
      <div className="leading-tight">
        <div className="text-[19px] font-bold tracking-[0.02em]">NINETY3</div>
        <div className="text-[14px] text-foreground/80">{subtitle}</div>
      </div>
    </div>
  );
}
