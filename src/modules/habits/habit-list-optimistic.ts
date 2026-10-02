// The optimistic view of the habits on "Hoy". Pure and client-safe: the screen applies a change
// at once and the server's answer (the page revalidates) replaces it.
import { applyOrder } from "@/modules/core/life-area-order";
import type { HabitItem } from "./habit-input";

export type HabitListChange =
  /** Leaves the list (deleted; H2: archived). */
  | { type: "remove"; id: string }
  /** Comes back ("Deshacer") at its old place; replaces it if the list already has it. */
  | { type: "restore"; habit: HabitItem; index: number }
  /** Changes in place (a day logged). */
  | { type: "update"; id: string; patch: Partial<HabitItem> }
  /** H2: the manual order (habits missing from `ids` keep their relative order, after them). */
  | { type: "reorder"; ids: readonly string[] };

export function applyHabitListChange(list: HabitItem[], change: HabitListChange): HabitItem[] {
  switch (change.type) {
    case "remove":
      return list.filter((habit) => habit.id !== change.id);
    case "restore": {
      if (list.some((habit) => habit.id === change.habit.id)) {
        return list.map((habit) => (habit.id === change.habit.id ? change.habit : habit));
      }
      const at = Math.max(0, Math.min(change.index, list.length));
      return [...list.slice(0, at), change.habit, ...list.slice(at)];
    }
    case "update":
      return list.map((habit) => (habit.id === change.id ? { ...habit, ...change.patch } : habit));
    case "reorder":
      return applyOrder(list, change.ids);
  }
}

/**
 * The patch of a yes/no day marked (`done`) or unmarked, as the server will store it: either way
 * the day has a log row now (unmarked is 0), so it "has logs".
 */
export function donePatch(done: boolean): Partial<HabitItem> {
  return { quantity: done ? 1 : 0, hasLogs: true };
}

/** The habit to focus when `id` leaves the list: the next one, else the previous, else none. */
export function neighborOf(list: readonly HabitItem[], id: string): HabitItem | null {
  const index = list.findIndex((habit) => habit.id === id);
  if (index === -1) return null;
  return list[index + 1] ?? list[index - 1] ?? null;
}
