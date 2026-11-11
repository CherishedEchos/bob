import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { HttpError, type Ctx, type Result } from "@/server/context";
import { requireContext } from "@/server/auth/session";

const MAX_BODY = 64 * 1024;

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
function checkOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, "Cross-site request blocked");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, "Bad origin");
  }
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, "Request too large");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Request too large");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

type Handler = (req: NextRequest, ctx: Ctx, params: Record<string, string>) => Promise<Response | unknown>;

/** Authenticated API route: resolves the session context server-side, never from the body. */
export function authed(handler: Handler) {
  return async (req: NextRequest, route: { params: Promise<Record<string, string>> }) => {
    try {
      checkOrigin(req);
      const ctx = await requireContext();
      const out = await handler(req, ctx, (await route?.params) ?? {});
      if (out instanceof Response) return out;
      return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof Error && e.message === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  console.error(e);
  return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
}

export function fromResult<T>(r: Result<T>) {
  if (r.ok) return { ok: true, value: r.value };
  const status = r.code === "forbidden" ? 403 : r.code === "not_found" ? 404 : r.code === "conflict" ? 409 : r.code === "unavailable" ? 503 : 422;
  return NextResponse.json({ ok: false, error: r.error, fieldErrors: r.fieldErrors, code: r.code }, { status });
}

export { checkOrigin };
