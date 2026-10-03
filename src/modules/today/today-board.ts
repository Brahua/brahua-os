// What the daily board shows (SPEC-today "Pantalla"), pure and client-safe. It combines what the
// provider modules say, never decides their rules: whether a habit counts as done is `habits`'
// `todayCount` (the same "N de M" as /habits), never a copy of it.
import type { HabitItem } from "@/modules/habits/habit-input";
import { todayCount } from "@/modules/habits/habit-status";

/**
 * How many items each section has. D1 fills `habits`; D2 (`tasks`, from
 * `getTasksTodaySummary`) and D3 (`projects`, from `getProjectsTodaySummary`) pass theirs through
 * the board's slots; 0 (or nothing) means the section has nothing today.
 */
export type TodayCounts = {
  habits: number;
  tasks?: number;
  projects?: number;
};

/** Which sections are on the board, in the spec's order, and whether the day is empty. */
export type TodaySections = {
  habits: boolean;
  tasks: boolean;
  projects: boolean;
  /** Nothing at all today: the calm "Nada programado para hoy" instead of the sections. */
  empty: boolean;
};

/** A section without items is not shown; with none at all the day is empty (principle 13). */
export function todaySections(counts: TodayCounts): TodaySections {
  const habits = counts.habits > 0;
  const tasks = (counts.tasks ?? 0) > 0;
  const projects = (counts.projects ?? 0) > 0;
  return { habits, tasks, projects, empty: !habits && !tasks && !projects };
}

/**
 * "X de N" of the "Hábitos" section: of the habits due today (what `getHabitsDueToday` returns,
 * already without paused ones), how many count as done by `habits`' rule (a day done, a weekly
 * habit's week met, a habit to avoid without a relapse).
 */
export function habitsProgress(
  habits: readonly HabitItem[],
  today: string,
): { done: number; total: number } {
  return todayCount(habits, today);
}
