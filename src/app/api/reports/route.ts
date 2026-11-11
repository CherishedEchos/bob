import { authed } from "@/server/http";
import { can } from "@/lib/auth/permissions";
import { enquiryStats, jobStats, moneyOwed, quoteStats } from "@/server/services/reports";

export const runtime = "nodejs";

/** Dashboard reporting — the same deterministic functions Bob uses. */
export const GET = authed(async (_req, ctx) => {
  const finance = can(ctx.role, "finance.read");
  const e = enquiryStats(ctx, { kind: "last_days", days: 30 });
  const nextWeek = jobStats(ctx, { kind: "next_week" });
  const won = jobStats(ctx, { kind: "last_days", days: 30 });
  return {
    enquiries: { ...e, period: e.period.label },
    jobs: { won: won.won, wonValue: finance ? won.wonValue : null, wonPeriod: won.period.label, active: won.active, bookedNextWeek: nextWeek.booked, nextWeekLabel: nextWeek.period.label },
    quotes: finance ? (() => { const q = quoteStats(ctx, { kind: "this_month" }); return { ...q, period: q.period.label }; })() : null,
    money: finance ? moneyOwed(ctx) : null,
  };
});
