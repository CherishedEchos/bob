import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/server/http";
import { handleTurn } from "@/server/bob/conversation";

export const runtime = "nodejs";

const schema = z.object({
  text: z.string().trim().min(1).max(2000),
  via: z.enum(["voice", "text"]).default("text"),
  conversationId: z.string().max(80).optional(),
});

/** One turn with Bob. Voice transcripts and typed text use this same endpoint. */
export const POST = authed(async (req, ctx) => {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "Say or type something first." }, { status: 400 });
  return handleTurn(ctx, parsed.data);
});
