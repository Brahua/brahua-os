// Postponing a task and undoing it, client-safe: the calls, queue keys and notices of "Mañana" /
// "Otro día…" in one place (the way `taskCompletion` is for completing). Used by the task lists
// and by other modules' screens (`today`'s "Tareas"), so what the notices say lives only in
// `tasks`. The caller keeps its own optimistic list and focus.
import type { ScreenServices } from "@/modules/core/components/screen-services";
import { ownerDateKey } from "@/lib/time";
import { POSTPONE_COPY } from "./postpone-copy";
import { postponeTask, restoreTaskDueDate } from "./postpone-actions";
import { failureReason, settled } from "./task-failure";
import { tomorrowOf, type PostponedTask, type PostponeTarget, type RestoredDueDate } from "./task-postpone";
import { TASKS_COPY } from "./tasks-copy";

/** The screen's queue, notices and announcer (the host's, or a tasks screen's own). */
export type TaskPostponementServices = Pick<ScreenServices, "enqueue" | "toaster" | "announce">;

/** What a postponement needs to know about the task. */
export type PostponableTask = { id: string; title: string };

/**
 * How a call ended: `saved`; `unchanged` (it already was there: a double tap, nothing to say or
 * undo); `failed` ("Sin guardar" was shown and the caller's optimistic change rolls back when its
 * transition ends) or `stale` (a newer call for the same task took over: it decides what stays).
 */
export type PostponeOutcome = "saved" | "unchanged" | "failed" | "stale";

export type TaskPostponement = {
  /**
   * Moves the task through the screen's queue (`task-postpone:<id>`) and says so in a notice with
   * "Deshacer" (and ⌘Z / Ctrl+Z from the notice viewport), which calls `onUndo` with what the
   * server answered (the day it had). Await it inside the transition that removed the row.
   */
  postpone: (
    task: PostponableTask,
    to: PostponeTarget,
    onUndo: (moved: PostponedTask) => void,
  ) => Promise<PostponeOutcome>;
  /**
   * "Deshacer": puts back exactly the day the task had, unless it was edited meanwhile (then
   * nothing is overwritten and it says so). Await it inside the transition that put the row back.
   */
  undo: (task: PostponableTask, moved: PostponedTask) => Promise<PostponeOutcome>;
};

/** Postponing with the screen's queue, notices and announcer. */
export function taskPostponement({
  enqueue,
  toaster,
  announce,
}: TaskPostponementServices): TaskPostponement {
  function notSaved(text: string, reason: string) {
    toaster.push({ title: TASKS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  return {
    async postpone(task, to, onUndo) {
      const result = settled<PostponedTask>(
        await enqueue(`task-postpone:${task.id}`, () => postponeTask({ id: task.id, to })),
      );
      if (result === "stale") return "stale";
      if (!result.ok) {
        notSaved(POSTPONE_COPY.notMoved, failureReason(result));
        return "failed";
      }
      const moved = result.data;
      if (!moved.changed) return "unchanged";
      const now = new Date();
      toaster.push({
        title: POSTPONE_COPY.movedTitle,
        text: POSTPONE_COPY.moved(task.title, moved.dueDate, ownerDateKey(now), tomorrowOf(now)),
        action: { label: TASKS_COPY.undo, run: () => onUndo(moved) },
      });
      return "saved";
    },

    async undo(task, moved) {
      const result = settled<RestoredDueDate>(
        await enqueue(`task-postpone:${task.id}`, () =>
          restoreTaskDueDate({
            id: task.id,
            dueDate: moved.previousDueDate,
            expected: moved.dueDate,
          }),
        ),
      );
      if (result === "stale") return "stale";
      if (!result.ok) {
        notSaved(POSTPONE_COPY.notUndone, failureReason(result));
        return "failed";
      }
      if (!result.data.restored && result.data.dueDate !== moved.previousDueDate) {
        // Edited meanwhile: the newer day stays (the caller's optimistic row rolls back).
        notSaved(POSTPONE_COPY.notUndone, POSTPONE_COPY.dateChanged);
        return "failed";
      }
      announce(POSTPONE_COPY.undone(task.title));
      return "saved";
    },
  };
}
