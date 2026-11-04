// Routines data access (server only, E1). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries with
// requireOwner()).
//
// Which routines are live and their order change under the routines lock
// `(10000, hashtext('health:routines'))`, taken FIRST (locks.ts): create, delete, restore and
// reorder. `position` stays contiguous (0…n-1) among the live ones. A rename only touches its own
// row and takes the routine's lock (the same as its exercises).
//
// Deleting is a soft delete (`deleted_at`): the routine leaves the list with its exercises;
// «Deshacer» puts it back in its place. While it is deleted its exercises are free to be deleted or
// to change how they are measured (exercises.ts only looks at live routines), so restoring it
// checks them first, holding their rows FOR SHARE: one deleted, or whose kind no longer fits its
// targets, refuses the «Deshacer» (`itemsChanged`) instead of bringing back a broken routine.
// `pnpm db:export` keeps deleted rows.
import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { isSameIdSet } from "@/modules/core/life-area-order";
import { healthExercises, healthRoutineExercises, healthRoutines } from "./db/schema";
import { lockRoutine, lockRoutines, type Tx } from "./locks";
import {
  defaultRoutineName,
  targetsProblem,
  type RenameRoutineInput,
  type RoutineRef,
  type RoutineSummary,
} from "./routines-input";

/** Routines that aren't deleted. EVERY read and write of routines filters with it. */
export const liveRoutine = isNull(healthRoutines.deletedAt);

// Raw subqueries name their tables by hand: Drizzle prints a single table's columns without it
// (CLAUDE.md "household"), so `${healthRoutines.id}` inside would read the item's own `id`.
const exerciseCount = sql<number>`(
  select count(*) from health_routine_exercises item
  join health_exercises exercise on exercise.id = item.exercise_id and exercise.deleted_at is null
  where item.routine_id = "health_routines"."id" and item.deleted_at is null
)`.mapWith(Number);

const SUMMARY = {
  id: healthRoutines.id,
  name: healthRoutines.name,
  position: healthRoutines.position,
  exerciseCount,
};

/** The live routines in their order, each with its number of live exercises. */
export async function selectRoutineSummaries(db: Database | Tx): Promise<RoutineSummary[]> {
  return db
    .select(SUMMARY)
    .from(healthRoutines)
    .where(liveRoutine)
    .orderBy(asc(healthRoutines.position), asc(healthRoutines.createdAt), asc(healthRoutines.id));
}

/** One live routine, or null. */
export async function selectRoutine(db: Database | Tx, id: string): Promise<RoutineRef | null> {
  const [row] = await db
    .select({ id: healthRoutines.id, name: healthRoutines.name })
    .from(healthRoutines)
    .where(and(eq(healthRoutines.id, id), liveRoutine));
  return row ?? null;
}

/** A deleted routine (the list's «Rutina eliminada · Deshacer»), or null when it isn't deleted. */
export async function selectDeletedRoutine(db: Database, id: string): Promise<RoutineRef | null> {
  const [row] = await db
    .select({ id: healthRoutines.id, name: healthRoutines.name })
    .from(healthRoutines)
    .where(and(eq(healthRoutines.id, id), isNotNull(healthRoutines.deletedAt)));
  return row ?? null;
}

/** Rewrites the live routines' `position` as 0…n-1 in their order (only rows that change). */
async function renumber(tx: Tx) {
  await tx.execute(sql`
    update health_routines as r
    set position = ranked.position, updated_at = now()
    from (
      select id, (row_number() over (order by position, created_at, id) - 1)::integer as position
      from health_routines
      where deleted_at is null
    ) as ranked
    where r.id = ranked.id and r.position <> ranked.position
  `);
}

/** «Nueva rutina»: at the end, with the next free «Rutina A/B/C…» name. */
export async function insertRoutine(db: Database): Promise<RoutineSummary> {
  return db.transaction(async (tx) => {
    await lockRoutines(tx);
    const live = await tx
      .select({ name: healthRoutines.name })
      .from(healthRoutines)
      .where(liveRoutine);
    const [row] = await tx
      .insert(healthRoutines)
      .values({ name: defaultRoutineName(live.map((r) => r.name)), position: live.length })
      .returning({
        id: healthRoutines.id,
        name: healthRoutines.name,
        position: healthRoutines.position,
      });
    return { ...row, exerciseCount: 0 };
  });
}

