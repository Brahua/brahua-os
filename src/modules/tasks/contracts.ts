// What `tasks` offers other modules (T6, SPEC-tasks "Contratos"), server-only:
//
// getTasksTodaySummary(now) (for `today`): the pending tasks that are overdue or due today (Lima),
// in one query, filtered with `visibleTask` (never a deleted task nor one of a deleted project).
// A pending task of a closed project (Terminado, Cancelado) stays, as in the "Hoy" view, but it
// isn't a next action here: like the project cards (T5), a closed project's mark isn't shown.
//
// (The progress source for `projects` lives in progress-source.ts, T5.)
import "server-only";
import { and, eq, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projects } from "@/modules/projects/db/schema";
import { isClosed } from "@/modules/projects/project-close";
import { tasks } from "./db/schema";
import { visibleTask } from "./tasks";
import { limaToday } from "./task-views";
import { buildTasksTodaySummary, type TaskTodayItem } from "./today-summary";

export type { TaskTodayDue, TaskTodayItem } from "./today-summary";

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
