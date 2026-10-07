"use client";

import { useRef, type TransitionStartFunction } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import type { HabitItem, HabitPauseSummary } from "../habit-input";
import type { HabitListChange } from "../habit-list-optimistic";
import { HABITS_COPY } from "../habits-copy";
import { pendingSkip } from "../skip-day";
import { SKIP_COPY } from "../skip-copy";
import type { SkippedHabit } from "../skip";
import { skipHabitToday, undoSkipHabit } from "../skip-actions";
import { failureReason, useHabitsScreen } from "./habits-screen";
import type { TrackFocus } from "./use-pause-flow";

type SkipTodayArgs = {
  /** The screen's optimistic list (as shown now): the habit's place, for its undo. */
  view: readonly HabitItem[];
  /** Applies an optimistic change (inside `startSaving`). */
  apply: (change: HabitListChange) => void;
  startSaving: TransitionStartFunction;
  /** Says a save failed ("Sin guardar"), with the server's reason. */
  notSaved: (text: string, reason: string) => void;
  /**
   * Called right before a habit leaves its pad (or comes back): notes whether focus was on it (or
   * lost) and the returned function moves focus to where the habit is now (never <body>).
   */
  trackFocus: TrackFocus;
};

/**
 * "Saltar hoy" (polish) on any habits screen (`/habits` "Hoy" and the board of `/`): rests the
 * habit for today with a one-day pause "Descanso". Optimistic (the habit shows its pause at
 * once and leaves the pads), through the screen's queue with the key `habit-pause:<id>` (one
 * pause change at a time per habit, like H4's), and the LCD notice offers "Deshacer", which
 * removes THAT pause by its id (the server leaves it alone if it is no longer a one-day rest).
 * A refusal or a network failure rolls back with "Sin guardar".
 */
export function useSkipToday({ view, apply, startSaving, notSaved, trackFocus }: SkipTodayArgs) {
  const { today, enqueue, toaster, announce, isCurrentDay } = useHabitsScreen();
  const { push } = toaster;
  // Habits with a skip or its undo on its way: a second activation does nothing.
  const busy = useRef(new Set<string>());

  const withPause = (habit: HabitItem, pause: HabitPauseSummary | null): HabitItem => ({
    ...habit,
    pause,
  });

  /** The "Deshacer": the habit comes back at once; only announced. */
  function undo(habit: HabitItem, pause: HabitPauseSummary, index: number) {
    if (busy.current.has(habit.id)) return;
    busy.current.add(habit.id);
    startSaving(async () => {
      try {
        const follow = trackFocus(withPause(habit, pause));
        // "restore": the board's read comes back without a habit that rests, so it may not be in
        // the list anymore (it goes back at its old place); on Hábitos it just replaces it.
        apply({ type: "restore", habit: withPause(habit, null), index });
        follow(withPause(habit, null));
        const queued = await enqueue(`habit-pause:${habit.id}`, () =>
          undoSkipHabit({ id: habit.id, pauseId: pause.id }),
        );
        if (queued.kind === "skipped" || queued.superseded) return;
        const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
        if (!result.ok) {
          trackFocus(withPause(habit, null))(withPause(habit, pause));
          notSaved(HABITS_COPY.notUndone, failureReason(result));
          return;
        }
        // The pause is no longer a one-day rest: it stays as it is (the page refreshes with it).
        announce(result.data.removed ? SKIP_COPY.back(habit.name) : SKIP_COPY.kept(habit.name));
      } finally {
        busy.current.delete(habit.id);
      }
    });
  }

  /** "Saltar hoy": `habit` rests today. */
  function skip(habit: HabitItem) {
    // The page was read for another Lima day (left open past midnight): reload it instead.
    if (!isCurrentDay()) return;
    if (busy.current.has(habit.id)) return;
    busy.current.add(habit.id);
    const shown = pendingSkip(habit.id, today);
    const index = view.findIndex((item) => item.id === habit.id);
    startSaving(async () => {
      try {
        apply({ type: "update", id: habit.id, patch: { pause: shown } });
        const queued = await enqueue(`habit-pause:${habit.id}`, () =>
          skipHabitToday({ id: habit.id }),
        );
        if (queued.kind === "skipped" || queued.superseded) return;
        const result: ActionResult<SkippedHabit> =
          queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
        if (!result.ok) {
          trackFocus(withPause(habit, shown))(withPause(habit, habit.pause));
          notSaved(SKIP_COPY.notSkipped, failureReason(result));
          return;
        }
        const { pause, changed } = result.data;
        push({
          title: SKIP_COPY.noticeTitle,
          text: SKIP_COPY.rests(habit.name),
          // Already resting (another tab, a longer pause): nothing was created, nothing to undo.
          action: changed
            ? { label: HABITS_COPY.undo, run: () => undo(habit, pause, index) }
            : undefined,
        });
      } finally {
        busy.current.delete(habit.id);
      }
    });
  }

  return { skip };
}
