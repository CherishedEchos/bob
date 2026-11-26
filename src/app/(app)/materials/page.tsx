"use client";

/**
 * Materials — the working order list. Every job's materials in one table,
 * grouped by merchant so an order can be put together per supplier. Same
 * records as each job's Materials tab.
 *
 * Desktop: one wide table with aligned columns (Material, Quantity, Job,
 * Needed by, Status). Phone: stacked rows with item, quantity and due date
 * visible without opening anything.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronRight, Package, Phone, Plus } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { addDays, daysBetween, formatDayShort } from "@/lib/dates";
import type { Material, MaterialStatus, Merchant } from "@/lib/types";
import { cn, todayKey } from "@/lib/utils";
import { EmptyState, pageActionClass } from "@/components/common/bits";
import { MATERIAL_STATUS_LABEL } from "@/components/forms/team-forms";
import { NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

type StatusFilter = MaterialStatus | "all";
type When = "any" | "late" | "week" | "none";

const STATUS_TEXT: Record<MaterialStatus, string> = { to_order: "text-warn-fg", ordered: "text-info-fg", on_site: "text-good-fg" };

/** How urgent an item is, in words. On-site items are never urgent. */
function urgency(m: Pick<Material, "neededBy" | "status">, today: string): { label: string; tone: "late" | "soon" | "normal" | "none" } {
  if (!m.neededBy) return { label: "No date", tone: "none" };
  const d = daysBetween(today, m.neededBy);
  if (m.status === "on_site") return { label: formatDayShort(m.neededBy), tone: "normal" };
  if (d < 0) return { label: `${-d} ${d === -1 ? "day" : "days"} late`, tone: "late" };
  if (d === 0) return { label: "Today", tone: "late" };
  if (d === 1) return { label: "Tomorrow", tone: "soon" };
  if (d <= 3) return { label: `In ${d} days`, tone: "soon" };
  return { label: formatDayShort(m.neededBy), tone: "normal" };
}

