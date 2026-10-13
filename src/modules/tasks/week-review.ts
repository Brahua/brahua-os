// What `weekly-review` reads and does in `tasks` (server only; contracts.ts exposes it). These
// functions take the database and trust their caller: the contract checks the owner and
// validates first.
//
// Locks (CLAUDE.md "Advisory locks"): none of the advisory ones, like the single postponement
// (postpone-db.ts): a move only changes `due_date` of one row, so the row lock is the only one and
// the first of its transaction. The batch takes the tasks one by one, each in its own transaction
// and in ascending id order, so two batches at once never wait on each other in a cycle and the
// second finds each task already moved (`already`).
import "server-only";
import { and, asc, count, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { OWNER_TIME_ZONE } from "@/lib/time";
import { projects } from "@/modules/projects/db/schema";
import { tasks } from "./db/schema";
import { postponeTaskById, restoreDueDateById } from "./postpone-db";
import { visibleTask } from "./tasks";
import {
  WEEK_REVIEW_OPEN_LIMIT,
  WEEK_REVIEW_RECENT_DONE,
  type MoveTasksResult,
  type MovedTask,
  type SkippedReason,
  type TasksWeekReview,
  type TaskMove,
  type TaskUndo,
  type UndoMoveTasksResult,
} from "./week-review-input";

const DAY_MS = 86_400_000;

function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The Lima day of a `done_at` instant, as a date. */
const doneDay = sql`(${tasks.doneAt} at time zone ${OWNER_TIME_ZONE})::date`;

/**
 * The reading of the week starting `weekStart` (a Monday): the tasks done in it, the ones that
 * stayed open and the inbox. Four queries, whatever the number of tasks. Trusts its caller.
 */
export async function readTasksWeekReview(
  db: Database,
  weekStart: string,
): Promise<TasksWeekReview> {
  const sunday = addDays(weekStart, 6);
  const doneInWeek = and(
    visibleTask,
    isNotNull(tasks.doneAt),
    sql`${doneDay} between ${weekStart}::date and ${sunday}::date`,
  );
  const openByNow = and(visibleTask, isNull(tasks.doneAt), lte(tasks.dueDate, sunday));
  const [[done], recent, [open], openRows, [inbox]] = await Promise.all([
    db.select({ count: count() }).from(tasks).where(doneInWeek),
    db
      .select({ id: tasks.id, title: tasks.title, doneAt: tasks.doneAt })
      .from(tasks)
      .where(doneInWeek)
      .orderBy(sql`${tasks.doneAt} desc`, tasks.id)
      .limit(WEEK_REVIEW_RECENT_DONE),
    db.select({ count: count() }).from(tasks).where(openByNow),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        recurrenceKind: tasks.recurrenceKind,
        projectName: projects.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(openByNow)
      .orderBy(asc(tasks.dueDate), asc(tasks.createdAt), asc(tasks.id))
      .limit(WEEK_REVIEW_OPEN_LIMIT),
    db
      .select({ count: count() })
      .from(tasks)
      .where(and(visibleTask, isNull(tasks.doneAt), isNull(tasks.lifeAreaId), isNull(tasks.projectId))),
  ]);
  return {
    weekStart,
    doneCount: done?.count ?? 0,
    recentDone: recent.flatMap((row) =>
      row.doneAt ? [{ id: row.id, title: row.title, doneAt: row.doneAt }] : [],
    ),
    open: openRows.flatMap((row) =>
      row.dueDate
        ? [
            {
              id: row.id,
              title: row.title,
              dueDate: row.dueDate,
              projectName: row.projectName ?? null,
              recurring: row.recurrenceKind !== null,
            },
          ]
        : [],
    ),
    openCount: open?.count ?? 0,
    inboxCount: inbox?.count ?? 0,
  };
}

/**
 * Moves the tasks of `moves` to `to` with the single postponement (`postponeTaskById`: only this
 * occurrence of a recurring task, the rule stays) and its guard: a task whose day is no longer the
 * one it was read with is left alone. Idempotent per task. The ids are taken in ascending order.
 * Trusts its caller (the contract validated the list as a set and the day).
 */
export async function moveTasksOnDate(
  db: Database,
  moves: readonly TaskMove[],
  to: string,
): Promise<MoveTasksResult> {
  const byId = new Map<string, MovedTask | { reason: SkippedReason }>();
  for (const move of [...moves].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const result = await postponeTaskById(db, move.id, to, { from: move.from });
    if (result === null) byId.set(move.id, { reason: "missing" });
    else if (result === "done") byId.set(move.id, { reason: "done" });
    else if (result === "stale") byId.set(move.id, { reason: "changed" });
    else if (!result.changed) byId.set(move.id, { reason: "already" });
    else {
      byId.set(move.id, {
        id: result.id,
        title: result.title,
        previousDueDate: result.previousDueDate,
        movedTo: to,
      });
    }
  }
  const moved: MovedTask[] = [];
  const skipped: MoveTasksResult["skipped"] = [];
  // Back in the order asked.
  for (const { id } of moves) {
    const entry = byId.get(id);
    if (!entry) continue;
    if ("reason" in entry) skipped.push({ id, reason: entry.reason });
    else moved.push(entry);
  }
  return { to, moved, skipped };
}

/**
 * "Deshacer" of `moveTasksOnDate`: puts each task back on `previousDueDate`, only while it is
 * still pending and still on `movedTo` (`restoreDueDateById`): one edited, completed or moved
 * again meanwhile is left as it is, and undoing twice restores nothing the second time. Trusts
 * its caller.
 */
export async function undoMovedTasks(
  db: Database,
  undo: readonly TaskUndo[],
): Promise<UndoMoveTasksResult> {
  const restored: string[] = [];
  const kept: UndoMoveTasksResult["kept"] = [];
  const missing: string[] = [];
  for (const entry of [...undo].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const result = await restoreDueDateById(db, entry.id, entry.previousDueDate, entry.movedTo);
    if (result === null) missing.push(entry.id);
    else if (result.restored) restored.push(entry.id);
    else kept.push({ id: entry.id, dueDate: result.dueDate });
  }
  return { restored, kept, missing };
}
