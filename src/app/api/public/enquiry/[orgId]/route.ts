import { NextResponse, type NextRequest } from "next/server";
import { submitWebsiteEnquiry } from "@/server/services/website-form";

export const runtime = "nodejs";

/** Public website enquiry form submission. No sign-in; rate-limited; honeypot-protected. */
export async function POST(req: NextRequest, route: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await route.params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 16 * 1024) return NextResponse.json({ error: "Message too long" }, { status: 413 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }
  const sender = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const r = submitWebsiteEnquiry(orgId, body, sender);
  if (r.ok) return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const status = r.code === "not_found" ? 404 : r.code === "unavailable" ? 429 : 422;
  return NextResponse.json({ ok: false, error: r.error, fieldErrors: r.fieldErrors }, { status });
}
