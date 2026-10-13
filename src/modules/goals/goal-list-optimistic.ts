// The optimistic view of the goals on /goals. Pure and client-safe: the screen applies a change
// at once and the server's answer (the page revalidates) replaces it.
import { applyOrder } from "@/modules/core/life-area-order";
import type { GoalItem } from "./goal-input";
import { achievementChange } from "./progress";

export type GoalListChange =
  /** Leaves the list (deleted). */
  | { type: "remove"; id: string }
  /** Comes back ("Deshacer") at its old place; replaces it if the list already has it. */
  | { type: "restore"; goal: GoalItem; index: number }
  /** Changes in place (an entry added, a status changed). */
  | { type: "update"; id: string; patch: Partial<GoalItem> }
  /** The manual order (goals missing from `ids` keep their relative order, after them). */
  | { type: "reorder"; ids: readonly string[] };

export function applyGoalListChange(list: GoalItem[], change: GoalListChange): GoalItem[] {
  switch (change.type) {
    case "remove":
      return list.filter((goal) => goal.id !== change.id);
    case "restore": {
      if (list.some((goal) => goal.id === change.goal.id)) {
        return list.map((goal) => (goal.id === change.goal.id ? change.goal : goal));
      }
      const at = Math.max(0, Math.min(change.index, list.length));
      return [...list.slice(0, at), change.goal, ...list.slice(at)];
    }
    case "update":
      return list.map((goal) => (goal.id === change.id ? { ...goal, ...change.patch } : goal));
    case "reorder":
      return applyOrder(list, change.ids);
  }
}

/**
 * The patch of an entry of `delta` on the goal as shown: the sum shown plus `delta`, absolute on
 * purpose (React keeps every optimistic update of a burst of taps until the last one settles, so
 * a relative "+1" would count a tap the server already applied twice), and the status the server
 * will reach by the same rule (`achievementChange`).
 */
export function entryPatch(goal: GoalItem, delta: number, now: Date): Partial<GoalItem> {
  const sum = goal.sum + delta;
  const change = achievementChange({
    status: goal.status,
    wasReached: goal.sum >= goal.target,
    nowReached: sum >= goal.target,
  });
  if (change === "achieve") {
    return { sum, status: "achieved", achievedAt: goal.achievedAt ?? now.toISOString() };
  }
  if (change === "reopen") return { sum, status: "active", achievedAt: null };
  return { sum };
}

/** The goal to focus when `id` leaves the list: the next one, else the previous, else none. */
export function neighborOf(list: readonly GoalItem[], id: string): GoalItem | null {
  const index = list.findIndex((goal) => goal.id === id);
  if (index === -1) return null;
  return list[index + 1] ?? list[index - 1] ?? null;
}
