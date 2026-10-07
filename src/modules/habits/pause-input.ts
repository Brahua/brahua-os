// Validation of H4's pauses (SPEC-habits "Pausas"). Client-safe: the pause sheet runs the same
// schema first. What depends on Lima's today (the start's window) is `pauseStartError`, which the
// server checks again under the habit's lock along with overlaps.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  HABIT_LOG_WINDOW_DAYS,
  HABIT_PAUSE_MAX_DAYS,
  HABIT_PAUSE_REASON_MAX_LENGTH,
  HABIT_PAUSE_START_AHEAD_DAYS,
} from "./habit-constants";
import { HABIT_ERRORS } from "./habit-input";
import { PAUSE_ERRORS } from "./pause-copy";
import { addDays, daysBetween } from "./schedule";
import { isReservedReason } from "./skip-day";

const id = z.uuid({ error: HABIT_ERRORS.notFound });
const pauseId = z.uuid({ error: PAUSE_ERRORS.notFound });

/** An optional reason: "", null or missing is none; stored like names (normalized), ≤ 60. */
const reason = z.preprocess(
  (value) => (value === undefined || value === null ? null : value),
  z
    .string({ error: PAUSE_ERRORS.reasonTooLong })
    // A cheap cap before normalizing.
    .max(HABIT_PAUSE_REASON_MAX_LENGTH * 4, PAUSE_ERRORS.reasonTooLong)
    .transform(normalizeName)
    .pipe(
      z
        .string()
        .max(HABIT_PAUSE_REASON_MAX_LENGTH, PAUSE_ERRORS.reasonTooLong)
        .refine((value) => !hasInvisibleCharacters(value), PAUSE_ERRORS.reasonInvisible)
        // Reserved for "Saltar hoy" (decisión autónoma): so its monthly count stays honest.
        .refine((value) => !isReservedReason(value), PAUSE_ERRORS.reasonReserved)
        .transform((value) => (value === "" ? null : value)),
    )
    .nullable(),
);

/** The days of a pause, both ends included. */
export const pauseLength = (startDate: string, endDate: string) =>
  daysBetween(startDate, endDate) + 1;

/**
 * Pausing a habit: a range of real days (both included, at most 90) with an optional reason.
 * The start's window (7 days back to a year ahead) and overlaps need today and the other pauses:
 * the server checks them.
 */
export const pauseHabitInputSchema = z
  .object({
    id,
    startDate: z.iso.date({ error: PAUSE_ERRORS.startRequired }),
    endDate: z.iso.date({ error: PAUSE_ERRORS.endRequired }),
    reason,
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) {
      context.addIssue({ code: "custom", path: ["endDate"], message: PAUSE_ERRORS.endBeforeStart });
    } else if (pauseLength(value.startDate, value.endDate) > HABIT_PAUSE_MAX_DAYS) {
      context.addIssue({ code: "custom", path: ["endDate"], message: PAUSE_ERRORS.tooLong });
    }
  });

export type PauseHabitInput = z.output<typeof pauseHabitInputSchema>;

/**
 * Why a pause's start is out of its window on `today`, or null when it is fine: from 7 days back
 * (never before the habit's start date, when given) to a year ahead.
 */
export function pauseStartError(
  startDate: string,
  today: string,
  habitStartDate?: string,
): string | null {
  if (startDate < addDays(today, -HABIT_LOG_WINDOW_DAYS)) return PAUSE_ERRORS.startTooEarly;
  if (habitStartDate !== undefined && startDate < habitStartDate) {
    return PAUSE_ERRORS.startBeforeHabit;
  }
  if (startDate > addDays(today, HABIT_PAUSE_START_AHEAD_DAYS)) return PAUSE_ERRORS.startTooLate;
  return null;
}

/** "Reanudar" one pause, or remove it (the "Deshacer" of pausing). */
export const habitPauseInputSchema = z.object({ id, pauseId });

export type HabitPauseInput = z.output<typeof habitPauseInputSchema>;

/** The fields of the pause sheet, in order (focus goes to the first invalid one). */
export const PAUSE_FIELDS = ["startDate", "endDate", "reason"] as const;
export type PauseField = (typeof PAUSE_FIELDS)[number];

/** "Saltar hoy": the habit to rest today (today and the reason are the server's). */
export const skipHabitInputSchema = z.object({ id });

export type SkipHabitInput = z.output<typeof skipHabitInputSchema>;
