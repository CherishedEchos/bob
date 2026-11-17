"use client";

/**
 * The company order list — every job's materials in one place. To order comes
 * first, grouped by merchant so an order can be put together per supplier.
 * Same records as each job's Materials tab.
 */
import * as React from "react";
import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays } from "@/lib/dates";
import type { Material, MaterialStatus } from "@/lib/types";
import { cn, todayKey } from "@/lib/utils";
import { EmptyState, Tabs, pageActionClass } from "@/components/common/bits";
import { MaterialRow } from "@/components/jobs/job-parts";
import { MATERIAL_STATUS_LABEL } from "@/components/forms/team-forms";
import { NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

type StatusFilter = MaterialStatus | "all";
type When = "any" | "week" | "overdue" | "none";

export default function MaterialsPage() {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const [status, setStatus] = React.useState<StatusFilter>("to_order");
  const [job, setJob] = React.useState("");
  const [merchant, setMerchant] = React.useState("");
  const [when, setWhen] = React.useState<When>("any");
  const today = todayKey();
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const merchants = new Map(data.merchants.map((m) => [m.id, m]));
  const write = can("materials.write");
  const count = (st: StatusFilter) => data.materials.filter((m) => st === "all" || m.status === st).length;
  const list = data.materials
    .filter((m) => (status === "all" || m.status === status) && (!job || m.jobId === job) && (!merchant || (merchant === "none" ? !m.merchantId : m.merchantId === merchant)))
    .filter((m) => (when === "any" ? true : when === "none" ? !m.neededBy : when === "overdue" ? !!m.neededBy && m.neededBy < today : !!m.neededBy && m.neededBy <= addDays(today, 7)))
    .sort((a, b) => (a.neededBy ?? "9999").localeCompare(b.neededBy ?? "9999"));
  const groups = new Map<string, Material[]>();
  for (const m of list) {
    const k = m.merchantId ?? "none";
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const ordered = [...groups].sort(([a], [b]) => (a === "none" ? 1 : b === "none" ? -1 : (merchants.get(a)?.name ?? "").localeCompare(merchants.get(b)?.name ?? "")));
  const filtered = !!(job || merchant || when !== "any");

  const row = (m: Material) => {
    const j = jobs.get(m.jobId);
    return (
      <MaterialRow
        key={m.id}
        item={m}
        write={write}
        jobLabel={j ? `${j.title} · ${j.customerName}` : undefined}
        merchantName={m.merchantId ? merchants.get(m.merchantId)?.name : undefined}
        onEdit={() => ui.openForm({ form: "material", materialId: m.id })}
        onStatus={async (st) => {
          const r = await actions.run("setMaterialStatus", { id: m.id, status: st });
          toast(r.ok ? `${m.item}: ${MATERIAL_STATUS_LABEL[st].toLowerCase()}` : r.errors._ || "Couldn't update — nothing changed", r.ok ? "success" : "error");
        }}
      />
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-page">Materials</h1>
          <p className="t-meta mt-0.5">
            {count("to_order")} to order · {count("ordered")} ordered
          </p>
        </div>
        {write ? (
          <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "material" })}>
            <Plus className="size-[18px]" aria-hidden /> Add material
          </button>
        ) : null}
      </div>
      <Tabs
        label="Order status"
        className="mb-3"
        value={status}
        onChange={setStatus}
        options={[
          { value: "to_order", label: "To order", count: count("to_order"), highlight: true },
          { value: "ordered", label: "Ordered", count: count("ordered") },
          { value: "on_site", label: "On site", count: count("on_site") },
          { value: "all", label: "All" },
        ]}
      />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label>
          <span className="sr-only">Job</span>
          <NativeSelect value={job} onChange={(e) => setJob(e.target.value)} className="h-11">
            <option value="">All jobs</option>
            {[...new Set(data.materials.map((m) => m.jobId))].map((id) => (
              <option key={id} value={id}>
                {jobs.get(id)?.title ?? "Job"} · {jobs.get(id)?.customerName}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span className="sr-only">Merchant</span>
          <NativeSelect value={merchant} onChange={(e) => setMerchant(e.target.value)} className="h-11">
            <option value="">All merchants</option>
            <option value="none">No merchant yet</option>
            {data.merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span className="sr-only">Needed by</span>
          <NativeSelect value={when} onChange={(e) => setWhen(e.target.value as When)} className="h-11">
            <option value="any">Any date</option>
            <option value="overdue">Needed date passed</option>
            <option value="week">Needed in the next 7 days</option>
            <option value="none">No date set</option>
          </NativeSelect>
        </label>
      </div>
      {list.length ? (
        <div className="space-y-4">
          {ordered.map(([key, items]) => {
            const mer = key === "none" ? undefined : merchants.get(key);
            return (
              <section key={key} aria-labelledby={`mg-${key}`} className="panel overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 lg:px-5">
                  <h2 id={`mg-${key}`} className="t-section">
                    {mer ? mer.name : "No merchant yet"}
                    <span className="ml-2 text-[14px] font-normal text-muted-foreground tabular">{items.length}</span>
                  </h2>
                  {mer ? (
                    <span className="flex flex-wrap gap-3 text-[14px]">
                      {mer.phone ? (
                        <a href={`tel:${mer.phone.replace(/\s/g, "")}`} className="font-semibold text-accent-fg">
                          {mer.phone}
                        </a>
                      ) : null}
                      <Link href={`/merchants?open=${mer.id}`} className="font-semibold text-accent-fg">
                        Merchant details
                      </Link>
                    </span>
                  ) : (
                    <span className="text-[13.5px] text-muted-foreground">Choose a merchant on each item to order it.</span>
                  )}
                </div>
                <ul className={cn("divide-y divide-line px-4 lg:px-5")}>{items.map(row)}</ul>
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Package}
          title={filtered ? "Nothing matches these filters" : status === "to_order" ? "Nothing to order" : "Nothing here"}
          body={filtered ? "Try clearing the job, merchant or date filter." : "Add materials from a job's Materials tab, or here."}
          action={write && !filtered ? <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "material" })}><Plus className="size-[18px]" /> Add material</button> : undefined}
        />
      )}
    </div>
  );
}
