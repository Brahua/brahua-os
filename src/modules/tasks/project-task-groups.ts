// The "Tareas" section of a project (T5): pending tasks grouped by milestone and the optimistic
// next-action mark. Pure and client-safe.
import { PROJECT_TASKS_COPY } from "./project-tasks-copy";
import type { TaskItem } from "./task-input";
import { compareByDue, type TaskGroup } from "./task-views";

export type MilestoneRef = { id: string; title: string };

/** Key of the "Sin hito" group (never a uuid, so never a milestone's id). */
export const NO_MILESTONE_KEY = "none";

/**
 * Whether the section groups by milestone: when the project has milestones and some pending
 * task is in one of them (SPEC-tasks: "agrupadas por hito si hay hitos"). Otherwise one flat
 * list, without a lone "Sin hito" heading.
 */
export function groupsByMilestone(
  tasks: readonly Pick<TaskItem, "milestoneId">[],
  milestones: readonly MilestoneRef[],
): boolean {
  const known = new Set(milestones.map((milestone) => milestone.id));
  return tasks.some((task) => task.milestoneId !== null && known.has(task.milestoneId));
}

/**
 * Pending tasks in the section's order: by milestone (the project's milestone order; "Sin hito",
 * or a milestone the page doesn't know yet, last), then like "Todas" (due date, priority,
 * creation). Consecutive tasks of a milestone form its group (`groupRuns`).
 */
export function sortByMilestone<T extends TaskItem>(
  tasks: readonly T[],
  milestones: readonly MilestoneRef[],
): T[] {
  const rank = new Map(milestones.map((milestone, index) => [milestone.id, index]));
  const rankOf = (task: T) =>
    task.milestoneId !== null ? (rank.get(task.milestoneId) ?? milestones.length) : milestones.length;
  return [...tasks].sort((a, b) => rankOf(a) - rankOf(b) || compareByDue(a, b));
}

/** The group of a task: its milestone (by title) or "Sin hito". */
export function milestoneGroupOf(milestones: readonly MilestoneRef[]) {
  const titles = new Map(milestones.map((milestone) => [milestone.id, milestone.title]));
  return (task: Pick<TaskItem, "milestoneId">): TaskGroup => {
    const title = task.milestoneId !== null ? titles.get(task.milestoneId) : undefined;
    return title !== undefined && task.milestoneId !== null
      ? { key: task.milestoneId, label: title }
      : { key: NO_MILESTONE_KEY, label: PROJECT_TASKS_COPY.noMilestone };
  };
}

/** A change of the next-action mark, shown at once. */
export type NextActionChange = { id: string; next: boolean };

/**
 * The tasks with the mark changed: marking one unmarks every other (one per project); unmarking
 * touches only that one.
 */
export function applyNextActionChange<T extends Pick<TaskItem, "id" | "isNextAction">>(
  tasks: readonly T[],
  { id, next }: NextActionChange,
): T[] {
  return tasks.map((task) => {
    if (task.id === id) return task.isNextAction === next ? task : { ...task, isNextAction: next };
    return next && task.isNextAction ? { ...task, isNextAction: false } : task;
  });
}
