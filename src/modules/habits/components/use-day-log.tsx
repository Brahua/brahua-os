"use client";

import type { TransitionStartFunction } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { celebrateStreak } from "@/lib/celebrate";
import type { HabitItem } from "../habit-input";
import { applyHabitListChange, donePatch, type HabitListChange } from "../habit-list-optimistic";
import { todayCount } from "../habit-status";
import { HABITS_COPY } from "../habits-copy";
import { setHabitDone } from "../log-actions";
import { FREQUENCY_COPY } from "../frequency-copy";
import { MEASURE_COPY } from "../measure-copy";
import { STREAK_COPY } from "../pause-copy";
import { streakMilestone } from "../streak-notice";
import { weekProgress } from "../week-progress";
import { failureReason, useHabitsScreen } from "./habits-screen";

type DayLogArgs = {
  /** The screen's optimistic list (as shown now). */
  view: HabitItem[];
  /** Applies an optimistic change (inside `startSaving`). */
  apply: (change: HabitListChange) => void;
  startSaving: TransitionStartFunction;
  /** Says a save failed ("Sin guardar"), with the server's reason. */
  notSaved: (text: string, reason: string) => void;
};

/**
 * Logging today with one tap on a yes/no pad (also a habit to avoid's relapse), on any habits
 * screen: "Hoy" of /habits (inside `HabitsScreen`) or another module's screen (H6: `today`, inside
 * `HabitsScreenWithin`, with the host's queue, notices and announcer). Optimistic, through the
 * screen's save queue (`habit-day:<id>:<day>`), with "Deshacer" (⌘Z) in the notice; a refusal or
 * a network failure rolls back with "Sin guardar". Returns the pad's `onToggle`.
 */
export function useDayLog({ view, apply, startSaving, notSaved }: DayLogArgs) {
  const { today, enqueue, toaster, announce, isCurrentDay } = useHabitsScreen();
  const { push } = toaster;

  function toggle(habit: HabitItem, done: boolean) {
    // A short buzz where the browser offers it (Android); iOS Safari has no Vibration API.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
    logDay(habit, done, true);
  }

  /**
   * Marks or unmarks today. `undoable`: a tap (the notice offers "Deshacer"); otherwise it is the
   * undo itself, which is only announced.
   */
  function logDay(habit: HabitItem, done: boolean, undoable: boolean) {
    // The page was read for another Lima day (left open past midnight): reload it instead of
    // logging the day before by mistake (isCurrentDay refreshes and says so).
    if (!isCurrentDay()) return;
    const change = { type: "update", id: habit.id, patch: donePatch(done) } as const;
    // H4: a tap that reaches 7, 30, 90 or 365 (days or weeks) is celebrated in the notice.
    const milestone = undoable ? streakMilestone(habit, { ...habit, ...change.patch }) : null;
    // The count as it will be after this tap ("2 de 3 hoy"), said in the notice too.
    const after = todayCount(applyHabitListChange(view, change), today);
    // A weekly habit says its week too ("2 de 3 hoy. 2 de 3 esta semana"): its pad's line is
    // only in its description, which isn't read again after the tap.
    const week = weekProgress(habit, done);
    const progress = week
      ? `${HABITS_COPY.todayCount(after.done, after.total)}. ${FREQUENCY_COPY.weekProgress(week.done, week.quota)}`
      : HABITS_COPY.todayCount(after.done, after.total);
    startSaving(async () => {
      apply(change);
      const queued = await enqueue(`habit-day:${habit.id}:${today}`, () =>
        setHabitDone({ id: habit.id, day: today, done }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<HabitItem> =
        queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(undoable ? HABITS_COPY.notLogged : HABITS_COPY.notUndone, failureReason(result));
        return;
      }
      // A habit to avoid: `done` is "a relapse is logged" (H3), said without guilt.
      const avoid = habit.kind === "avoid";
      if (undoable && milestone) {
        push({
          title: STREAK_COPY.milestoneTitle(milestone.count, milestone.unit),
          text: STREAK_COPY.milestone(habit.name, milestone.count, progress),
          action: { label: HABITS_COPY.undo, run: () => logDay(habit, !done, false) },
        });
        // 30 days or more: confetti in the area's color too (never under reduced motion).
        void celebrateStreak(milestone.count, habit.area?.color);
      } else if (undoable) {
        push({
          title: avoid
            ? done
              ? MEASURE_COPY.slipTitle
              : MEASURE_COPY.unslipTitle
            : done
              ? HABITS_COPY.doneTitle
              : HABITS_COPY.undoneTitle,
          text: avoid
            ? done
              ? MEASURE_COPY.slip(habit.name, progress)
              : MEASURE_COPY.unslip(habit.name, progress)
            : done
              ? HABITS_COPY.done(habit.name, progress)
              : HABITS_COPY.undone(habit.name, progress),
          action: { label: HABITS_COPY.undo, run: () => logDay(habit, !done, false) },
        });
      } else if (avoid) {
        announce(done ? MEASURE_COPY.slipAgain(habit.name) : MEASURE_COPY.unslipAgain(habit.name));
      } else {
        announce(done ? HABITS_COPY.doneAgain(habit.name) : HABITS_COPY.undoneAgain(habit.name));
      }
    });
  }

  return { toggle };
}