const qty = (m: Pick<Material, "quantity" | "unit">) => `${m.quantity}${m.unit ? ` ${m.unit}` : ""}`;

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
  const filtered = !!(job || merchant || when !== "any");

  const list = data.materials
    .filter((m) => (status === "all" || m.status === status) && (!job || m.jobId === job) && (!merchant || (merchant === "none" ? !m.merchantId : m.merchantId === merchant)))
    .filter((m) => (when === "any" ? true : when === "none" ? !m.neededBy : when === "late" ? !!m.neededBy && m.neededBy < today : !!m.neededBy && m.neededBy <= addDays(today, 7)))
    .sort((a, b) => (a.neededBy ?? "9999").localeCompare(b.neededBy ?? "9999"));
  const groups = new Map<string, Material[]>();
  for (const m of list) groups.set(m.merchantId ?? "none", [...(groups.get(m.merchantId ?? "none") ?? []), m]);
  const ordered = [...groups].sort(([a], [b]) => (a === "none" ? 1 : b === "none" ? -1 : (merchants.get(a)?.name ?? "").localeCompare(merchants.get(b)?.name ?? "")));
  const lateCount = list.filter((m) => urgency(m, today).tone === "late").length;

  const setItemStatus = async (m: Material, st: MaterialStatus) => {
    const r = await actions.run("setMaterialStatus", { id: m.id, status: st });
    toast(r.ok ? `${m.item}: ${MATERIAL_STATUS_LABEL[st].toLowerCase()}` : r.errors._ || "Couldn't update — nothing changed", r.ok ? "success" : "error");
  };
  const edit = (m: Material) => (write ? ui.openForm({ form: "material", materialId: m.id }) : ui.openJob(m.jobId, { tab: "materials" }));

  return (
    <div className="max-w-[1400px]">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-page">Materials</h1>
          <p className="t-meta mt-0.5">
            {count("to_order")} to order · {count("ordered")} ordered
            {lateCount && status !== "on_site" ? <span className="font-semibold text-danger-fg"> · {lateCount} late or due today</span> : null}
          </p>
        </div>
        {write ? (
          <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "material" })}>
            <Plus className="size-[18px]" aria-hidden /> Add material
          </button>
        ) : null}
      </header>

      {/* One compact toolbar: status and filters together */}
      <div role="toolbar" aria-label="Filter materials" className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Order status" className="flex w-full shrink-0 gap-0.5 rounded-xl bg-surface-3 p-1 lg:w-auto">
          {(
            [
              ["to_order", "To order"],
              ["ordered", "Ordered"],
              ["on_site", "Delivered"],
              ["all", "All"],
            ] as [StatusFilter, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={status === v}
              onClick={() => setStatus(v)}
              className={cn("flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[15px] font-semibold transition lg:flex-none", status === v ? "bg-card text-heading shadow-[0_1px_2px_rgb(16_24_40/0.08)] ring-1 ring-line" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
              {v !== "all" ? <span className={cn("tabular text-[13.5px]", status === v ? "text-accent-fg" : "text-subtle")}>{count(v)}</span> : null}
            </button>
          ))}
        </div>
        <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto lg:flex-1">
          <label className="min-w-0">
            <span className="sr-only">Job</span>
            <NativeSelect value={job} onChange={(e) => setJob(e.target.value)} className="h-11 text-[15px]">
              <option value="">All jobs</option>
              {[...new Set(data.materials.map((m) => m.jobId))].map((id) => (
                <option key={id} value={id}>
                  {jobs.get(id)?.title ?? "Job"} · {jobs.get(id)?.customerName}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="min-w-0">
            <span className="sr-only">Merchant</span>
            <NativeSelect value={merchant} onChange={(e) => setMerchant(e.target.value)} className="h-11 text-[15px]">
              <option value="">All merchants</option>
              <option value="none">No merchant yet</option>
              {data.merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="min-w-0">
            <span className="sr-only">Needed by</span>
            <NativeSelect value={when} onChange={(e) => setWhen(e.target.value as When)} className="h-11 text-[15px]">
              <option value="any">Any date</option>
              <option value="late">Needed date passed</option>
              <option value="week">Needed in the next 7 days</option>
              <option value="none">No date set</option>
            </NativeSelect>
          </label>
        </div>
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setJob("");
              setMerchant("");
              setWhen("any");
            }}
            className="h-11 px-1 text-[15px] font-semibold text-accent-fg"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {list.length ? (
        <>
          {/* Desktop: one table, grouped by merchant, aligned columns */}
          <div className="panel hidden overflow-hidden md:block">
            <table className="w-full table-fixed border-collapse text-left">
              <caption className="sr-only">Materials grouped by merchant</caption>
              <colgroup>
                <col />
                <col className="w-[112px]" />
                <col className="w-[22%]" />
                <col className="w-[124px]" />
                <col className="w-[150px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[14px] font-semibold text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 lg:px-5">Material</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Quantity</th>
                  <th scope="col" className="px-3 py-2.5">Job</th>
                  <th scope="col" className="px-3 py-2.5">Needed by</th>
                  <th scope="col" className="px-4 py-2.5 lg:pr-5">Status</th>
                </tr>
              </thead>
              {ordered.map(([key, items]) => (
                <tbody key={key} className="border-b border-line last:border-b-0">
                  <tr className="bg-card">
                    <th scope="colgroup" colSpan={5} className="px-4 pb-1.5 pt-4 lg:px-5">
                      <GroupHeader merchant={key === "none" ? undefined : merchants.get(key)} count={items.length} />
                    </th>
                  </tr>
                  {items.map((m) => {
                    const j = jobs.get(m.jobId);
                    const u = urgency(m, today);
                    return (
                      <tr
                        key={m.id}
                        // The whole row opens the item; the status dropdown and links keep their own clicks.
                        onClick={(e) => !(e.target as HTMLElement).closest("select,a,label") && edit(m)}
                        className="cursor-pointer border-t border-line align-top transition-colors hover:bg-surface-2"
                      >
                        <td className="px-4 py-3 lg:px-5">
                          <button type="button" onClick={(e) => { e.stopPropagation(); edit(m); }} aria-label={`Edit ${m.item}`} className="block w-full rounded text-left">
                            <span className="block text-[15px] font-semibold leading-snug text-heading [overflow-wrap:anywhere]">{m.item}</span>
                            {m.orderRef || (!m.merchantId && m.supplier) ? (
                              <span className="mt-0.5 block text-[14px] text-muted-foreground">
                                {m.orderRef ? `Ref ${m.orderRef}` : ""}
                                {m.orderRef && !m.merchantId && m.supplier ? " · " : ""}
                                {!m.merchantId && m.supplier ? `Supplier: ${m.supplier}` : ""}
                              </span>
                            ) : null}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-right text-[15px] tabular text-foreground">{qty(m)}</td>
                        <td className="px-3 py-3 text-[15px] leading-snug">
                          <span className="block truncate text-foreground" title={j?.title}>
                            {j?.title ?? "Job"}
                          </span>
                          <span className="block truncate text-muted-foreground" title={j?.customerName}>
                            {j?.customerName}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-[15px] leading-snug tabular">
                          <NeededBy m={m} u={u} />
                        </td>
                        <td className="px-4 py-2 lg:pr-5">
                          <StatusSelect m={m} write={write} onChange={(st) => void setItemStatus(m, st)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>

          {/* Phone: stacked rows, same information */}
          <div className="flex flex-col gap-3 md:hidden">
            {ordered.map(([key, items]) => (
              <section key={key} className="panel overflow-hidden">
                <div className="border-b border-line px-4 py-3">
                  <GroupHeader merchant={key === "none" ? undefined : merchants.get(key)} count={items.length} />
                </div>
                <ul className="divide-y divide-line">
                  {items.map((m) => {
                    const j = jobs.get(m.jobId);
                    const u = urgency(m, today);
                    return (
                      <li key={m.id} className="row-open px-4 py-3">
                        <button type="button" onClick={() => edit(m)} aria-label={`Edit ${m.item}`} className="row-target block w-full text-left after:absolute after:inset-0 after:content-['']">
                          <span className="block text-[15.5px] font-semibold leading-snug text-heading [overflow-wrap:anywhere]">{m.item}</span>
                          <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[15px] tabular">
                            <span className="font-medium text-foreground">{qty(m)}</span>
                            <span aria-hidden className="text-subtle">·</span>
                            <span className={cn(u.tone === "late" ? "font-semibold text-danger-fg" : u.tone === "soon" ? "font-semibold text-warn-fg" : "text-muted-foreground")}>{m.neededBy ? `Needed ${u.tone === "normal" ? u.label : u.label.toLowerCase()}` : "No date"}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[15px] text-muted-foreground">
                            {j ? `${j.title} · ${j.customerName}` : "Job"}
                            {m.orderRef ? ` · Ref ${m.orderRef}` : ""}
                          </span>
                        </button>
                        <div className="row-secondary mt-2 w-[150px]">
                          <StatusSelect m={m} write={write} onChange={(st) => void setItemStatus(m, st)} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          icon={Package}
          title={filtered ? "Nothing matches these filters" : status === "to_order" ? "Nothing to order" : "Nothing here"}
          body={filtered ? "Clear the job, merchant or date filter to see more." : "Add materials from a job's Materials tab, or here."}
          action={write && !filtered ? <button type="button" className={pageActionClass} onClick={() => ui.openForm({ form: "material" })}><Plus className="size-[18px]" /> Add material</button> : undefined}
        />
      )}
    </div>
  );
}

function GroupHeader({ merchant, count }: { merchant?: Merchant; count: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h2 className="text-[16px] font-semibold text-heading">
        {merchant ? merchant.name : "No merchant yet"}
        <span className="ml-2 text-[14.5px] font-normal text-muted-foreground">
          {count} {count === 1 ? "item" : "items"}
        </span>
      </h2>
      {merchant ? (
        <span className="flex flex-wrap items-center gap-x-4 text-[15px] font-normal">
          {merchant.phone ? (
            <a href={`tel:${merchant.phone.replace(/\s/g, "")}`} className="inline-flex h-9 items-center gap-1.5 font-medium text-foreground hover:text-accent-fg">
              <Phone className="size-3.5" aria-hidden /> {merchant.phone}
            </a>
          ) : null}
          <Link href={`/merchants?open=${merchant.id}`} className="inline-flex h-9 items-center gap-0.5 font-medium text-muted-foreground hover:text-foreground">
            Supplier record <ChevronRight className="size-4" aria-hidden />
          </Link>
        </span>
      ) : (
        <span className="text-[14.5px] font-normal text-muted-foreground">Choose a merchant on each item to order it.</span>
      )}
    </div>
  );
}

function NeededBy({ m, u }: { m: Material; u: ReturnType<typeof urgency> }) {
  if (!m.neededBy) return <span className="text-muted-foreground">No date</span>;
  return (
    <>
      <span className={cn("block", u.tone === "late" ? "font-semibold text-danger-fg" : u.tone === "soon" ? "font-semibold text-warn-fg" : "text-foreground")}>{u.label}</span>
      {u.tone !== "normal" ? <span className="block text-[14px] text-muted-foreground">{formatDayShort(m.neededBy)}</span> : null}
    </>
  );
}

/** A real dropdown that looks like one: border, chevron, coloured status text. */
function StatusSelect({ m, write, onChange }: { m: Material; write: boolean; onChange: (s: MaterialStatus) => void }) {
  return (
    <label className="row-secondary relative block">
      <span className="sr-only">Status for {m.item}</span>
      <NativeSelect value={m.status} disabled={!write} onChange={(e) => onChange(e.target.value as MaterialStatus)} className={cn("h-10 pl-3 text-[15px] font-semibold", STATUS_TEXT[m.status])}>
        {(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((st) => (
          <option key={st} value={st}>
            {MATERIAL_STATUS_LABEL[st]}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
