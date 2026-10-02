"use server";

// Server Actions of recurrence (T3). Their own file so T2 and T4 never touch the same lines
// (HANDOFF "Revisión 1"). Each one goes through ownerAction(): owner first, Zod, ActionResult.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { tasks } from "./db/schema";
import { recurrenceColumns, type SpawnInbox, type SpawnUndo } from "./recurrence-db";
import { setTaskRecurrenceInputSchema } from "./recurrence-input";
import { TASKS_PATH, taskPath } from "./routes";
import { TASK_ERRORS, taskIdInputSchema, type TaskItem } from "./task-input";
import {
  completeTaskById,
  reopenTaskById,
  restoreTaskById,
  selectTaskById,
  visibleTask,
} from "./tasks";

function revalidateTask(id: string) {
  revalidatePath(TASKS_PATH);
  revalidatePath(taskPath(id));
}

const setRecurrence = ownerAction(
  setTaskRecurrenceInputSchema,
  async ({ id, recurrence }) => {
    const db = getDb();
    const updated = await db
      .update(tasks)
      .set(recurrenceColumns(recurrence))
      .where(and(eq(tasks.id, id), visibleTask))
      .returning({ id: tasks.id });
    revalidateTask(id);
    const task = updated.length > 0 ? await selectTaskById(db, id) : null;
    return task ? ok(task) : fail(TASK_ERRORS.notFound);
  },
  { name: "setTaskRecurrence" },
);

/**
 * Sets a task's recurrence rule, or removes it (`recurrence: null`). The rule applies the next
 * time the task is completed; a done task keeps it for when it is reopened.
 */
export async function setTaskRecurrence(input: unknown): Promise<ActionResult<TaskItem>> {
  return setRecurrence(input);
}

/**
 * A completion, with the occurrence it created (a recurring task) or null, and why that one went
 * to the inbox (its place was closed), or null.
 */
export type CompletedTask = { task: TaskItem; next: TaskItem | null; nextInbox: SpawnInbox | null };

const complete = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    const result = await completeTaskById(getDb(), id);
    revalidateTask(id);
    if (!result) return fail(TASK_ERRORS.notFound);
    // A double tap (`changed: false`) creates nothing and reports nothing new.
    return ok(
      result.changed
        ? { task: result.task, next: result.next, nextInbox: result.nextInbox }
        : { task: result.task, next: null, nextInbox: null },
    );
  },
  { name: "completeTaskWithNext" },
);

/**
 * `completeTask` for the lists: the same completion (idempotent by `done_at`, the next
 * occurrence in the same transaction), plus the occurrence it created, so the notice can say
 * when the next one is due.
 */
export async function completeTaskWithNext(input: unknown): Promise<ActionResult<CompletedTask>> {
  return complete(input);
}

/** An undo of a completion, with what happened to the occurrence it had created. */
export type ReopenedTask = { task: TaskItem; spawn: SpawnUndo | null };

const reopen = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    const result = await reopenTaskById(getDb(), id);
    revalidateTask(id);
    return result ? ok({ task: result.task, spawn: result.spawn }) : fail(TASK_ERRORS.notFound);
  },
  { name: "reopenTaskWithSpawn" },
);

/**
 * `reopenTask` for the lists ("Deshacer"): the same undo, plus whether the next occurrence was
 * removed (untouched) or kept (already edited), so the notice can say which.
 */
export async function reopenTaskWithSpawn(input: unknown): Promise<ActionResult<ReopenedTask>> {
  return reopen(input);
}

/** An undone delete, and whether it came back as a task of its own (see `restoreTaskById`). */
export type RestoredTask = { task: TaskItem; detached: boolean };

const restore = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    const result = await restoreTaskById(getDb(), id);
    revalidateTask(id);
    return result ? ok(result) : fail(TASK_ERRORS.notFound);
  },
  { name: "restoreTaskWithSpawn" },
);

/**
 * `restoreTask` for the lists ("Deshacer" of a delete): the same undo, plus whether a deleted
 * occurrence came back detached (its recurrence already has another next one), so it can be said.
 */
export async function restoreTaskWithSpawn(input: unknown): Promise<ActionResult<RestoredTask>> {
  return restore(input);
}
