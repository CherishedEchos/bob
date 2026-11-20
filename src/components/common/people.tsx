"use client";

import { cn } from "@/lib/utils";
import { initials } from "@/lib/schedule";
import type { Person } from "@/lib/types";

/**
 * Soft, calendar-style colours. Each job keeps the same colour everywhere
 * (diary, job cards, team schedule) so people learn to recognise it.
 */
export const JOB_TONES = [
  { card: "bg-[#fdf1e6] ring-[#f6d9bf] hover:ring-[#eab98d]", bar: "bg-[#f38735]", text: "text-[#8a4a12]", dot: "bg-[#f38735]" },
  { card: "bg-[#eaf2fd] ring-[#cfe0f8] hover:ring-[#a9c6ef]", bar: "bg-[#4f86d9]", text: "text-[#2a4f8a]", dot: "bg-[#4f86d9]" },
  { card: "bg-[#e8f5ee] ring-[#c9e7d6] hover:ring-[#9fd2b5]", bar: "bg-[#3a9b6b]", text: "text-[#1f6345]", dot: "bg-[#3a9b6b]" },
  { card: "bg-[#f1edfb] ring-[#ddd4f4] hover:ring-[#c0b1ea]", bar: "bg-[#7b5fd0]", text: "text-[#4b3690]", dot: "bg-[#7b5fd0]" },
  { card: "bg-[#fcebee] ring-[#f5d0d7] hover:ring-[#ebaab6]", bar: "bg-[#d4596f]", text: "text-[#8c2f40]", dot: "bg-[#d4596f]" },
  { card: "bg-[#e7f4f5] ring-[#c6e5e8] hover:ring-[#99d0d5]", bar: "bg-[#2f949c]", text: "text-[#1c5f65]", dot: "bg-[#2f949c]" },
  { card: "bg-[#fbf4df] ring-[#efe0b0] hover:ring-[#e2c97a]", bar: "bg-[#c99a1d]", text: "text-[#7a5c0c]", dot: "bg-[#c99a1d]" },
] as const;

export type JobTone = (typeof JOB_TONES)[number];

export function jobTone(jobId: string | undefined): JobTone {
  if (!jobId) return JOB_TONES[0];
  let h = 0;
  for (let i = 0; i < jobId.length; i++) h = (h * 31 + jobId.charCodeAt(i)) >>> 0;
  return JOB_TONES[h % JOB_TONES.length];
}

const AVATAR_TONES = ["bg-[#e9e4dc] text-[#5b4a36]", "bg-[#dfe7ef] text-[#34506b]", "bg-[#e1ece4] text-[#2f5a3f]", "bg-[#ece2ea] text-[#6a3d5f]", "bg-[#efe6d8] text-[#6b5223]", "bg-[#e0e8ea] text-[#2f5560]"];

function avatarTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 17 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** A person's initials in a soft circle; subcontractors get a dashed ring so they're told apart at a glance. */
export function PersonAvatar({ person, name, size = 24, className }: { person?: Pick<Person, "name" | "kind">; name?: string; size?: number; className?: string }) {
  const n = person?.name ?? name ?? "?";
  const sub = person?.kind === "subcontractor";
  return (
    <span
      title={`${n}${sub ? " (subcontractor)" : ""}`}
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold ring-2 ring-card", avatarTone(n), sub && "border border-dashed border-black/25", className)}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) }}
    >
      {initials(n)}
    </span>
  );
}

/** Overlapping avatars with a "+N". */
export function PeopleStack({ people, max = 3, size = 24, className }: { people: Pick<Person, "name" | "kind" | "id">[]; max?: number; size?: number; className?: string }) {
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={cn("flex items-center", className)} aria-label={people.map((p) => p.name).join(", ")}>
      {shown.map((p, i) => (
        <PersonAvatar key={p.id} person={p} size={size} className={i ? "-ml-1" : undefined} />
      ))}
      {rest > 0 ? (
        <span className="-ml-1 grid place-items-center rounded-full bg-surface-3 font-semibold text-muted-foreground ring-2 ring-card" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
