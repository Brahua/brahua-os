// Validation and client types of a track's syllabus (L1, SPEC-learning). Client-safe: the section
// runs the same schemas first so errors show without a round trip; the actions are the authority.
// Every write names the track, and the data layer checks the step is really its (steps.ts).
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { MAX_STEPS_PER_TRACK, STEP_TITLE_MAX_LENGTH } from "./learning-constants";
import { LEARNING_ERRORS } from "./learning-copy";
import { STEP_ERRORS as ERRORS } from "./steps-copy";
import { codePoints } from "./syllabus";
import { syllabusSchema } from "./tracks-input";

/** A step as the track's page shows it. */
export type StepItem = {
  id: string;
  title: string;
  /** Contiguous per track (0…n-1). */
  position: number;
  /** ISO instant it was checked (to the millisecond: «Deshacer» sends it back), or null. */
  doneAt: string | null;
};

/** What checking or unchecking a step changed: «Deshacer» sends `doneAt` and `previous` back. */
export type StepDoneResult = { step: StepItem; previous: string | null };

/** The title as stored: like names (NFC, collapsed whitespace, trimmed), 1–200 characters. */
export const stepTitleSchema = z
  .string({ error: ERRORS.titleRequired })
  .max(2_000, ERRORS.titleTooLong)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, ERRORS.titleRequired)
      .refine((value) => codePoints(value) <= STEP_TITLE_MAX_LENGTH, ERRORS.titleTooLong)
      .refine((value) => !hasInvisibleCharacters(value), ERRORS.invisible),
  );

const trackId = z.uuid({ error: LEARNING_ERRORS.notFound });
const id = z.uuid({ error: ERRORS.notFound });
/** An instant as the client got it (ISO, to the millisecond), or null. */
const instant = z.iso.datetime({ error: ERRORS.changed }).nullable();

/**
 * Add one step at the end. The id comes from the client (a random uuid), so the row on screen can
 * be checked, edited or moved before the server answers: those calls queue behind this one.
 */
export const addStepInputSchema = z.object({ trackId, id, title: stepTitleSchema });
export type AddStepInput = z.output<typeof addStepInputSchema>;

/** «Pegar temario»: one step per non-blank line, added at the end. */
export const pasteStepsInputSchema = z.object({
  trackId,
  syllabus: syllabusSchema.refine((titles) => titles.length > 0, ERRORS.pasteEmpty),
});
export type PasteStepsInput = z.output<typeof pasteStepsInputSchema>;

/** A set of ids of one track (the paste's «Deshacer», a reorder). */
const idSet = z
  .array(z.uuid({ error: ERRORS.order }), { error: ERRORS.order })
  .min(1, ERRORS.order)
  .max(MAX_STEPS_PER_TRACK, ERRORS.order)
  .refine((ids) => new Set(ids).size === ids.length, ERRORS.order);

/** «Deshacer» of a paste: the steps it added, removed while they are still there. */
export const undoPasteInputSchema = z.object({ trackId, ids: idSet });
export type UndoPasteInput = z.output<typeof undoPasteInputSchema>;

export const renameStepInputSchema = z.object({ trackId, id, title: stepTitleSchema });
export type RenameStepInput = z.output<typeof renameStepInputSchema>;

/** «Hecho» (or unchecking): the state wanted, so it is idempotent. */
export const stepDoneInputSchema = z.object({
  trackId,
  id,
  done: z.boolean({ error: ERRORS.changed }),
});
export type StepDoneInput = z.output<typeof stepDoneInputSchema>;

/**
 * «Deshacer» of a check: puts `restore` back only while the step still holds `expected` (what that
 * check left). After another change, nothing is written.
 */
export const undoStepDoneInputSchema = z.object({
  trackId,
  id,
  expected: instant,
  restore: instant,
});
export type UndoStepDoneInput = z.output<typeof undoStepDoneInputSchema>;

/** Remove (a soft delete). */
export const stepRefInputSchema = z.object({ trackId, id });
export type StepRefInput = z.output<typeof stepRefInputSchema>;

/** «Deshacer» of a remove: the same step back, after the neighbour it had (else at `position`). */
export const restoreStepInputSchema = z.object({
  trackId,
  id,
  afterId: z.uuid({ error: ERRORS.order }).nullable().default(null),
  position: z
    .number({ error: ERRORS.order })
    .int(ERRORS.order)
    .min(0, ERRORS.order)
    .max(MAX_STEPS_PER_TRACK, ERRORS.order),
});
export type RestoreStepInput = z.output<typeof restoreStepInputSchema>;

/** Every live step id of the track in the new order (checked as a set against the track's). */
export const reorderStepsInputSchema = z.object({ trackId, ids: idSet });
export type ReorderStepsInput = z.output<typeof reorderStepsInputSchema>;
