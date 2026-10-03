// Tasks data access (server only). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries
// with requireOwner()).
//
// Locks (CLAUDE.md "Advisory locks"): a write that puts a task in a project, or takes it out of
// one, first takes that project's task lock, `(TASKS_ADVISORY_SPACE, hashtext(projectId))`
// (several projects: sorted, so two writers never take them in opposite orders). Rule: always
// the first locks of the transaction, never after a row lock. Only then the rows: the task FOR
// UPDATE, and what it goes into FOR SHARE (an archive, a project closed or deleted, or a milestone
// deleted at the same time waits, so a task never lands somewhere that went away after the check).
// T5 (next action, one per project) relies on the same project lock.
import "server-only";
import { and, eq, gt, isNotNull, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { alias, type PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { CLOSED_STATUSES } from "@/modules/projects/project-close";
import { taskTagLinks, taskTags, tasks } from "./db/schema";
import { TASKS_ADVISORY_SPACE } from "./lock-keys";
import {
  COMPLETED_COLUMNS,
  recurrenceColumns,
  removeUntouchedSpawn,
  spawnNextOccurrence,
  type SpawnInbox,
  type SpawnUndo,
} from "./recurrence-db";
import { writeTaskTags } from "./tag-links";
import type {
  CreateTaskInput,
  DeletedTask,
  EditTaskInput,
  TaskItem,
  TaskPlacement,
  TaskTagSummary,
  TaskTargets,
} from "./task-input";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export { TASKS_ADVISORY_SPACE } from "./lock-keys";

/**
 * Takes the task locks of `projectIds` (deduplicated, sorted). Must be the first locks of the
 * transaction (see the header).
 */
export async function lockProjectTasks(tx: Tx, projectIds: readonly (string | null)[]) {
  const ids = [...new Set(projectIds.filter((value): value is string => value !== null))].sort();
  for (const projectId of ids) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${sql.raw(String(TASKS_ADVISORY_SPACE))}, hashtext(${projectId}))`,
    );
  }
}

const ownArea = alias(lifeAreas, "own_area");
const projectArea = alias(lifeAreas, "project_area");

const areaColumns = (table: typeof lifeAreas) => ({
  id: table.id,
  slug: table.slug,
  name: table.name,
  icon: table.icon,
  color: table.color,
});

/** The task's tags by name, as JSON (an empty list without any). */
const TAGS = sql<TaskTagSummary[]>`coalesce((
  select json_agg(json_build_object('id', ${taskTags.id}, 'name', ${taskTags.name}) order by ${taskTags.name})
  from ${taskTagLinks}
  inner join ${taskTags} on ${taskTags.id} = ${taskTagLinks.tagId}
  where ${taskTagLinks.taskId} = ${tasks.id}
), '[]'::json)`;

const ROW = {
  id: tasks.id,
  title: tasks.title,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  doneAt: tasks.doneAt,
  createdAt: tasks.createdAt,
  lifeAreaId: tasks.lifeAreaId,
  projectId: tasks.projectId,
  // A soft-deleted milestone reads as none ("sin hito"); restoring it brings it back.
  milestoneId: sql<string | null>`case when exists (
    select 1 from project_milestones live_milestone
    where live_milestone.id = ${tasks.milestoneId} and live_milestone.deleted_at is null
  ) then ${tasks.milestoneId} end`,
  isNextAction: tasks.isNextAction,
  recurrenceKind: tasks.recurrenceKind,
  recurrenceInterval: tasks.recurrenceInterval,
  recurrenceWeekdays: tasks.recurrenceWeekdays,
  recurrenceMonthDay: tasks.recurrenceMonthDay,
  projectName: projects.name,
  projectStatus: projects.status,
  ownArea: areaColumns(ownArea as unknown as typeof lifeAreas),
  projectArea: areaColumns(projectArea as unknown as typeof lifeAreas),
  tags: TAGS,
};

type Row = Awaited<ReturnType<typeof selectItems>>[number];

export function toItem(row: Row): TaskItem {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    dueDate: row.dueDate,
    doneAt: row.doneAt,
    createdAt: row.createdAt,
    lifeAreaId: row.lifeAreaId,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    isNextAction: row.isNextAction,
    // One source of truth: with a project, the area is the project's.
    area: row.projectId ? row.projectArea : row.ownArea,
    project:
      row.projectId && row.projectName && row.projectStatus
        ? { id: row.projectId, name: row.projectName, status: row.projectStatus }
        : null,
    recurrence: row.recurrenceKind
      ? {
          kind: row.recurrenceKind,
          interval: row.recurrenceInterval,
          weekdays: row.recurrenceWeekdays,
          monthDay: row.recurrenceMonthDay,
        }
      : null,
    tags: row.tags,
  };
}

/** Tasks with what they show (their area or their project's, the project, the tags). */
export function selectItems(db: Database | Tx, where: SQL | undefined) {
  return db
    .select(ROW)
    .from(tasks)
    .leftJoin(ownArea, eq(ownArea.id, tasks.lifeAreaId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(projectArea, eq(projectArea.id, projects.lifeAreaId))
    .where(where);
}

/**
 * Whether a task is visible (SPEC-tasks "Borrar"): not deleted, and neither is its project. The
 * tasks of a soft-deleted project hide with it (no view, page, count or write reaches them) and
 * come back when the project is restored. EVERY read and write of tasks (T2–T6 included: views,
 * counts, the progress source, the today summary) must filter with it. It doesn't need the
 * projects join (a subquery), so it fits any query on `tasks`.
 */
export const visibleTask = and(
  isNull(tasks.deletedAt),
  sql`(${tasks.projectId} is null or exists (
    select 1 from projects visible_project
    where visible_project.id = ${tasks.projectId} and visible_project.deleted_at is null
  ))`,
) as SQL;
const pending = isNull(tasks.doneAt);
const inInbox = and(isNull(tasks.lifeAreaId), isNull(tasks.projectId));

/**
 * The inbox ("Bandeja"): pending tasks with neither an area nor a project, the newest first
 * (what was just captured is on top).
 */
export async function selectInboxTasks(db: Database): Promise<TaskItem[]> {
  const rows = await selectItems(db, and(visibleTask, pending, inInbox)).orderBy(
    sql`${tasks.createdAt} desc`,
    tasks.id,
  );
  return rows.map((row) => toItem(row));
}

/** One task (done or not), unless it doesn't exist or is deleted. */
export async function selectTaskById(db: Database | Tx, id: string): Promise<TaskItem | null> {
  const [row] = await selectItems(db, and(eq(tasks.id, id), visibleTask));
  return row ? toItem(row) : null;
}

/** How long after a delete the list still offers its "Deshacer" (`?deleted=<id>`). */
export const RECENT_DELETE_MINUTES = 10;

/** A task deleted in the last minutes (for the list's undo notice), or null. */
export async function selectDeletedTaskById(db: Database, id: string): Promise<DeletedTask | null> {
  const [task] = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.id, id),
        isNotNull(tasks.deletedAt),
        gt(tasks.deletedAt, sql`now() - make_interval(mins => ${RECENT_DELETE_MINUTES})`),
      ),
    );
  return task ?? null;
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/**
 * Where a task can go: the active areas in their order, and the projects that are neither
 * deleted, done nor canceled, by name, with their area.
 */
export async function selectTaskTargets(db: Database): Promise<TaskTargets> {
  const [areas, open] = await Promise.all([
    db
      .select(areaColumns(lifeAreas))
      .from(lifeAreas)
      .where(isNull(lifeAreas.archivedAt))
      .orderBy(lifeAreas.sortOrder, lifeAreas.id),
    db
      .select({ id: projects.id, name: projects.name, status: projects.status, area: areaColumns(lifeAreas) })
      .from(projects)
      .innerJoin(lifeAreas, eq(lifeAreas.id, projects.lifeAreaId))
      .where(and(isNull(projects.deletedAt), notInArray(projects.status, [...CLOSED_STATUSES]))),
  ]);
  const sorted = [...open].sort(
    (a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { areas, projects: sorted };
}

/** Why a placement was refused. */
export type PlacementFailure = "areaUnavailable" | "projectUnavailable" | "milestoneUnavailable";

/**
 * Checks where a task goes, locking what it goes into FOR SHARE until the transaction ends.
 * What it already is in passes unchanged (a task keeps an area archived since, or a project
 * closed since, until it is moved). A new area must be active; a new project open (not deleted,
 * done or canceled); a milestone must be a live one of that project (SPEC-tasks: a milestone of
 * another project is refused).
 */
async function checkPlacement(
  tx: Tx,
  next: TaskPlacement,
  current: TaskPlacement | null,
): Promise<PlacementFailure | null> {
  if (next.projectId !== null && next.projectId !== current?.projectId) {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, next.projectId),
          isNull(projects.deletedAt),
          notInArray(projects.status, [...CLOSED_STATUSES]),
        ),
      )
      .for("share");
    if (!project) return "projectUnavailable";
  }
  const sameMilestone =
    next.milestoneId === current?.milestoneId && next.projectId === current?.projectId;
  if (next.milestoneId !== null && next.projectId !== null && !sameMilestone) {
    const [milestone] = await tx
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(
        and(
          eq(projectMilestones.id, next.milestoneId),
          eq(projectMilestones.projectId, next.projectId),
          isNull(projectMilestones.deletedAt),
        ),
      )
      .for("share");
    if (!milestone) return "milestoneUnavailable";
  }
  if (next.lifeAreaId !== null && next.lifeAreaId !== current?.lifeAreaId) {
    const [area] = await tx
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(and(eq(lifeAreas.id, next.lifeAreaId), isNull(lifeAreas.archivedAt)))
      .for("share");
    if (!area) return "areaUnavailable";
  }
  return null;
}

/**
 * Creates a task: in the inbox, or in an area or project (checked like a move). Returns the
 * task, or why the placement was refused (writing nothing).
 */
export async function insertTask(
  db: Database,
  input: CreateTaskInput,
): Promise<TaskItem | PlacementFailure> {
  return db.transaction(async (tx) => {
    await lockProjectTasks(tx, [input.projectId]);
    const failure = await checkPlacement(tx, input, null);
    if (failure) return failure;
    const [created] = await tx
      .insert(tasks)
      .values({
        title: input.title,
        priority: input.priority,
        dueDate: input.dueDate,
        lifeAreaId: input.lifeAreaId,
        projectId: input.projectId,
        milestoneId: input.milestoneId,
        ...recurrenceColumns(input.recurrence),
      })
      .returning({ id: tasks.id });
    // T4: its tags, created on first use, in the same transaction.
    if (input.tags?.length) await writeTaskTags(tx, created.id, input.tags, { fresh: true });
    return (await selectTaskById(tx, created.id)) as TaskItem;
  });
}

/** The columns an edit writes (never `done_at`, `deleted_at` or the timestamps directly). */
type TaskEdit = Pick<
  PgUpdateSetSource<typeof tasks>,
  "title" | "priority" | "dueDate" | "lifeAreaId" | "projectId" | "milestoneId" | "isNextAction"
>;

/**
 * Edits a task's own fields (title, priority, due date, placement); missing fields stay. A move
 * clears the next-action mark (it belongs to the project it leaves). Null when the task doesn't
 * exist or is deleted; a refused placement writes nothing.
 */
export async function updateTask(
  db: Database,
  input: EditTaskInput,
): Promise<TaskItem | PlacementFailure | null> {
  return db.transaction(async (tx) => {
    const { placement } = input;
    if (placement) {
      // Unlocked read of the project it is in now, only to know which locks to take first. If
      // another write moves it between this read and the row lock below, the lock of that new
      // project isn't held: fine for T1 (a move only clears the next-action mark); T5, which
      // sets the mark, must re-check `current.projectId` against the locked ones.
      const [before] = await tx
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.id, input.id), visibleTask));
      if (!before) return null;
      await lockProjectTasks(tx, [before.projectId, placement.projectId]);
    }
    const [current] = await tx
      .select({
        lifeAreaId: tasks.lifeAreaId,
        projectId: tasks.projectId,
        milestoneId: tasks.milestoneId,
      })
      .from(tasks)
      .where(and(eq(tasks.id, input.id), visibleTask))
      .for("update");
    if (!current) return null;

    const values: TaskEdit = {};
    if (input.title !== undefined) values.title = input.title;
    if (input.priority !== undefined) values.priority = input.priority;
    if (input.dueDate !== undefined) values.dueDate = input.dueDate;
    if (placement) {
      const failure = await checkPlacement(tx, placement, current);
      if (failure) return failure;
      values.lifeAreaId = placement.lifeAreaId;
      values.projectId = placement.projectId;
      values.milestoneId = placement.milestoneId;
      if (placement.projectId !== current.projectId) values.isNextAction = false;
    }
    if (Object.keys(values).length > 0) {
      await tx.update(tasks).set(values).where(eq(tasks.id, input.id));
    }
    return selectTaskById(tx, input.id);
  });
}

/**
 * Takes the task lock of the project a task is in now, before any row lock (see the header):
 * a recurring completion puts its next occurrence in that project, and its undo takes it out.
 * Unlocked read: if a move lands between it and the row lock, the new project's lock isn't held
 * — fine, the occurrence never carries the next-action mark (what the lock protects, with T5).
 */
async function lockTaskProject(tx: Tx, id: string) {
  const [before] = await tx
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, id), visibleTask));
  if (before) await lockProjectTasks(tx, [before.projectId]);
}

/**
 * Marks a task done. Idempotent by `done_at`: completing it twice (a double tap) keeps the first
 * date and reports `changed: false`, so the next occurrence of a recurring task (T3) is created
 * once, in this same transaction (`next`: its id, or null). Clears the next-action mark
 * (SPEC-tasks: it is not passed on). Null when the task doesn't exist or is deleted.
 */
export async function completeTaskById(
  db: Database,
  id: string,
): Promise<{
  task: TaskItem;
  changed: boolean;
  next: TaskItem | null;
  /** Why the next one went to the inbox (its place was closed), or null. */
  nextInbox: SpawnInbox | null;
} | null> {
  return db.transaction(async (tx) => {
    await lockTaskProject(tx, id);
    // The row lock makes a second, concurrent completion wait and then see `done_at` set.
    const [completed] = await tx
      .update(tasks)
      .set({ doneAt: sql`now()`, isNextAction: false })
      .where(and(eq(tasks.id, id), visibleTask, pending))
      .returning(COMPLETED_COLUMNS);
    // T3: the next occurrence of a recurring task (only when this call completed it).
    const spawned = completed ? await spawnNextOccurrence(tx, completed) : null;
    const task = await selectTaskById(tx, id);
    if (!task) return null;
    const next = spawned ? await selectTaskById(tx, spawned.id) : null;
    return { task, changed: completed !== undefined, next, nextInbox: spawned?.inbox ?? null };
  });
}

/**
 * Undoes a completion ("Deshacer"): the task is pending again, and the occurrence its completion
 * spawned (T3) is removed if untouched (`spawn`: "removed", "kept" when it was already edited,
 * or null when there was none). Undoing twice changes nothing. Null when the task doesn't exist
 * or is deleted.
 */
export async function reopenTaskById(
  db: Database,
  id: string,
): Promise<{ task: TaskItem; changed: boolean; spawn: SpawnUndo | null } | null> {
  return db.transaction(async (tx) => {
    await lockTaskProject(tx, id);
    const updated = await tx
      .update(tasks)
      .set({ doneAt: null })
      .where(and(eq(tasks.id, id), visibleTask, isNotNull(tasks.doneAt)))
      .returning({ id: tasks.id });
    // T3: only the call that reopened it touches the occurrence.
    const spawn = updated.length > 0 ? await removeUntouchedSpawn(tx, id) : null;
    const task = await selectTaskById(tx, id);
    return task ? { task, changed: updated.length > 0, spawn } : null;
  });
}

/**
 * Soft delete: stamps `deleted_at`, so the task leaves every view but stays in `pnpm db:export`.
 * Also clears its next-action mark. Null when it doesn't exist or is already deleted.
 */
export async function softDeleteTask(db: Database, id: string): Promise<DeletedTask | null> {
  const [task] = await db
    .update(tasks)
    .set({ deletedAt: sql`now()`, isNextAction: false })
    .where(and(eq(tasks.id, id), visibleTask))
    .returning({ id: tasks.id, title: tasks.title });
  return task ?? null;
}

/**
 * Undoes a soft delete. Restoring one that isn't deleted changes nothing (a second "Deshacer" is
 * not an error). Null only when the task doesn't exist at all.
 *
 * T3: a deleted occurrence of a recurring task whose completed task already has another live
 * occurrence (it was deleted, the completion undone and done again) can't come back as a second
 * "next one" (`tasks_spawned_from_unique`): it comes back **detached**, a task of its own
 * (`spawned_from_id` cleared, `detached: true`), instead of failing.
 */
export async function restoreTaskById(
  db: Database,
  id: string,
): Promise<{ task: TaskItem; detached: boolean } | null> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .select({ spawnedFromId: tasks.spawnedFromId })
      .from(tasks)
      .where(and(eq(tasks.id, id), isNotNull(tasks.deletedAt)))
      .for("update");
    let detached = false;
    if (deleted) {
      const parentId = deleted.spawnedFromId;
      if (parentId !== null) {
        // A completion of the parent in flight holds its row: wait for it, then look.
        await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, parentId)).for("share");
        const [sibling] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.spawnedFromId, parentId), isNull(tasks.deletedAt)));
        detached = sibling !== undefined;
      }
      await tx
        .update(tasks)
        .set(detached ? { deletedAt: null, spawnedFromId: null } : { deletedAt: null })
        .where(eq(tasks.id, id));
    }
    const task = await selectTaskById(tx, id);
    return task ? { task, detached } : null;
  });
}
