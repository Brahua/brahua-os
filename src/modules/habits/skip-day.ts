// "Saltar hoy" rules (polish), pure and client-safe: what a skip is, and the month's count.
import { HABIT_SKIP_REASON } from "./habit-constants";
import type { HabitItem, HabitPauseSummary } from "./habit-input";
import { isPausedToday } from "./habit-status";

type PauseDays = Pick<HabitPauseSummary, "startDate" | "endDate" | "reason">;

/** A skip is a pause of exactly one day with the reason "Descanso". */
export function isSkipPause(pause: PauseDays): boolean {
  return pause.startDate === pause.endDate && pause.reason === HABIT_SKIP_REASON;
}

/**
 * How many days of `month` (YYYY-MM, Lima) the habit rested with "Saltar hoy": its one-day
 * "Descanso" pauses in that month (callers pass the pauses that aren't removed).
 */
export function skippedDaysInMonth(pauses: readonly PauseDays[], month: string): number {
  return pauses.filter((pause) => isSkipPause(pause) && pause.startDate.startsWith(`${month}-`))
    .length;
}

/**
 * Whether "Saltar hoy" is offered: only a habit to keep (resting from "no fumar" makes no sense:
 * decisión autónoma para revisar con el owner), not already paused today. Archived habits never
 * reach a pad.
 */
export function canSkipToday(habit: HabitItem, today: string): boolean {
  return habit.kind === "build" && !isPausedToday(habit, today);
}

/** The pause the optimistic view shows while the skip is saved (its id isn't a real one). */
export const PENDING_SKIP_PREFIX = "pending-skip-";

export function pendingSkip(habitId: string, today: string): HabitPauseSummary {
  return {
    id: `${PENDING_SKIP_PREFIX}${habitId}`,
    startDate: today,
    endDate: today,
    reason: HABIT_SKIP_REASON,
  };
}
