/**
 * Where to return after signing in (?next=): same-site paths only, never the
 * sign-in page, an API or an invite link — so a crafted link can't send anyone
 * to another site.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/^\/(login|api\/|invite\/)/.test(raw) || raw === "/") return null;
  return raw.slice(0, 500);
}
