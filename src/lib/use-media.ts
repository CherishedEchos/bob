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
