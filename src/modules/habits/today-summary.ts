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
export function buildHabitsTodaySummary(
  habits: readonly HabitItem[],
  now: Date,
): HabitTodayItem[] {
  return dueOn(habits, ownerDateKey(now)).map(habitTodayItem);
}

/** One habit's DTO (its day as read). */
export function habitTodayItem(habit: HabitItem): HabitTodayItem {
  const dayDone = isDayDone(habit);
  return {
    id: habit.id,
    name: habit.name,
    area: habit.area
      ? { id: habit.area.id, name: habit.area.name, color: habit.area.color }
      : null,
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
