// A task's milestone (T2; server only). SPEC-tasks "Hito": optional, only with a project, and it
// must be a live milestone of THAT project. Callers check the owner and validate first.
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { tasks } from "./db/schema";
import type { TaskItem } from "./task-input";
import { selectTaskById, visibleTask } from "./tasks";

/** A milestone a task can be in (its project's live ones, in their order). */
export type TaskMilestoneOption = { id: string; title: string; done: boolean };

/** The live milestones of a project that isn't deleted, in order ([] otherwise). */
export async function selectMilestoneOptions(
  db: Database,
  projectId: string,
): Promise<TaskMilestoneOption[]> {
  const rows = await db
    .select({
      id: projectMilestones.id,
      title: projectMilestones.title,
      doneAt: projectMilestones.doneAt,
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(
      and(
        eq(projectMilestones.projectId, projectId),
        isNull(projectMilestones.deletedAt),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(projectMilestones.sortOrder, projectMilestones.id);
  return rows.map(({ id, title, doneAt }) => ({ id, title, done: doneAt !== null }));
}

export type MilestoneFailure = "notFound" | "withoutProject" | "milestoneUnavailable";

/**
 * Sets (or clears, with null) a task's milestone. The project is the task's own as stored, read
 * under the row lock, so a milestone is checked against where the task really is, not against
 * what a stale screen showed. Locks: the task row FOR UPDATE, then the milestone FOR SHARE (the
 * same order as `updateTask`; a milestone deleted at the same time waits). No project lock: the
 * task doesn't enter or leave a project.
 */
export async function setTaskMilestoneById(
  db: Database,
  id: string,
  milestoneId: string | null,
): Promise<TaskItem | MilestoneFailure> {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, id), visibleTask))
      .for("update");
    if (!task) return "notFound";
    if (milestoneId !== null) {
      if (task.projectId === null) return "withoutProject";
      const [milestone] = await tx
        .select({ id: projectMilestones.id })
        .from(projectMilestones)
        .where(
          and(
            eq(projectMilestones.id, milestoneId),
            eq(projectMilestones.projectId, task.projectId),
            isNull(projectMilestones.deletedAt),
          ),
        )
        .for("share");
      if (!milestone) return "milestoneUnavailable";
    }
    await tx.update(tasks).set({ milestoneId }).where(eq(tasks.id, id));
    return (await selectTaskById(tx, id)) as TaskItem;
  });
}
