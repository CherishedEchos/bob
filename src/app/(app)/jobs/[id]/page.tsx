"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { HardHat } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI, type JobTab } from "@/lib/store/ui";
import { JobWorkspace } from "@/components/jobs/job-sheet";
import { EmptyState } from "@/components/common/bits";

const TABS: JobTab[] = ["overview", "schedule", "updates", "photos", "documents", "materials", "tasks", "extras", "variations" as JobTab, "financials", "handover", "files", "report", "money"];

export default function JobPage() {
  return (
    <React.Suspense>
      <JobPageInner />
    </React.Suspense>
  );
}

function JobPageInner() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { data } = useStore();
  const tab = params.get("tab") as JobTab | null;
  const job = data.jobs.find((j) => j.id === id);
  const { setPageContext } = useUI();
  const label = job ? `${job.customerName} — ${job.title}` : "";
  React.useEffect(() => {
    if (!job) return;
    setPageContext({ type: "job", id: job.id, label });
    return () => setPageContext(null);
  }, [job?.id, label, setPageContext]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (job) document.title = `${job.title} · ${job.customerName} — Bob`;
  }, [job]);
  if (!job)
    return (
      <EmptyState
        icon={HardHat}
        title="Job not found"
        body="It may have been removed, or it belongs to another business."
        action={
          <Link href="/jobs" className="font-semibold text-accent-fg">
            Back to Jobs
          </Link>
        }
      />
    );
  return <JobWorkspace id={job.id} initialTab={tab && TABS.includes(tab) ? tab : undefined} />;
}
