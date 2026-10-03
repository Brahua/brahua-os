"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { fail } from "@/lib/action-result";
import type { HabitItem } from "../habit-input";
import { applyHabitListChange } from "../habit-list-optimistic";
import { HABITS_COPY } from "../habits-copy";
import { archiveHabit, unarchiveHabit } from "../organize-actions";
import { ORGANIZE_COPY } from "../organize-copy";
import { ArchivedHabits, reactivateSelector } from "./habit-sections";
import { failureReason, useHabitsScreen } from "./habits-screen";

type ArchivedHabitsSectionProps = {
  /** The archived habits (not deleted), in their old order. */
  habits: HabitItem[];
  /** Id of the page's heading (tabIndex -1): focus lands there when the list is left empty. */
  headingId: string;
};

/**
 * H5: "Archivados (N)" at the bottom of "Semana" (H2 had it on "Hoy"), with "Reactivar": the
 * habit leaves the list at once (optimistic, through the screen's queue with the key
 * `habit-archive:<id>`) and goes back to the end of "Hoy"; the notice's "Deshacer" archives it
 * again. Focus goes to the next "Reactivar", else to the page's heading. One at a time per habit
 * (`aria-disabled` + a guard).
 */
export function ArchivedHabitsSection({ habits, headingId }: ArchivedHabitsSectionProps) {
  const { enqueue, toaster, announce } = useHabitsScreen();
  const { push } = toaster;
  const [view, apply] = useOptimistic(habits, applyHabitListChange);
  const [saving, startSaving] = useTransition();
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

  // After a refused "Reactivar", its row comes back (the rollback): focus goes back to its key
  // once it is there, if it is still where the reactivation left it (the next key or the heading).
  const refocus = useRef<{ id: string; from: Element | null } | null>(null);
  useEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    const key = document.querySelector<HTMLElement>(reactivateSelector(pending.id));
    if (!key) return;
    refocus.current = null;
    const active = document.activeElement;
    if (active === pending.from || active === document.body || active === null) key.focus();
  });

  function notSaved(text: string, reason: string) {
    push({ title: HABITS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  function reactivate(habit: HabitItem) {
    if (!hold(habit.id)) return;
    const index = view.findIndex((item) => item.id === habit.id);
    const neighbor = view[index + 1] ?? view[index - 1];
    startSaving(async () => {
      try {
        apply({ type: "remove", id: habit.id });
        const queued = await enqueue(`habit-archive:${habit.id}`, () =>
          unarchiveHabit({ id: habit.id, position: "end" }),
        );
        if (queued.kind === "skipped" || queued.superseded) return;
        const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
        if (!result.ok) {
          refocus.current = { id: habit.id, from: document.activeElement };
          notSaved(ORGANIZE_COPY.notReactivated, failureReason(result));
          return;
        }
        push({
          title: ORGANIZE_COPY.reactivatedTitle,
          text: ORGANIZE_COPY.reactivated(habit.name),
          action: { label: HABITS_COPY.undo, run: () => archiveAgain(habit, index) },
        });
      } finally {
        release(habit.id);
      }
    });
    // Focus never stays on a key that leaves: the next archived one, else the heading.
    const next = neighbor
      ? document.querySelector<HTMLElement>(reactivateSelector(neighbor.id))
      : null;
    (next ?? document.getElementById(headingId))?.focus();
  }

  /** The undo of "Reactivar": back into "Archivados" at once, in its place. Announced. */
  function archiveAgain(habit: HabitItem, index: number) {
    startSaving(async () => {
      apply({ type: "restore", habit, index });
      const queued = await enqueue(`habit-archive:${habit.id}`, () =>
        archiveHabit({ id: habit.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (result.ok) announce(ORGANIZE_COPY.archivedAgain(habit.name));
      else notSaved(HABITS_COPY.notUndone, failureReason(result));
    });
  }

  return (
    <div data-saving={saving ? "" : undefined}>
      <ArchivedHabits
        habits={view}
        onReactivate={reactivate}
        isBusy={(habit) => busy.has(habit.id)}
      />
    </div>
  );
}
