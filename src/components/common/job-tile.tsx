import { ChefHat, Home, DoorClosed, Building2, Fence, Footprints, Hammer, ShowerHead } from "lucide-react";
import type { JobKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<JobKind, typeof Home> = {
  kitchen: ChefHat,
  loft: Home,
  wardrobes: DoorClosed,
  extension: Building2,
  decking: Fence,
  staircase: Footprints,
  bathroom: ShowerHead,
  general: Hammer,
};

/** Warm, illustrative tile standing in for a job photo (no stock imagery in the demo). */
export function JobTile({ kind, className }: { kind: JobKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <div
      className={cn(
        "relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl ring-1 ring-line",
        "bg-[linear-gradient(160deg,#fff4ec,#fde6d4)]",
        className,
      )}
      aria-hidden
    >
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[repeating-linear-gradient(90deg,rgb(180_82_15/0.05)_0_6px,transparent_6px_12px)]" />
      <Icon className="relative size-7 text-accent-icon" strokeWidth={1.7} />
    </div>
  );
}
