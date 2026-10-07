"use client";

import { CalendarArrowDown } from "lucide-react";
import { LazyMotion, useMotionValue, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/design-system";
import { POSTPONE_COPY } from "../postpone-copy";
import { LEAVE_FADE_SECONDS, SWIPE_THRESHOLD, swipeDecision } from "../swipe";
import { RowLeave } from "./postpone-keys";

// The features load on the first swipeable row (a dynamic import): the rows render at once
// without them, and Bandeja, Hechas and the project pages never fetch the library.
const loadFeatures = () => import("./motion-features").then((loaded) => loaded.domMax);

/** If the fade's end never arrives (features still loading, a hidden tab), leave anyway after this (ms). */
const LEAVE_FALLBACK_MS = 400;

type SwipeRowProps = {
  taskId: string;
  /**
   * The drag is on: the list decides once (below 1024 px, no reduced motion, and this task's
   * "Mañana" does something). Without it the row only fades out when a key leaves it.
   */
  swipe: boolean;
  /** What a swipe past the threshold does ("Mañana"). */
  onSwipe: () => void;
  children: React.ReactNode;
};

/**
 * The `<li>` of a task row that can be postponed. When `swipe` is on, a horizontal drag to the
 * left (`swipeDecision`) does what "Mañana" does; a vertical drag is the page's scroll
 * (`drag="x"` leaves `touch-action: pan-y` to the browser). The keys stay the accessible way (and
 * the one the E2E suite drives). Only `transform` and `opacity` move.
 *
 * Whoever leaves (the key, or the swipe) fades the row first (90 ms, also with reduced motion:
 * it is opacity only), and only then runs what was asked, so the removal has something to show.
 */
export function SwipeRow({ taskId, swipe, onSwipe, children }: SwipeRowProps) {
  const x = useMotionValue(0);
  const hint = useTransform(x, [-SWIPE_THRESHOLD, -24, 0], [1, 0.4, 0]);
  const [leaving, setLeaving] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const lastDragEnd = useRef(Number.NEGATIVE_INFINITY);

  const leave = useCallback((run: () => void) => {
    if (pending.current) return;
    pending.current = run;
    setLeaving(true);
  }, []);

  const finishLeaving = useCallback(() => {
    const run = pending.current;
    if (!run) return;
    pending.current = null;
    run();
    // If the list kept the row (it refused, or only updated it), it comes back in place.
    setLeaving(false);
    x.set(0);
  }, [x]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(finishLeaving, LEAVE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, finishLeaving]);

  return (
    <li
      data-task-row={taskId}
      data-leaving={leaving ? "" : undefined}
      className="relative min-w-0 overflow-hidden bg-surface"
    >
      <LazyMotion features={loadFeatures}>
        {swipe ? (
          <m.div
            aria-hidden
            style={{ opacity: hint }}
            className="bo-text-body-sm pointer-events-none absolute inset-0 flex items-center justify-end gap-2 bg-surface-pressed pr-5 text-text"
            data-swipe-hint=""
          >
            <Icon icon={CalendarArrowDown} size="md" />
            {POSTPONE_COPY.swipeHint}
          </m.div>
        ) : null}
        <m.div
          style={{ x }}
          drag={swipe ? "x" : false}
          dragDirectionLock
          dragConstraints={{ left: -SWIPE_THRESHOLD * 1.5, right: 0 }}
          dragElastic={{ left: 0.1, right: 0 }}
          dragMomentum={false}
          dragSnapToOrigin
          onDragEnd={(_, info) => {
            lastDragEnd.current = performance.now();
            if (swipeDecision(info.offset.x, info.velocity.x)) leave(onSwipe);
          }}
          // A drag that ends on a link or a key must not also click it.
          onClickCapture={(event) => {
            if (performance.now() - lastDragEnd.current < 300) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          initial={false}
          animate={{ opacity: leaving ? 0 : 1 }}
          transition={{ duration: LEAVE_FADE_SECONDS, ease: "easeOut" }}
          onAnimationComplete={() => {
            if (leaving) finishLeaving();
          }}
          className="flex min-w-0 flex-wrap items-start gap-1 bg-surface pr-2 sm:flex-nowrap"
        >
          <RowLeave value={leave}>{children}</RowLeave>
        </m.div>
      </LazyMotion>
    </li>
  );
}
