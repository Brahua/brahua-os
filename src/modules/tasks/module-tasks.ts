// What `tasks` offers a module that keeps its own screen over tasks marked with a tag (H1 of
// `household`, SPEC-household "Contratos"), server-only. The module never touches `tasks`' tables:
// it lists the pending tasks that carry a tag and creates, completes, reopens, deletes and
// restores them through these functions, which wrap what `tasks` already does (`insertTask`,
// `completeTaskById`, `reopenTaskById`, `softDeleteTask`, `restoreTaskById`: same locks, same
// recurrence, same exact "Deshacer"). Each one checks the owner and revalidates the task screens.
//
// The tag is the only stable link between occurrences: completing a recurring task creates the
// next one as another row that copies the tags (`spawnNextOccurrence`).
import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { taskTagLinks, taskTags, tasks } from "./db/schema";
import { revalidateTaskLists } from "./revalidate";
import { createTaskInputSchema, type TaskItem, type TaskRecurrence } from "./task-input";
import {
  completeTaskById,
  insertTask,
  reopenTaskById,
  restoreTaskById,
  selectItems,
  softDeleteTask,
  toItem,
  visibleTask,
} from "./tasks";

/** At most this many tasks of a tag are listed (a household has dozens, never thousands). */
export const MAX_TAGGED_TASKS = 500;

/** A task as a module that tags tasks reads it: what a row needs, and its tag names. */
export type TaggedTask = {
  id: string;
  title: string;
  /** A day in Lima, YYYY-MM-DD. */
  dueDate: string | null;
  recurrence: TaskRecurrence | null;
  /** Its tags by name. */
  tags: string[];
};

function toTagged(item: TaskItem): TaggedTask {
  return {
    id: item.id,
    title: item.title,
    dueDate: item.dueDate,
    recurrence: item.recurrence,
    tags: item.tags.map((tag) => tag.name),
  };
}

/**
 * The pending, visible tasks tagged `tag` (never a deleted task nor one of a deleted project),
 * the soonest due date first (no date last) and then by title. One query. Trusts its caller (see
 * getTasksByTag).
 */
export async function selectTasksByTag(db: Database, tag: string): Promise<TaggedTask[]> {
  const tagged = db
    .select({ id: taskTagLinks.taskId })
    .from(taskTagLinks)
    .innerJoin(taskTags, eq(taskTags.id, taskTagLinks.tagId))
    .where(eq(taskTags.name, tag));
  const rows = await selectItems(db, and(visibleTask, isNull(tasks.doneAt), inArray(tasks.id, tagged)))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.title), asc(tasks.id))
    .limit(MAX_TAGGED_TASKS);
  return rows.map(toItem).map(toTagged);
}

/** For a module over tagged tasks: the pending tasks that carry `tag`. Checks the owner. */
export async function getTasksByTag(tag: string): Promise<TaggedTask[]> {
  await requireOwner();
  return selectTasksByTag(getDb(), tag);
}

/**
 * Creates a task with tags and, optionally, a due date and a recurrence rule, in the inbox (the
 * same validation as the quick capture, tags created on first use). Throws a RangeError for an
 * invalid input: the calling action validates first, so that is a programming error. Checks the
 * owner.
 */
export async function createTaskWithTags(input: unknown): Promise<TaggedTask> {
  await requireOwner();
  const parsed = createTaskInputSchema.safeParse(input);
  if (!parsed.success) throw new RangeError(parsed.error.issues[0]?.message ?? "Invalid task");
  const created = await insertTask(getDb(), parsed.data);
  if (typeof created === "string") throw new RangeError(created);
  revalidateTaskLists();
  return toTagged(created);
}

export type CompletedModuleTask = {
  id: string;
  title: string;
  /** Whether this call completed it (a double tap reports false and creates nothing). */
  changed: boolean;
  /** The occurrence a recurring task created, or null. */
  next: { id: string; dueDate: string | null } | null;
};

/** Marks a task done; a recurring one creates the next occurrence. Null if it doesn't exist. */
export async function completeModuleTask(id: string): Promise<CompletedModuleTask | null> {
  await requireOwner();
  const result = await completeTaskById(getDb(), id);
  revalidateTaskLists();
  if (!result) return null;
  return {
    id: result.task.id,
    title: result.task.title,
    changed: result.changed,
    next: result.next ? { id: result.next.id, dueDate: result.next.dueDate } : null,
  };
}

/** "Deshacer" of a completion: pending again, and the occurrence it created goes if untouched. */
export async function reopenModuleTask(
  id: string,
): Promise<{ id: string; changed: boolean; spawn: "removed" | "kept" | null } | null> {
  await requireOwner();
  const result = await reopenTaskById(getDb(), id);
  revalidateTaskLists();
  return result ? { id: result.task.id, changed: result.changed, spawn: result.spawn } : null;
}

/** Soft delete (the task leaves every view and stays in the export). Null if it isn't there. */
export async function deleteModuleTask(id: string): Promise<{ id: string; title: string } | null> {
  await requireOwner();
  const deleted = await softDeleteTask(getDb(), id);
  revalidateTaskLists();
  return deleted;
}

/** "Deshacer" of a delete. Null only when the task doesn't exist at all. */
export async function restoreModuleTask(
  id: string,
): Promise<{ id: string; detached: boolean } | null> {
  await requireOwner();
  const result = await restoreTaskById(getDb(), id);
  revalidateTaskLists();
  return result ? { id: result.task.id, detached: result.detached } : null;
}
