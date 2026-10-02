// Tags of tasks, data access (T4; server only). Like tasks.ts, these functions trust their input:
// the actions check the owner and validate with Zod first (names come normalized and unique).
//
// Locks: a task's tags change under its row lock (taken by the `updated_at` stamp), so two
// writes to the same task take turns and the 10-tag limit holds. The last write wins, also across
// tabs (each sends the whole set). Tags are created on first use (tag-links.ts). No advisory
// lock: tags don't touch projects (see tasks.ts for the project locks a create takes first).
import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { taskTagLinks, taskTags, tasks } from "./db/schema";
import type { TaskTagSummary } from "./task-input";
import { writeTaskTags } from "./tag-links";
import { visibleTask } from "./tasks";

/**
 * Replaces the tags of a visible task (not deleted, nor in a deleted project; done or not).
 * Returns whether the task was found; a missing or hidden task writes nothing.
 */
export async function replaceTaskTags(
  db: Database,
  taskId: string,
  names: readonly string[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Stamps updated_at (a tag edit is an edit: T3 keeps a spawned occurrence on "Deshacer"
    // once it was touched, i.e. updated_at > created_at) and takes the row lock, like FOR UPDATE.
    const [task] = await tx
      .update(tasks)
      .set({ updatedAt: sql`now()` })
      .where(and(eq(tasks.id, taskId), visibleTask))
      .returning({ id: tasks.id });
    if (!task) return false;
    await writeTaskTags(tx, taskId, names);
    return true;
  });
}

/**
 * The tags in use (on at least one visible task, done ones included), the most used first and
 * then by name: what the filter offers (by id). An unused tag (its last task was untagged or
 * deleted) is left out.
 */
export async function selectTagOptions(db: Database): Promise<TaskTagSummary[]> {
  const uses = sql<number>`count(*)`;
  return db
    .select({ id: taskTags.id, name: taskTags.name })
    .from(taskTags)
    .innerJoin(taskTagLinks, eq(taskTagLinks.tagId, taskTags.id))
    .innerJoin(tasks, eq(tasks.id, taskTagLinks.taskId))
    .where(visibleTask)
    .groupBy(taskTags.id, taskTags.name)
    .orderBy(sql`${uses} desc`, taskTags.name);
}

/** The names of the tags in use, in the same order: what the tag field suggests. */
export async function selectTagNames(db: Database): Promise<string[]> {
  return (await selectTagOptions(db)).map((tag) => tag.name);
}

/**
 * Filters tasks by a tag id (`?etiqueta=<tagId>`: stable under a rename, nothing to normalize):
 * `where(and(visibleTask, …, taskHasTag(tagId)))`. An `exists`, so it fits any query on `tasks`
 * without a join (and without duplicating rows).
 */
export function taskHasTag(tagId: string): SQL {
  return sql`exists (
    select 1 from ${taskTagLinks}
    where ${taskTagLinks.taskId} = ${tasks.id} and ${taskTagLinks.tagId} = ${tagId}
  )`;
}
