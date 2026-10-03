// What the daily board shows (SPEC-today "Pantalla"), pure and client-safe. It combines what the
// provider modules say, never decides their rules: whether a habit counts as done is `habits`'
// `todayCount` (the same "N de M" as /habits), never a copy of it.
import type { HabitItem } from "@/modules/habits/habit-input";
import { todayCount } from "@/modules/habits/habit-status";

/**
 * Id of the board's `<h1 tabIndex={-1}>` (the greeting): where focus goes when the focused
 * element leaves with a whole section (its last task completed, D2; the section hidden). A
 * section that only loses a row focuses its next row, or its own heading.
 */
export const TODAY_HEADING_ID = "today-title";

/**
 * How many items each section has. D1 fills `habits`; D2 (`tasks`, from
 * `getTasksTodaySummary`) and D3 (`projects`, from `getProjectsTodaySummary`) pass theirs through
 * the board's slots; 0 (or nothing) means the section has nothing today.
 */
export type TodayCounts = {
  habits: number;
  tasks?: number;
  projects?: number;
  /** D4: "Día completo" is shown. Never next to the empty day (it only shows after activity). */
  dayComplete?: boolean;
};

/** Which sections are on the board, in the spec's order, and whether the day is empty. */
export type TodaySections = {
  habits: boolean;
  tasks: boolean;
  projects: boolean;
  /** Nothing at all today: the calm "Nada programado para hoy" instead of the sections. */
  empty: boolean;
};

/**
 * A section without items is not shown; with none at all (and no "Día completo") the day is
 * empty (principle 13). "Día completo" and the empty day never show together.
 */
export function todaySections(counts: TodayCounts): TodaySections {
  const habits = counts.habits > 0;
  const tasks = (counts.tasks ?? 0) > 0;
  const projects = (counts.projects ?? 0) > 0;
  const dayComplete = counts.dayComplete ?? false;
  return { habits, tasks, projects, empty: !habits && !tasks && !projects && !dayComplete };
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
