// Writing the tags of one task (T4; server only), inside the caller's transaction. Its own file
// so tasks.ts (a create with tags) and tags.ts can both use it without importing each other.
//
// Tags are created on first use with `insert … on conflict (name) do nothing`, sorted by name:
// two writers creating the same new tag never fail (the second waits for the first, then reuses
// its row), and two creating overlapping sets take the rows in the same order (no deadlock).
import "server-only";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { taskTagLinks, taskTags } from "./db/schema";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The ids of these tags (normalized names), creating the missing ones. Must run inside the
 * transaction that links them.
 */
async function ensureTags(tx: Tx, names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const sorted = [...new Set(names)].sort();
  await tx
    .insert(taskTags)
    .values(sorted.map((name) => ({ name })))
    .onConflictDoNothing({ target: taskTags.name });
  const rows = await tx
    .select({ id: taskTags.id })
    .from(taskTags)
    .where(inArray(taskTags.name, sorted));
  return rows.map((row) => row.id);
}

/**
 * Makes `names` the tags of a task that was just locked or created in `tx` (adds what is missing,
 * unlinks the rest). The tags themselves stay: an unused tag only stops being suggested. `fresh`:
 * the task was just created (no links to remove).
 */
export async function writeTaskTags(
  tx: Tx,
  taskId: string,
  names: readonly string[],
  { fresh = false } = {},
) {
  const ids = await ensureTags(tx, names);
  if (!fresh) await tx
    .delete(taskTagLinks)
    .where(
      ids.length > 0
        ? and(eq(taskTagLinks.taskId, taskId), notInArray(taskTagLinks.tagId, ids))
        : eq(taskTagLinks.taskId, taskId),
    );
  if (ids.length > 0) {
    await tx
      .insert(taskTagLinks)
      .values(ids.map((tagId) => ({ taskId, tagId })))
      .onConflictDoNothing();
  }
}
