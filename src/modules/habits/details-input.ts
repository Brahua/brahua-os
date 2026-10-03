// H5: "Más detalles" of the create and edit form (SPEC-habits "Identidad y momento", "Fecha de
// inicio"): the identity phrase (≤ 120), the cue (≤ 60) and, only when creating, the start date
// (today or up to 7 days back). Client-safe. Its own file, like H2's frequency-input.ts and H3's
// measure-input.ts: `createHabitInputSchema` spreads `detailsInputShape` and the edit schema
// `detailsUpdateShape`.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { HABIT_CUE_MAX_LENGTH, HABIT_IDENTITY_MAX_LENGTH } from "./habit-constants";
import { DETAILS_ERRORS } from "./history-copy";
import { logWindowStart } from "./schedule";

/** An optional text, stored like names (normalized; blank is null), up to `max` characters. */
function optionalText(max: number, errors: { tooLong: string; invisible: string }) {
  return (
    z
      .string({ error: errors.tooLong })
      // A cheap cap before normalizing.
      .max(max * 4, errors.tooLong)
      .transform(normalizeName)
      .pipe(
        z
          .string()
          .max(max, errors.tooLong)
          .refine((value) => !hasInvisibleCharacters(value), errors.invisible)
          .transform((value) => (value === "" ? null : value)),
      )
      .nullable()
  );
}

const identity = optionalText(HABIT_IDENTITY_MAX_LENGTH, {
  tooLong: DETAILS_ERRORS.identityTooLong,
  invisible: DETAILS_ERRORS.identityInvisible,
});
const cue = optionalText(HABIT_CUE_MAX_LENGTH, {
  tooLong: DETAILS_ERRORS.cueTooLong,
  invisible: DETAILS_ERRORS.cueInvisible,
});

/** "" or null: not given (like missing). */
const blankIsMissing = (value: unknown) => (value === "" || value === null ? undefined : value);

/**
 * Creating: identity and cue (optional: none when missing or blank) and the start date (optional:
 * today when missing). Whether the start date is within its window depends on today:
 * `startDateError` (the server checks it again).
 */
export const detailsInputShape = {
  identity: z.preprocess(blankIsMissing, identity.optional()),
  cue: z.preprocess(blankIsMissing, cue.optional()),
  startDate: z.preprocess(
    blankIsMissing,
    z.iso.date({ error: DETAILS_ERRORS.startDateInvalid }).optional(),
  ),
};

/** Editing: identity and cue; missing leaves them as they are. The start date never changes. */
export const detailsUpdateShape = {
  identity: z.preprocess((value) => (value === "" ? null : value), identity.optional()),
  cue: z.preprocess((value) => (value === "" ? null : value), cue.optional()),
};

/** The fields of "Más detalles", in the form's order (focus goes to the first invalid one). */
export const DETAILS_FIELDS = ["identity", "cue", "startDate"] as const;
export type DetailsField = (typeof DETAILS_FIELDS)[number];

/**
 * Why a new habit's start date is out of its window on `today` (Lima), or null when it is fine:
 * today or up to 7 days back, never in the future (SPEC-habits "Fecha de inicio").
 */
export function startDateError(startDate: string, today: string): string | null {
  if (startDate > today) return DETAILS_ERRORS.startDateFuture;
  if (startDate < logWindowStart(today)) return DETAILS_ERRORS.startDateTooEarly;
  return null;
}

/** The columns `insertHabit` stores (the start date was checked against `today` before). */
export function detailsColumns(
  input: { identity?: string | null; cue?: string | null; startDate?: string },
  today: string,
) {
  return {
    identity: input.identity ?? null,
    cue: input.cue ?? null,
    startDate: input.startDate ?? today,
  };
}

/** The columns `updateHabitById` changes (only the ones sent). */
export function detailsUpdateColumns(input: { identity?: string | null; cue?: string | null }) {
  return {
    ...(input.identity !== undefined ? { identity: input.identity } : {}),
    ...(input.cue !== undefined ? { cue: input.cue } : {}),
  };
}
