// Streaks and compliance of `habits` (SPEC-habits "Rachas y cumplimiento"): pure and client-safe,
// the one place these rules live. The server builds each habit's streaks with them (habits.ts),
// the pad picks the one that matches today's state, and H5 (week view, monthly calendar) and H6
// (`today`) reuse them. Days are Lima's (YYYY-MM-DD), weeks run Monday to Sunday.
//
// The rules, in short:
// - A day is done when its log reached the log's own `target` (the goal in force that day, so a
//   goal raised later never undoes a day); for a habit to avoid, when it has no relapse.
// - A day is available from `start_date` on and when no pause covers it. A paused day is
//   neutral even with a log: it neither breaks nor adds.
// - Daily and fixed days count days (fixed days only look at their weekdays). "X por semana"
//   counts weeks: a week is met when its done and available days reach its quota,
//   `ceil(X × available / 7)`; a week with no available day is neutral.
// - Today (or this week) adds once done and never breaks while it is not: it isn't over. A habit
//   to avoid counts today while it is clean, and a relapse today leaves it at 0.
import type { HabitFrequency, HabitKind } from "./habit-constants";
import { isDayDone } from "./habit-status";
import { addDays, isScheduledOn, weekStart } from "./schedule";
import { proportionalQuota, weekQuota } from "./week-progress";

/** What the streak rules need of a habit. */
export type StreakRules = {
  kind: HabitKind;
  frequency: HabitFrequency;
  weeklyTarget: number | null;
  weekdays: number[] | null;
  /** A day in Lima, YYYY-MM-DD: nothing before it counts. */
  startDate: string;
};

/** A day's log: its quantity and the goal in force that day. */
export type DayLog = { quantity: number; target: number };

/** A pause: both ends included. */
export type PauseRange = { startDate: string; endDate: string };

/** A habit's history: its logs by day (days without one are empty) and its pauses. */
export type StreakHistory = {
  logs: ReadonlyMap<string, DayLog>;
  pauses: readonly PauseRange[];
};

export type StreakUnit = "days" | "weeks";
export type Streak = { count: number; unit: StreakUnit };

/** The milestones the notice celebrates (days or weeks, by the habit's unit). */
export const STREAK_MILESTONES = [7, 30, 90, 365] as const;

/** Days of the week of `monday` (Monday first). */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** Whether a pause covers `day`. */
export function isPausedOn(pauses: readonly PauseRange[], day: string): boolean {
  return pauses.some((pause) => pause.startDate <= day && day <= pause.endDate);
}

/** Whether `day` is available: on or after the start date and not paused. */
export function isAvailableOn(habit: StreakRules, pauses: readonly PauseRange[], day: string) {
  return day >= habit.startDate && !isPausedOn(pauses, day);
}

/** Whether `day` is done by its own log (`isDayDone`; a habit to avoid's clean day is done). */
export function isDoneOn(habit: StreakRules, history: StreakHistory, day: string): boolean {
  const log = history.logs.get(day);
  return isDayDone({ kind: habit.kind, quantity: log?.quantity ?? 0, target: log?.target ?? 1 });
}

/** "X por semana" counts weeks; everything else counts days. */
export function streakUnit(habit: Pick<StreakRules, "frequency">): StreakUnit {
  return habit.frequency === "weekly_count" ? "weeks" : "days";
}

/** The days of a week that are available (start date, pauses), 0–7. */
export function availableDaysInWeek(
  habit: StreakRules,
  pauses: readonly PauseRange[],
  monday: string,
): number {
  return weekDays(monday).filter((day) => isAvailableOn(habit, pauses, day)).length;
}

export type WeekStatus = {
  /** Done and available days of the week up to `today` (each day once). */
  done: number;
  /** `ceil(X × available / 7)`: 0 is a neutral week. */
  quota: number;
};

/**
 * A "X por semana" week: its done and available days (up to `today`; later days can't be logged)
 * over its proportional quota. Paused days don't count even when they have a log.
 */
export function weekStatus(
  habit: StreakRules,
  history: StreakHistory,
  monday: string,
  today: string,
): WeekStatus {
  const days = weekDays(monday).filter((day) => isAvailableOn(habit, history.pauses, day));
  const done = days.filter((day) => day <= today && isDoneOn(habit, history, day)).length;
  return { done, quota: weekQuota(habit.weeklyTarget ?? 0, days.length) };
}

