import { ChefHat, Home, DoorClosed, Building2, Fence, Footprints, Hammer } from "lucide-react";
import type { JobKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<JobKind, typeof Home> = {
  kitchen: ChefHat,
  loft: Home,
  wardrobes: DoorClosed,
  extension: Building2,
  decking: Fence,
  staircase: Footprints,
  general: Hammer,
};

/** Warm, illustrative tile standing in for a job photo (no stock imagery in the demo). */
export function JobTile({ kind, className }: { kind: JobKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <div
      className={cn(
        "relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl ring-1 ring-white/10",
        "bg-[radial-gradient(120%_90%_at_20%_10%,rgb(255_180_126/0.28),transparent_55%),linear-gradient(160deg,#3a2a1f,#1b1613)]",
        className,
      )}
      aria-hidden
    >
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.04)_0_6px,transparent_6px_12px)]" />
      <Icon className="relative size-7 text-copper-200" strokeWidth={1.6} />
    </div>
  );
}
