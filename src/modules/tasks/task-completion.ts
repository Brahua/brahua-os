// Completing a task from another module's screen (`today`'s "Tareas", D2), client-safe: the same
// calls, queue keys and notices as `TaskList`, so the recurrence rule (T3) and what the notices
// say live only in `tasks`. The caller keeps its own optimistic list and focus.
import { fail, type ActionResult } from "@/lib/action-result";
import type { Toaster } from "@/lib/toast/use-toaster";
import type { Enqueue, Queued } from "@/lib/use-save-queue";
import {
  completeTaskWithNext,
  reopenTaskWithSpawn,
  type CompletedTask,
  type ReopenedTask,
} from "./recurrence-actions";
import { completedNotice, reopenedNotice } from "./recurrence-notices";
import { TASKS_COPY } from "./tasks-copy";

/** The host screen's services (`ScreenServices` of `core`). */
export type TaskCompletionServices = {
  enqueue: Enqueue;
  toaster: Toaster;
  announce: (message: string) => void;
};

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
   * Completes the task through the screen's queue (`task-done:<id>`, like the task lists): a
   * recurring task creates its next occurrence and "Tarea hecha" says when it is due. The
   * notice's "Deshacer" (and ⌘Z / Ctrl+Z, from the notice viewport) calls `onUndo`. Await it
   * inside the transition that removed the row.
   */
  complete: (task: CompletableTask, onUndo: () => void) => Promise<CompletionOutcome>;
  /**
   * "Deshacer" of a completion: pending again, and its untouched next occurrence removed (or
   * kept if it was edited, and said so). Await it inside the transition that put the row back.
   */
  reopen: (task: CompletableTask) => Promise<CompletionOutcome>;
};

function reasonOf(result: { ok: false; error: string; fieldErrors?: Record<string, string[]> }) {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

/** The call's result, a thrown call as a network failure, or "stale" if a newer one took over. */
function settled<T>(queued: Queued<ActionResult<T>>): ActionResult<T> | "stale" {
  if (queued.kind === "skipped" || queued.superseded) return "stale";
  return queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
}

/** Completion with the host screen's queue, notices and announcer. */
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
        notSaved(TASKS_COPY.notCompleted, reasonOf(result));
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
        notSaved(TASKS_COPY.notUndone, reasonOf(result));
        return "failed";
      }
      announce(reopenedNotice(task, result.data.spawn));
      return "saved";
    },
  };
}
