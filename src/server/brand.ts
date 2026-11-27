import type { OrgConfig } from "@/lib/types";

/**
 * The logo to embed in documents (report PDFs, handover packs). Screens use the
 * sharp SVG wordmark, but PDFs need a bitmap, so an SVG maps to the PNG beside it.
 */
export function printableLogoUrl(org: Pick<OrgConfig, "wordmark" | "logoUrl">): string | undefined {
  const url = org.wordmark?.onLight ?? org.logoUrl;
  return url?.replace(/\.svg$/i, ".png");
}
