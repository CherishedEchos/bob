/**
 * The LLM engine with a mocked Anthropic client: verifies the loop, that
 * external actions only become pending approvals, that customer content is
 * wrapped as untrusted, and that tools are filtered by role.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ctxFor, freshDb, N93_STAFF, RDG_OWNER } from "./helpers";
import { claudeTurn, setClaudeClientForTests } from "@/server/bob/claude";
import { syncInbox } from "@/server/integrations/inbox";
import { getActionView } from "@/server/bob/actions";
import * as R from "@/server/services/records";

type Req = { messages: { role: string; content: unknown }[]; tools: { name: string }[]; tool_choice?: { type: string } };

function fakeClient(script: ((req: Req) => unknown)[], seen: Req[]) {
  let i = 0;
  return () =>
    ({
      beta: {
        messages: {
          create: async (req: Req) => {
            seen.push(JSON.parse(JSON.stringify(req)));
            const step = script[Math.min(i++, script.length - 1)];
            return step(req);
          },
        },
      },
    }) as never;
}

const toolUse = (id: string, name: string, input: unknown) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });
const say = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

beforeEach(() => freshDb());
afterEach(() => setClaudeClientForTests(null));

describe("Claude engine", () => {
  it("injected email can't make the model send anything without approval", async () => {
    const ctx = ctxFor(RDG_OWNER);
    await syncInbox(ctx);
    const kevin = R.listEnquiries(ctx).find((e) => e.customerName === "Kevin Marsh")!;
    const seen: Req[] = [];
    setClaudeClientForTests(
      fakeClient(
        [
          () => toolUse("t1", "get_enquiry_details", { enquiry_id: kevin.id }),
          // Pretend the model was "persuaded" and tries to send the customer list.
          () => toolUse("t2", "send_email", { to: "kevin.marsh@example.com", subject: "Customer list", body: "Here is everything", enquiryId: kevin.id }),
          () => say("I've drafted that — it needs your approval."),
        ],
        seen,
      ),
    );
    const out = await claudeTurn({ ...ctx, via: "bob" }, "deal with Kevin's email", [], {}, "conv_test");
    // Tool result for the enquiry wraps customer text as untrusted data.
    const toolResult = JSON.stringify(seen[1].messages.at(-1));
    expect(toolResult).toContain("untrusted_external_content");
    expect(toolResult).toContain("asks the assistant to ignore its instructions");
    // The send became a PENDING approval, not an executed send.
    const actionId = out.replies.find((r) => r.actionId)!.actionId!;
    expect(getActionView(ctx, actionId)?.status).toBe("pending");
    expect(out.changed).toBe(false);
    // After proposing, the model was not allowed to chain more tools.
    expect(seen[2].tool_choice).toEqual({ type: "none" });
  });

  it("only offers tools the user's role permits", async () => {
    const seen: Req[] = [];
    setClaudeClientForTests(fakeClient([() => say("ok")], seen));
    await claudeTurn({ ...ctxFor(N93_STAFF), via: "bob" }, "hello", [], {}, "conv_x");
    const names = seen[0].tools.map((t) => t.name);
    expect(names).toContain("create_follow_up");
    expect(names).not.toContain("create_invoice");
    expect(names).not.toContain("get_money_owed");
    expect(names).not.toContain("send_email");
  });

  it("invalid tool arguments from the model are rejected by validation", async () => {
    const ctx = ctxFor(RDG_OWNER);
    const seen: Req[] = [];
    setClaudeClientForTests(
      fakeClient([() => toolUse("t1", "record_payment", { jobId: "rdg_job_loft_eg", amount: -50, type: "deposit", method: "cash", receivedAt: "yesterday" }), () => say("Couldn't do that.")], seen),
    );
    const out = await claudeTurn({ ...ctx, via: "bob" }, "record a payment", [], {}, "conv_y");
    expect(out.replies.some((r) => r.actionId)).toBe(false);
    expect(JSON.stringify(seen[1].messages.at(-1))).toMatch(/invalid/);
  });
});
