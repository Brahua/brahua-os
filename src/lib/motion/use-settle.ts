"use client";

import type { Transition } from "motion/react";
import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";
import { SCREEN } from "./tokens";
import { settle, segmentDelay } from "./variants";

/**
 * The transition of a value that is not a transform (a bar's width): it follows the same timing
 * as the rest, and with reduced motion it jumps to the final value. `entering` is the first
 * appearance of the screen (the long draw, segment by segment at `index`); otherwise it settles.
 */
export function useValueTransition(entering: boolean, index: number = 0): Transition {
  const reduced = usePrefersReducedMotion();
  if (reduced) return { duration: 0 };
  return entering ? { ...settle, duration: SCREEN.draw, delay: segmentDelay(index) + 0.2 } : settle;
}
