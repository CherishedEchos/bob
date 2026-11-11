import { authed } from "@/server/http";
import { loadConversation, startConversation } from "@/server/bob/conversation";

export const runtime = "nodejs";

/** Latest conversation for the signed-in user (own org + own user only). */
export const GET = authed(async (req, ctx) => {
  const id = req.nextUrl.searchParams.get("id") ?? undefined;
  return loadConversation(ctx, id);
});

/** Start a new conversation. */
export const POST = authed(async (_req, ctx) => ({ conversationId: startConversation(ctx), messages: [] }));
