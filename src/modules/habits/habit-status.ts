// A habit's state on a day, as "Hoy" shows it (SPEC-habits "Rachas y cumplimiento"). Pure and
// client-safe: the pad, the live count and the optimistic view all use it. H4's `streak.ts`
// builds the streaks on `isDayDone` (one definition of a done day), not a copy of it.
import type { HabitItem } from "./habit-input";
import { isScheduledOn } from "./schedule";
import { isWeekMet } from "./week-progress";

/** What `isDayDone` needs of a habit and its day. */
export type HabitDay = Pick<HabitItem, "kind" | "quantity" | "target">;

/**
 * Whether the day is done: its quantity reached its target (a yes/no habit's target is 1; a
 * quantity can go past it, 10/8). For a habit to avoid it is the other way round: the day is
 * done while there is no relapse (quantity 0, or no log at all).
 */
export function isDayDone(day: HabitDay): boolean {
  if (day.kind === "avoid") return day.quantity === 0;
  return day.quantity >= day.target;
}

/** Whether a habit to avoid has a relapse logged on the day (always false for the others). */
export function hasRelapse(day: HabitDay): boolean {
  return day.kind === "avoid" && day.quantity > 0;
}

/** The habits due on `today`, in the list's (manual) order. */
export function dueOn<T extends HabitItem>(habits: readonly T[], today: string): T[] {
  return habits.filter((habit) => isScheduledOn(habit, today));
}

/**
 * Whether a habit due today counts as done in "N de M hoy": its day is done or, for "X veces
 * por semana", its week is already met (SPEC-habits "Contratos": `done`). H2.
 */
export function countsAsDone(habit: HabitItem): boolean {
  const done = isDayDone(habit);
  return done || isWeekMet(habit, done);
}

/** "N de M hoy": how many of the habits due today are done. */
export function todayCount(habits: readonly HabitItem[], today: string) {
  const due = dueOn(habits, today);
  return { done: due.filter(countsAsDone).length, total: due.length };
}
