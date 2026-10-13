"use client";

import dynamic from "next/dynamic";
import { useLayoutEffect, useRef, useState, type TransitionStartFunction } from "react";
import { fail } from "@/lib/action-result";
import { CONFETTI_FROM, celebrateStreak } from "@/lib/celebrate";
import { addEntryToGoal, undoEntryOfGoal } from "../actions";
import type { GoalItem } from "../goal-input";
import { applyGoalListChange, entryPatch, type GoalListChange } from "../goal-list-optimistic";
import { unitOf } from "../goal-text";
import { GOALS_COPY } from "../goals-copy";
import { failureReason, useGoalsScreen } from "./goals-screen";

// The "Sumar…" sheet's code loads on demand.
const loadAdd = () => import("./add-entry-sheet");
const AddEntrySheet = dynamic(() => loadAdd().then((loaded) => loaded.AddEntrySheet));
/** Loads the sheet's code ahead (when "Sumar…" is pointed at or focused). */
export const preloadAddEntry = () => void loadAdd();

type GoalEntriesArgs = {
  /** The screen's optimistic list (as shown now). */
  view: GoalItem[];
  /** Applies an optimistic change (inside `startSaving`). */
  apply: (change: GoalListChange) => void;
  startSaving: TransitionStartFunction;
  /** Says a save failed ("Sin guardar"), with the server's reason. */
  notSaved: (text: string, reason: string) => void;
  /** Where focus goes if the sheet's return target left meanwhile (never <body>). */
  focusFallback: () => void;
};

type Adding = { goal: GoalItem; key: number };

/** "5 de 12 libros" for the goal as saved. */
function countOf(goal: GoalItem): string {
  return GOALS_COPY.count(Math.max(goal.sum, 0), goal.target, unitOf(goal));
}

/**
 * Entries of a manual goal on a goals screen: "+1" and "Sumar…" add an entry (optimistic, through
 * the screen's queue, with "Deshacer" in the notice, which undoes that exact entry by its id). A
 * refusal or a network failure rolls back with "Sin guardar". Returns `add` (a tap's delta),
 * `openAdd` for the "Sumar…" key and the sheet to render.
 */
export function useGoalEntries({
  view,
  apply,
  startSaving,
  notSaved,
  focusFallback,
}: GoalEntriesArgs) {
  const { enqueue, toaster, announce, isCurrentDay } = useGoalsScreen();
  const { push } = toaster;
  // The list as shown now: a notice's "Deshacer" runs long after the render that made it, and
  // must start from what is on screen then (other taps may have happened meanwhile).
  const shownList = useRef(view);
  useLayoutEffect(() => {
    shownList.current = view;
  }, [view]);

  function shownGoal(goal: GoalItem): GoalItem {
    return shownList.current.find((item) => item.id === goal.id) ?? goal;
  }

  /** Adds `delta` (a tap's +1, the sheet's amount, or minus an undone one). */
  function add(goal: GoalItem, delta: number) {
    // A page read for another Lima day reloads instead of adding to the day before.
    if (!isCurrentDay()) return;
    const change = {
      type: "update",
      id: goal.id,
      patch: entryPatch(shownGoal(goal), delta, new Date()),
    } as const;
    // Two taps in the same frame (before a render) each start from the other's result.
    shownList.current = applyGoalListChange(shownList.current, change);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
    startSaving(async () => {
      apply(change);
      const queued = await enqueue(null, () => addEntryToGoal({ goalId: goal.id, delta }));
      if (queued.kind === "skipped") return;
      const result = queued.kind === "done" ? queued.value : fail(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(GOALS_COPY.notAdded, failureReason(result));
        return;
      }
      const { goal: saved, entryId, achievedNow } = result.data;
      push({
        title: achievedNow ? GOALS_COPY.reachedTitle : GOALS_COPY.addedTitle,
        text: achievedNow
          ? GOALS_COPY.reached(saved.title, countOf(saved))
          : GOALS_COPY.added(saved.title, delta, countOf(saved)),
        action: { label: GOALS_COPY.undo, run: () => undo(goal, entryId, delta) },
      });
      // The discreet flourish of the app (never under reduced motion).
      if (achievedNow) void celebrateStreak(CONFETTI_FROM, saved.area?.color);
    });
  }

  /** The "Deshacer" of an entry: that exact entry, by its id. Only announced when it works. */
  function undo(goal: GoalItem, entryId: string, delta: number) {
    if (!isCurrentDay()) return;
    const change = {
      type: "update",
      id: goal.id,
      patch: entryPatch(shownGoal(goal), -delta, new Date()),
    } as const;
    shownList.current = applyGoalListChange(shownList.current, change);
    startSaving(async () => {
      apply(change);
      const queued = await enqueue(null, () => undoEntryOfGoal({ goalId: goal.id, entryId }));
      if (queued.kind === "skipped") return;
      const result = queued.kind === "done" ? queued.value : fail(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(GOALS_COPY.notUndone, failureReason(result));
        return;
      }
      announce(GOALS_COPY.addedAgain(result.data.title, countOf(result.data)));
    });
  }

  // ── "Sumar…" sheet ──
  const [adding, setAdding] = useState<Adding | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addReturn = useRef<HTMLElement | null>(null);

  /** Opens the sheet for `goal` (as shown now); focus goes back to `returnTo` on close. */
  function openAdd(goal: GoalItem, returnTo: HTMLElement | null) {
    addReturn.current = returnTo;
    const current = shownGoal(goal);
    setAdding((previous) => ({ goal: current, key: (previous?.key ?? 0) + 1 }));
    setAddOpen(true);
  }

  const addSheet = adding ? (
    <AddEntrySheet
      key={adding.key}
      open={addOpen}
      onOpenChange={setAddOpen}
      goal={adding.goal}
      returnFocusRef={addReturn}
      onClosed={() => {
        if (document.activeElement === document.body || document.activeElement === null) {
          focusFallback();
        }
      }}
      onSave={(goal, delta) => {
        setAddOpen(false);
        add(goal, delta);
      }}
    />
  ) : null;

  return { add, openAdd, addSheet };
}