/** Renames a live routine (under its own lock). */
export async function renameRoutineById(
  db: Database,
  { id, name }: RenameRoutineInput,
): Promise<RoutineRef | "notFound"> {
  return db.transaction(async (tx) => {
    await lockRoutine(tx, id);
    const [row] = await tx
      .update(healthRoutines)
      .set({ name })
      .where(and(eq(healthRoutines.id, id), liveRoutine))
      .returning({ id: healthRoutines.id, name: healthRoutines.name });
    return row ?? "notFound";
  });
}

/** Soft delete; the others close the gap. Returns what the list's «Deshacer» names. */
export async function softDeleteRoutine(
  db: Database,
  id: string,
): Promise<RoutineRef | "notFound"> {
  return db.transaction(async (tx) => {
    await lockRoutines(tx);
    const [row] = await tx
      .update(healthRoutines)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(healthRoutines.id, id), liveRoutine))
      .returning({ id: healthRoutines.id, name: healthRoutines.name });
    if (!row) return "notFound";
    await renumber(tx);
    return row;
  });
}

/**
 * Whether every live item of the routine still has a live exercise whose kind fits its targets,
 * holding those exercises FOR SHARE until the end (see the header).
 */
async function itemsStillFit(tx: Tx, routineId: string): Promise<boolean> {
  const rows = await tx
    .select({
      kind: healthExercises.kind,
      exerciseDeletedAt: healthExercises.deletedAt,
      repsMin: healthRoutineExercises.repsMin,
      repsMax: healthRoutineExercises.repsMax,
      targetSeconds: healthRoutineExercises.targetSeconds,
    })
    .from(healthRoutineExercises)
    .innerJoin(healthExercises, eq(healthExercises.id, healthRoutineExercises.exerciseId))
    .where(
      and(
        eq(healthRoutineExercises.routineId, routineId),
        isNull(healthRoutineExercises.deletedAt),
      ),
    )
    .for("share", { of: healthExercises });
  return rows.every(
    (row) => row.exerciseDeletedAt === null && targetsProblem(row.kind, row) === null,
  );
}

/**
 * «Deshacer» of a delete: back at the place it had (clamped to the list), with its exercises.
 * Restoring a live one changes nothing; one with an exercise deleted, or measured another way,
 * while it was deleted stays deleted (`itemsChanged`).
 */
export async function restoreRoutineById(
  db: Database,
  id: string,
): Promise<RoutineSummary[] | "notFound" | "itemsChanged"> {
  return db.transaction(async (tx) => {
    await lockRoutines(tx);
    const [row] = await tx
      .select({ position: healthRoutines.position, deletedAt: healthRoutines.deletedAt })
      .from(healthRoutines)
      .where(eq(healthRoutines.id, id));
    if (!row) return "notFound";
    if (row.deletedAt !== null) {
      if (!(await itemsStillFit(tx, id))) return "itemsChanged";
      const live = await selectRoutineSummaries(tx);
      const at = Math.min(row.position, live.length);
      await tx
        .update(healthRoutines)
        .set({ position: sql`${healthRoutines.position} + 1` })
        .where(and(liveRoutine, gte(healthRoutines.position, at)));
      await tx
        .update(healthRoutines)
        .set({ deletedAt: null, position: at })
        .where(eq(healthRoutines.id, id));
      await renumber(tx);
    }
    return selectRoutineSummaries(tx);
  });
}

/**
 * Writes the new order. `"staleOrder"` (writing nothing) when `ids` is not exactly the set of live
 * routines: one was created or deleted elsewhere, or the request was tampered with.
 */
export async function reorderRoutinesByIds(
  db: Database,
  ids: readonly string[],
): Promise<RoutineSummary[] | "staleOrder"> {
  return db.transaction(async (tx) => {
    await lockRoutines(tx);
    const current = await selectRoutineSummaries(tx);
    if (
      !isSameIdSet(
        current.map((routine) => routine.id),
        ids,
      )
    ) {
      return "staleOrder";
    }
    const position = new Map(current.map((routine) => [routine.id, routine.position]));
    const changed = ids
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => position.get(id) !== index);
    if (changed.length > 0) {
      const cases = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(healthRoutines)
        .set({ position: sql`case ${healthRoutines.id} ${cases} end` })
        .where(
          and(
            liveRoutine,
            inArray(
              healthRoutines.id,
              changed.map(({ id }) => id),
            ),
          ),
        );
    }
    return selectRoutineSummaries(tx);
  });
}
