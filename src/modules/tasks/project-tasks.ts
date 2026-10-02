// Tasks in projects (T5 of `tasks`, SPEC-tasks "En proyectos"), server only: the "Tareas"
// section of a project's page, the next action (one per project), the progress source and the
// next actions of the list's cards. These functions take the database and trust their input:
// callers check the owner and validate first.
//
// Locks: marking the next action takes the project's task lock first,
// `(TASKS_ADVISORY_SPACE, hashtext(projectId))` (lockProjectTasks in tasks.ts: the two-key
// convention of `projects`, per project; the same lock every write that puts a task in a project
// or takes it out of one takes). Rule: always the first lock of the transaction, never after a
// row lock. Only then the task FOR UPDATE and the project FOR SHARE (a close or a delete at the
// same time waits, so a closed project never gets a next action). With the lock, "clear the
// project's mark, then mark this one" never runs twice at once for a project, so the unique
// partial index `tasks_next_action_unique` is never hit; it stays the last guard.
import "server-only";
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "@/lib/db";
import { OWNER_TIME_ZONE } from "@/lib/time";
import { projects } from "@/modules/projects/db/schema";
import { CLOSED_STATUSES } from "@/modules/projects/project-close";
import type { NextAction } from "@/modules/projects/project-extensions";
import type { ProgressCounts } from "@/modules/projects/progress-source";
import { tasks } from "./db/schema";
import { removeUntouchedSpawn, type SpawnUndo } from "./recurrence-db";
import type { TaskItem } from "./task-input";
import { lockProjectTasks, selectItems, selectTaskById, toItem, visibleTask } from "./tasks";
import { compareByDoneDesc, compareByDue, doneSinceDay } from "./task-views";

/** A project's tasks for its "Tareas" section. */
export type ProjectTasks = {
  /** Pending, in the order of "Todas" (due date, priority, creation); grouped by the client. */
  pending: TaskItem[];
  /** Done in the last 30 days (Lima days, like "Hechas"), the most recent first. */
  done: TaskItem[];
};

/**
 * The "Tareas" section of a project: its pending tasks and the recently done ones, in ONE query
 * (visible tasks only: a deleted project's page doesn't exist anyway).
 */
export async function selectProjectTasks(
  db: Database,
  projectId: string,
  now: Date,
): Promise<ProjectTasks> {
  const rows = await selectItems(
    db,
    and(
      visibleTask,
      eq(tasks.projectId, projectId),
      or(
        isNull(tasks.doneAt),
        gte(sql`(${tasks.doneAt} at time zone ${OWNER_TIME_ZONE})::date`, doneSinceDay(now)),
      ),
    ),
  );
  const items = rows.map((row) => toItem(row));
  return {
    pending: items.filter((task) => task.doneAt === null).sort(compareByDue),
    done: items.filter((task) => task.doneAt !== null).sort(compareByDoneDesc),
  };
}

/** Why marking the next action was refused. */
export type NextActionFailure = "withoutProject" | "done" | "projectClosed" | "moved";

/**
 * Marks (`next: true`) or unmarks a task as its project's next action. Marking clears the mark
 * of any other task of the project (one per project, SPEC-tasks). Only a pending task of an open
 * project (not deleted, done or canceled) can be marked; unmarking always works. Returns the
 * task, why it was refused (writing nothing), or null when it doesn't exist or isn't visible.
 */
export async function setNextActionById(
  db: Database,
  id: string,
  next: boolean,
): Promise<TaskItem | NextActionFailure | null> {
  return db.transaction(async (tx) => {
    // Unlocked read, only to know which project's lock to take first (see the header).
    const [before] = await tx
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, id), visibleTask));
    if (!before) return null;
    if (before.projectId === null) return next ? "withoutProject" : selectTaskById(tx, id);
    await lockProjectTasks(tx, [before.projectId]);
    const [current] = await tx
      .select({ projectId: tasks.projectId, doneAt: tasks.doneAt })
      .from(tasks)
      .where(and(eq(tasks.id, id), visibleTask))
      .for("update");
    if (!current) return null;
    // Moved to another project between the read and the row lock: that project's lock isn't
    // held (and can't be taken now, after a row lock). The client asks again.
    if (current.projectId !== before.projectId) return "moved";
    if (!next) {
      await tx.update(tasks).set({ isNextAction: false }).where(eq(tasks.id, id));
      return selectTaskById(tx, id);
    }
    if (current.doneAt !== null) return "done";
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, before.projectId),
          isNull(projects.deletedAt),
          notInArray(projects.status, [...CLOSED_STATUSES]),
        ),
      )
      .for("share");
    if (!project) return "projectClosed";
    await tx
      .update(tasks)
      .set({ isNextAction: false })
      .where(
        and(
          eq(tasks.projectId, before.projectId),
          eq(tasks.isNextAction, true),
          isNull(tasks.deletedAt),
          ne(tasks.id, id),
        ),
      );
    await tx.update(tasks).set({ isNextAction: true }).where(eq(tasks.id, id));
    return selectTaskById(tx, id);
  });
}

