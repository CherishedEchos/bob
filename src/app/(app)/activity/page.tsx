"use client";

import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { Card, PageHeader } from "@/components/common/bits";
import { timeAgo } from "@/lib/utils";

export default function ActivityPage() {
  const { data } = useStore();
  const ui = useUI();
  return (
    <>
      <PageHeader title="Activity log" subtitle="Every change — from the dashboard, from Bob (after approval) or from integrations. Newest first." />
      <Card className="divide-y divide-white/[0.06]">
        {data.activity.map((a) => {
          const clickable =
            (a.entityType === "job" && data.jobs.some((j) => j.id === a.entityId)) ||
            (a.entityType === "enquiry" && data.enquiries.some((e) => e.id === a.entityId)) ||
            (a.entityType === "customer" && data.customers.some((c) => c.id === a.entityId));
          return (
            <button
              key={a.id}
              disabled={!clickable}
              onClick={() => (a.entityType === "job" ? ui.openJob(a.entityId!) : a.entityType === "customer" ? ui.openCustomer(a.entityId!) : ui.openEnquiry(a.entityId!))}
              className="flex w-full items-start gap-3 px-4 py-3.5 text-left enabled:hover:bg-white/[0.03]"
            >
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-copper-500" />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px]">{a.summary}</p>
                <p className="mt-0.5 text-[12.5px] text-subtle">
                  {a.actor}
                  {a.via === "bob" ? " via Bob" : a.via === "integration" ? " (integration)" : ""} · {timeAgo(a.at)} · {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </button>
          );
        })}
      </Card>
    </>
  );
}
