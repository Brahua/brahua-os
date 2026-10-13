"use client";

import { useLayoutEffect, useRef, type TransitionStartFunction } from "react";
import { fail } from "@/lib/action-result";
import { moveGoalToNext, undoMoveOfGoal } from "../actions";
import type { GoalItem, GoalMove } from "../goal-input";
import type { GoalListChange } from "../goal-list-optimistic";
import { movedPatch, movePeriodOf } from "../goal-move";
import { GOALS_COPY } from "../goals-copy";
import { periodLabel, periodOf, type GoalPeriod } from "../pace";
import { failureReason, useGoalsScreen } from "./goals-screen";

type MoveGoalArgs = {
  /** The screen's optimistic list (as shown now). */
  view: GoalItem[];
  apply: (change: GoalListChange) => void;
  startSaving: TransitionStartFunction;
  notSaved: (text: string, reason: string) => void;
  /**
   * Called as the move starts: the key that was pressed may leave (the goal changes section or
   * can't move again), so the screen puts focus where it still exists.
   */
  restoreFocus: (id: string) => void;
};

/**
 * "Pasar al próximo periodo" on a goals screen: the same goal moves to the next period
 * (optimistic, through the screen's queue) and the notice's "Deshacer" sends it back to the exact
 * period and place it left, only if it still has the period the move gave it. A refusal rolls back
 * with "Sin guardar". One move per goal at a time (a second activation does nothing).
 */
export function useMoveGoal({ view, apply, startSaving, notSaved, restoreFocus }: MoveGoalArgs) {
  const { today, enqueue, toaster, announce, isCurrentDay } = useGoalsScreen();
  const { push } = toaster;
  const moving = useRef(new Set<string>());
  const shown = useRef(view);
  useLayoutEffect(() => {
    shown.current = view;
  }, [view]);

  function move(goal: GoalItem) {
    if (moving.current.has(goal.id)) return;
    if (!isCurrentDay()) return;
    const current = shown.current.find((item) => item.id === goal.id) ?? goal;
    const next = movePeriodOf(current, today);
    if (!next) return;
    moving.current.add(goal.id);
    const before = periodOf(current);
    restoreFocus(goal.id);
    startSaving(async () => {
      apply({ type: "update", id: goal.id, patch: movedPatch(next) });
      const queued = await enqueue(`goal-move:${goal.id}`, () =>
        moveGoalToNext({ id: goal.id, year: current.year, quarter: current.quarter }),
      );
      moving.current.delete(goal.id);
      if (queued.kind === "skipped" || queued.superseded) return;
      const result =
        queued.kind === "done" ? queued.value : fail<GoalMove>(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(GOALS_COPY.notMoved, failureReason(result));
        return;
      }
      const { moved, goal: saved, from } = result.data;
      if (!moved) {
        // Someone moved it first: say so, and show what is stored (the page revalidates).
        push({ title: GOALS_COPY.movedTitle, text: GOALS_COPY.moveAlready(saved.title) });
        return;
      }
      push({
        title: GOALS_COPY.movedTitle,
        text: GOALS_COPY.movedTo(saved.title, periodLabel(periodOf(saved))),
        action: { label: GOALS_COPY.undo, run: () => undo(saved, from, before) },
      });
    });
  }

  function undo(saved: GoalItem, from: GoalMove["from"], before: GoalPeriod) {
    if (!isCurrentDay()) return;
    if (moving.current.has(saved.id)) return;
    moving.current.add(saved.id);
    restoreFocus(saved.id);
    startSaving(async () => {
      apply({
        type: "update",
        id: saved.id,
        patch: { year: from.year, quarter: from.quarter, periodKind: before.kind },
      });
      const queued = await enqueue(`goal-move:${saved.id}`, () =>
        undoMoveOfGoal({
          id: saved.id,
          from,
          applied: { year: saved.year, quarter: saved.quarter },
        }),
      );
      moving.current.delete(saved.id);
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(GOALS_COPY.notMovedBack, failureReason(result));
        return;
      }
      if (result.data.restored) {
        announce(GOALS_COPY.movedBack(saved.title, periodLabel(periodOf(result.data.goal))));
      } else {
        push({ title: GOALS_COPY.movedTitle, text: GOALS_COPY.moveUndoStale(saved.title) });
      }
    });
  }

  return { move };
}