/**
 * What the undo of completing a next action did with the mark: `restored` (it is the next action
 * again), `taken` (another task of the project got the mark meanwhile: it keeps it), `unchanged`
 * (the task wasn't done: a second undo changes nothing), or why it couldn't be marked again (the
 * task is pending again anyway).
 */
export type UndoCompletionMark = "restored" | "taken" | "unchanged" | NextActionFailure;

/**
 * "Deshacer" of completing a project's next action, atomically (one transaction, so the page
 * refreshes once): the project's task lock first (see the header), the task FOR UPDATE, reopen
 * it, and mark it again ONLY if the reopen changed something AND the project (open, FOR SHARE)
 * has no other next action. A mark given to another task meanwhile is never stolen. Null when
 * the task doesn't exist or isn't visible.
 */
export async function undoCompletionById(
  db: Database,
  id: string,
): Promise<{ task: TaskItem; mark: UndoCompletionMark; spawn: SpawnUndo | null } | null> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, id), visibleTask));
    if (!before) return null;
    await lockProjectTasks(tx, [before.projectId]);
    const [current] = await tx
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, id), visibleTask))
      .for("update");
    if (!current) return null;
    const reopened = await tx
      .update(tasks)
      .set({ doneAt: null })
      .where(and(eq(tasks.id, id), isNotNull(tasks.doneAt)))
      .returning({ id: tasks.id });
    // T3: the occurrence its completion spawned goes too (if untouched), like reopenTaskById.
    const spawn = reopened.length > 0 ? await removeUntouchedSpawn(tx, id) : null;
    const mark = await remark(tx, id, reopened.length > 0, current.projectId, before.projectId);
    const task = await selectTaskById(tx, id);
    return task ? { task, mark, spawn } : null;
  });
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function remark(
  tx: Tx,
  id: string,
  changed: boolean,
  projectId: string | null,
  lockedProjectId: string | null,
): Promise<UndoCompletionMark> {
  if (!changed) return "unchanged";
  if (projectId === null) return "withoutProject";
  // Moved between the unlocked read and the row lock: that project's lock isn't held.
  if (projectId !== lockedProjectId) return "moved";
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
        notInArray(projects.status, [...CLOSED_STATUSES]),
      ),
    )
    .for("share");
  if (!project) return "projectClosed";
  const [other] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.isNextAction, true),
        isNull(tasks.deletedAt),
        ne(tasks.id, id),
      ),
    );
  if (other) return "taken";
  await tx.update(tasks).set({ isNextAction: true }).where(eq(tasks.id, id));
  return "restored";
}

/**
 * The next action of each of `projectIds` that has one, in ONE query (the list's cards): pending,
 * visible, and of a project that is still open (a closed project's mark stays, but its card in
 * "Historial" doesn't show it; reopening the project brings it back).
 */
export async function selectNextActions(
  db: Database,
  projectIds: readonly string[],
): Promise<Map<string, NextAction>> {
  const result = new Map<string, NextAction>();
  if (projectIds.length === 0) return result;
  const rows = await db
    .select({ projectId: tasks.projectId, id: tasks.id, title: tasks.title })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        inArray(tasks.projectId, [...projectIds]),
        eq(tasks.isNextAction, true),
        isNull(tasks.doneAt),
        visibleTask,
        notInArray(projects.status, [...CLOSED_STATUSES]),
      ),
    );
  for (const row of rows) {
    if (row.projectId) result.set(row.projectId, { id: row.id, title: row.title });
  }
  return result;
}

/**
 * Done and total tasks of each of `projectIds` (the progress source): every visible task counts
 * (done = with `done_at`), in ONE grouped query. A deleted task, or the tasks of a deleted
 * project, never count. Projects without tasks are missing from the map.
 */
export async function countProjectTasks(
  db: Database,
  projectIds: readonly string[],
): Promise<Map<string, ProgressCounts>> {
  const result = new Map<string, ProgressCounts>();
  if (projectIds.length === 0) return result;
  const rows = await db
    .select({ projectId: tasks.projectId, total: count(), done: count(tasks.doneAt) })
    .from(tasks)
    .where(and(inArray(tasks.projectId, [...projectIds]), visibleTask))
    .groupBy(tasks.projectId);
  for (const row of rows) {
    if (row.projectId) result.set(row.projectId, { done: row.done, total: row.total });
  }
  return result;
}
