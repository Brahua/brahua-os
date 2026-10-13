// The weekly objective's pure rules and validation (SPEC-goals "Objetivo semanal"). Client-safe:
// the inline editor runs the same schema first, the Server Actions validate again.
//
// A week is Monday–Sunday in Lima and is keyed by its Monday (`weekly_objectives.week_start`).
// The Monday helpers live here (not imported from `habits`: `goals` reads that module only through
// its contracts and routes, see eslint.config.mjs).
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { WEEKLY_OBJECTIVE_MAX_LENGTH } from "./goal-constants";
import { GOAL_ERRORS } from "./goals-copy";

const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Whether `value` is a real calendar day written YYYY-MM-DD (no 2026-02-30, no 2026-1-5). */
export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const date = toDate(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Whether `value` is a real day that falls on a Monday. */
export function isMonday(value: string): boolean {
  return isDateKey(value) && toDate(value).getUTCDay() === 1;
}

/** The Monday of the week `day` (a Lima day, YYYY-MM-DD) is in. */
export function mondayOf(day: string): string {
  const weekday = toDate(day).getUTCDay();
  const back = weekday === 0 ? 6 : weekday - 1;
  return new Date(toDate(day).getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/** The Sunday that ends the week starting on `weekStart`. */
export function weekEnd(weekStart: string): string {
  return new Date(toDate(weekStart).getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
}

/** The week `today` (the Lima day the page was read for) is in: its Monday. */
export function currentWeekStart(today: string): string {
  return mondayOf(today);
}

/** The objective as stored: like names (NFC, collapsed whitespace, trimmed). */
export const normalizeWeeklyText = normalizeName;

const weekStart = z
  .string({ error: GOAL_ERRORS.weekInvalid })
  .refine(isMonday, GOAL_ERRORS.weekInvalid);

/** The objective's text: 1–140 characters once normalized, no invisible characters. */
export const weeklyTextSchema = z
  .string({ error: GOAL_ERRORS.weeklyRequired })
  // A cheap cap before normalizing: an absurdly long string is refused without the work.
  .max(WEEKLY_OBJECTIVE_MAX_LENGTH * 4, GOAL_ERRORS.weeklyTooLong)
  .transform(normalizeWeeklyText)
  .pipe(
    z
      .string()
      .min(1, GOAL_ERRORS.weeklyRequired)
      .max(WEEKLY_OBJECTIVE_MAX_LENGTH, GOAL_ERRORS.weeklyTooLong)
      .refine((value) => !hasInvisibleCharacters(value), GOAL_ERRORS.weeklyInvisible),
  );

export const setWeeklyObjectiveInputSchema = z.object({ weekStart, text: weeklyTextSchema });
export type SetWeeklyObjectiveInput = z.output<typeof setWeeklyObjectiveInputSchema>;

export const clearWeeklyObjectiveInputSchema = z.object({ weekStart });
export type ClearWeeklyObjectiveInput = z.output<typeof clearWeeklyObjectiveInputSchema>;

/**
 * The undo of a set or a clear carries what it needs: the text to put back (`previous`, null: the
 * week had none) and what the change left (`applied`, null: it cleared the week). It only writes
 * while the week still holds `applied`; if something changed it meanwhile, it changes nothing.
 */
export const undoWeeklyObjectiveInputSchema = z.object({
  weekStart,
  previous: weeklyTextSchema.nullable(),
  applied: weeklyTextSchema.nullable(),
});
export type UndoWeeklyObjectiveInput = z.output<typeof undoWeeklyObjectiveInputSchema>;

/** A week's objective as the screen shows it. */
export type WeeklyObjectiveItem = { weekStart: string; text: string };

/** What a set or a clear did: the week's text now and the one it replaced (the undo's data). */
export type WeeklyObjectiveChange = {
  weekStart: string;
  /** The text now (null: none). */
  text: string | null;
  /** The text before (null: the week had none). */
  previous: string | null;
};

/** What an undo did: the text now, and whether it put `previous` back. */
export type WeeklyObjectiveUndo = {
  weekStart: string;
  text: string | null;
  restored: boolean;
};
