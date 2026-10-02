"use server";

// Server Actions of T5 (tasks in projects): the next action. Through ownerAction(): owner check,
// Zod, then an ActionResult. In their own file (not actions.ts), like T2–T4.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { NEXT_ACTION_ERRORS, setNextActionInputSchema } from "./next-action-input";
import { PROJECT_TASKS_COPY } from "./project-tasks-copy";
import type { SpawnUndo } from "./recurrence-db";
import { setNextActionById, undoCompletionById, type UndoCompletionMark } from "./project-tasks";
import { revalidateTaskScreens } from "./revalidate";
import { TASK_ERRORS, taskIdInputSchema, type TaskItem } from "./task-input";

const setNext = ownerAction(
  setNextActionInputSchema,
  async ({ id, next }) => {
    const result = await setNextActionById(getDb(), id, next);
    // Either way: a refusal means the page was out of date (a closed project, a done task).
    revalidateTaskScreens(id);
    if (result === null) return fail(TASK_ERRORS.notFound);
    return typeof result === "string" ? fail(NEXT_ACTION_ERRORS[result]) : ok(result);
  },
  { name: "setNextAction" },
);

/**
 * Marks (`next: true`) or unmarks a task as its project's next action. Marking takes the mark
 * from any other task of the project (one per project). Only a pending task of an open project.
 */
export async function setNextAction(input: unknown): Promise<ActionResult<TaskItem>> {
  return setNext(input);
}

const undoComplete = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    // One transaction: reopen, and mark it again only if nobody took the mark meanwhile.
    const result = await undoCompletionById(getDb(), id);
    revalidateTaskScreens(id);
    if (!result) return fail(TASK_ERRORS.notFound);
    const { task, mark, spawn } = result;
    const refused = mark !== "restored" && mark !== "taken" && mark !== "unchanged";
    return ok({
      task,
      mark,
      spawn,
      restored: mark === "restored",
      warning: refused ? PROJECT_TASKS_COPY.notRemarked(NEXT_ACTION_ERRORS[mark]) : null,
    });
  },
  { name: "undoCompleteNextAction" },
);

/** What the undo of completing a next action returns. */
export type UndoCompletionResult = {
  task: TaskItem;
  mark: UndoCompletionMark;
  /** T3: what happened to the occurrence its completion spawned (like `reopenTaskWithSpawn`). */
  spawn: SpawnUndo | null;
  /** It is the next action again. */
  restored: boolean;
  /**
   * Why it couldn't be marked again (the task is pending again anyway), for a "Sin guardar"
   * notice; null when nothing went wrong (a mark another task took meanwhile stays there).
   */
  warning: string | null;
};

/**
 * "Deshacer" of completing a project's next action (its card and its "Tareas" section): the task
 * is pending again and, unless another task got the mark meanwhile, the next action again.
 */
export async function undoCompleteNextAction(
  input: unknown,
): Promise<ActionResult<UndoCompletionResult>> {
  return undoComplete(input);
}
