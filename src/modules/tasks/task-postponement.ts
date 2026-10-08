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
  /**
   * `evening-close-ritual`: every task through its own queue key and its own server call (the
   * idempotency and the undo are per task), but ONE notice: "3 tareas pasan a mañana" with a
   * "Deshacer" that calls `onUndo` with the ones that really moved. `saved` if at least one
   * moved, `unchanged` if none changed (all were already there), `failed` if none could be saved
   * ("Sin guardar" says how many failed; the caller's optimistic rows roll back with the
   * transition and the server's read decides which ones stay).
   */
  postponeMany: (
    tasks: readonly PostponableTask[],
    to: PostponeTarget,
    onUndo: (moved: PostponedItem[]) => void,
  ) => Promise<PostponeOutcome>;
  /** "Deshacer" of the batch: one call per task, one announcement. */
  undoMany: (items: readonly PostponedItem[]) => Promise<PostponeOutcome>;
};

/** A task that was moved, with what the server answered (the day it had, for "Deshacer"). */
export type PostponedItem = { task: PostponableTask; moved: PostponedTask };

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

    async postponeMany(tasks, to, onUndo) {
      const results = await Promise.all(
        tasks.map(async (task) => ({
          task,
          result: settled<PostponedTask>(
            await enqueue(`task-postpone:${task.id}`, () => postponeTask({ id: task.id, to })),
          ),
        })),
      );
      const moved: PostponedItem[] = [];
      let failed = 0;
      let stale = 0;
      let reason = "";
      for (const { task, result } of results) {
        if (result === "stale") stale += 1;
        else if (!result.ok) {
          failed += 1;
          reason ||= failureReason(result);
        } else if (result.data.changed) moved.push({ task, moved: result.data });
      }
      if (moved.length === 0) {
        if (failed > 0) notSaved(POSTPONE_COPY.notMovedMany(failed), reason);
        return failed > 0 ? "failed" : stale > 0 ? "stale" : "unchanged";
      }
      const now = new Date();
      const day = moved[0].moved.dueDate;
      const said =
        moved.length === 1
          ? POSTPONE_COPY.moved(moved[0].task.title, day, ownerDateKey(now), tomorrowOf(now))
          : POSTPONE_COPY.movedMany(moved.length, day, ownerDateKey(now), tomorrowOf(now));
      // The notices are shown one at a time and a "Deshacer" notice is replaced by the next one:
      // what failed goes in the same notice, so the undo of what moved is never lost.
      toaster.push({
        title: moved.length === 1 ? POSTPONE_COPY.movedTitle : POSTPONE_COPY.movedManyTitle,
        text: failed > 0 ? `${said} ${POSTPONE_COPY.notMovedSome(failed)}` : said,
        action: { label: TASKS_COPY.undo, run: () => onUndo(moved) },
      });
      return "saved";
    },

    async undoMany(items) {
      const results = await Promise.all(
        items.map(async ({ task, moved }) => ({
          moved,
          result: settled<RestoredDueDate>(
            await enqueue(`task-postpone:${task.id}`, () =>
              restoreTaskDueDate({
                id: task.id,
                dueDate: moved.previousDueDate,
                expected: moved.dueDate,
              }),
            ),
          ),
        })),
      );
      let restored = 0;
      let failed = 0;
      let changedMeanwhile = 0;
      for (const { moved, result } of results) {
        if (result === "stale") continue;
        if (!result.ok) failed += 1;
        else if (!result.data.restored && result.data.dueDate !== moved.previousDueDate) {
          changedMeanwhile += 1;
        } else restored += 1;
      }
      if (failed + changedMeanwhile > 0) {
        notSaved(
          POSTPONE_COPY.notUndone,
          changedMeanwhile > 0 ? POSTPONE_COPY.dateChanged : "",
        );
      }
      if (restored === 0) return failed + changedMeanwhile > 0 ? "failed" : "stale";
      announce(POSTPONE_COPY.undoneMany(restored));
      return "saved";
    },
  };
}
