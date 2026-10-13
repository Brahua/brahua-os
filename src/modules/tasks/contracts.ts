// What `tasks` offers other modules (T6, SPEC-tasks "Contratos"), server-only:
//
// getTasksTodaySummary(now) (for `today`): the pending tasks that are overdue or due today (Lima),
// in one query, filtered with `visibleTask` (never a deleted task nor one of a deleted project).
// A pending task of a closed project (Terminado, Cancelado) stays, as in the "Hoy" view, but it
// isn't a next action here: like the project cards (T5), a closed project's mark isn't shown.
//
// getTasksDoneTodayCount(now) (for `today`'s "Día completo", D4): how many visible tasks were
// completed on Lima's day of `now`, in one query.
//
// getTasksWeekReview(weekStart, now) (for `weekly-review`): the week's tasks done, the ones that
// stayed open (due by its Sunday, overdue included) and the inbox, in four queries
// (week-review.ts).
//
// moveTasksToDate(moves, to, now) / undoMoveTasks(undo) (for `weekly-review`): a batch of the
// single postponement (`postponeTask`: only this occurrence of a recurring task) with an exact
// undo that carries each task's id, the day it had and the day the move set.
//
// (The progress source for `projects` lives in progress-source.ts, T5.)
import "server-only";
import { and, count, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { OWNER_TIME_ZONE, ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { projects } from "@/modules/projects/db/schema";
import { isClosed } from "@/modules/projects/project-close";
import { tasks } from "./db/schema";
import { revalidateTaskLists } from "./revalidate";
import { visibleTask } from "./tasks";
import { normalizeDueTime } from "./task-time";
import { limaToday } from "./task-views";
import { buildTasksTodaySummary, type TaskTodayItem } from "./today-summary";
import { moveTasksOnDate, readTasksWeekReview, undoMovedTasks } from "./week-review";
import {
  moveTasksInputSchema,
  undoMoveTasksInputSchema,
  WEEK_REVIEW_ERRORS,
  type MoveTasksResult,
  type TaskMove,
  type TasksWeekReview,
  type TaskUndo,
  type UndoMoveTasksResult,
} from "./week-review-input";

export type { TaskTodayDue, TaskTodayItem } from "./today-summary";
export type {
  MoveTasksResult,
  MovedTask,
  SkippedReason,
  TasksWeekReview,
  TaskMove,
  TaskUndo,
  UndoMoveTasksResult,
  WeekReviewDoneTask,
  WeekReviewOpenTask,
} from "./week-review-input";
export {
  MAX_BATCH_MOVES,
  moveTasksInputSchema,
  undoMoveTasksInputSchema,
  WEEK_REVIEW_ERRORS,
} from "./week-review-input";

const ownArea = alias(lifeAreas, "today_own_area");
const projectArea = alias(lifeAreas, "today_project_area");

// Typed as the table itself (as tasks.ts does) so each joined area reads as one nullable object.
const areaColumns = (table: typeof lifeAreas) => ({
  id: table.id,
  slug: table.slug,
  name: table.name,
  icon: table.icon,
  color: table.color,
});

/**
 * The summary's rows in ONE query (the area and the project come in the same row): visible,
 * pending and due on or before Lima's today. Trusts its caller (see getTasksTodaySummary).
 */
export async function selectTasksTodaySummary(
  db: Database,
  now: Date,
): Promise<TaskTodayItem[]> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      doneAt: tasks.doneAt,
      createdAt: tasks.createdAt,
      isNextAction: tasks.isNextAction,
      projectId: tasks.projectId,
      projectName: projects.name,
      projectStatus: projects.status,
      ownArea: areaColumns(ownArea as unknown as typeof lifeAreas),
      projectArea: areaColumns(projectArea as unknown as typeof lifeAreas),
    })
    .from(tasks)
    .leftJoin(ownArea, eq(ownArea.id, tasks.lifeAreaId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(projectArea, eq(projectArea.id, projects.lifeAreaId))
    .where(and(visibleTask, isNull(tasks.doneAt), lte(tasks.dueDate, limaToday(now))));
  return buildTasksTodaySummary(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      priority: row.priority,
      dueDate: row.dueDate,
      dueTime: normalizeDueTime(row.dueTime),
      doneAt: row.doneAt,
      createdAt: row.createdAt,
      // T5's rule: a closed project keeps the mark in the database, but it isn't shown.
      isNextAction:
        row.isNextAction && row.projectStatus !== null && !isClosed(row.projectStatus),
      // One source of truth: with a project, the area is the project's.
      area: row.projectId ? row.projectArea : row.ownArea,
      project:
        row.projectId && row.projectName ? { id: row.projectId, name: row.projectName } : null,
    })),
    now,
  );
}

/**
 * For `today`: the pending tasks that are overdue or due today (Lima), the most overdue first,
 * then priority (Alta first), then creation. Checks the owner like the other queries (redirects
 * to /login without one).
 */
