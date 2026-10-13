// Step 1 · Logros of the ritual (SPEC-weekly-review "Pantallas"): the week's figures and what is
// worth naming under them, built from what the providers' contracts answer. Pure and client-safe
// (types only come from the contracts, erased at build time): the page reads, this decides.
import type { HabitsWeekCompleteDays, HabitsWeekSummary } from "@/modules/habits/contracts";
import type { GoalsWeekReview } from "@/modules/goals/contracts";
import type { ProjectsWeekReview } from "@/modules/projects/contracts";
import type { TasksWeekReview } from "@/modules/tasks/contracts";

/** How many of each highlight the screen lists. */
export const TOP_HABITS = 3;
export const RECENT_TASKS = 5;
export const LISTED_MILESTONES = 5;
export const LISTED_GOALS = 5;

export type HabitHighlight = { id: string; name: string; done: number; expected: number };

export type LogrosModel = {
  weekStart: string;
  /** «Días completos esta semana: N». */
  completeDays: number;
  /** The habits' «18 de 24». */
  habits: { done: number; expected: number };
  tasksDone: number;
  milestonesDone: number;
  goalsAchieved: number;
  /** The most consistent habits (done over expected, at least one done), best first. */
  topHabits: HabitHighlight[];
  recentTasks: { id: string; title: string }[];
  milestones: { id: string; title: string; projectName: string }[];
  goals: { id: string; title: string; href: string }[];
  /** Nothing to count: the screen says «Una semana tranquila» instead of four zeros alone. */
  quiet: boolean;
};

/**
 * The most consistent habits of the week: those with something expected and at least one done,
 * by the share done (then by how many, then by name). A habit with nothing done never shows (this
 * step names what was achieved, never what was missed).
 */
export function topHabits(
  habits: HabitsWeekSummary["habits"],
  limit = TOP_HABITS,
): HabitHighlight[] {
  return habits
    .filter(({ compliance }) => compliance.expected > 0 && compliance.done > 0)
    .map(({ id, name, compliance }) => ({
      id,
      name,
      done: compliance.done,
      expected: compliance.expected,
    }))
    .sort(
      (a, b) =>
        b.done / b.expected - a.done / a.expected ||
        b.done - a.done ||
        a.name.localeCompare(b.name, "es"),
    )
    .slice(0, limit);
}

export type LogrosSources = {
  habits: HabitsWeekSummary;
  completeDays: HabitsWeekCompleteDays;
  tasks: TasksWeekReview;
  projects: ProjectsWeekReview;
  goals: GoalsWeekReview;
};

/** The step's model from the five readings of the week. */
export function buildLogros(
  weekStart: string,
  { habits, completeDays, tasks, projects, goals }: LogrosSources,
): LogrosModel {
  const model: Omit<LogrosModel, "quiet"> = {
    weekStart,
    completeDays: completeDays.completeDays,
    habits: { done: habits.total.done, expected: habits.total.expected },
    tasksDone: tasks.doneCount,
    milestonesDone: projects.milestonesDone.length,
    goalsAchieved: goals.achieved.length,
    topHabits: topHabits(habits.habits),
    recentTasks: tasks.recentDone.map(({ id, title }) => ({ id, title })),
    milestones: projects.milestonesDone
      .slice(0, LISTED_MILESTONES)
      .map(({ id, title, projectName }) => ({ id, title, projectName })),
    goals: goals.achieved
      .slice(0, LISTED_GOALS)
      .map(({ id, title, href }) => ({ id, title, href })),
  };
  const quiet =
    model.completeDays === 0 &&
    model.habits.done === 0 &&
    model.tasksDone === 0 &&
    model.milestonesDone === 0 &&
    model.goalsAchieved === 0;
  return { ...model, quiet };
}
