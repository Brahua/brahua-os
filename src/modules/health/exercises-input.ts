// Validation and client types of the exercise catalogue (E1, SPEC-health "Catálogo"). Client-safe:
// the forms run the same schemas first so errors show without a round trip; the actions are the
// authority (and the only ones that know whether a name is taken).
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  EQUIPMENT,
  EXERCISE_KINDS,
  EXERCISE_NAME_MAX_LENGTH,
  MUSCLE_GROUPS,
  REST_MAX_SECONDS,
  REST_MIN_SECONDS,
  type Equipment,
  type ExerciseKind,
  type MuscleGroup,
} from "./health-constants";
import { EXERCISE_ERRORS as ERRORS } from "./exercises-copy";
import { exerciseNameKey } from "./name-key";

/** An exercise as the catalogue, its page and the pickers show it. */
export type ExerciseItem = {
  id: string;
  name: string;
  /** Lowercase without accents (name-key.ts): what the search compares. */
  nameKey: string;
  kind: ExerciseKind;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
  perDumbbell: boolean;
  restSeconds: number;
};

/** A deleted exercise (the catalogue's «Ejercicio eliminado · Deshacer»). */
export type DeletedExercise = { id: string; name: string };

/** Characters, not UTF-16 units: an emoji counts as one. */
const codePoints = (value: string) => [...value].length;

/** The name as stored: like names (NFC, collapsed whitespace, trimmed), 1–80 characters. */
export const exerciseNameSchema = z
  .string({ error: ERRORS.nameRequired })
  .max(2_000, ERRORS.nameTooLong)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, ERRORS.nameRequired)
      .refine((value) => codePoints(value) <= EXERCISE_NAME_MAX_LENGTH, ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), ERRORS.invisible)
      // Only accents or marks (a lone U+0301): nothing is left of it to search or compare by.
      .refine((value) => value === "" || exerciseNameKey(value) !== "", ERRORS.nameRequired),
  );

/** A rest in whole seconds, 30–600. */
export const restSecondsSchema = z
  .number({ error: ERRORS.rest })
  .int(ERRORS.rest)
  .min(REST_MIN_SECONDS, ERRORS.rest)
  .max(REST_MAX_SECONDS, ERRORS.rest);

const fields = {
  name: exerciseNameSchema,
  kind: z.enum(EXERCISE_KINDS, { error: ERRORS.kind }),
  muscleGroup: z.enum(MUSCLE_GROUPS, { error: ERRORS.group }),
  equipment: z.enum(EQUIPMENT, { error: ERRORS.equipment }),
  perDumbbell: z.boolean({ error: ERRORS.perDumbbell }),
  restSeconds: restSecondsSchema,
};

/** The form's fields, in the order they show (the first with an error takes focus). */
export const EXERCISE_FIELDS = [
  "name",
  "kind",
  "muscleGroup",
  "equipment",
  "perDumbbell",
  "restSeconds",
] as const;
export type ExerciseField = (typeof EXERCISE_FIELDS)[number];

/** «Nuevo ejercicio». */
export const createExerciseInputSchema = z.object(fields);
export type CreateExerciseInput = z.output<typeof createExerciseInputSchema>;

/** Its page: every field, sent whole. */
export const updateExerciseInputSchema = z.object({
  id: z.uuid({ error: ERRORS.notFound }),
  ...fields,
});
export type UpdateExerciseInput = z.output<typeof updateExerciseInputSchema>;

/** Delete and restore. */
export const exerciseIdInputSchema = z.object({ id: z.uuid({ error: ERRORS.notFound }) });
export type ExerciseIdInput = z.output<typeof exerciseIdInputSchema>;
