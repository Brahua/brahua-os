// Reads of the views of /tasks (T2; server only). Each view is ONE query (the area, project and
// tags come in the same row: no query per task), always filtered with `visibleTask` (a deleted
// task, or one of a deleted project, is never shown). The rows are sorted with the same pure
// comparators the client uses (task-views.ts). Callers check the owner first.
import "server-only";
import { and, eq, gt, gte, isNotNull, isNull, lte } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { tasks } from "./db/schema";
import type { TaskItem } from "./task-input";
import { selectItems, toItem, visibleTask } from "./tasks";
import {
  addDays,
  compareByDoneDesc,
  compareByDue,
  doneSince,
  limaToday,
  UPCOMING_DAYS,
} from "./task-views";

const pending = isNull(tasks.doneAt);

/** "Hoy": pending, overdue or due today (Lima), the oldest due first, then priority, creation. */
export async function selectTodayTasks(db: Database, now: Date): Promise<TaskItem[]> {
  const rows = await selectItems(
    db,
    and(visibleTask, pending, lte(tasks.dueDate, limaToday(now))),
  );
  return rows.map((row) => toItem(row)).sort(compareByDue);
}

/** "Próximas": pending, due from tomorrow up to 7 days from today (Lima), by day. */
export async function selectUpcomingTasks(db: Database, now: Date): Promise<TaskItem[]> {
  const today = limaToday(now);
  const rows = await selectItems(
    db,
    and(
      visibleTask,
      pending,
      gt(tasks.dueDate, today),
      lte(tasks.dueDate, addDays(today, UPCOMING_DAYS)),
    ),
  );
  return rows.map((row) => toItem(row)).sort(compareByDue);
}

/**
 * "Todas": every pending task (the inbox too), by due date (without one, last), priority and
 * creation. The filters apply on top (`matchesFilters`): the page also needs the whole list to
 * offer only the projects that have pending tasks.
 */
export async function selectPendingTasks(db: Database): Promise<TaskItem[]> {
  const rows = await selectItems(db, and(visibleTask, pending));
  return rows.map((row) => toItem(row)).sort(compareByDue);
}

/** "Hechas": done in the last 30 days, the most recent first. */
export async function selectDoneTasks(db: Database, now: Date): Promise<TaskItem[]> {
  const rows = await selectItems(
    db,
    and(visibleTask, isNotNull(tasks.doneAt), gte(tasks.doneAt, doneSince(now))),
  );
  return rows.map((row) => toItem(row)).sort(compareByDoneDesc);
}

/** A task's notes (detail only, never in the lists), or undefined when it isn't visible. */
export async function selectTaskNotes(
  db: Database,
  id: string,
): Promise<{ notes: string | null } | undefined> {
  const [row] = await db
    .select({ notes: tasks.notes })
    .from(tasks)
    .where(and(eq(tasks.id, id), visibleTask));
  return row;
}

/**
 * Writes a task's notes (null clears them). Returns them as saved, or undefined (writing
 * nothing) when the task doesn't exist, is deleted or belongs to a deleted project.
 */
export async function setTaskNotes(
  db: Database,
  id: string,
  notes: string | null,
): Promise<{ notes: string | null } | undefined> {
  const [row] = await db
    .update(tasks)
    .set({ notes })
    .where(and(eq(tasks.id, id), visibleTask))
    .returning({ notes: tasks.notes });
  return row;
}
