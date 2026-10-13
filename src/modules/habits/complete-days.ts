// «Días completos» of a week (SPEC-weekly-review "Decisiones": Días completos): pure and
// client-safe, built on the rules of streak.ts and schedule.ts so the ritual and the habits'
// own screens agree. `getHabitsWeekCompleteDays` (contracts.ts) reads the history and calls this.
import { isScheduledOn } from "./schedule";
import { isAvailableOn, isDoneOn, weekDays, type StreakHistory, type StreakRules } from "./streak";

/** One habit with its history of the week (the logs of its days and its pauses). */
export type CompleteDaysHabit = { rules: StreakRules; history: StreakHistory };

/** One day of the week: how many habits it asked for, how many are done, and the verdict. */
export type CompleteDay = {
  day: string;
  /** Habits that defined the day: scheduled, started and not paused (see `definesDay`). */
  scheduled: number;
  done: number;
  /** Every scheduled habit is done (and there is at least one). */
  complete: boolean;
};

export type HabitsWeekCompleteDays = {
  /** The Monday of the week. */
  weekStart: string;
  /** Monday to Sunday. */
  days: CompleteDay[];
  /** How many days are complete: «Días completos esta semana: N». */
  completeDays: number;
};

/**
 * Whether a habit defines a day for this count. Only «daily» and «fixed days» habits do: an «X por
 * semana» habit has no day it is due on (it can be done any day, and a day it was not done is not
 * a day it failed), so it never makes a day incomplete nor completes it (decisión autónoma para
 * revisar con el owner). A habit to avoid is daily: its clean day is done. The habit must be
 * started and not paused that day.
 */
export function definesDay(habit: CompleteDaysHabit, day: string): boolean {
  const { rules, history } = habit;
  if (rules.frequency === "weekly_count") return false;
  return isAvailableOn(rules, history.pauses, day) && isScheduledOn(rules, day);
}

/**
 * The 7 days of the week of `monday`: a day is complete when EVERY habit that defined it is done
 * (`isDoneOn`). A day no habit defined is neither complete nor missed (`scheduled: 0`). Days after
 * `today` aren't elapsed and count for nothing; `today` counts only once it is complete (an
 * unfinished today is not a failure, it simply isn't complete yet, so the same rule gives it
 * `complete: false`). Pure: `today` is Lima's day.
 */
export function completeDaysOf(
  monday: string,
  habits: readonly CompleteDaysHabit[],
  today: string,
): HabitsWeekCompleteDays {
  const days = weekDays(monday).map((day): CompleteDay => {
    if (day > today) return { day, scheduled: 0, done: 0, complete: false };
    let scheduled = 0;
    let done = 0;
    for (const habit of habits) {
      if (!definesDay(habit, day)) continue;
      scheduled += 1;
      if (isDoneOn(habit.rules, habit.history, day)) done += 1;
    }
    return { day, scheduled, done, complete: scheduled > 0 && done === scheduled };
  });
  return { weekStart: monday, days, completeDays: days.filter((day) => day.complete).length };
}
