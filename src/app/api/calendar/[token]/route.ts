import { type NextRequest } from "next/server";
import { feedFor } from "@/server/services/calendar";

export const runtime = "nodejs";

/**
 * Public calendar subscription (.ics). The random token in the link is the
 * credential; it's checked against the current membership on every fetch.
 */
export async function GET(req: NextRequest, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "bob.local";
  const feed = feedFor(token.replace(/\.ics$/, ""), host.split(":")[0]);
  if (!feed) return new Response("This calendar link isn't active. Create a new one in Bob.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  return new Response(feed.ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="bob-diary.ics"`,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
