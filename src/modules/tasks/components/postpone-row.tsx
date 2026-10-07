"use client";

import { CalendarArrowDown, CalendarDays } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { createContext, use, useCallback, useRef, useState } from "react";
import { Icon, Key } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { POSTPONE_COPY } from "../postpone-copy";

// "Mañana" and "Otro día…" on a task's row (polish → postpone-one-tap): the keys, and the swipe
// that does the same thing on touch screens. The lists decide what happens (`taskPostponement`,
// their own optimistic list and focus); this file only draws and reports.

/** How far (px) a row is dragged to the left before releasing it postpones. */
export const SWIPE_THRESHOLD = 96;
/** A quick flick counts too (px/s), once it has moved a little. */
export const SWIPE_VELOCITY = 600;
const SWIPE_MIN_FLICK = 48;
/** How long the row takes to fade out before it leaves (s): inside the 100 ms budget. */
export const LEAVE_FADE_SECONDS = 0.09;

/** What a row's postpone keys need from its list. */
export type RowPostpone = {
  /** "Mañana": the list removes the row and saves. */
  onTomorrow: (task: { id: string; title: string }) => void;
  /** "Otro día…": the list opens its sheet; `trigger` gets focus back on close. */
  onPick: (task: { id: string; title: string }, trigger: HTMLElement) => void;
  /** Hides "Mañana" (the task already is due tomorrow). */
  hideTomorrow?: boolean;
  /** A save of this task is in flight: the keys stay focusable (`aria-disabled`) and do nothing. */
  busy?: boolean;
};

/** Lets a key start the row's fade-out; the row then calls what the key asked for. */
const RowLeave = createContext<((run: () => void) => void) | null>(null);

type SwipeRowProps = {
  taskId: string;
  /** Touch swipe on (it is only active below 1024 px and without reduced motion). */
  swipe: boolean;
  /** What a swipe past the threshold does ("Mañana"). */
  onSwipe: () => void;
  children: React.ReactNode;
};

/**
 * The `<li>` of a task row that can be postponed. Below 1024 px a horizontal drag to the left
 * (past `SWIPE_THRESHOLD`, or a quick flick) does what "Mañana" does; a vertical drag is the
 * page's scroll (`drag="x"` leaves `touch-action: pan-y` to the browser). The keys stay the
 * accessible way (and the one the E2E suite drives). Only `transform` and `opacity` move; with
 * `prefers-reduced-motion: reduce` there is no drag at all and the row only fades.
 *
 * Whoever leaves (the key, or the swipe) fades the row first (90 ms), and only then runs what was
 * asked, so the row's removal has something to show; the fade is the same with reduced motion.
 */
export function SwipeRow({ taskId, swipe, onSwipe, children }: SwipeRowProps) {
  const reduced = useReducedMotion();
  const isDesktop = useIsDesktop();
  const draggable = swipe && !isDesktop && !reduced;
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

  function finishLeaving() {
    const run = pending.current;
    if (!run) return;
    pending.current = null;
    run();
    // If the list kept the row (it refused), it comes back.
    setLeaving(false);
    animate(x, 0, { duration: 0 });
  }

  return (
    <li
      data-task-row={taskId}
      data-leaving={leaving ? "" : undefined}
      className="relative min-w-0 overflow-hidden bg-surface"
    >
      {draggable ? (
        <motion.div
          aria-hidden
          style={{ opacity: hint }}
          className="bo-text-body-sm pointer-events-none absolute inset-0 flex items-center justify-end gap-2 bg-surface-pressed pr-5 text-text"
          data-swipe-hint=""
        >
          <Icon icon={CalendarArrowDown} size="md" />
          {POSTPONE_COPY.swipeHint}
        </motion.div>
      ) : null}
      <motion.div
        style={{ x }}
        drag={draggable ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: -SWIPE_THRESHOLD * 1.5, right: 0 }}
        dragElastic={{ left: 0.1, right: 0 }}
        dragMomentum={false}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          lastDragEnd.current = performance.now();
          const far = info.offset.x <= -SWIPE_THRESHOLD;
          const flick = info.velocity.x <= -SWIPE_VELOCITY && info.offset.x <= -SWIPE_MIN_FLICK;
          if (far || flick) leave(onSwipe);
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
      </motion.div>
    </li>
  );
}

type PostponeKeysProps = RowPostpone & { task: { id: string; title: string } };

/**
 * "Mañana" (icon and text, 48 px) and "Otro día…": secondary keys (ghost, never the signal one:
 * completing is the row's primary action). Below 640 px they sit under the title; wider, at the
 * row's end.
 */
export function PostponeKeys({
  task,
  onTomorrow,
  onPick,
  hideTomorrow = false,
  busy = false,
}: PostponeKeysProps) {
  const leave = use(RowLeave);
  return (
    <div className="flex shrink-0 basis-full items-center gap-1 pl-12 sm:basis-auto sm:self-center sm:pl-0">
      {hideTomorrow ? null : (
        <Key
          variant="ghost"
          icon={CalendarArrowDown}
          aria-label={POSTPONE_COPY.tomorrowName(task.title)}
          aria-disabled={busy || undefined}
          data-task-focus={`postpone:${task.id}`}
          onClick={() => {
            if (busy) return;
            if (leave) leave(() => onTomorrow(task));
            else onTomorrow(task);
          }}
        >
          {POSTPONE_COPY.tomorrow}
        </Key>
      )}
      <Key
        variant="ghost"
        icon={CalendarDays}
        aria-label={POSTPONE_COPY.pickName(task.title)}
        aria-haspopup="dialog"
        aria-disabled={busy || undefined}
        data-task-focus={`pick:${task.id}`}
        onClick={(event) => {
          if (!busy) onPick(task, event.currentTarget);
        }}
      >
        {POSTPONE_COPY.pick}
      </Key>
    </div>
  );
}
