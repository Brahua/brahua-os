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

/**
 * Called right before a habit moves between a grid and "En pausa" (an optimistic change, a
 * "Deshacer" or a rollback): it notes whether focus was on the habit (or lost), and the returned
 * function moves focus to where the habit is now (never <body>).
 */
export type TrackFocus = (habit: HabitItem) => (moved: HabitItem) => void;

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
  trackFocus: TrackFocus;
};

type Pausing = { habit: HabitItem; key: number };

/** A pause shown optimistically, not saved yet (its id isn't a real one). */
const PENDING_PREFIX = "pending-";

/**
 * H4's pauses on a habits screen: "Pausar" (a sheet with the dates and a reason; not optimistic,
 * an overlap is only known on the server, so the sheet calls the action itself), "Reanudar"
 * (optimistic, with "Deshacer" that pauses again until the old end) and the "Deshacer" of
 * pausing (removes the pause). "Reanudar" and both "Deshacer" go through the screen's queue
 * with the key `habit-pause:<id>`, one at a time per habit (`isBusy`).
 */
export function usePauseFlow({
  apply,
  startSaving,
  notSaved,
  onPausedClosed,
  focusFallback,
  trackFocus,
}: PauseFlowArgs) {
  const { today, enqueue, toaster, announce, isCurrentDay } = useHabitsScreen();
  const { push } = toaster;
  // Habits with a pause change on its way: a second "Reanudar" waits (aria-disabled + guard).
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const busyNow = useRef(new Set<string>());

  function hold(id: string): boolean {
    if (busyNow.current.has(id)) return false;
    busyNow.current.add(id);
    setBusy(new Set(busyNow.current));
    return true;
  }

  function release(id: string) {
    busyNow.current.delete(id);
    setBusy(new Set(busyNow.current));
  }

  /** Whether a pause change of the habit is on its way (its "Reanudar" is aria-disabled). */
  const isBusy = (habit: HabitItem) =>
    busy.has(habit.id) || (habit.pause?.id.startsWith(PENDING_PREFIX) ?? false);

  /** The habit with another shown pause (null: none, it goes back to the grids). */
  const withPause = (habit: HabitItem, pause: HabitPauseSummary | null): HabitItem => ({
    ...habit,
    pause,
  });

  /** Applies the habit's new pause at once and moves focus with it if it was there. */
  function move(habit: HabitItem, pause: HabitPauseSummary | null) {
    const follow = trackFocus(habit);
    apply({ type: "update", id: habit.id, patch: { pause } });
    follow(withPause(habit, pause));
  }

  /** A failure: the optimistic change rolls back, focus follows the habit back. */
  function rolledBack(shown: HabitItem, back: HabitItem, text: string, reason: string) {
    trackFocus(shown)(back);
    notSaved(text, reason);
  }

  /**
   * Pauses again (the "Deshacer" of "Reanudar"), optimistically: from `input.startDate` to its
   * end, with its reason. Only announced.
   */
  function pauseAgain(habit: HabitItem, input: PauseHabitInput) {
    if (!hold(habit.id)) return;
    const shown: HabitPauseSummary = {
      id: `${PENDING_PREFIX}${habit.id}`,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
    };
    startSaving(async () => {
      try {
        move(withPause(habit, null), shown);
        const queued = await enqueue(`habit-pause:${habit.id}`, () => pauseHabit(input));
        if (queued.kind === "skipped" || queued.superseded) return;
        const result: ActionResult<unknown> =
          queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
        if (result.ok) announce(PAUSE_COPY.pauseBack(habit.name));
        else {
          rolledBack(
            withPause(habit, shown),
            withPause(habit, null),
            HABITS_COPY.notUndone,
            failureReason(result),
          );
        }
      } finally {
        release(habit.id);
      }
    });
  }

  /** The "Deshacer" of "Pausar": removes that pause (whatever its dates). Only announced. */
  function removePause(habit: HabitItem, pause: HabitPauseSummary) {
    if (!hold(habit.id)) return;
    startSaving(async () => {
      try {
        move(withPause(habit, pause), null);
        const queued = await enqueue(`habit-pause:${habit.id}`, () =>
          removeHabitPause({ id: habit.id, pauseId: pause.id }),
        );
        if (queued.kind === "skipped" || queued.superseded) return;
        const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
        if (result.ok) announce(PAUSE_COPY.pauseRemoved(habit.name));
        else {
          rolledBack(
            withPause(habit, null),
            withPause(habit, pause),
            HABITS_COPY.notUndone,
            failureReason(result),
          );
        }
      } finally {
        release(habit.id);
      }
    });
  }

  /**
   * "Reanudar" (or "Cancelar la pausa" for one that hasn't started): optimistic, the habit goes
   * back to the grids at once. The notice offers "Deshacer" (pauses again until the old end).
   * Once per habit until the server answers (a second activation does nothing).
   */
  function resume(habit: HabitItem) {
    const pause = habit.pause;
    if (!pause || isBusy(habit) || !hold(habit.id)) return;
    startSaving(async () => {
      try {
        apply({ type: "update", id: habit.id, patch: { pause: null } });
        const queued = await enqueue(`habit-pause:${habit.id}`, () =>
          resumeHabit({ id: habit.id, pauseId: pause.id }),
        );
        if (queued.kind === "skipped" || queued.superseded) return;
        const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
        if (!result.ok) {
          rolledBack(withPause(habit, null), habit, PAUSE_COPY.notResumed, failureReason(result));
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
      } finally {
        release(habit.id);
      }
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
      // A page left open past midnight reloads instead (its "today" is yesterday's).
      canSave={isCurrentDay}
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

  return { openPause, resume, isBusy, pauseSheet };
}
