import * as React from "react";
import { cn } from "@/lib/utils";

export type OrbState = "idle" | "listening" | "thinking";

// Off-centre ellipses with uneven radii: as they rotate they weave into lobes.
const RIBBONS = [
  { r: "62% 38% 55% 45% / 48% 60% 40% 52%", anim: "animate-orb-a", inset: "3% 18% 13% 5%" },
  { r: "40% 60% 42% 58% / 60% 42% 58% 40%", anim: "animate-orb-b", inset: "16% 3% 4% 14%" },
  { r: "55% 45% 65% 35% / 40% 55% 45% 60%", anim: "animate-orb-c", inset: "5% 9% 19% 11%" },
  { r: "45% 55% 38% 62% / 55% 38% 62% 45%", anim: "animate-orb-d", inset: "12% 13% 6% 20%" },
];

const BARS = [0.35, 0.6, 0.85, 1, 0.75, 0.5, 0.3];

// "Soft" look (Ask Bob home): three broad, rounded-triangle petals with a
// translucent amber fill and a soft glowing edge, slowly turning.
function petal(R: number, k: number, steps = 96): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = R * (1 + k * Math.cos(3 * t));
    pts.push(`${(100 + r * Math.cos(t - Math.PI / 2)).toFixed(2)},${(100 + r * Math.sin(t - Math.PI / 2)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}
const PETALS = [
  { d: petal(72, 0.17), rot: 0, dur: 40 },
  { d: petal(70, 0.19), rot: 40, dur: 52 },
  { d: petal(68, 0.16), rot: 80, dur: 64 },
];

/** Soft amber rings (Ask Bob home). Same states as the classic orb. */
function SoftOrb({ state, size, className }: { state: OrbState; size: number; className?: string }) {
  const speed = state === "listening" ? 0.3 : state === "thinking" ? 0.55 : 1;
  const id = React.useId().replace(/:/g, "");
  return (
    <div
      className={cn("relative isolate select-none", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={state === "listening" ? "Assistant is listening" : state === "thinking" ? "Assistant is thinking" : "Assistant ready"}
    >
      <div
        className={cn("absolute -inset-[14%] -z-10 rounded-full blur-2xl transition-opacity duration-500", state === "listening" ? "opacity-100" : "opacity-60")}
        style={{ background: "radial-gradient(circle, rgb(255 140 50 / 0.30), rgb(236 122 46 / 0.08) 50%, transparent 70%)" }}
      />
      <svg viewBox="0 0 200 200" className={cn("absolute inset-0 size-full overflow-visible transition-transform duration-700", state === "listening" && "scale-[1.05]")} aria-hidden>
        <defs>
          <radialGradient id={`f${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="45%" stopColor="#ff8c32" stopOpacity="0" />
            <stop offset="100%" stopColor="#ff8c32" stopOpacity="0.3" />
          </radialGradient>
          <filter id={`g${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
        </defs>
        {PETALS.map((p, i) => (
          <g key={i} transform={`rotate(${p.rot} 100 100)`}>
            <g className={i % 2 ? "animate-orb-b" : "animate-orb-a"} style={{ transformOrigin: "100px 100px", animationDuration: `${p.dur * speed}s` }}>
              <path d={p.d} fill={`url(#f${id})`} style={{ mixBlendMode: "screen" }} />
              <path d={p.d} fill="none" stroke="#ff7a1a" strokeWidth="5" opacity="0.75" filter={`url(#g${id})`} />
              <path d={p.d} fill="none" stroke="#ffcf9e" strokeWidth="1.4" opacity="0.95" />
            </g>
          </g>
        ))}
      </svg>
      <div className="absolute inset-[31%] grid place-items-center rounded-full" style={{ background: "radial-gradient(circle, #140b06 50%, rgb(20 11 6 / 0) 100%)" }}>
        <div className="flex h-[44%] items-center gap-[7%]" style={{ width: "62%" }}>
          {BARS.map((h, i) => (
            <span
              key={i}
              className={cn("flex-1 origin-center rounded-full bg-[#ff9a45]", state !== "idle" ? "animate-wave" : "")}
              style={{
                height: `${h * 100}%`,
                animationDelay: `${i * 0.09}s`,
                animationDuration: state === "listening" ? "0.7s" : "1.2s",
                transform: state === "idle" ? `scaleY(${0.55 + h * 0.4})` : undefined,
                boxShadow: "0 0 6px rgb(255 140 50 / 0.6)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Orb({ state = "idle", size = 240, className, tone = "classic" }: { state?: OrbState; size?: number; className?: string; tone?: "classic" | "soft" }) {
  if (tone === "soft") return <SoftOrb state={state} size={size} className={className} />;
  const speed = state === "listening" ? 0.35 : state === "thinking" ? 0.6 : 1;
  return (
    <div
      className={cn("relative isolate select-none", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={state === "listening" ? "Assistant is listening" : state === "thinking" ? "Assistant is thinking" : "Assistant ready"}
    >
      {/* ambient glow */}
      <div
        className={cn(
          "absolute -inset-[28%] -z-10 animate-breathe rounded-full blur-2xl transition-opacity duration-500",
          state === "listening" ? "opacity-100" : "opacity-70",
        )}
        style={{ background: "radial-gradient(circle, rgb(236 122 46 / 0.42), rgb(236 122 46 / 0.12) 45%, transparent 68%)" }}
      />
      {/* ribbons */}
      {RIBBONS.map((rb, i) => (
        <div
          key={i}
          className={cn("absolute mix-blend-screen transition-transform duration-700", rb.anim, state === "listening" && "scale-[1.06]")}
          style={{
            inset: rb.inset,
            borderRadius: rb.r,
            border: "1.5px solid rgb(255 176 120 / 0.75)",
            boxShadow:
              "0 0 14px rgb(236 122 46 / 0.65), 0 0 36px rgb(236 122 46 / 0.25), inset 0 0 16px rgb(236 122 46 / 0.4)",
            background: "radial-gradient(closest-side, transparent 62%, rgb(236 122 46 / 0.16))",
            animationDuration: `${[14, 18, 22, 11][i] * speed}s`,
          }}
        />
      ))}
      {/* core */}
      <div
        className="absolute inset-[29%] grid place-items-center rounded-full"
        style={{
          background: "radial-gradient(circle at 50% 38%, #3b2111, #150d08 70%)",
          boxShadow: "0 0 0 1px rgb(255 176 120 / 0.35), 0 0 30px rgb(236 122 46 / 0.55), inset 0 0 22px rgb(236 122 46 / 0.35)",
        }}
      >
        <div className="flex h-[38%] items-center gap-[5%]" style={{ width: "58%" }}>
          {BARS.map((h, i) => (
            <span
              key={i}
              className={cn("flex-1 origin-center rounded-full bg-gradient-to-b from-copper-200 to-copper-500", state !== "idle" ? "animate-wave" : "")}
              style={{
                height: `${h * 100}%`,
                animationDelay: `${i * 0.09}s`,
                animationDuration: state === "listening" ? "0.7s" : "1.2s",
                transform: state === "idle" ? `scaleY(${0.55 + h * 0.4})` : undefined,
                boxShadow: "0 0 8px rgb(236 122 46 / 0.7)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Small orb avatar used next to assistant messages. */
export function OrbAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn("grid size-10 shrink-0 place-items-center rounded-full", className)}
      style={{
        background: "radial-gradient(circle at 50% 38%, #3b2111, #150d08 70%)",
        boxShadow: "0 0 0 1.5px rgb(255 176 120 / 0.55), 0 0 16px rgb(236 122 46 / 0.55)",
      }}
      aria-hidden
    >
      <div className="flex h-3.5 items-center gap-[2px]">
        {[0.4, 0.75, 1, 0.75, 0.4].map((h, i) => (
          <span key={i} className="w-[2px] rounded-full bg-copper-300" style={{ height: `${h * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Flowing waveform line shown above the voice controls in conversation. */
export function WaveLine({ active, className }: { active: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 400 40" preserveAspectRatio="none" className={cn("h-10 w-full", className)} aria-hidden>
      <defs>
        <linearGradient id="wl" x1="0" x2="1">
          <stop offset="0" stopColor="#ec7a2e" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffb47e" stopOpacity="1" />
          <stop offset="1" stopColor="#ec7a2e" stopOpacity="0" />
        </linearGradient>
        <filter id="wlglow">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M0 20 C 60 ${20 - (8 + i * 4)}, 120 ${20 + (10 - i * 3)}, 200 20 S 340 ${20 - (6 + i * 3)}, 400 20`}
          fill="none"
          stroke="url(#wl)"
          strokeWidth={i === 0 ? 2 : 1.2}
          opacity={i === 0 ? 1 : 0.5}
          filter="url(#wlglow)"
        >
          {active ? (
            <animate
              attributeName="d"
              dur={`${1.6 + i * 0.4}s`}
              repeatCount="indefinite"
              values={`M0 20 C 60 ${12 - i * 3}, 120 ${30 + i * 2}, 200 20 S 340 ${10 - i * 2}, 400 20;M0 20 C 60 ${30 + i * 2}, 120 ${10 - i * 2}, 200 20 S 340 ${30 + i * 2}, 400 20;M0 20 C 60 ${12 - i * 3}, 120 ${30 + i * 2}, 200 20 S 340 ${10 - i * 2}, 400 20`}
            />
          ) : null}
        </path>
      ))}
    </svg>
  );
}
