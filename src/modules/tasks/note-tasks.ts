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
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
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
 * «Deshacer» of a line turned into a task. The row is locked (FOR UPDATE), so a completion at the
 * same time either waits or wins, and it is read whatever its state:
 * - `mismatch`: the task doesn't exist or its stored title isn't `title` (what the line being put
 *   back would make, through `inboxTaskTitle`): the request doesn't describe this task, nothing is
 *   written.
 * - `missing`: it is already gone (deleted, or its project is): nothing to remove.
 * - `kept`: it changed since it was created (it is the owner's now): nothing is written.
 *   Untouched means pending and never written after its insert (`updated_at = created_at`: any
 *   edit, move, tag, note, completion or reopening stamps `updated_at`, T3's rule for an untouched
 *   occurrence).
 * - `removed`: soft-deleted.
 */
export async function undoInboxTask(
  tx: Tx,
  id: string,
  title: string,
): Promise<"removed" | "kept" | "missing" | "mismatch"> {
  const [task] = await tx
    .select({
      title: tasks.title,
      untouched: sql<boolean>`${tasks.updatedAt} = ${tasks.createdAt}`,
      doneAt: tasks.doneAt,
      visible: sql<boolean>`${visibleTask}`,
    })
    .from(tasks)
    .where(eq(tasks.id, id))
    .for("update");
  if (!task || task.title !== title) return "mismatch";
  if (!task.visible) return "missing";
  if (!task.untouched || task.doneAt !== null) return "kept";
  await tx.update(tasks).set({ deletedAt: sql`now()` }).where(eq(tasks.id, id));
  return "removed";
}

/**
 * «Ese día» (SPEC-notes "Pie"): how many visible tasks were completed on the Lima day `day`
 * (`YYYY-MM-DD`), whatever their due date. ONE query over a range of `done_at` (from Lima's
 * midnight of `day` to the next one, so the column is compared as stored): 23:59 counts for that
 * day, 00:00 for the next. Each completed occurrence of a recurring task is its own row and counts
 * once; the next occurrence it created is pending and doesn't. A deleted task, or one of a deleted
 * project, never counts (`visibleTask`).
 */
export async function countTasksCompletedOn(db: Database, day: string): Promise<number> {
  const start = sql`(${day}::date::timestamp at time zone ${OWNER_TIME_ZONE})`;
  const end = sql`((${day}::date + 1)::timestamp at time zone ${OWNER_TIME_ZONE})`;
  const [row] = await db
    .select({ count: count() })
    .from(tasks)
    .where(and(visibleTask, gte(tasks.doneAt, start), lt(tasks.doneAt, end)));
  return row?.count ?? 0;
}
