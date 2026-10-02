// The week of a "X veces por semana" habit as the pad shows it ("2 de 3 esta semana"). Pure and
// client-safe (H2). H4: the quota is proportional to the week's available days (a pause, a start
// date mid-week), the same `weekQuota` the weekly streak uses (streak.ts). Whether the day read
// is done comes from the caller (`isDayDone` of habit-status.ts, the one definition of a done
// day), so this file depends on nothing else.
import type { HabitItem } from "./habit-input";

/** What `weekProgress` needs of a habit. */
export type HabitWeek = Pick<
  HabitItem,
  "frequency" | "weeklyTarget" | "weekDoneBefore" | "weekAvailable"
>;

/**
 * A week's quota (SPEC-habits "X por semana"): `ceil(X × available / 7)`. With the whole week
 * available it is X; a pause or a start date mid-week asks for the proportional part. A week
 * with none is neutral (0).
 */
export function weekQuota(weeklyTarget: number, availableDays = 7): number {
  const available = Math.max(0, Math.min(7, availableDays));
  return Math.ceil((weeklyTarget * available) / 7);
}

/**
 * "2 de 3 esta semana": the days done this week (each day once: the ones before the day read,
 * plus that day when `doneToday`) over the week's quota (its available days, H4). Null for the
 * other frequencies.
 */
export function weekProgress(
  habit: HabitWeek,
  doneToday: boolean,
): { done: number; quota: number } | null {
  if (habit.frequency !== "weekly_count" || habit.weeklyTarget === null) return null;
  return {
    done: habit.weekDoneBefore + (doneToday ? 1 : 0),
    quota: weekQuota(habit.weeklyTarget, habit.weekAvailable),
  };
}

/** Whether the week's quota is met (it can be passed: 4 of 3). A neutral week never is. */
export function isWeekMet(habit: HabitWeek, doneToday: boolean): boolean {
  const progress = weekProgress(habit, doneToday);
  return progress !== null && progress.quota > 0 && progress.done >= progress.quota;
}
