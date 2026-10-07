// Data access of "Mañana" / "Otro día…" (server only; callers check the owner and validate).
//
// Locks (CLAUDE.md "Advisory locks"): none of the advisory ones. A postponement only changes
// `due_date` of one row, never its placement (no project or milestone lock is involved, and the
// next-action mark and the recurrence rule stay), so the row lock (`FOR UPDATE`) is the only one
// and the first of its transaction: a second, concurrent tap waits and then finds the day already
// set (`changed: false`).
import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { tasks } from "./db/schema";
import type { PostponedTask, RestoredDueDate } from "./task-postpone";
import { visibleTask } from "./tasks";

/**
 * Moves a pending, visible task to `day` (this task only: a recurring task keeps its rule, no
 * copy is created, and the next occurrence is still computed when it is completed). Idempotent:
 * on the same day it changes nothing and says `changed: false`. Null when the task doesn't exist
 * or is deleted (or its project is); "done" when it is already completed.
 */
export async function postponeTaskById(
  db: Database,
  id: string,
  day: string,
): Promise<PostponedTask | "done" | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, doneAt: tasks.doneAt })
      .from(tasks)
      .where(and(eq(tasks.id, id), visibleTask))
      .for("update");
    if (!current) return null;
    if (current.doneAt !== null) return "done";
    const changed = current.dueDate !== day;
    // The write stamps `updated_at` (Drizzle), so an occurrence spawned by a completion counts as
    // edited: undoing that completion keeps it, like any other edit.
    if (changed) await tx.update(tasks).set({ dueDate: day }).where(eq(tasks.id, id));
    return {
      id: current.id,
      title: current.title,
      dueDate: day,
      previousDueDate: current.dueDate,
      changed,
    };
  });
}

/**
 * "Deshacer" of a postponement: puts `dueDate` back, only while the task is still pending and has `expected` (the
 * day the postponement set); a newer edit is never overwritten (`restored: false`, with the day it
 * has). Undoing twice is not an error. Null when the task doesn't exist or is deleted.
 */
export async function restoreDueDateById(
  db: Database,
  id: string,
  dueDate: string | null,
  expected: string,
): Promise<RestoredDueDate | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ dueDate: tasks.dueDate, doneAt: tasks.doneAt })
      .from(tasks)
      .where(and(eq(tasks.id, id), visibleTask))
      .for("update");
    if (!current) return null;
    // A task completed meanwhile is not put back on a day (it is no longer pending), nor a newer edit.
    if (current.doneAt !== null || current.dueDate !== expected) {
      return { id, dueDate: current.dueDate, restored: false };
    }
    // The hour stays where it was (a postponement only moves the day), except when the task goes
    // back to no day at all: a time needs a day (`tasks_due_time_check`).
    await tx
      .update(tasks)
      .set(dueDate === null ? { dueDate, dueTime: null } : { dueDate })
      .where(eq(tasks.id, id));
    return { id, dueDate, restored: true };
  });
}
