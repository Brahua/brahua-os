// Days of `habits` (SPEC-habits "Semana y día"): pure, client-safe. A day is a Lima calendar day
// as YYYY-MM-DD (`ownerDateKey` of src/lib/time.ts gives today's); weeks run Monday to Sunday.
// Days are read and written as UTC dates so they never shift with the host's time zone.
import { HABIT_LOG_WINDOW_DAYS, type HabitFrequency } from "./habit-constants";

const DAY_MS = 86_400_000;

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** `day` moved by `days` (negative: earlier), across months and years. */
export function addDays(day: string, days: number): string {
  return new Date(toDate(day).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday of a day: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const weekday = toDate(day).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The Monday of the week `day` is in. */
export function weekStart(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

/** The first day that can still be logged: `HABIT_LOG_WINDOW_DAYS` before today. */
export function logWindowStart(today: string): string {
  return addDays(today, -HABIT_LOG_WINDOW_DAYS);
}

/**
 * Whether a day can be logged (marked, unmarked or corrected): today or up to 7 days before, and
 * never before the habit's start date. Future days never.
 */
export function isLoggableDay(day: string, today: string, startDate: string): boolean {
  return day <= today && day >= logWindowStart(today) && day >= startDate;
}

/** What `isScheduledOn` needs of a habit. */
export type HabitSchedule = {
  frequency: HabitFrequency;
  weeklyTarget: number | null;
  weekdays: number[] | null;
  startDate: string;
};

/**
 * Whether a habit is due on `day` ("tocan hoy"): never before its start date; a daily habit every
 * day after it.
 */
export function isScheduledOn(habit: HabitSchedule, day: string): boolean {
  if (day < habit.startDate) return false;
  switch (habit.frequency) {
    case "daily":
      return true;
    // H2 slot (Frecuencias): `weekdays` only on its days (isoWeekday), `weekly_count` every day.
    // Until H2 nothing creates them; they show every day.
    case "weekly_count":
    case "weekdays":
      return true;
  }
}
