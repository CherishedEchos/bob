"use client";

import * as React from "react";

/** True when the media query matches (false during the first render on the server). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia(query);
    const sync = () => setMatches(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

/** Desktop layout (Tailwind's lg breakpoint). */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

/**
 * The visible part of the screen on phones (shrinks when the keyboard opens).
 * Undefined on desktop or before mount, so callers fall back to CSS.
 */
export function useVisualViewport(): { height: number; offsetTop: number } | undefined {
  const [vv, setVv] = React.useState<{ height: number; offsetTop: number }>();
  React.useEffect(() => {
    const v = window.visualViewport;
    if (!v || window.matchMedia("(min-width: 640px)").matches) return;
    const sync = () => setVv({ height: v.height, offsetTop: v.offsetTop });
    sync();
    v.addEventListener("resize", sync);
    v.addEventListener("scroll", sync);
    return () => {
      v.removeEventListener("resize", sync);
      v.removeEventListener("scroll", sync);
    };
  }, []);
  return vv;
}
