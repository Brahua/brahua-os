// Days done of a habit inside a range (SPEC-goals "Hábito → avance"): pure and client-safe, built
// on the rules of streak.ts so a goal and the habit's own screens agree. `getHabitDoneDays`
// (contracts.ts) reads the history and calls this.
import { addDays, isScheduledOn } from "./schedule";
import {
  isAvailableOn,
  isDoneOn,
  streakUnit,
  type StreakHistory,
  type StreakRules,
} from "./streak";
import { proportionalQuota } from "./week-progress";

/** The days done in a range over the days that were expected of the habit in it. */
export type HabitDoneDays = { done: number; expected: number };

/**
 * The habit's done days from `from` to `to` (both included, Lima days), counted up to `today`
 * (later days can't be logged) and from the habit's start date on.
 *
 * - `done`: scheduled, available (started, not paused) days that are done by their own log
 *   (`isDoneOn`; a clean day of a habit to avoid is done). A paused or not scheduled day never
 *   counts, even with a log. An "X por semana" habit counts every logged day as done: the measure
 *   is days, never weeks (SPEC-goals "Hábito semanal").
 * - `expected`: the scheduled and available days elapsed, today only once done (it isn't over).
 *   For "X por semana" it is the proportional quota of the available days (`ceil(X × days / 7)`).
 */
export function doneDaysIn(
  habit: StreakRules,
  history: StreakHistory,
  range: { from: string; to: string },
  today: string,
): HabitDoneDays {
  const start = range.from > habit.startDate ? range.from : habit.startDate;
  const end = range.to < today ? range.to : today;
  let done = 0;
  let expected = 0;
  let available = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (!isAvailableOn(habit, history.pauses, day)) continue;
    available += 1;
    if (!isScheduledOn(habit, day)) continue;
    const isDone = isDoneOn(habit, history, day);
    if (isDone) done += 1;
    if (isDone || day !== today) expected += 1;
  }
  if (streakUnit(habit) === "weeks") {
    return { done, expected: proportionalQuota(habit.weeklyTarget ?? 0, available) };
  }
  return { done, expected };
}
