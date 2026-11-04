// What `tasks` offers the notes (SPEC-notes "Contratos → notes → tasks" and "pie"), server-only:
// plain data functions that never import `notes` (eslint.config.mjs). The composition root
// src/lib/note-task-actions.ts hands `createInboxTask` and `undoInboxTask` to the notes' own
// transaction, and src/lib/note-extensions.tsx reads `countTasksCompletedOn` for «Ese día». They
// trust their caller: it checked the owner.
//
// No advisory lock is taken: an inbox task belongs to no project (SPEC-tasks "Locks": only a
// write that puts a task in a project, or takes it out of one, takes that project's lock), so the
// notes' transaction keeps its own lock order.
import "server-only";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { OWNER_TIME_ZONE } from "@/lib/time";
import { hasInvisibleCharacters } from "@/lib/text";
import { tasks } from "./db/schema";
import { TASK_TITLE_MAX_LENGTH } from "./task-constants";
import { normalizeTaskTitle } from "./task-input";
import { visibleTask } from "./tasks";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Why a line can't be a task's title: empty, longer than 200, or with invisible characters. */
export type InboxTitleProblem = "empty" | "tooLong" | "invisible";

/**
 * The title an inbox task would get from `text` (normalized like every title: NFC, spaces
 * collapsed), or why it can't. Never cut: a longer text is refused.
 */
export function inboxTaskTitle(text: string): { title: string } | { problem: InboxTitleProblem } {
  const title = normalizeTaskTitle(text);
  if (title === "") return { problem: "empty" };
  if (title.length > TASK_TITLE_MAX_LENGTH) return { problem: "tooLong" };
  if (hasInvisibleCharacters(title)) return { problem: "invisible" };
  return { title };
}

/**
 * Creates a pending task in the inbox (no area, project, date or priority of its own), inside the
 * caller's transaction: the title as written, no date read from it (SPEC-notes "Línea → tarea").
 * Writes nothing when the title can't be one.
 */
export async function createInboxTask(
  tx: Tx,
  text: string,
): Promise<{ id: string; title: string } | { problem: InboxTitleProblem }> {
  const checked = inboxTaskTitle(text);
  if ("problem" in checked) return checked;
  const [created] = await tx
    .insert(tasks)
    .values({ title: checked.title })
    .returning({ id: tasks.id, title: tasks.title });
  return created;
}

/**
 * «Deshacer» of a line turned into a task: soft-deletes the task only if it is untouched since it
 * was created (`removed`): still visible and pending, and never written after its insert
 * (`updated_at = created_at`: any edit, move, tag, note, completion or reopening stamps
 * `updated_at`, T3's rule for an untouched occurrence). Otherwise nothing is written: `kept` (it
 * changed: it is the owner's now) or `missing` (deleted, or never existed). The row is locked
 * (FOR UPDATE), so a completion at the same time either waits or wins.
 */
export async function undoInboxTask(
  tx: Tx,
  id: string,
): Promise<"removed" | "kept" | "missing"> {
  const [task] = await tx
    .select({ untouched: sql<boolean>`${tasks.updatedAt} = ${tasks.createdAt}`, doneAt: tasks.doneAt })
    .from(tasks)
    .where(and(eq(tasks.id, id), visibleTask))
    .for("update");
  if (!task) return "missing";
  if (!task.untouched || task.doneAt !== null) return "kept";
  await tx.update(tasks).set({ deletedAt: sql`now()` }).where(eq(tasks.id, id));
  return "removed";
}

/**
 * «Ese día» (SPEC-notes "Pie"): how many visible tasks were completed on the Lima day `day`
 * (`YYYY-MM-DD`), whatever their due date. ONE query: `done_at` read as a Lima date (23:59 counts
 * for that day, 00:00 for the next). Each completed occurrence of a recurring task is its own row
 * and counts once; the next occurrence it created is pending and doesn't. A deleted task, or one
 * of a deleted project, never counts (`visibleTask`).
 */
export async function countTasksCompletedOn(db: Database, day: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(tasks)
    .where(
      and(
        visibleTask,
        isNotNull(tasks.doneAt),
        sql`(${tasks.doneAt} at time zone ${OWNER_TIME_ZONE})::date = ${day}::date`,
      ),
    );
  return row?.count ?? 0;
}