/** One step of a streak, oldest first: a day, or a week for "X por semana". */
type Period = { state: "done" | "open" | "neutral"; current: boolean };

/**
 * The habit's days (or weeks) from its start date to today, oldest first: done, open (not done)
 * or neutral (not scheduled, paused, a week with no available day). The last one is the current
 * day or week (`current`), which never breaks a streak.
 */
function periods(habit: StreakRules, history: StreakHistory, today: string): Period[] {
  if (habit.startDate > today) return [];
  const result: Period[] = [];
  if (streakUnit(habit) === "weeks") {
    const current = weekStart(today);
    for (let monday = weekStart(habit.startDate); monday <= current; monday = addDays(monday, 7)) {
      const week = weekStatus(habit, history, monday, today);
      const state = week.quota === 0 ? "neutral" : week.done >= week.quota ? "done" : "open";
      result.push({ state, current: monday === current });
    }
    return result;
  }
  for (let day = habit.startDate; day <= today; day = addDays(day, 1)) {
    const counts = isScheduledOn(habit, day) && isAvailableOn(habit, history.pauses, day);
    const state = !counts ? "neutral" : isDoneOn(habit, history, day) ? "done" : "open";
    result.push({ state, current: day === today });
  }
  return result;
}

/**
 * The current streak: done days (or met weeks) in a row back from today, skipping the neutral
 * ones, until the first open one or the start date. Today (this week) adds once done and, while
 * open, is skipped. A habit to avoid counts today while clean; a relapse today leaves it at 0.
 */
export function currentStreak(habit: StreakRules, history: StreakHistory, today: string): Streak {
  const unit = streakUnit(habit);
  const list = periods(habit, history, today);
  let count = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const { state, current } = list[index];
    if (state === "neutral") continue;
    if (state === "done") {
      count += 1;
      continue;
    }
    if (current && habit.kind !== "avoid") continue;
    break;
  }
  return { count, unit };
}

/** The best streak of the whole history (same rules; it is never shorter than the current). */
export function bestStreak(habit: StreakRules, history: StreakHistory, today: string): Streak {
  let best = 0;
  let run = 0;
  for (const { state, current } of periods(habit, history, today)) {
    if (state === "done") {
      run += 1;
      best = Math.max(best, run);
    } else if (state === "open" && (!current || habit.kind === "avoid")) {
      run = 0;
    }
  }
  return { count: best, unit: streakUnit(habit) };
}

/**
 * The streak either way today could end, so a screen can show the right one at once after a tap
 * (optimistic) without the history: `done` with today done (a habit to avoid: clean), `notDone`
 * without (a relapse). Both are the same when today doesn't count (not scheduled, paused).
 */
export type StreakChoice = { unit: StreakUnit; done: number; notDone: number };

export function streakChoice(
  habit: StreakRules,
  history: StreakHistory,
  today: string,
): StreakChoice {
  const target = history.logs.get(today)?.target ?? 1;
  const withToday = (log: DayLog): StreakHistory => ({
    pauses: history.pauses,
    logs: new Map(history.logs).set(today, log),
  });
  const avoid = habit.kind === "avoid";
  const done = withToday({ quantity: avoid ? 0 : target, target });
  const notDone = withToday({ quantity: avoid ? 1 : 0, target });
  return {
    unit: streakUnit(habit),
    done: currentStreak(habit, done, today).count,
    notDone: currentStreak(habit, notDone, today).count,
  };
}

/** The streak a screen shows for today's state (`dayDone`: `isDayDone` of today). */
export function shownStreak(choice: StreakChoice, dayDone: boolean): Streak {
  return { count: dayDone ? choice.done : choice.notDone, unit: choice.unit };
}

/** The milestone a change from `before` to `after` reaches (7, 30, 90, 365), or null. */
export function reachedMilestone(before: number, after: number): number | null {
  if (after <= before) return null;
  return STREAK_MILESTONES.find((milestone) => before < milestone && milestone <= after) ?? null;
}

// ── Compliance (H5: the week view and the monthly calendar) ──

