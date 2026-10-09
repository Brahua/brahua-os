// What the Telegram bot (`reminders`, R3) needs from `tasks`, as plain data-layer functions: this
// file imports nothing of `reminders` (the composition root `src/lib/bot-capture.ts` joins the two).
// The webhook has already authenticated Telegram and checked that the chat is the owner's, so,
// like the tick, these trust their caller instead of asking for a session; the input is still
// validated with the same schema as the quick capture.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { parseTaskText } from "@/lib/natural-date";
import { tasks } from "./db/schema";
import { createTaskInputSchema, TASK_ERRORS, type TaskItem } from "./task-input";
import { insertTask } from "./tasks";

export type CaptureTaskResult =
  { ok: true; task: TaskItem } | { ok: false; reason: "too_long" | "invalid" };

/**
 * Saves a task from a line of text, the way the quick capture does: «pilas mañana» → "pilas" due
 * tomorrow (Lima), «ideas para el viaje» → that text, no day. No area and no project, so it lands
 * in the inbox. `db` may be the webhook's transaction (the insert then is a savepoint of it).
 */
export async function captureTaskText(
  db: Database,
  text: string,
  now: Date,
): Promise<CaptureTaskResult> {
  const reading = parseTaskText(text, now);
  const parsed = createTaskInputSchema.safeParse({
    title: reading.title,
    dueDate: reading.dueDate,
    dueTime: reading.dueTime,
  });
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((issue) => issue.message === TASK_ERRORS.titleTooLong);
    return { ok: false, reason: tooLong ? "too_long" : "invalid" };
  }
  const task = await insertTask(db, parsed.data);
  // A placement failure cannot happen without an area or a project, but a string is not a task.
  return typeof task === "string" ? { ok: false, reason: "invalid" } : { ok: true, task };
}

/**
 * "Deshacer" of a captured task: soft-deletes exactly `id`, but only while nobody touched it. A
 * task is untouched when it is not deleted, not done and its `updated_at` still equals its
 * `created_at` (every edit, move, postponement or completion goes through Drizzle, which stamps
 * `updated_at`). One UPDATE, so a concurrent edit either wins first (we report "changed") or
 * loses (we delete); we never overwrite a newer state.
 */
export async function undoCapturedTask(
  db: Database,
  id: string,
): Promise<"undone" | "changed" | "gone"> {
  const undone = await db
    .update(tasks)
    .set({ deletedAt: sql`now()`, isNextAction: false })
    .where(
      and(
        eq(tasks.id, id),
        isNull(tasks.deletedAt),
        isNull(tasks.doneAt),
        sql`${tasks.updatedAt} = ${tasks.createdAt}`,
      ),
    )
    .returning({ id: tasks.id });
  if (undone.length > 0) return "undone";
  const [row] = await db
    .select({ deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(eq(tasks.id, id));
  return !row || row.deletedAt !== null ? "gone" : "changed";
}
