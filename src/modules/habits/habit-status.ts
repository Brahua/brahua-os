// A habit's state on a day, as "Hoy" shows it (SPEC-habits "Rachas y cumplimiento"). Pure and
// client-safe: the pad, the live count and the optimistic view all use it. H4's `streak.ts`
// builds the streaks on `isDayDone` (one definition of a done day), not a copy of it.
import type { HabitItem } from "./habit-input";
import { isScheduledOn } from "./schedule";

/** What `isDayDone` needs of a habit and its day. */
export type HabitDay = Pick<HabitItem, "kind" | "quantity" | "target">;

/**
 * Whether the day is done: its quantity reached its target (a yes/no habit's target is 1). H3
 * slot (A evitar): for `avoid` the day is done when there is no relapse (quantity 0).
 */
export function isDayDone(day: HabitDay): boolean {
  return day.quantity >= day.target;
}

/** The habits due on `today`, in the list's (manual) order. */
export function dueOn<T extends HabitItem>(habits: readonly T[], today: string): T[] {
  return habits.filter((habit) => isScheduledOn(habit, today));
}

/** "N de M hoy": how many of the habits due today are done. */
export function todayCount(habits: readonly HabitItem[], today: string) {
  const due = dueOn(habits, today);
  return { done: due.filter(isDayDone).length, total: due.length };
}
