"use client";

import * as React from "react";
import { Gauge } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

/**
 * Cresaro administration: AI usage, cost and spending limits for every
 * workspace, plus the engine's health and a live connection test. Only
 * Cresaro platform administrators (BOB_PLATFORM_ADMINS) can open it; the API
 * answers 404 to everyone else.
 */

type Agg = { key: string; n: number; input: number; write: number; read: number; output: number; cost: number; ms: number; fails: number };
type Usage = {
  workspaces: { id: string; name: string; limitUsd: number | null; spentUsd: number; percent: number | null; blocked: boolean; warning: boolean; warnAtPercent: number }[];
  selected: {
    id: string;
    name: string;
    report: {
      days: number;
      total: Omit<Agg, "key"> & { cacheHitRate: number; avgMs: number };
      askBobAnswers: number;
      byDay: { day: string; cost: number; n: number }[];
      byModel: Agg[];
      byFeature: Agg[];
      byUser: Agg[];
    };
  } | null;
  engine: { configured: boolean; model: string; routing: { fastModel: string } | null; caching: string; health: { ok: number; failed: number; lastOkAt?: string; lastErrorAt?: string; lastError?: string; lastModel?: string } };
};

const usd = (n: number) => (n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const num = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const FEATURE: Record<string, string> = { ask_bob: "Ask Bob", handover_report: "Handover drafting", report_rewrite: "Handover rewrites", connection_test: "Connection tests" };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3.5 ring-1 ring-line">
      <div className="text-[12.5px] font-medium text-subtle">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums text-heading">{value}</div>
      {hint ? <div className="mt-0.5 text-[12.5px] text-subtle">{hint}</div> : null}
    </div>
  );
}

function Table({ title, rows, label = (k: string) => k }: { title: string; rows: Agg[]; label?: (k: string) => string }) {
  return (
    <section className="rounded-2xl bg-surface p-4 ring-1 ring-line">
      <h2 className="mb-2 text-[14px] font-semibold text-heading">{title}</h2>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-left text-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">Name</th>
                <th className="py-1 pr-3 text-right font-medium">Calls</th>
                <th className="py-1 pr-3 text-right font-medium">Input</th>
                <th className="py-1 pr-3 text-right font-medium">Cache read</th>
                <th className="py-1 pr-3 text-right font-medium">Output</th>
                <th className="py-1 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-heading">{label(r.key)}</td>
                  <td className="py-1.5 pr-3 text-right">{r.n}</td>
                  <td className="py-1.5 pr-3 text-right">{num(r.input + r.write)}</td>
                  <td className="py-1.5 pr-3 text-right">{num(r.read)}</td>
                  <td className="py-1.5 pr-3 text-right">{num(r.output)}</td>
                  <td className="py-1.5 text-right font-medium text-heading">{usd(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-subtle">No calls in this period.</p>
      )}
    </section>
  );
}

function LimitRow({ w, onSaved }: { w: Usage["workspaces"][number]; onSaved: () => void }) {
  const [limit, setLimit] = React.useState(w.limitUsd === null ? "" : String(w.limitUsd));
  const [warn, setWarn] = React.useState(String(w.warnAtPercent));
  const save = async () => {
    const r = await fetch("/api/cresaro/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: w.id, monthlyLimitUsd: limit.trim() === "" ? null : Number(limit), warnAtPercent: Number(warn) || 80 }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast(`Limit saved for ${w.name}`, "success");
      onSaved();
    } else toast(j.error ?? "Couldn't save", "error");
  };
  return (
    <tr className="border-t border-line">
      <td className="py-2 pr-3 text-heading">{w.name}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        <span className={cn(w.blocked ? "text-danger-fg" : w.warning ? "text-warn-fg" : "")}>{usd(w.spentUsd)}</span>
        {w.percent !== null ? <span className="text-subtle"> · {w.percent}%</span> : null}
      </td>
      <td className="py-2 pr-3">
        <Input aria-label={`Monthly limit for ${w.name} in dollars`} inputMode="decimal" placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} className="h-9 w-28" />
      </td>
      <td className="py-2 pr-3">
        <Input aria-label={`Warn at percent for ${w.name}`} inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} className="h-9 w-20" />
      </td>
      <td className="py-2 text-right">
        <Button size="sm" variant="secondary" onClick={() => void save()}>
          Save
        </Button>
      </td>
    </tr>
  );
}

function ConnectionTest() {
  const [test, setTest] = React.useState<{ ok: boolean; model?: string; ms?: number; error?: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/cresaro/ai-test", { method: "POST" });
          setTest(await r.json().catch(() => ({ ok: false, error: "No response" })));
          setBusy(false);
        }}
      >
        {busy ? "Testing…" : "Test connection"}
      </Button>
      {test ? <span className={cn("text-[13px] font-medium", test.ok ? "text-good-fg" : "text-danger-fg")}>{test.ok ? `Connected: ${test.model} replied in ${test.ms} ms` : `Failed: ${test.error}`}</span> : null}
    </div>
  );
}

