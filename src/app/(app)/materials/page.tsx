"use client";

/** Everything that still needs ordering across jobs — the planner's shopping list. */
import * as React from "react";
import { Package, Plus } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays } from "@/lib/dates";
import type { Material, MaterialStatus } from "@/lib/types";
import { todayKey } from "@/lib/utils";
import { EmptyState, ListPanel, Tabs, pageActionClass } from "@/components/common/bits";
import { MaterialRow } from "@/components/jobs/job-parts";
import { MATERIAL_STATUS_LABEL } from "@/components/forms/team-forms";
import { toast } from "@/components/ui/toaster";

type Filter = MaterialStatus | "all";

export default function MaterialsPage() {
  const { data, actions, can } = useStore();
  const ui = useUI();
  const [filter, setFilter] = React.useState<Filter>("to_order");
  const today = todayKey();
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const list = data.materials.filter((m) => filter === "all" || m.status === filter);
  const thisWeek = list.filter((m) => m.neededBy && m.neededBy <= addDays(today, 7));
  const later = list.filter((m) => !thisWeek.includes(m));
  const write = can("materials.write");
  const row = (m: Material) => {
    const j = jobs.get(m.jobId);
    return (
      <MaterialRow
        key={m.id}
        item={m}
        write={write}
        jobLabel={j ? `${j.title} · ${j.customerName}` : undefined}
        onEdit={() => ui.openForm({ form: "material", materialId: m.id })}
        onStatus={async (status) => {
          const r = await actions.run("setMaterialStatus", { id: m.id, status });
          toast(r.ok ? `${m.item}: ${MATERIAL_STATUS_LABEL[status].toLowerCase()}` : r.errors._ || "Couldn't update", r.ok ? "success" : "error");
        }}
      />
    );
  };
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-page">Materials</h1>
          <p className="t-meta mt-0.5 lg:text-[15px]">{data.materials.filter((m) => m.status === "to_order").length} to order across {new Set(data.materials.filter((m) => m.status === "to_order").map((m) => m.jobId)).size} jobs</p>
        </div>
        {write ? (
          <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "material" })}>
            <Plus className="size-[18px]" aria-hidden /> Add item
          </button>
        ) : null}
      </div>
      <Tabs
        label="Order status"
        className="mb-3"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "to_order", label: "To order", count: data.materials.filter((m) => m.status === "to_order").length, highlight: true },
          { value: "ordered", label: "Ordered", count: data.materials.filter((m) => m.status === "ordered").length },
          { value: "on_site", label: "On site", count: data.materials.filter((m) => m.status === "on_site").length },
          { value: "all", label: "All" },
        ]}
      />
      {list.length ? (
        <div className="space-y-4">
          {thisWeek.length ? (
            <ListPanel id="mat-week" title="Needed in the next 7 days" count={thisWeek.length}>
              <ul className="divide-y divide-line px-4 lg:px-5">{thisWeek.map(row)}</ul>
            </ListPanel>
          ) : null}
          {later.length ? (
            <ListPanel id="mat-later" title={thisWeek.length ? "Later or no date" : "Items"} count={later.length}>
              <ul className="divide-y divide-line px-4 lg:px-5">{later.map(row)}</ul>
            </ListPanel>
          ) : null}
        </div>
      ) : (
        <EmptyState icon={Package} title={filter === "to_order" ? "Nothing to order" : "Nothing here"} body="Add items from a job's Materials tab, or here." />
      )}
    </div>
  );
}
