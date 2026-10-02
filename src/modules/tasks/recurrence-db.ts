// Recurrence writes (T3, server only), called by `completeTaskById` and `reopenTaskById` inside
// their transaction (SPEC-tasks "Recurrencia": the next occurrence is created in the same
// transaction as the completion, and "Deshacer" removes it if it is untouched). No value import
// from tasks.ts (it imports this file).
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { taskTagLinks, tasks } from "./db/schema";
import { nextDueDate } from "./recurrence";
import type { TaskRecurrence } from "./task-input";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The four recurrence columns of a rule (all null without one). */
export function recurrenceColumns(rule: TaskRecurrence | null | undefined) {
  return {
    recurrenceKind: rule?.kind ?? null,
    recurrenceInterval: rule?.interval ?? null,
    recurrenceWeekdays: rule?.weekdays ?? null,
    recurrenceMonthDay: rule?.monthDay ?? null,
  };
}

/** What the next occurrence copies from the one just completed. */
export type CompletedRow = Pick<
  typeof tasks.$inferSelect,
  | "id"
  | "title"
  | "notes"
  | "priority"
  | "doneAt"
  | "lifeAreaId"
  | "projectId"
  | "milestoneId"
  | "recurrenceKind"
  | "recurrenceInterval"
  | "recurrenceWeekdays"
  | "recurrenceMonthDay"
>;

/** The columns `completeTaskById` returns from its update, for `spawnNextOccurrence`. */
export const COMPLETED_COLUMNS = {
  id: tasks.id,
  title: tasks.title,
  notes: tasks.notes,
  priority: tasks.priority,
  doneAt: tasks.doneAt,
  lifeAreaId: tasks.lifeAreaId,
  projectId: tasks.projectId,
  milestoneId: tasks.milestoneId,
  recurrenceKind: tasks.recurrenceKind,
  recurrenceInterval: tasks.recurrenceInterval,
  recurrenceWeekdays: tasks.recurrenceWeekdays,
  recurrenceMonthDay: tasks.recurrenceMonthDay,
};

function ruleOf(row: CompletedRow): TaskRecurrence | null {
  if (!row.recurrenceKind) return null;
  return {
    kind: row.recurrenceKind,
    interval: row.recurrenceInterval,
    weekdays: row.recurrenceWeekdays,
    monthDay: row.recurrenceMonthDay,
  };
}

/**
 * Creates the next occurrence of a recurring task that was just completed (the caller holds its
 * row lock and only calls this when its own update changed `done_at`, so a double tap spawns
 * once). It copies the title, notes, priority, area / project / milestone (as they are: the same
 * task continues), the tags and the rule; its due date is the rule's next one from the
 * completion day in Lima, and `spawned_from_id` points back to the completed task. Its
 * `updated_at` equals its `created_at` until someone edits it ("untouched", for the undo).
 *
 * At most one live occurrence per completed task (`tasks_spawned_from_unique`): completing it
 * again after an undo that kept an edited occurrence creates nothing new. Returns the id of the
 * occurrence (new or existing), or null when the task doesn't recur.
 */
export async function spawnNextOccurrence(tx: Tx, completed: CompletedRow): Promise<string | null> {
  const rule = ruleOf(completed);
  if (!rule || !completed.doneAt) return null;
  const [created] = await tx
    .insert(tasks)
    .values({
      title: completed.title,
      notes: completed.notes,
      priority: completed.priority,
      dueDate: nextDueDate(rule, completed.doneAt),
      lifeAreaId: completed.lifeAreaId,
      projectId: completed.projectId,
      milestoneId: completed.milestoneId,
      ...recurrenceColumns(rule),
      spawnedFromId: completed.id,
    })
    .onConflictDoNothing()
    .returning({ id: tasks.id });
  if (!created) {
    const [existing] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.spawnedFromId, completed.id), isNull(tasks.deletedAt)));
    return existing?.id ?? null;
  }
  // The tags (T4 writes them; the links table exists since T1): the same ones.
  await tx.execute(sql`
    insert into ${taskTagLinks} (task_id, tag_id)
    select ${created.id}, ${taskTagLinks.tagId} from ${taskTagLinks}
    where ${taskTagLinks.taskId} = ${completed.id}
  `);
  return created.id;
}

/** What "Deshacer" did with the occurrence the completion had spawned. */
export type SpawnUndo = "removed" | "kept";

/**
 * Undo of a completion (SPEC-tasks "Deshacer al completar"): soft-deletes the live occurrence
 * the task spawned, but only if it is untouched: never edited (`updated_at = created_at`; every
 * Drizzle update stamps `updated_at`, and T4 must stamp it when the tags change), still pending
 * and not deleted. Otherwise it stays (the owner already worked on it) and only the original
 * reopens. Null when there was none (not recurring, or already gone).
 */
export async function removeUntouchedSpawn(tx: Tx, completedId: string): Promise<SpawnUndo | null> {
  const [spawn] = await tx
    .select({
      id: tasks.id,
      untouched: sql<boolean>`${tasks.updatedAt} = ${tasks.createdAt} and ${tasks.doneAt} is null`,
    })
    .from(tasks)
    .where(and(eq(tasks.spawnedFromId, completedId), isNull(tasks.deletedAt)))
    .for("update");
  if (!spawn) return null;
  if (!spawn.untouched) return "kept";
  await tx
    .update(tasks)
    .set({ deletedAt: sql`now()`, isNextAction: false })
    .where(eq(tasks.id, spawn.id));
  return "removed";
}
