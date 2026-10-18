"use server";

// Server Actions of recurrence (T3). Their own file so T2 and T4 never touch the same lines
// (HANDOFF "Revisión 1"). Each one goes through ownerAction(): owner first, Zod, ActionResult.
import { and, eq, isNull } from "drizzle-orm";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb, type Database } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { projectMilestones } from "@/modules/projects/db/schema";
import { milestoneState, phaseChange } from "@/modules/projects/milestone-state";
import { tasks } from "./db/schema";
import { countMilestoneTasks } from "./project-tasks";
import { recurrenceColumns, type SpawnInbox, type SpawnUndo } from "./recurrence-db";
import { setTaskRecurrenceInputSchema } from "./recurrence-input";
import { revalidateTaskScreens } from "./revalidate";
import { TASK_ERRORS, taskIdInputSchema, type TaskItem } from "./task-input";
import {
  completeTaskById,
  reopenTaskById,
  restoreTaskById,
  selectTaskById,
  visibleTask,
} from "./tasks";

/** The list, the task's page and (T5) the project screens: its section, progress and card. */
function revalidateTask(id: string) {
  revalidateTaskScreens(id);
}

const setRecurrence = ownerAction(
  setTaskRecurrenceInputSchema,
  async ({ id, recurrence }) => {
    const db = getDb();
    // A task in a milestone can't repeat (hitos-agrupan-tareas): the next occurrence would reopen
    // its phase. A rule is only refused when it would be set, never when it is removed.
    if (recurrence) {
      const [placed] = await db
        .select({ milestoneId: tasks.milestoneId })
        .from(tasks)
        .where(and(eq(tasks.id, id), visibleTask));
      if (placed?.milestoneId) {
        return {
          ok: false,
          error: INVALID_FIELDS_MESSAGE,
          fieldErrors: { recurrence: [TASK_ERRORS.milestoneRecurring] },
        };
      }
    }
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
export type CompletedTask = {
  task: TaskItem;
  next: TaskItem | null;
  nextInbox: SpawnInbox | null;
  /** The milestone this completion closed (its last open task): the notice says «Hito completo». */
  phase?: { id: string; title: string } | null;
};

/**
 * The live milestone a pending task is in and its state now, or null (no milestone, done already,
 * or a deleted milestone). Read before completing, to tell whether the completion closes it.
 */
async function phaseBefore(db: Database, id: string) {
  const [row] = await db
    .select({ milestoneId: tasks.milestoneId, title: projectMilestones.title })
    .from(tasks)
    .innerJoin(projectMilestones, eq(projectMilestones.id, tasks.milestoneId))
    .where(and(eq(tasks.id, id), visibleTask, isNull(tasks.doneAt), isNull(projectMilestones.deletedAt)));
  if (!row?.milestoneId) return null;
  const counts = await countMilestoneTasks(db, [row.milestoneId]);
  return { id: row.milestoneId, title: row.title, before: milestoneState(counts.get(row.milestoneId)) };
}

const complete = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    const db = getDb();
    const placed = await phaseBefore(db, id);
    const result = await completeTaskById(db, id);
    revalidateTask(id);
    if (!result) return fail(TASK_ERRORS.notFound);
    // A double tap (`changed: false`) creates nothing and reports nothing new.
    if (!result.changed) return ok({ task: result.task, next: null, nextInbox: null, phase: null });
    // The milestone's state is derived: if this was its last open task it is complete now.
    let phase: CompletedTask["phase"] = null;
    if (placed) {
      const after = milestoneState((await countMilestoneTasks(db, [placed.id])).get(placed.id));
      if (phaseChange(placed.before, after) === "closed") phase = { id: placed.id, title: placed.title };
    }
    return ok({ task: result.task, next: result.next, nextInbox: result.nextInbox, phase });
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
