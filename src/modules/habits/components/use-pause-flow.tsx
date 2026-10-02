"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type TransitionStartFunction } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import type { HabitItem, HabitPauseSummary } from "../habit-input";
import type { HabitListChange } from "../habit-list-optimistic";
import { HABITS_COPY } from "../habits-copy";
import { pauseHabit, removeHabitPause, resumeHabit } from "../pause-actions";
import { PAUSE_COPY } from "../pause-copy";
import type { PauseHabitInput } from "../pause-input";
import { failureReason, useHabitsScreen } from "./habits-screen";

// The pause sheet's code loads on demand (from the options sheet's "Pausar").
const loadPause = () => import("./pause-sheet");
const PauseSheet = dynamic(() => loadPause().then((loaded) => loaded.PauseSheet));
/** Loads the pause sheet's code ahead (when "Pausar" is pointed at or focused). */
export const preloadPause = () => void loadPause();

type PauseFlowArgs = {
  /** Applies an optimistic change (inside `startSaving`). */
  apply: (change: HabitListChange) => void;
  startSaving: TransitionStartFunction;
  /** Says a save failed ("Sin guardar"), with the server's reason. */
  notSaved: (text: string, reason: string) => void;
  /**
   * The pause sheet closed after pausing `habit` (the page no longer `aria-hidden`): the screen
   * moves focus (its pad may have left the grid for "En pausa").
   */
  onPausedClosed: (habit: HabitItem, pausedToday: boolean) => void;
  /** Where focus goes if a sheet's return target left meanwhile (never <body>). */
  focusFallback: () => void;
};

type Pausing = { habit: HabitItem; key: number };

/**
 * H4's pauses on a habits screen: "Pausar" (a sheet with the dates and a reason; not optimistic,
 * an overlap is only known on the server), "Reanudar" (optimistic, with "Deshacer" that pauses
 * again until the old end) and the "Deshacer" of pausing (removes the pause). Everything goes
 * through the screen's queue with the key `habit-pause:<id>`.
 */
export function usePauseFlow({
  apply,
  startSaving,
  notSaved,
  onPausedClosed,
  focusFallback,
}: PauseFlowArgs) {
  const { today, enqueue, toaster, announce } = useHabitsScreen();
  const { push } = toaster;

  /** Optimistic: the habit's shown pause (null: none, it goes back to the grids). */
  const pausePatch = (habit: HabitItem, pause: HabitPauseSummary | null): HabitListChange => ({
    type: "update",
    id: habit.id,
    patch: { pause },
  });

  /**
   * Pauses again (the "Deshacer" of "Reanudar"), optimistically: from `input.startDate` to its
   * end, with its reason. Only announced.
   */
  function pauseAgain(habit: HabitItem, input: PauseHabitInput) {
    startSaving(async () => {
      apply(
        pausePatch(habit, {
          id: `pending-${habit.id}`,
          startDate: input.startDate,
          endDate: input.endDate,
          reason: input.reason,
        }),
      );
      const queued = await enqueue(`habit-pause:${habit.id}`, () => pauseHabit(input));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<unknown> =
        queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (result.ok) announce(PAUSE_COPY.pauseBack(habit.name));
      else notSaved(HABITS_COPY.notUndone, failureReason(result));
    });
  }

  /** The "Deshacer" of "Pausar": removes that pause (whatever its dates). Only announced. */
  function removePause(habit: HabitItem, pause: HabitPauseSummary) {
    startSaving(async () => {
      apply(pausePatch(habit, null));
      const queued = await enqueue(`habit-pause:${habit.id}`, () =>
        removeHabitPause({ id: habit.id, pauseId: pause.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (result.ok) announce(PAUSE_COPY.pauseRemoved(habit.name));
      else notSaved(HABITS_COPY.notUndone, failureReason(result));
    });
  }

  /**
   * "Reanudar" (or "Cancelar la pausa" for one that hasn't started): optimistic, the habit goes
   * back to the grids at once. The notice offers "Deshacer" (pauses again until the old end).
   */
  function resume(habit: HabitItem) {
    const pause = habit.pause;
    if (!pause) return;
    startSaving(async () => {
      apply(pausePatch(habit, null));
      const queued = await enqueue(`habit-pause:${habit.id}`, () =>
        resumeHabit({ id: habit.id, pauseId: pause.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(PAUSE_COPY.notResumed, failureReason(result));
        return;
      }
      const { outcome } = result.data;
      // Ended yesterday: "Deshacer" pauses from today to the old end. Removed (it hadn't
      // started): the same dates again.
      const again: PauseHabitInput = {
        id: habit.id,
        startDate: outcome === "ended" ? today : pause.startDate,
        endDate: pause.endDate,
        reason: pause.reason,
      };
      push({
        title: PAUSE_COPY.resumedTitle,
        text:
          pause.startDate > today
            ? PAUSE_COPY.pauseCancelled(habit.name)
            : PAUSE_COPY.resumed(habit.name),
        action:
          outcome === "none"
            ? undefined
            : { label: HABITS_COPY.undo, run: () => pauseAgain(habit, again) },
      });
    });
  }

  // ── The pause sheet ──
  const [pausing, setPausing] = useState<Pausing | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const pauseReturn = useRef<HTMLElement | null>(null);
  const paused = useRef<{ habit: HabitItem; pausedToday: boolean } | null>(null);

  /** Opens "Pausar" for `habit`; focus goes back to `returnTo` if it closes without pausing. */
  function openPause(habit: HabitItem, returnTo: HTMLElement | null) {
    pauseReturn.current = returnTo;
    paused.current = null;
    setPausing((previous) => ({ habit, key: (previous?.key ?? 0) + 1 }));
    setPauseOpen(true);
  }

  function onPaused(habit: HabitItem, pause: HabitPauseSummary, input: PauseHabitInput) {
    const pausedToday = input.startDate <= today && today <= input.endDate;
    paused.current = { habit, pausedToday };
    setPauseOpen(false);
    push({
      title: PAUSE_COPY.pausedTitle,
      text: pausedToday
        ? PAUSE_COPY.paused(habit.name, input.endDate)
        : PAUSE_COPY.pausedAhead(habit.name, input.startDate, input.endDate),
      action: { label: HABITS_COPY.undo, run: () => removePause(habit, pause) },
    });
  }

  const pauseSheet = pausing ? (
    <PauseSheet
      key={pausing.key}
      open={pauseOpen}
      onOpenChange={setPauseOpen}
      habit={pausing.habit}
      today={today}
      returnFocusRef={pauseReturn}
      onPaused={onPaused}
      onClosed={() => {
        const done = paused.current;
        paused.current = null;
        if (done) {
          onPausedClosed(done.habit, done.pausedToday);
          return;
        }
        if (document.activeElement === document.body || document.activeElement === null) {
          focusFallback();
        }
      }}
    />
  ) : null;

  return { openPause, resume, pauseSheet };
}
