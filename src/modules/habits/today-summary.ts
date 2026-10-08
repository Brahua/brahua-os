// What `habits` tells `today` (H6, SPEC-habits "Contratos"): the habits due today, by Lima's
// calendar day, with today's state. Pure and client-safe: the DTO, which habits enter and how
// each one reads. contracts.ts reads the habits (server-only) and builds the summary with this.
// Every rule comes from the module's own pure functions (habit-status.ts, week-progress.ts,
// streak.ts), so `today` and /habits never disagree.
import type { AreaColor } from "@/design-system/areas";
import { ownerDateKey } from "@/lib/time";
import type { HabitKind, HabitMeasure } from "./habit-constants";
import type { HabitItem } from "./habit-input";
import { countsAsDone, dueOn, isDayDone } from "./habit-status";
import { shownStreak, type Streak } from "./streak";
import { weekProgress } from "./week-progress";

/** A habit's area as `today` shows it (it may be archived since). */
export type HabitTodayArea = { id: string; name: string; color: AreaColor };

/** One habit for `today`: only what it needs to show it and link to it (`habitPath(id)`). */
export type HabitTodayItem = {
  id: string;
  name: string;
  area: HabitTodayArea | null;
  /** "build" (a cumplir) or "avoid" (a evitar: logs relapses). */
  kind: HabitKind;
  /** "check" (sí/no) or "quantity". */
  measure: HabitMeasure;
  /** The daily goal (1 for a yes/no). */
  goal: number;
  /** A quantity's unit ("vasos"), else null. */
  unit: string | null;
  /** What a tap adds (1 for a yes/no). */
  step: number;
  /** What is logged today (0 without a log; a habit to avoid: 1 with a relapse). */
  quantity: number;
  /**
   * Met today: the day is done (`isDayDone`: today's quantity reached today's target); for "X
   * veces por semana" also once the week's quota is met; for a habit to avoid, while there is no
   * relapse today.
   */
  done: boolean;
  /** "2 de 3 esta semana" (today included when done) for "X veces por semana", else null. */
  week: { done: number; quota: number } | null;
  /** The current streak as the pad shows it ("weeks" for "X veces por semana"). */
  streak: Streak;
};

/**
 * The summary from the active habits read with today's log (`today` = Lima's day of `now`): the
 * ones due today and not paused today (`dueOn`: daily, "X veces por semana" every day, even with
 * the week met, fixed days on theirs; never before the start date), in the order given (the
 * manual one).
 */
export function buildHabitsTodaySummary(habits: readonly HabitItem[], now: Date): HabitTodayItem[] {
  return habitsDueToday(habits, now).map(habitTodayItem);
}

/**
 * The habits due today (Lima's day of `now`) and not paused today, as full `HabitItem`s in the
 * order given: what `getHabitsDueToday` gives `today` for its pads (`HabitPad`, `useDayLog`,
 * `useQuantityLog` need the whole item), the same ones the summary describes.
 */
export function habitsDueToday<T extends HabitItem>(habits: readonly T[], now: Date): T[] {
  return dueOn(habits, ownerDateKey(now));
}

/** A habit with a reminder time that is still to do on a day (R4: `habit_time`). */
export type TimedHabit = { id: string; name: string; reminderTime: string };

/**
 * R4: of the active habits read for the Lima day of `at`, the ones that get a `habit_time`
 * reminder: due that day and not paused (`habitsDueToday`), a habit to keep (one to avoid has no
 * time), with a reminder time, and not met yet (`countsAsDone`: the day's quantity reached its
 * target, or, for "X veces por semana", the week's quota is met). The order given (the manual one).
 */
export function timedHabitsLeft(habits: readonly HabitItem[], at: Date): TimedHabit[] {
  return habitsDueToday(habits, at)
    .filter(
      (habit) => habit.kind === "build" && Boolean(habit.reminderTime) && !countsAsDone(habit),
    )
    .map((habit) => ({
      id: habit.id,
      name: habit.name,
      reminderTime: habit.reminderTime as string,
    }));
}

/** One habit's DTO (its day as read). */
export function habitTodayItem(habit: HabitItem): HabitTodayItem {
  const dayDone = isDayDone(habit);
  return {
    id: habit.id,
    name: habit.name,
    area: habit.area ? { id: habit.area.id, name: habit.area.name, color: habit.area.color } : null,
    kind: habit.kind,
    measure: habit.measure,
    goal: habit.goal,
    unit: habit.unit,
    step: habit.step,
    quantity: habit.quantity,
    done: countsAsDone(habit),
    week: weekProgress(habit, dayDone),
    streak: shownStreak(habit.streak, dayDone),
  };
}
