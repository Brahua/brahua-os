"use client";

import { useIsDesktop } from "@/lib/use-is-desktop";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/**
 * Whether the rows of a list can be swiped ("Mañana"): below 1024 px and without
 * `prefers-reduced-motion` (a drag is a displacement; the keys stay). Read once by the list, not
 * by every row.
 */
export function useSwipeEnabled(): boolean {
  const isDesktop = useIsDesktop();
  const reduced = usePrefersReducedMotion();
  return !isDesktop && !reduced;
}
