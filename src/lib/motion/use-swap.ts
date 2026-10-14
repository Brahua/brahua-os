"use client";

import { animate } from "motion/mini";
import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";
import { bezier, EASE, SCREEN, TRAVEL } from "./tokens";

type Direction = 1 | -1;

type SwapOptions = {
  /** Which content is shown (the month as a number): a change means the next content arrived. */
  order: number;
  /** The next content is on its way (a navigation in a transition). */
  pending: boolean;
  /** Where the pending content goes to (1: forward, the old one leaves to the left). */
  intent: Direction;
};

const OFFSET = (direction: Direction) => `translateX(${TRAVEL * direction}px)`;

/**
 * Content that follows an arrow (month to month): while the next one loads it leaves 8 px
 * towards the arrow and dims; when it arrives it comes from the other side and settles. Returns
 * the ref of the element to move. It never blocks anything: the content stays interactive, and
 * with reduced motion only the opacity moves. Uses WAAPI (`motion/mini`), so it needs no
 * `MotionProvider`.
 */
export function useDirectionalSwap<T extends HTMLElement>({ order, pending, intent }: SwapOptions) {
  const ref = useRef<T>(null);
  const reduced = usePrefersReducedMotion();
  const shownOrder = useRef(order);
  const left = useRef(false);

  useEffect(() => {
    const element = ref.current;
    // No Web Animations (an old engine, jsdom): the content simply changes, nothing breaks.
    if (!element || typeof element.animate !== "function") return;
    const travel = (direction: Direction) => (reduced ? "none" : OFFSET(direction));
    let controls: ReturnType<typeof animate> | null = null;
    if (pending) {
      left.current = true;
      controls = animate(
        element,
        { opacity: 0.4, transform: travel(-intent as Direction) },
        { duration: SCREEN.swapOut, ease: bezier(EASE.standard) },
      );
    } else if (shownOrder.current !== order) {
      const direction: Direction = order > shownOrder.current ? 1 : -1;
      shownOrder.current = order;
      left.current = false;
      controls = animate(
        element,
        { opacity: [0.4, 1], transform: [travel(direction), "none"] },
        { duration: SCREEN.swapIn, ease: bezier(EASE.out) },
      );
    } else if (left.current) {
      // The navigation ended without a new month (an error, or back to the same one): rest.
      left.current = false;
      controls = animate(
        element,
        { opacity: 1, transform: "none" },
        { duration: SCREEN.swapIn, ease: bezier(EASE.out) },
      );
    }
    return () => controls?.cancel();
  }, [order, pending, intent, reduced]);

  return ref;
}
