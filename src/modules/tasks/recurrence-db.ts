// Recurrence writes (T3, server only), called by `completeTaskById` and `reopenTaskById` inside
// their transaction (SPEC-tasks "Recurrencia": the next occurrence is created in the same
// transaction as the completion, and "Deshacer" removes it if it is untouched). No value import
// from tasks.ts (it imports this file).
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { CLOSED_STATUSES } from "@/modules/projects/project-close";
import { taskTagLinks, tasks } from "./db/schema";
import { nextDueDate } from "./recurrence";
import type { TaskRecurrence } from "./task-input";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The four recurrence columns of a rule (all null without one). */
export function recurrenceColumns(rule: TaskRecurrence | null | undefined) {
  return {
    recurrenceKind: rule?.kind ?? null,
    recurrenceInterval: rule?.interval ?? null,
    recurrenceWeekdays: rule?.weekdays ?? null,
    recurrenceMonthDay: rule?.monthDay ?? null,
  };
}

/** What the next occurrence copies from the one just completed. */
export type CompletedRow = Pick<
  typeof tasks.$inferSelect,
  | "id"
  | "title"
  | "notes"
  | "priority"
  | "dueDate"
  | "dueTime"
  | "doneAt"
  | "lifeAreaId"
  | "projectId"
  | "milestoneId"
  | "recurrenceKind"
  | "recurrenceInterval"
  | "recurrenceWeekdays"
  | "recurrenceMonthDay"
>;

/** The columns `completeTaskById` returns from its update, for `spawnNextOccurrence`. */
export const COMPLETED_COLUMNS = {
  id: tasks.id,
  title: tasks.title,
  notes: tasks.notes,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  dueTime: tasks.dueTime,
  doneAt: tasks.doneAt,
  lifeAreaId: tasks.lifeAreaId,
  projectId: tasks.projectId,
  milestoneId: tasks.milestoneId,
  recurrenceKind: tasks.recurrenceKind,
  recurrenceInterval: tasks.recurrenceInterval,
  recurrenceWeekdays: tasks.recurrenceWeekdays,
  recurrenceMonthDay: tasks.recurrenceMonthDay,
};

function ruleOf(row: CompletedRow): TaskRecurrence | null {
  if (!row.recurrenceKind) return null;
  return {
    kind: row.recurrenceKind,
    interval: row.recurrenceInterval,
    weekdays: row.recurrenceWeekdays,
    monthDay: row.recurrenceMonthDay,
  };
}

/**
 * Why the next occurrence went to the inbox instead of where the completed one was: its project
 * is no longer open (done, canceled or deleted), or its own area is archived. Null: same place.
 */
export type SpawnInbox = "project" | "area";

type Placement = Pick<CompletedRow, "lifeAreaId" | "projectId" | "milestoneId">;

/**
 * Where the next occurrence goes (decision of review round 1, SPEC-tasks "Recurrencia"): where
 * the completed one is, unless that is closed — a project done, canceled or deleted, or its own
 * area archived — then the inbox (no area, project or milestone). A soft-deleted milestone is
 * not copied (no milestone). What it reads stays locked FOR SHARE until the transaction ends.
 */
async function nextPlacement(
  tx: Tx,
  completed: Placement,
): Promise<{ placement: Placement; inbox: SpawnInbox | null }> {
  const inbox = { lifeAreaId: null, projectId: null, milestoneId: null };
  if (completed.projectId !== null) {
    const [project] = await tx
      .select({ status: projects.status, deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, completed.projectId))
      .for("share");
    const closed = (CLOSED_STATUSES as readonly string[]).includes(project?.status ?? "");
    if (!project || project.deletedAt !== null || closed) {
      return { placement: inbox, inbox: "project" };
    }
    let milestoneId: string | null = null;
    if (completed.milestoneId !== null) {
      const [milestone] = await tx
        .select({ id: projectMilestones.id })
        .from(projectMilestones)
        .where(
          and(eq(projectMilestones.id, completed.milestoneId), isNull(projectMilestones.deletedAt)),
        )
        .for("share");
      milestoneId = milestone?.id ?? null;
    }
    return {
      placement: { lifeAreaId: null, projectId: completed.projectId, milestoneId },
      inbox: null,
    };
  }
  if (completed.lifeAreaId !== null) {
    const [area] = await tx
      .select({ archivedAt: lifeAreas.archivedAt })
      .from(lifeAreas)
      .where(eq(lifeAreas.id, completed.lifeAreaId))
      .for("share");
    if (!area || area.archivedAt !== null) return { placement: inbox, inbox: "area" };
  }
  // Its own area (active), or the inbox it was in.
  return {
    placement: { lifeAreaId: completed.lifeAreaId, projectId: null, milestoneId: null },
    inbox: null,
  };
}

