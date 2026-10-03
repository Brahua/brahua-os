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

// ── Tareas (D2) ──

/** How many tasks "Tareas" shows before "Ver N más" (SPEC-today: 3, principle 5). */
export const TODAY_TASKS_VISIBLE = 3;

/**
 * The fold of "Tareas": how many rows are shown and hidden, and what the toggle says ("more":
 * "Ver N más" with N = `hidden`; "less": "Ver menos"; null: no toggle, everything fits). The
 * expanded state lives on the page only (never remembered).
 */
export type TaskFold = { shown: number; hidden: number; toggle: "more" | "less" | null };

export function taskFold(total: number, expanded: boolean): TaskFold {
  const count = Math.max(0, total);
  if (count <= TODAY_TASKS_VISIBLE) return { shown: count, hidden: 0, toggle: null };
  if (expanded) return { shown: count, hidden: 0, toggle: "less" };
  return { shown: TODAY_TASKS_VISIBLE, hidden: count - TODAY_TASKS_VISIBLE, toggle: "more" };
}

/**
 * Where focus goes when the row `id` leaves the list `ids` (in its order before it leaves): the
 * next row, else the previous one, else (the list empties and the section leaves with it) the
 * board's heading. The next row is always a shown one: rows rise into the fold.
 */
export type TaskFocusTarget = { kind: "row"; id: string } | { kind: "board" };

export function focusAfterTaskLeaves(ids: readonly string[], id: string): TaskFocusTarget {
  const rest = ids.filter((other) => other !== id);
  if (rest.length === 0) return { kind: "board" };
  const index = ids.indexOf(id);
  if (index === -1) return { kind: "row", id: rest[0] };
  return { kind: "row", id: ids[index + 1] ?? ids[index - 1] };
}

/** An optimistic change to the "Tareas" list: a completed row leaves, an undone one returns. */
export type TodayTaskChange<T> =
  { type: "remove"; id: string } | { type: "restore"; task: T; index: number };

/** Applies a change; a row that is already there is never doubled (the server may be first). */
export function applyTodayTaskChange<T extends { id: string }>(
  list: readonly T[],
  change: TodayTaskChange<T>,
): T[] {
  if (change.type === "remove") return list.filter((task) => task.id !== change.id);
  if (list.some((task) => task.id === change.task.id)) return [...list];
  const index = Math.min(Math.max(0, change.index), list.length);
  return [...list.slice(0, index), change.task, ...list.slice(index)];
}
