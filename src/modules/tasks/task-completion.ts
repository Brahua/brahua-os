// Completing a task and undoing it, client-safe: the calls, queue keys and notices of the task
// lists, in one place. Used by `TaskList` and by other modules' screens (`today`'s "Tareas", D2),
// so the recurrence rule (T3) and what the notices say live only in `tasks`. The caller keeps its
// own optimistic list and focus.
import type { ScreenServices } from "@/modules/core/components/screen-services";
import {
  completeTaskWithNext,
  reopenTaskWithSpawn,
  type CompletedTask,
  type ReopenedTask,
} from "./recurrence-actions";
import { completedNotice, reopenedNotice } from "./recurrence-notices";
import { failureReason, settled } from "./task-failure";
import { TASKS_COPY } from "./tasks-copy";

/** The screen's queue, notices and announcer (the host's, or a tasks screen's own). */
export type TaskCompletionServices = Pick<ScreenServices, "enqueue" | "toaster" | "announce">;

/** What a completion needs to know about the task. */
export type CompletableTask = { id: string; title: string };

/**
 * How a call ended: `saved`, `failed` (a refusal or the network: "Sin guardar" was shown and the
 * caller's optimistic change rolls back when its transition ends) or `stale` (a newer call for
 * the same task took over: it decides what stays, nothing is said).
 */
export type CompletionOutcome = "saved" | "failed" | "stale";

export type TaskCompletion = {
  /**
   * Completes the task through the screen's queue (`task-done:<id>`): a recurring task creates
   * its next occurrence and "Tarea hecha" says when it is due. The notice's "Deshacer" (and
   * ⌘Z / Ctrl+Z, from the notice viewport) calls `onUndo`. Await it inside the transition that
   * removed (or updated) the row.
   */
  complete: (task: CompletableTask, onUndo: () => void) => Promise<CompletionOutcome>;
  /**
   * "Deshacer" of a completion: pending again, and its untouched next occurrence removed (or
   * kept if it was edited, and said so). Await it inside the transition that put the row back.
   */
  reopen: (task: CompletableTask) => Promise<CompletionOutcome>;
};

/** Completion with the screen's queue, notices and announcer. */
export function taskCompletion({
  enqueue,
  toaster,
  announce,
}: TaskCompletionServices): TaskCompletion {
  function notSaved(text: string, reason: string) {
    toaster.push({ title: TASKS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  return {
    async complete(task, onUndo) {
      const result = settled<CompletedTask>(
        await enqueue(`task-done:${task.id}`, () => completeTaskWithNext({ id: task.id })),
      );
      if (result === "stale") return "stale";
      if (!result.ok) {
        notSaved(TASKS_COPY.notCompleted, failureReason(result));
        return "failed";
      }
      toaster.push({
        title: TASKS_COPY.completedTitle,
        text: completedNotice(task, result.data.next, result.data.nextInbox),
        action: { label: TASKS_COPY.undo, run: onUndo },
      });
      return "saved";
    },

    async reopen(task) {
      const result = settled<ReopenedTask>(
        await enqueue(`task-done:${task.id}`, () => reopenTaskWithSpawn({ id: task.id })),
      );
      if (result === "stale") return "stale";
      if (!result.ok) {
        notSaved(TASKS_COPY.notUndone, failureReason(result));
        return "failed";
      }
      announce(reopenedNotice(task, result.data.spawn));
      return "saved";
    },
  };
}