/**
 * Creates the next occurrence of a recurring task that was just completed (the caller holds its
 * row lock and only calls this when its own update changed `done_at`, so a double tap spawns
 * once). It copies the title, notes, priority, the tags and the rule, and goes where the
 * completed one was (or to the inbox if that is closed: `nextPlacement`); its due date is the
 * rule's next one (`nextDueDate`, from the completion day in Lima and the completed one's due
 * date), and `spawned_from_id` points back to the completed task. Its `updated_at` equals its
 * `created_at` until someone edits it ("untouched", for the undo).
 *
 * At most one live occurrence per completed task (`tasks_spawned_from_unique`): completing it
 * again after an undo that kept an edited occurrence creates nothing new and returns that one
 * while it is still pending (a done one is not "the next one": null). Null too when the task
 * doesn't recur.
 */
export async function spawnNextOccurrence(
  tx: Tx,
  completed: CompletedRow,
): Promise<{ id: string; inbox: SpawnInbox | null } | null> {
  const rule = ruleOf(completed);
  if (!rule || !completed.doneAt) return null;
  const { placement, inbox } = await nextPlacement(tx, completed);
  const [created] = await tx
    .insert(tasks)
    .values({
      title: completed.title,
      notes: completed.notes,
      priority: completed.priority,
      dueDate: nextDueDate(rule, completed.doneAt, completed.dueDate),
      // polish -> task-time: the next occurrence keeps the hour (the next day is always set).
      dueTime: completed.dueTime,
      ...placement,
      ...recurrenceColumns(rule),
      spawnedFromId: completed.id,
    })
    .onConflictDoNothing({ target: tasks.spawnedFromId, where: sql`deleted_at is null` })
    .returning({ id: tasks.id });
  if (!created) {
    const [existing] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.spawnedFromId, completed.id),
          isNull(tasks.deletedAt),
          isNull(tasks.doneAt),
        ),
      );
    return existing ? { id: existing.id, inbox: null } : null;
  }
  // The tags (T4 writes them; the links table exists since T1): the same ones.
  await tx.execute(sql`
    insert into ${taskTagLinks} (task_id, tag_id)
    select ${created.id}, ${taskTagLinks.tagId} from ${taskTagLinks}
    where ${taskTagLinks.taskId} = ${completed.id}
  `);
  return { id: created.id, inbox };
}

/** What "Deshacer" did with the occurrence the completion had spawned. */
export type SpawnUndo = "removed" | "kept";

/**
 * Undo of a completion (SPEC-tasks "Deshacer al completar"): soft-deletes the live occurrence
 * the task spawned, but only if it is untouched: never edited (`updated_at = created_at`; every
 * Drizzle update stamps `updated_at`, and T4 must stamp it when the tags change), still pending
 * and not deleted. Otherwise it stays (the owner already worked on it) and only the original
 * reopens. Null when there was none (not recurring, or already gone).
 */
export async function removeUntouchedSpawn(tx: Tx, completedId: string): Promise<SpawnUndo | null> {
  const [spawn] = await tx
    .select({
      id: tasks.id,
      untouched: sql<boolean>`${tasks.updatedAt} = ${tasks.createdAt} and ${tasks.doneAt} is null`,
    })
    .from(tasks)
    .where(and(eq(tasks.spawnedFromId, completedId), isNull(tasks.deletedAt)))
    .for("update");
  if (!spawn) return null;
  if (!spawn.untouched) return "kept";
  await tx
    .update(tasks)
    .set({ deletedAt: sql`now()`, isNextAction: false })
    .where(eq(tasks.id, spawn.id));
  return "removed";
}
