// "Saltar hoy" rules (polish), pure and client-safe: what a skip is, and the month's count.
import { HABIT_SKIP_REASON, PENDING_PREFIX } from "./habit-constants";
import type { HabitItem, HabitPauseSummary } from "./habit-input";
import { isPausedToday } from "./habit-status";
import { isScheduledOn } from "./schedule";

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
 * Whether the reason is the reserved one (trimmed, case and accents ignored): only "Saltar hoy"
 * writes it, so the month's count is never inflated by a pause typed by hand.
 */
export function isReservedReason(reason: string | null): boolean {
  if (reason === null) return false;
  const plain = reason.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  return plain === HABIT_SKIP_REASON.toLowerCase();
}

/**
 * Whether "Saltar hoy" is offered: only a habit to keep (resting from "no fumar" makes no sense:
 * decisión autónoma para revisar con el owner), due today (`isScheduledOn`: "X por semana" is due
 * every day, fixed days only on theirs) and not already paused today. Archived habits never reach
 * a pad.
 */
export function canSkipToday(habit: HabitItem, today: string): boolean {
  return habit.kind === "build" && isScheduledOn(habit, today) && !isPausedToday(habit, today);
}

/** The pause the optimistic view shows while the skip is saved (its id isn't a real one). */
export const PENDING_SKIP_PREFIX = `${PENDING_PREFIX}skip-`;

export function pendingSkip(habitId: string, today: string): HabitPauseSummary {
  return {
    id: `${PENDING_SKIP_PREFIX}${habitId}`,
    startDate: today,
    endDate: today,
    reason: HABIT_SKIP_REASON,
  };
}
