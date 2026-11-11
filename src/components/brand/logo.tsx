import Image from "next/image";
import type { OrgConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/assistant/orb";

/**
 * Branding.
 *  - Bob (the product, by Cresaro): a typographic wordmark with the orb.
 *  - The organisation (e.g. Ninety3): its own logo from OrgConfig.logoUrl, or a
 *    monogram when no logo has been supplied (we never invent a logo).
 *
 * NOTE: public/brand/ninety3-logo.png is cropped from the supplied reference
 * mock-up as a stand-in. Replace it with Ninety3's original artwork.
 */
export function BobWordmark({ className, org }: { className?: string; org?: Pick<OrgConfig, "shortName"> }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <OrbAvatar />
      <div className="leading-none">
        <div className="text-[20px] font-bold tracking-tight">Bob</div>
        {org ? <div className="mt-0.5 text-[12px] text-muted-foreground">for {org.shortName}</div> : null}
      </div>
    </div>
  );
}

export function OrgLogo({ org, size = 36, className }: { org: Pick<OrgConfig, "logoUrl" | "name" | "shortName">; size?: number; className?: string }) {
  if (org.logoUrl)
    return (
      <Image
        src={org.logoUrl}
        alt={org.name}
        width={size}
        height={size}
        priority
        className={cn("shrink-0 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_4px_18px_-4px_rgb(236_122_46/0.45)]", className)}
      />
    );
  const initials = org.shortName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-label={org.name}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={cn("grid shrink-0 place-items-center rounded-full bg-ink-700 font-bold text-copper-200 ring-1 ring-white/10", className)}
    >
      {initials}
    </span>
  );
}
