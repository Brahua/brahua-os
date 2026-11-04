// A routine's exercises (server only, E1). These functions take the database and trust their
// input: callers check the owner and validate first (the actions through ownerAction(), the
// queries with requireOwner()).
//
// Every write runs in a transaction that takes the routine's lock `(10000, hashtext(<routine id>))`
// FIRST (locks.ts), then checks the routine exists and isn't deleted, holding its row FOR SHARE;
// and every statement on an item filters by its routine as well as its id: an id from another
// routine is "not found" (no IDOR across routines). `position` stays contiguous (0…n-1) among the
// routine's live items, and a routine holds at most MAX_ROUTINE_ITEMS.
//
// The targets must fit the exercise's kind (reps for weight_reps/reps, seconds for time/cardio:
// `targetsProblem`). The exercise's row is held FOR SHARE while an item is written, so a kind
// change or a delete of the exercise (exercises.ts, FOR UPDATE) waits and then sees the item.
//
// Removing is a soft delete (`deleted_at`); «Deshacer» puts it back in its place.
import "server-only";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { isSameIdSet } from "@/modules/core/life-area-order";
import { healthExercises, healthRoutineExercises, healthRoutines } from "./db/schema";
import { MAX_ROUTINE_ITEMS, type ExerciseKind } from "./health-constants";
import { lockRoutine, type Tx } from "./locks";
import {
  targetsProblem,
  type AddItemInput,
  type ItemRefInput,
  type RestoreItemInput,
  type RoutineItem,
  type TargetField,
  type UpdateItemInput,
} from "./routines-input";

/** Why an item write did nothing. */
export type ItemFailure =
  | "routineNotFound"
  | "itemNotFound"
  /** The exercise doesn't exist or is deleted. */
  | "exerciseUnavailable"
  | "tooMany"
  /** The targets don't fit the exercise's kind (the field to mark comes with it). */
  | { wrongTarget: TargetField }
  /** «Deshacer» of a remove: the exercise changed how it is measured meanwhile. */
  | "targetsChanged"
  /** Only a tampered request (or a uuid collision) reuses an id. */
  | "idTaken"
  | "staleOrder";

const items = healthRoutineExercises;
const liveItem = isNull(items.deletedAt);

const ITEM = {
  id: items.id,
  exerciseId: items.exerciseId,
  exerciseName: healthExercises.name,
  kind: healthExercises.kind,
  equipment: healthExercises.equipment,
  perDumbbell: healthExercises.perDumbbell,
  exerciseRestSeconds: healthExercises.restSeconds,
  position: items.position,
  targetSets: items.targetSets,
  repsMin: items.repsMin,
  repsMax: items.repsMax,
  targetSeconds: items.targetSeconds,
  restSeconds: items.restSeconds,
};

/** One live item of the routine. */
const ofRoutine = (routineId: string, id: string) =>
  and(eq(items.id, id), eq(items.routineId, routineId), liveItem);

/**
 * A guard on every read of items with their exercise: a live routine can't hold a deleted one
 * (exercises.ts refuses it, routines.ts checks it on restore), but a read never shows one.
 */
const liveExercise = isNull(healthExercises.deletedAt);

/** The routine's live items in order, with their exercise. */
export async function selectRoutineItems(
  db: Database | Tx,
  routineId: string,
): Promise<RoutineItem[]> {
  return db
    .select(ITEM)
    .from(items)
    .innerJoin(healthExercises, eq(healthExercises.id, items.exerciseId))
    .where(and(eq(items.routineId, routineId), liveItem, liveExercise))
    .orderBy(asc(items.position), asc(items.id));
}

async function selectItem(tx: Tx, routineId: string, id: string): Promise<RoutineItem | null> {
  const [row] = await tx
    .select(ITEM)
    .from(items)
    .innerJoin(healthExercises, eq(healthExercises.id, items.exerciseId))
    .where(and(ofRoutine(routineId, id), liveExercise));
  return row ?? null;
}

/**
 * Locks the routine (first), then checks it exists and isn't deleted, holding its row FOR SHARE
 * until the end.
 */
async function openRoutine(tx: Tx, routineId: string): Promise<boolean> {
  await lockRoutine(tx, routineId);
  const [routine] = await tx
    .select({ id: healthRoutines.id })
    .from(healthRoutines)
    .where(and(eq(healthRoutines.id, routineId), isNull(healthRoutines.deletedAt)))
    .for("share");
  return routine !== undefined;
}

/** A live exercise's kind, its row held FOR SHARE (see the header), or null. */
async function exerciseKind(tx: Tx, exerciseId: string): Promise<ExerciseKind | null> {
  const [row] = await tx
    .select({ kind: healthExercises.kind })
    .from(healthExercises)
    .where(and(eq(healthExercises.id, exerciseId), isNull(healthExercises.deletedAt)))
    .for("share");
  return row?.kind ?? null;
}

async function liveCount(tx: Tx, routineId: string): Promise<number> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(items)
    .where(and(eq(items.routineId, routineId), liveItem));
  return total;
}

/** Rewrites the live items' `position` as 0…n-1 in their order (only rows that change). */
async function renumber(tx: Tx, routineId: string) {
  await tx.execute(sql`
    update health_routine_exercises as i
    set position = ranked.position, updated_at = now()
    from (
      select id, (row_number() over (order by position, id) - 1)::integer as position
      from health_routine_exercises
      where routine_id = ${routineId} and deleted_at is null
    ) as ranked
    where i.id = ranked.id and i.position <> ranked.position
  `);
}

