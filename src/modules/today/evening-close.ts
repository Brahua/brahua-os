// evening-close-ritual (corte `polish`): the close of the day on "/" from 20:00 (Lima) when
// something is left. Pure and client-safe. The hour is a constant for now: `reminders` brings
// the settings store where this and the other times (briefing 7:30, evening review 21:00) become
// editable (decision to review with the owner, in HANDOFF).
import { ownerHour } from "@/lib/time";
import { isDayComplete, variantForDay, type DayTally } from "./today-board";
import { TODAY_COPY } from "./today-copy";

/** From this Lima hour the header of "/" can switch to the close of the day. */
export const EVENING_CLOSE_HOUR = 20;

/**
 * Cookie that, in an E2E build only, decides the close of the day: "on" shows it, anything else
 * (or none) hides it, whatever the hour (see `evening-close-server.ts`).
 */
export const E2E_EVENING_COOKIE = "bo_e2e_evening";

/** Whether `now` is in the close window of its Lima day (20:00 to midnight). */
export function isEveningClose(now: Date): boolean {
  return ownerHour(now) >= EVENING_CLOSE_HOUR;
}

/**
 * Milliseconds from `now` until the next 20:00 in Lima, or null when it already is that time.
 * Lima has no daylight saving and a whole-hour offset, so the minutes and seconds are the UTC
 * ones. A little past the mark (1 s) so the server reads an hour that is already 20.
 */
export function msUntilEveningClose(now: Date): number | null {
  const hour = ownerHour(now);
  if (hour >= EVENING_CLOSE_HOUR) return null;
  const toMark =
    ((EVENING_CLOSE_HOUR - hour) * 60 - now.getUTCMinutes()) * 60_000 -
    now.getUTCSeconds() * 1000 -
    now.getUTCMilliseconds();
  return toMark + 1000;
}

/** What the close of the day says, from the board's (live) tally. */
export type EveningClose = {
  /** Habits done and tasks completed today (the same numbers as "Día completo"). */
  habits: number;
  tasks: number;
  /** "4 de 5" when some habit due today is not done; habits never move, so only said. */
  habitsOpen: { done: number; total: number } | null;
  /** Tasks left on the board: the ones "Mañana" moves. */
  pending: number;
};

/**
 * The close, or null when it has nothing to say: a finished day is "Día completo"'s, and a day
 * with nothing done and nothing to move has no ritual (the greeting line keeps its place).
 */
export function eveningClose(tally: DayTally): EveningClose | null {
  if (isDayComplete(tally)) return null;
  const { habits, tasks } = tally;
  const close: EveningClose = {
    habits: habits.done,
    tasks: tasks.doneToday,
    habitsOpen: habits.total > habits.done ? { done: habits.done, total: habits.total } : null,
    pending: tasks.pending,
  };
  return close.habits > 0 || close.tasks > 0 || close.pending > 0 ? close : null;
}

/** The question about the tasks left, one per day (stable all day, different across days). */
export function closeQuestion(day: string, pending: number): string {
  const questions = TODAY_COPY.eveningClose.questions;
  return questions[variantForDay(day, questions.length)](pending);
}
