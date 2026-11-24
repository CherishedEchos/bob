"use client";

import * as React from "react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { Card, PageHeader, Tabs } from "@/components/common/bits";
import { cn, timeAgo } from "@/lib/utils";

/** Who did what: the whole team, or just the signed-in person (Luke's and Ryan's changes are labelled by name). */
export default function ActivityPage() {
  const { data, user } = useStore();
  const ui = useUI();
  const [who, setWho] = React.useState<"everyone" | "me">("everyone");
  const list = data.activity.filter((a) => who === "everyone" || a.actor === user.name);
  return (
    <>
      <PageHeader className="mb-4" title="Activity" subtitle="Every change — from the app, from Bob (after approval) or from integrations. Newest first." />
      <Tabs
        label="Whose activity"
        className="mb-4 self-start"
        value={who}
        onChange={setWho}
        options={[
          { value: "everyone", label: "Everyone" },
          { value: "me", label: `Just me (${user.name})` },
        ]}
      />
      <Card className="divide-y divide-line">
        {list.length === 0 ? <p className="px-4 py-6 text-[15px] text-subtle">Nothing yet — changes you make will show here.</p> : null}
        {list.map((a) => {
          const clickable =
            (a.entityType === "job" && data.jobs.some((j) => j.id === a.entityId)) ||
            (a.entityType === "enquiry" && data.enquiries.some((e) => e.id === a.entityId)) ||
            (a.entityType === "customer" && data.customers.some((c) => c.id === a.entityId));
          const mine = a.actor === user.name;
          return (
            <button
              key={a.id}
              disabled={!clickable}
              onClick={() => (a.entityType === "job" ? ui.openJob(a.entityId!) : a.entityType === "customer" ? ui.openCustomer(a.entityId!) : ui.openEnquiry(a.entityId!))}
              className="flex w-full items-start gap-3 px-4 py-3.5 text-left enabled:hover:bg-surface-2"
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", mine ? "bg-copper-500" : "bg-line-strong")} />
              <div className="min-w-0 flex-1">
                <p className="text-[15.5px]">{a.summary}</p>
                <p className="mt-0.5 text-[13.5px] text-subtle">
                  {mine ? "You" : a.actor}
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
