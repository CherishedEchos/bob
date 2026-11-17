"use client";

/**
 * First steps for a new owner: add a job, add a person, schedule the job,
 * invite the person. Each step ticks itself off from real records; the whole
 * thing can be skipped and stays skipped on this device.
 */
import * as React from "react";
import { Check, X } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/utils";

export function Onboarding() {
  const { data, can, org } = useStore();
  const ui = useUI();
  const key = `bob.onboarding.skipped:${org.id}`;
  const [skipped, setSkipped] = React.useState(true);
  React.useEffect(() => {
    try {
      setSkipped(localStorage.getItem(key) === "1");
    } catch {
      setSkipped(false);
    }
  }, [key]);
  if (!can("team.manage") || !can("schedule.manage") || skipped) return null;
  const steps = [
    { label: "Add a job", done: data.jobs.length > 0, run: () => ui.openForm({ form: "job" }) },
    { label: "Add a person", done: data.people.length > 0, run: () => ui.openForm({ form: "person" }) },
    { label: "Schedule the job", done: data.bookings.some((b) => b.personIds.length > 0), run: () => ui.openForm({ form: "booking" }) },
    { label: "Invite them to Bob", done: data.access.some((a) => a.state === "pending" || a.state === "accepted"), run: () => (window.location.href = "/team") },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);
  const skip = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    setSkipped(true);
  };
  return (
    <section aria-labelledby="ob-title" className="panel relative px-4 py-4 lg:px-5">
      <button type="button" onClick={skip} className="absolute right-2 top-2 flex h-10 items-center gap-1 rounded-lg px-2 text-[13.5px] font-medium text-muted-foreground hover:bg-surface-2" aria-label="Skip getting started">
        Skip <X className="size-4" aria-hidden />
      </button>
      <h2 id="ob-title" className="t-section pr-20">
        Get your first job on the board
      </h2>
      <p className="t-meta mt-0.5">
        {done} of {steps.length} done · takes about two minutes
      </p>
      <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={s.run}
              disabled={s.done}
              className={cn(
                "flex min-h-12 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[15px] font-medium ring-1 transition",
                s.done ? "bg-surface-2 text-muted-foreground ring-line" : i === next ? "bg-primary text-white ring-transparent hover:bg-copper-600" : "bg-card ring-line-strong hover:bg-surface-2",
              )}
            >
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[12.5px] font-semibold", s.done ? "bg-emerald-600 text-white" : i === next ? "bg-white/25" : "bg-surface-3")}>
                {s.done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn(s.done && "line-through")}>{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
