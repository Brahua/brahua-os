// Catalogue data access (server only, E1). These functions take the database and trust their
// input: callers check the owner and validate first (the actions through ownerAction(), the
// queries with requireOwner()).
//
// Every write takes the catalogue lock `(10000, hashtext('health:exercises'))` FIRST (locks.ts),
// then checks the name among the live exercises: two saves of «Press de banca» at once wait for
// each other and the second says «Ya existe» (the partial unique index on `name_key` stays the
// hard guarantee). The key is the app's (name-key.ts): `unaccent` isn't IMMUTABLE.
//
// An exercise in a live routine can't be deleted, nor change between being measured in reps and
// in time: the routine's targets would stop fitting (decisión autónoma para revisar con el owner).
// The exercise's row is held FOR UPDATE before looking, and adding it to a routine holds it FOR
// SHARE (routine-items.ts), so the check can't miss one added at the same time.
//
// Deleting is a soft delete (`deleted_at`): it leaves the catalogue and the pickers; «Deshacer»
// clears it, unless a live exercise took its name meanwhile.
import "server-only";
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { healthExercises } from "./db/schema";
import type {
  CreateExerciseInput,
  DeletedExercise,
  ExerciseItem,
  UpdateExerciseInput,
} from "./exercises-input";
import { usesReps } from "./health-constants";
import { lockExercises, type Tx } from "./locks";
import { exerciseNameKey } from "./name-key";

/** Why a catalogue write did nothing. */
export type ExerciseFailure =
  | { failure: "notFound" }
  | { failure: "nameTaken" }
  /** It is in a live routine (named): it can't be deleted, nor change how it is measured. */
  | { failure: "inRoutine"; routine: string };

export const isExerciseFailure = (value: unknown): value is ExerciseFailure =>
  typeof value === "object" && value !== null && "failure" in value;

const EXERCISE = {
  id: healthExercises.id,
  name: healthExercises.name,
  nameKey: healthExercises.nameKey,
  kind: healthExercises.kind,
  muscleGroup: healthExercises.muscleGroup,
  equipment: healthExercises.equipment,
  perDumbbell: healthExercises.perDumbbell,
  restSeconds: healthExercises.restSeconds,
};

/** Exercises that aren't deleted. EVERY read of the catalogue filters with it. */
export const liveExercise = isNull(healthExercises.deletedAt);

/** The live catalogue, by name (the screen groups it). */
export async function selectExercises(db: Database | Tx): Promise<ExerciseItem[]> {
  return db
    .select(EXERCISE)
    .from(healthExercises)
    .where(liveExercise)
    .orderBy(asc(healthExercises.nameKey), asc(healthExercises.id));
}

/** One live exercise, or null. */
export async function selectExercise(db: Database | Tx, id: string): Promise<ExerciseItem | null> {
  const [row] = await db
    .select(EXERCISE)
    .from(healthExercises)
    .where(and(eq(healthExercises.id, id), liveExercise));
  return row ?? null;
}

/** A deleted exercise (the catalogue's «Deshacer»), or null when it isn't deleted. */
export async function selectDeletedExercise(
  db: Database,
  id: string,
): Promise<DeletedExercise | null> {
  const [row] = await db
    .select({ id: healthExercises.id, name: healthExercises.name })
    .from(healthExercises)
    .where(and(eq(healthExercises.id, id), isNotNull(healthExercises.deletedAt)));
  return row ?? null;
}

/** Whether a live exercise other than `exceptId` has this key (under the catalogue lock). */
async function nameTaken(tx: Tx, nameKey: string, exceptId?: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: healthExercises.id })
    .from(healthExercises)
    .where(
      and(
        eq(healthExercises.nameKey, nameKey),
        liveExercise,
        exceptId ? ne(healthExercises.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The first live routine (by its order) with this exercise among its live items, or null. */
async function routineUsing(tx: Tx, exerciseId: string): Promise<string | null> {
  const result = await tx.execute<{ name: string }>(sql`
    select routine.name from health_routine_exercises item
    join health_routines routine on routine.id = item.routine_id
    where item.exercise_id = ${exerciseId} and item.deleted_at is null and routine.deleted_at is null
    order by routine.position, routine.id
    limit 1
  `);
  return result.rows[0]?.name ?? null;
}

/** «Nuevo ejercicio». */
export async function insertExercise(
  db: Database,
  input: CreateExerciseInput,
): Promise<ExerciseItem | ExerciseFailure> {
  return db.transaction(async (tx) => {
    await lockExercises(tx);
    const nameKey = exerciseNameKey(input.name);
    if (await nameTaken(tx, nameKey)) return { failure: "nameTaken" };
    const [row] = await tx
      .insert(healthExercises)
      .values({ ...input, nameKey })
      .returning(EXERCISE);
    return row;
  });
}

/** Its page: every field. */
export async function updateExerciseFields(
  db: Database,
  { id, ...input }: UpdateExerciseInput,
): Promise<ExerciseItem | ExerciseFailure> {
  return db.transaction(async (tx) => {
    await lockExercises(tx);
    const [current] = await tx
      .select({ kind: healthExercises.kind })
      .from(healthExercises)
      .where(and(eq(healthExercises.id, id), liveExercise))
      .for("update");
    if (!current) return { failure: "notFound" };
    const nameKey = exerciseNameKey(input.name);
    if (await nameTaken(tx, nameKey, id)) return { failure: "nameTaken" };
    if (usesReps(current.kind) !== usesReps(input.kind)) {
      const routine = await routineUsing(tx, id);
      if (routine !== null) return { failure: "inRoutine", routine };
    }
    const [row] = await tx
      .update(healthExercises)
      .set({ ...input, nameKey })
      .where(eq(healthExercises.id, id))
      .returning(EXERCISE);
    return row;
  });
}

/** Soft delete: out of the catalogue and the pickers, back with «Deshacer». */
export async function softDeleteExercise(
  db: Database,
  id: string,
): Promise<DeletedExercise | ExerciseFailure> {
  return db.transaction(async (tx) => {
    await lockExercises(tx);
    const [current] = await tx
      .select({ id: healthExercises.id })
      .from(healthExercises)
      .where(and(eq(healthExercises.id, id), liveExercise))
      .for("update");
    if (!current) return { failure: "notFound" };
    const routine = await routineUsing(tx, id);
    if (routine !== null) return { failure: "inRoutine", routine };
    const [row] = await tx
      .update(healthExercises)
      .set({ deletedAt: sql`now()` })
      .where(eq(healthExercises.id, id))
      .returning({ id: healthExercises.id, name: healthExercises.name });
    return row;
  });
}

/**
 * «Deshacer» of a delete. Restoring a live one changes nothing; one whose name a live exercise
 * took meanwhile stays deleted (`nameTaken`).
 */
export async function restoreExerciseById(
  db: Database,
  id: string,
): Promise<ExerciseItem | ExerciseFailure> {
  return db.transaction(async (tx) => {
    await lockExercises(tx);
    const [row] = await tx
      .select({ nameKey: healthExercises.nameKey, deletedAt: healthExercises.deletedAt })
      .from(healthExercises)
      .where(eq(healthExercises.id, id))
      .for("update");
    if (!row) return { failure: "notFound" };
    if (row.deletedAt !== null) {
      if (await nameTaken(tx, row.nameKey, id)) return { failure: "nameTaken" };
      await tx.update(healthExercises).set({ deletedAt: null }).where(eq(healthExercises.id, id));
    }
    return (await selectExercise(tx, id))!;
  });
}
