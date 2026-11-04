"use server";

// Server Actions of the exercise catalogue (E1): create, edit, delete and restore. Each one goes
// through ownerAction(): owner check first, Zod, then an ActionResult (SPEC-core "Estilo de
// código"). Reachable by any POST, so input is `unknown`.
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import {
  insertExercise,
  isExerciseFailure,
  restoreExerciseById,
  softDeleteExercise,
  updateExerciseFields,
  type ExerciseFailure,
} from "./exercises";
import { EXERCISE_ERRORS } from "./exercises-copy";
import {
  createExerciseInputSchema,
  exerciseIdInputSchema,
  updateExerciseInputSchema,
  type DeletedExercise,
  type ExerciseItem,
} from "./exercises-input";
import { revalidateHealth } from "./revalidate";

/** A refusal: «Ya existe…» on the name field; the others as the general message. */
function refused<T>(value: ExerciseFailure, nameField: boolean): ActionResult<T> {
  if (value.failure === "nameTaken") {
    return nameField
      ? {
          ok: false,
          error: INVALID_FIELDS_MESSAGE,
          fieldErrors: { name: [EXERCISE_ERRORS.nameTaken] },
        }
      : fail(EXERCISE_ERRORS.nameTaken);
  }
  if (value.failure === "inRoutine") return fail(EXERCISE_ERRORS.inRoutine(value.routine));
  return fail(EXERCISE_ERRORS.notFound);
}

/** Either way: after a refusal, the response brings the current catalogue. */
function settle<T>(value: T | ExerciseFailure, nameField = true): ActionResult<T> {
  revalidateHealth();
  return isExerciseFailure(value) ? refused<T>(value, nameField) : ok(value);
}

const create = ownerAction(
  createExerciseInputSchema,
  async (data) => settle(await insertExercise(getDb(), data)),
  { name: "createExercise" },
);

/** «Nuevo ejercicio»: a name already used by a live one (without case or accents) is refused. */
export async function createExercise(input: unknown): Promise<ActionResult<ExerciseItem>> {
  return create(input);
}

const update = ownerAction(
  updateExerciseInputSchema,
  async (data) => settle(await updateExerciseFields(getDb(), data)),
  { name: "updateExercise" },
);

/**
 * Its page: every field, sent whole. Changing between reps and time is refused while it is in a
 * live routine.
 */
export async function updateExercise(input: unknown): Promise<ActionResult<ExerciseItem>> {
  return update(input);
}

const remove = ownerAction(
  exerciseIdInputSchema,
  async ({ id }) => settle(await softDeleteExercise(getDb(), id), false),
  { name: "deleteExercise" },
);

/** Soft delete, back with «Deshacer». Refused while it is in a live routine (named). */
export async function deleteExercise(input: unknown): Promise<ActionResult<DeletedExercise>> {
  return remove(input);
}

const restore = ownerAction(
  exerciseIdInputSchema,
  async ({ id }) => settle(await restoreExerciseById(getDb(), id), false),
  { name: "restoreExercise" },
);

/** «Deshacer» of a delete; refused when a live exercise took its name meanwhile. */
export async function restoreExercise(input: unknown): Promise<ActionResult<ExerciseItem>> {
  return restore(input);
}
