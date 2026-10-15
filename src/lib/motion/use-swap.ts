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
  // Every animation this hook started: cancelled only on unmount. Cancelling one when the next
  // starts would snap the element back to its resting style for a frame (a WAAPI cancel drops
  // the effect), which is the jump this avoids on a fast answer or an arrow pressed twice.
  const started = useRef<ReturnType<typeof animate>[]>([]);

  useEffect(
    () => () => {
      started.current.forEach((controls) => controls.cancel());
      started.current = [];
    },
    [],
  );

  useEffect(() => {
    const element = ref.current;
    // No Web Animations (an old engine, jsdom): the content simply changes, nothing breaks.
    if (!element || typeof element.animate !== "function") return;
    const travel = (direction: Direction) => (reduced ? "none" : OFFSET(direction));
    if (pending) {
      left.current = true;
      started.current.push(
        animate(
          element,
          { opacity: 0.4, transform: travel(-intent as Direction) },
          { duration: SCREEN.swapOut, ease: bezier(EASE.standard) },
        ),
      );
    } else if (shownOrder.current !== order) {
      const direction: Direction = order > shownOrder.current ? 1 : -1;
      shownOrder.current = order;
      left.current = false;
      // It starts from whatever the content shows now (dimmed when the exit finished, a bit
      // brighter if the answer beat it), so a fast arrival never flashes.
      const shown = Number.parseFloat(getComputedStyle(element).opacity);
      started.current.push(
        animate(
          element,
          {
            opacity: [Number.isNaN(shown) ? 0.4 : shown, 1],
            transform: [travel(direction), "none"],
          },
          { duration: SCREEN.swapIn, ease: bezier(EASE.out) },
        ),
      );
    } else if (left.current) {
      // The navigation ended without a new month (an error, or back to the same one): rest.
      left.current = false;
      started.current.push(
        animate(
          element,
          { opacity: 1, transform: "none" },
          { duration: SCREEN.swapIn, ease: bezier(EASE.out) },
        ),
      );
    }
  }, [order, pending, intent, reduced]);

  return ref;
}
