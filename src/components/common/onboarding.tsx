"use client";

/**
 * Optional first steps for a new owner: business details, team, first job,
 * the diary and talking to Bob. Each step ticks itself off from real records
 * (or, for Bob, the first conversation on this device); the whole thing can
 * be skipped and stays skipped on this device.
 */
import * as React from "react";
import { Check, X } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/utils";

/** Set once someone has had an answer from Bob on this device (the last onboarding step). */
export const TALKED_KEY = "bob.talked";

export function Onboarding() {
  const { data, can, org } = useStore();
  const ui = useUI();
  const key = `bob.onboarding.skipped:${org.id}`;
  const [skipped, setSkipped] = React.useState(true);
  const [talked, setTalked] = React.useState(false);
  React.useEffect(() => {
    try {
      setSkipped(localStorage.getItem(key) === "1");
      setTalked(localStorage.getItem(TALKED_KEY) === "1");
    } catch {
      setSkipped(false);
    }
  }, [key]);
  if (!can("team.manage") || !can("schedule.manage") || skipped) return null;
  const steps = [
    { label: "Your business", done: !!(org.contact.phone || org.contact.email) && org.services.length > 0, run: () => (window.location.href = "/settings") },
    { label: "Add your team", done: data.people.length > 0, run: () => ui.openForm({ form: "person" }) },
    { label: "Add a job", done: data.jobs.length > 0, run: () => ui.openForm({ form: "job" }) },
    { label: "Put it in the diary", done: data.bookings.some((b) => b.personIds.length > 0), run: () => ui.openForm({ form: "booking" }) },
    { label: "Talk to Bob", done: talked, run: () => (window.location.href = "/assistant?listen=1") },
  ];
  const done = steps.filter((s) => s.done).length;
  // For new workspaces only: once the business is up and running (most steps done), it stays out of the way.
  if (done >= 3) return null;
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
      <button type="button" onClick={skip} className="absolute right-2 top-2 flex h-10 items-center gap-1 rounded-lg px-2 text-[14.5px] font-medium text-muted-foreground hover:bg-surface-2" aria-label="Skip getting started">
        Skip <X className="size-4" aria-hidden />
      </button>
      <h2 id="ob-title" className="t-section pr-20">
        Getting started
      </h2>
      <p className="t-meta mt-0.5">
        {done} of {steps.length} done · optional — skip it any time
      </p>
      <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
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
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[13.5px] font-semibold", s.done ? "bg-emerald-600 text-white" : i === next ? "bg-white/25" : "bg-surface-3")}>
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
