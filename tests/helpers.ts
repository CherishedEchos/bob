import { getDb, setDbForTests } from "@/server/db";
import { createSession, contextFromToken } from "@/server/auth/session";
import type { Ctx } from "@/server/context";
import { handleTurn } from "@/server/bob/conversation";
import { approveAction } from "@/server/bob/actions";
import type { BobMessage } from "@/lib/bob/types";

/** Brand-new in-memory database, freshly seeded. */
export function freshDb() {
  const old = globalThis.__bobDb;
  try {
    old?.close();
  } catch {
    /* ignore */
  }
  setDbForTests(undefined);
  return getDb();
}

/** Build a context exactly as an API request would: via a real session token. */
export function ctxFor(email: string, orgId?: string): Ctx {
  const u = getDb().prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string };
  const m = getDb().prepare("SELECT org_id FROM memberships WHERE user_id = ?").get(u.id) as { org_id: string };
  const s = createSession(u.id, orgId ?? m.org_id);
  if (!s.ok) throw new Error("session failed");
  return contextFromToken(s.token)!;
}

export const N93_OWNER = "owner@ninety3.example";
export const N93_OFFICE = "office@ninety3.example";
export const N93_STAFF = "site@ninety3.example";
export const RDG_OWNER = "alex@ridgeway.example";
export const RDG_STAFF = "sam@ridgeway.example";

export class Chat {
  conversationId?: string;
  last: BobMessage[] = [];
  constructor(public ctx: Ctx) {}
  async say(text: string, via: "voice" | "text" = "text") {
    const r = await handleTurn(this.ctx, { text, via, conversationId: this.conversationId });
    this.conversationId = r.conversationId;
    this.last = r.messages.slice(1);
    return this;
  }
  get text() {
    return this.last.map((m) => m.text).join(" ");
  }
  get action() {
    return this.last.find((m) => m.action)?.action;
  }
  async approve(edits?: Record<string, string>) {
    const a = this.action;
    if (!a) throw new Error(`No action to approve. Bob said: ${this.text}`);
    return approveAction(this.ctx, a.id, edits);
  }
}