export default function CresaroAdminPage() {
  const { org } = useStore();
  const [orgId, setOrgId] = React.useState<string>("");
  const [days, setDays] = React.useState(30);
  const [data, setData] = React.useState<Usage | null>(null);
  const [denied, setDenied] = React.useState(false);
  const load = React.useCallback(() => {
    const q = new URLSearchParams({ days: String(days), ...(orgId ? { org: orgId } : {}) });
    void fetch(`/api/cresaro/usage?${q}`).then(async (r) => {
      if (!r.ok) return setDenied(true);
      const j = (await r.json()) as Usage;
      setData(j);
      if (!orgId && j.selected) setOrgId(j.selected.id);
    });
  }, [days, orgId]);
  React.useEffect(load, [load]);

  if (denied) return <p className="py-16 text-center text-subtle">This page isn&apos;t available.</p>;
  if (!data) return <p className="py-16 text-center text-subtle">Loading…</p>;
  const rep = data.selected?.report;
  const max = Math.max(...(rep?.byDay.map((d) => d.cost) ?? [0]), 0.0001);
  const h = data.engine.health;

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[12.5px] font-medium uppercase tracking-wide text-subtle">
            <Gauge className="size-4" /> Cresaro administration
          </div>
          <h1 className="mt-1 text-[24px] font-semibold text-heading">AI usage &amp; cost</h1>
          <p className="text-[13.5px] text-subtle">Visible only to Cresaro administrators. Customers never see model names, tokens or costs.</p>
        </div>
        <div className="flex gap-2">
          <NativeSelect aria-label="Workspace" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {data.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.id === org.id ? " (current)" : ""}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Period" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </NativeSelect>
        </div>
      </header>

      {rep ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Spend" value={usd(rep.total.cost)} hint={`${rep.total.n} model calls`} />
            <Stat label="Ask Bob answers" value={String(rep.askBobAnswers)} hint={rep.askBobAnswers ? `${usd(rep.byFeature.find((f) => f.key === "ask_bob")?.cost ?? 0)} total, ≈${usd((rep.byFeature.find((f) => f.key === "ask_bob")?.cost ?? 0) / rep.askBobAnswers)} each` : undefined} />
            <Stat label="Cache hit rate" value={`${Math.round(rep.total.cacheHitRate * 100)}%`} hint={`${num(rep.total.read)} of ${num(rep.total.input + rep.total.write + rep.total.read)} input tokens`} />
            <Stat label="Average call time" value={`${(rep.total.avgMs / 1000).toFixed(1)} s`} hint={rep.total.fails ? `${rep.total.fails} failed` : "No failures"} />
          </div>

          <section className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <h2 className="mb-3 text-[14px] font-semibold text-heading">Daily spend</h2>
            <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={`Daily spend over the last ${days} days, peaking at ${usd(max)}`}>
              {rep.byDay.map((d) => (
                <div key={d.day} title={`${d.day}: ${usd(d.cost)} · ${d.n} calls`} className="flex-1 rounded-t bg-copper-500/80" style={{ height: `${Math.max(d.cost > 0 ? 3 : 1, (d.cost / max) * 100)}%`, opacity: d.cost > 0 ? 1 : 0.25 }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11.5px] text-subtle">
              <span>{rep.byDay[0]?.day}</span>
              <span>{rep.byDay.at(-1)?.day}</span>
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <Table title="By feature" rows={rep.byFeature} label={(k) => FEATURE[k] ?? k} />
            <Table title="By model" rows={rep.byModel} />
          </div>
          <Table title="By person" rows={rep.byUser} />
        </>
      ) : null}

      <section className="rounded-2xl bg-surface p-4 ring-1 ring-line">
        <h2 className="text-[14px] font-semibold text-heading">Monthly spending limits</h2>
        <p className="mb-2 text-[13px] text-subtle">When a workspace reaches its limit, Ask Bob switches to its built-in assistant until the next month and handover drafting uses the standard template. Leave blank for no limit.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">Workspace</th>
                <th className="py-1 pr-3 text-right font-medium">This month</th>
                <th className="py-1 pr-3 font-medium">Limit ($)</th>
                <th className="py-1 pr-3 font-medium">Warn at %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.workspaces.map((w) => (
                <LimitRow key={`${w.id}-${w.limitUsd}`} w={w} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4 text-[13.5px] ring-1 ring-line">
        <h2 className="text-[14px] font-semibold text-heading">Engine</h2>
        <p className="text-subtle">
          {data.engine.configured ? "Claude is configured" : "Claude is not configured (built-in assistant only)"} · main model {data.engine.model}
          {data.engine.routing ? ` · simple questions routed to ${data.engine.routing.fastModel}` : " · routing off"} · prompt cache {data.engine.caching}
        </p>
        <p className="text-subtle">
          Since the server started: {h.ok} answered by Claude, {h.failed} fell back.
          {h.lastModel ? ` Last model ${h.lastModel}.` : ""}
        </p>
        {h.lastError ? <p className="text-danger-fg">Last problem: {h.lastError}</p> : null}
        {data.engine.configured ? <ConnectionTest /> : null}
      </section>
    </div>
  );
}
