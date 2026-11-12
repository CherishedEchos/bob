import Image from "next/image";
import type { OrgConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WORDMARK, WORDMARK_COLORS } from "./wordmark-paths";

/**
 * Branding.
 *  - Bob (the product, by Cresaro): a typographic wordmark with the orb.
 *  - The organisation (e.g. Ninety3): its own logo from OrgConfig.logoUrl, or a
 *    monogram when no logo has been supplied (we never invent a logo).
 *
 * NOTE: public/brand/ninety3-logo.png is cropped from the supplied reference
 * mock-up as a stand-in. Replace it with Ninety3's original artwork.
 */
/**
 * The bob. wordmark — one set of outlines (Geist Black) shared with
 * public/brand/bob-wordmark*.svg so it renders identically everywhere.
 * `height` is the height of the letters (b ascender to baseline).
 * tone="light" → warm-white letters for dark backgrounds; "dark" for light ones.
 */
export function BobLogo({
  height = 24,
  tone = "light",
  byline = false,
  className,
  title = "Bob",
}: {
  height?: number;
  tone?: "light" | "dark";
  byline?: boolean;
  className?: string;
  title?: string;
}) {
  // Below ~40px the outlined byline would be too small to read: use live text.
  if (byline && height < 40)
    return (
      <span className={cn("inline-flex flex-col items-start gap-[3px]", className)}>
        <BobLogo height={height} tone={tone} title={title} />
        <span
          className="text-[11px] font-medium leading-none"
          style={{ color: tone === "light" ? WORDMARK_COLORS.bylineOnDark : WORDMARK_COLORS.bylineOnLight }}
        >
          by Cresaro
        </span>
      </span>
    );
  const h = Number(WORDMARK.viewBox.split(" ")[3]);
  const vb = byline ? WORDMARK.viewBoxWithByline : WORDMARK.viewBox;
  const [, , vw, vh] = vb.split(" ").map(Number);
  const scale = height / h;
  return (
    <svg
      viewBox={vb}
      width={Math.round(vw * scale * 10) / 10}
      height={Math.round(vh * scale * 10) / 10}
      role="img"
      aria-label={byline ? `${title} by Cresaro` : title}
      className={cn("block shrink-0 overflow-visible", className)}
    >
      <path fill={tone === "light" ? WORDMARK_COLORS.light : WORDMARK_COLORS.dark} d={WORDMARK.letters} />
      <circle fill={WORDMARK_COLORS.dot} cx={WORDMARK.dot.cx} cy={WORDMARK.dot.cy} r={WORDMARK.dot.r} />
      {byline ? <path fill={tone === "light" ? WORDMARK_COLORS.bylineOnDark : WORDMARK_COLORS.bylineOnLight} d={WORDMARK.byline} /> : null}
    </svg>
  );
}

/** App header lock-up: the wordmark, optionally with the workspace it's running for. */
export function BobWordmark({ className, org, compact }: { className?: string; org?: Pick<OrgConfig, "shortName">; compact?: boolean }) {
  return (
    <div className={cn("flex items-end gap-2", className)}>
      <BobLogo height={compact ? 22 : 24} />
      {org ? <span className="pb-[1px] text-[13.5px] leading-none text-muted-foreground">for {org.shortName}</span> : null}
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
      className={cn("grid shrink-0 place-items-center rounded-full bg-ink-700 font-bold text-accent-fg ring-1 ring-line", className)}
    >
      {initials}
    </span>
  );
}
