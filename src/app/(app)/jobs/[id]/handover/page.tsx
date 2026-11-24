"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { HandoverWorkspace } from "@/components/reports/handover-wizard";

/** The customer handover for one job, as its own focused page (no job profile underneath). */
export default function HandoverPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useStore();
  const { setPageContext } = useUI();
  const job = data.jobs.find((j) => j.id === id);
  React.useEffect(() => {
    if (!job) return;
    document.title = `Handover · ${job.title} — Bob`;
    setPageContext({ type: "job", id: job.id, label: `${job.customerName} — ${job.title}` });
    return () => setPageContext(null);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!job)
    return (
      <p className="py-16 text-center text-[15.5px] text-muted-foreground">
        Job not found. <Link href="/jobs" className="font-semibold text-accent-fg">Back to Jobs</Link>
      </p>
    );
  return <HandoverWorkspace job={job} />;
}