export async function getTasksTodaySummary(now: Date): Promise<TaskTodayItem[]> {
  await requireOwner();
  return selectTasksTodaySummary(getDb(), now);
}

/**
 * How many visible tasks were completed on Lima's day of `now` (ONE query): `done_at` read as a
 * Lima date, so 23:59 counts for that day and 00:00 for the next. A deleted task, or one of a
 * deleted project, never counts (`visibleTask`). Trusts its caller (see getTasksDoneTodayCount).
 */
export async function selectTasksDoneTodayCount(db: Database, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(tasks)
    .where(
      and(
        visibleTask,
        isNotNull(tasks.doneAt),
        sql`(${tasks.doneAt} at time zone ${OWNER_TIME_ZONE})::date = ${limaToday(now)}::date`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * For `today`'s "Día completo" (D4): how many tasks were completed today (Lima), whatever their
 * due date. Checks the owner like the other queries (redirects to /login without one).
 */
export async function getTasksDoneTodayCount(now: Date): Promise<number> {
  await requireOwner();
  return selectTasksDoneTodayCount(getDb(), now);
}

// ── The weekly review ───────────────────────────────────────────────────────────────────────

const monday = z.iso.date();

/**
 * The reading of the week of `weekStart` (any day of it; the result names its Monday): visible
 * tasks done within it (Lima days), the ones still open (pending, due by its Sunday, overdue ones
 * included; at most 200 listed, `openCount` the total), the last 5 done, and the pending inbox.
 * Four queries. Trusts its caller (see getTasksWeekReview).
 */
export async function selectTasksWeekReview(
  db: Database,
  weekStart: string,
): Promise<TasksWeekReview> {
  if (!monday.safeParse(weekStart).success) {
    throw new RangeError("weekStart must be a day as YYYY-MM-DD");
  }
  return readTasksWeekReview(db, mondayOf(weekStart));
}

/** For `weekly-review`: the week's tasks done, open and in the inbox. Checks the owner. */
export async function getTasksWeekReview(weekStart: string): Promise<TasksWeekReview> {
  await requireOwner();
  return selectTasksWeekReview(getDb(), weekStart);
}

/** The Monday of the week of a day (YYYY-MM-DD, any day of it). */
function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const back = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Moves a batch of tasks to the day `to` (today or later, Lima): each one as the single
 * postponement does it (only this occurrence of a recurring task) and only while it still has the
 * day it was read with (`from`): one edited meanwhile is left alone and listed as skipped. `moves`
 * is a set (no repeated id, at most 200). The answer carries what the undo needs. Throws a
 * RangeError for an invalid list or day. Trusts its caller (see moveTasksToDate).
 */
export async function moveTasksToDateWith(
  db: Database,
  moves: readonly TaskMove[],
  to: string,
  now: Date,
): Promise<MoveTasksResult> {
  const parsed = moveTasksInputSchema.safeParse({ moves, to });
  if (!parsed.success) throw new RangeError(parsed.error.issues[0]?.message ?? "Invalid moves");
  if (parsed.data.to < ownerDateKey(now)) throw new RangeError(WEEK_REVIEW_ERRORS.past);
  return moveTasksOnDate(db, parsed.data.moves, parsed.data.to);
}

/**
 * For `weekly-review`: "Mover las N al lunes" / "Mañana" in one call (see moveTasksToDateWith).
 * Checks the owner and revalidates the task screens (the list, the projects and Hoy).
 */
export async function moveTasksToDate(
  moves: readonly TaskMove[],
  to: string,
  now: Date = new Date(),
): Promise<MoveTasksResult> {
  await requireOwner();
  const result = await moveTasksToDateWith(getDb(), moves, to, now);
  revalidateTaskLists();
  return result;
}

/**
 * "Deshacer" of the batch: each task goes back to `previousDueDate` only while it is still
 * pending and still on `movedTo`; one edited, completed or moved again meanwhile is not touched,
 * and the answer says which were restored. Throws a RangeError for an invalid list. Trusts its
 * caller (see undoMoveTasks).
 */
export async function undoMoveTasksWith(
  db: Database,
  undo: readonly TaskUndo[],
): Promise<UndoMoveTasksResult> {
  const parsed = undoMoveTasksInputSchema.safeParse({ undo });
  if (!parsed.success) throw new RangeError(parsed.error.issues[0]?.message ?? "Invalid undo");
  return undoMovedTasks(db, parsed.data.undo);
}

/** For `weekly-review`: the exact undo of `moveTasksToDate`. Checks the owner. */
export async function undoMoveTasks(undo: readonly TaskUndo[]): Promise<UndoMoveTasksResult> {
  await requireOwner();
  const result = await undoMoveTasksWith(getDb(), undo);
  revalidateTaskLists();
  return result;
}