/**
 * A day's state for the calendar (SPEC-habits "Detalle"): `beforeStart`, `future`, `paused`
 * (rest, never red), `notScheduled` (another weekday of a fixed-days habit), `done`, `partial`
 * (a quantity under its target) or `empty` (not done: shown empty, never as a failure). A logged
 * paused or unscheduled day keeps that state (it doesn't count); its log is still shown.
 */
export type DayStatus =
  "beforeStart" | "future" | "paused" | "notScheduled" | "done" | "partial" | "empty";

export function dayStatus(
  habit: StreakRules,
  history: StreakHistory,
  day: string,
  today: string,
): DayStatus {
  if (day < habit.startDate) return "beforeStart";
  if (day > today) return "future";
  if (isPausedOn(history.pauses, day)) return "paused";
  if (!isScheduledOn(habit, day)) return "notScheduled";
  if (isDoneOn(habit, history, day)) return "done";
  const quantity = history.logs.get(day)?.quantity ?? 0;
  return habit.kind === "build" && quantity > 0 ? "partial" : "empty";
}

/** "5 de 7", "2 de 3": done over expected. */
export type Compliance = { done: number; expected: number };

/**
 * A week's compliance (the week view's row and its total, "18 de 24"). Daily and fixed days:
 * scheduled and available days done, over the scheduled and available days elapsed; today only
 * counts once done (it isn't over). "X por semana": done days over the week's quota. A habit to
 * avoid: clean days over available days elapsed (today, while clean, counts: it is a clean day).
 */
export function weekCompliance(
  habit: StreakRules,
  history: StreakHistory,
  monday: string,
  today: string,
): Compliance {
  if (streakUnit(habit) === "weeks") {
    const week = weekStatus(habit, history, monday, today);
    return { done: week.done, expected: week.quota };
  }
  return daysCompliance(habit, history, weekDays(monday), today);
}

/**
 * Daily, fixed days and a habit to avoid over some days: the scheduled and available ones done,
 * over the scheduled and available ones elapsed (today only once done; a clean today is done).
 */
function daysCompliance(
  habit: StreakRules,
  history: StreakHistory,
  days: readonly string[],
  today: string,
): Compliance {
  let done = 0;
  let expected = 0;
  for (const day of days) {
    if (day > today) break;
    if (!isScheduledOn(habit, day) || !isAvailableOn(habit, history.pauses, day)) continue;
    const isDone = isDoneOn(habit, history, day);
    if (day === today && !isDone) continue;
    expected += 1;
    if (isDone) done += 1;
  }
  return { done, expected };
}

/** H5: the days of a month (`YYYY-MM`), first to last. */
export function monthDays(month: string): string[] {
  const days: string[] = [];
  for (let day = `${month}-01`; day.startsWith(month); day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * H5: a month's compliance (the habit page's stat), with the week's rules. Daily, fixed days and a
 * habit to avoid: as `weekCompliance`, over the month's days elapsed. "X por semana": its done
 * and available days up to today over the month's proportional quota, `ceil(X × available / 7)`
 * of the whole month's available days (the month is judged whole, like the week).
 */
export function monthCompliance(
  habit: StreakRules,
  history: StreakHistory,
  month: string,
  today: string,
): Compliance {
  const days = monthDays(month);
  if (streakUnit(habit) === "weeks") {
    const available = days.filter((day) => isAvailableOn(habit, history.pauses, day));
    const done = available.filter((day) => day <= today && isDoneOn(habit, history, day)).length;
    return { done, expected: proportionalQuota(habit.weeklyTarget ?? 0, available.length) };
  }
  return daysCompliance(habit, history, days, today);
}

/**
 * H5: the days done since the start date ("Llevas 42 días hechos", principle 10): scheduled,
 * available and done up to today (a logged paused or unscheduled day doesn't count). A habit to
 * avoid counts its clean days, today included while clean.
 */
export function totalDone(habit: StreakRules, history: StreakHistory, today: string): number {
  let total = 0;
  for (let day = habit.startDate; day <= today; day = addDays(day, 1)) {
    if (!isScheduledOn(habit, day) || !isAvailableOn(habit, history.pauses, day)) continue;
    if (isDoneOn(habit, history, day)) total += 1;
  }
  return total;
}