/** Adds one exercise at the end. */
export async function insertItem(
  db: Database,
  { routineId, id, exerciseId, ...targets }: AddItemInput,
): Promise<RoutineItem | ItemFailure> {
  return db.transaction(async (tx) => {
    if (!(await openRoutine(tx, routineId))) return "routineNotFound";
    const kind = await exerciseKind(tx, exerciseId);
    if (kind === null) return "exerciseUnavailable";
    const problem = targetsProblem(kind, targets);
    if (problem !== null) return { wrongTarget: problem };
    const total = await liveCount(tx, routineId);
    if (total >= MAX_ROUTINE_ITEMS) return "tooMany";
    const [row] = await tx
      .insert(items)
      .values({ id, routineId, exerciseId, position: total, ...targets })
      .onConflictDoNothing({ target: items.id })
      .returning({ id: items.id });
    if (!row) return "idTaken";
    return (await selectItem(tx, routineId, id))!;
  });
}

/** Its targets, whole. */
export async function updateItem(
  db: Database,
  { routineId, id, ...targets }: UpdateItemInput,
): Promise<RoutineItem | ItemFailure> {
  return db.transaction(async (tx) => {
    if (!(await openRoutine(tx, routineId))) return "routineNotFound";
    const [current] = await tx
      .select({ exerciseId: items.exerciseId })
      .from(items)
      .where(ofRoutine(routineId, id))
      .for("update");
    if (!current) return "itemNotFound";
    const kind = await exerciseKind(tx, current.exerciseId);
    if (kind === null) return "exerciseUnavailable";
    const problem = targetsProblem(kind, targets);
    if (problem !== null) return { wrongTarget: problem };
    await tx.update(items).set(targets).where(ofRoutine(routineId, id));
    return (await selectItem(tx, routineId, id))!;
  });
}

/**
 * Removes an item (soft delete) and closes the gap. Returns the row as it was and its position
 * (what «Deshacer» sends back). A removed one is "not found".
 */
export async function removeItem(
  db: Database,
  { routineId, id }: ItemRefInput,
): Promise<{ item: RoutineItem; position: number } | ItemFailure> {
  return db.transaction(async (tx) => {
    if (!(await openRoutine(tx, routineId))) return "routineNotFound";
    const item = await selectItem(tx, routineId, id);
    if (!item) return "itemNotFound";
    await tx
      .update(items)
      .set({ deletedAt: sql`now()` })
      .where(ofRoutine(routineId, id));
    await renumber(tx, routineId);
    return { item, position: item.position };
  });
}

/**
 * «Deshacer» of a remove: clears `deleted_at` and puts the item back right after `afterId` (the
 * neighbour it had above it) while that one is still there, else at `position` clamped to the
 * list. Restoring a live one changes nothing (a second «Deshacer» is not an error). An exercise
 * deleted meanwhile can't come back, nor one that now is measured another way (`targetsChanged`).
 */
export async function restoreItem(
  db: Database,
  { routineId, id, position, afterId }: RestoreItemInput,
): Promise<RoutineItem[] | ItemFailure> {
  return db.transaction(async (tx) => {
    if (!(await openRoutine(tx, routineId))) return "routineNotFound";
    const [row] = await tx
      .select({
        deletedAt: items.deletedAt,
        exerciseId: items.exerciseId,
        repsMin: items.repsMin,
        repsMax: items.repsMax,
        targetSeconds: items.targetSeconds,
      })
      .from(items)
      .where(and(eq(items.id, id), eq(items.routineId, routineId)));
    if (!row) return "itemNotFound";
    if (row.deletedAt === null) return selectRoutineItems(tx, routineId);
    const kind = await exerciseKind(tx, row.exerciseId);
    if (kind === null) return "exerciseUnavailable";
    if (targetsProblem(kind, row) !== null) return "targetsChanged";
    const current = await selectRoutineItems(tx, routineId);
    if (current.length >= MAX_ROUTINE_ITEMS) return "tooMany";
    const anchor = afterId ? current.findIndex((item) => item.id === afterId) : -1;
    const at = anchor !== -1 ? anchor + 1 : Math.min(position, current.length);
    await tx
      .update(items)
      .set({ position: sql`${items.position} + 1` })
      .where(and(eq(items.routineId, routineId), liveItem, gte(items.position, at)));
    await tx
      .update(items)
      .set({ deletedAt: null, position: at })
      .where(and(eq(items.id, id), eq(items.routineId, routineId), isNotNull(items.deletedAt)));
    await renumber(tx, routineId);
    return selectRoutineItems(tx, routineId);
  });
}

/**
 * Writes the new order of a routine's live items. `"staleOrder"` (writing nothing) when `ids` is
 * not exactly that set: one was added or removed elsewhere, or the request was tampered with.
 */
export async function reorderItemsByIds(
  db: Database,
  routineId: string,
  ids: readonly string[],
): Promise<RoutineItem[] | ItemFailure> {
  return db.transaction(async (tx) => {
    if (!(await openRoutine(tx, routineId))) return "routineNotFound";
    const current = await selectRoutineItems(tx, routineId);
    if (
      !isSameIdSet(
        current.map((item) => item.id),
        ids,
      )
    ) {
      return "staleOrder";
    }
    const position = new Map(current.map((item) => [item.id, item.position]));
    const changed = ids
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => position.get(id) !== index);
    if (changed.length > 0) {
      const cases = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(items)
        .set({ position: sql`case ${items.id} ${cases} end` })
        .where(
          and(
            eq(items.routineId, routineId),
            liveItem,
            inArray(
              items.id,
              changed.map(({ id }) => id),
            ),
          ),
        );
    }
    return selectRoutineItems(tx, routineId);
  });
}
