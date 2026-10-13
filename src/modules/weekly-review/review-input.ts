// Validation and client types of `weekly-review` (SPEC-weekly-review "Modelo de datos"). Client-safe:
// the actions (W3) are the authority and the form runs the same schemas first so errors show
// without a round trip. W1 only needs what the contracts take; the close action is W3's.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { REVIEW_NOTE_MAX_LENGTH } from "./review-constants";
import { REVIEW_ERRORS } from "./review-copy";
import { isMonday } from "./week";

/** The note as stored: like names (NFC, collapsed whitespace, trimmed). */
export const normalizeReviewNote = normalizeName;

/** A week: its Monday as a real day, YYYY-MM-DD. (Whether it is in the future needs the clock: `isReviewableWeek`.) */
export const reviewWeekSchema = z
  .string({ error: REVIEW_ERRORS.weekInvalid })
  .refine(isMonday, REVIEW_ERRORS.weekInvalid);

/**
 * The optional note of a closed week: 1–280 characters once normalized, no invisible characters.
 * A missing or blank one is `null` (no note); one that is too long is an error, never cut.
 */
export const reviewNoteSchema = z
  // A cheap cap before normalizing: an absurdly long string is refused without the work.
  .string({ error: REVIEW_ERRORS.noteTooLong })
  .max(REVIEW_NOTE_MAX_LENGTH * 4, REVIEW_ERRORS.noteTooLong)
  .nullish()
  .transform((value) => (value == null ? null : normalizeReviewNote(value)))
  .pipe(
    z
      .string()
      .max(REVIEW_NOTE_MAX_LENGTH, REVIEW_ERRORS.noteTooLong)
      .refine((value) => !hasInvisibleCharacters(value), REVIEW_ERRORS.noteInvisible)
      .nullable()
      .transform((value) => (value === "" ? null : value)),
  );

/** What closing a week takes (the action of W3 adds the objective of the next week). */
export const closeWeekSchema = z.object({ weekStart: reviewWeekSchema, note: reviewNoteSchema });
export type CloseWeekInput = z.output<typeof closeWeekSchema>;
