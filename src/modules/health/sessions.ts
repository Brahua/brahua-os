// Sessions data access (server only, E2). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries with
// requireOwner()).
//
// Locks (locks.ts): EVERY write of a session, its exercises or its sets takes the sessions lock
// `(10000, hashtext('health:session'))` FIRST, and no other advisory lock. Then the session's row
// FOR UPDATE (it exists and isn't deleted), and every statement on an exercise or a set filters by
// its session as well as its id: an id from another session is "not found" (no IDOR). Two
// «Empezar» at once queue on the lock, so the second sees the first one's open session; the
// partial unique index `health_sessions_open_unique` is the hard guarantee. Inside a session
// `position` stays contiguous (0…n-1) among the live exercises, and among an exercise's live sets.
//
// Every write stamps the session's `updated_at` with the database clock to the millisecond: the
// «Deshacer» of «Terminar» gets it as an ISO string and compares it with what is stored (it must
// round-trip exactly), so a session touched after finishing can't be reopened by an old notice.
//
// Reading the routine of a session and the exercises never filters deleted ones: a session keeps
// its history (the routine's name, an exercise deleted from the catalogue later). Adding an
// exercise, or starting from a routine, only takes live ones.
//
// Removing is a soft delete (`deleted_at`) everywhere: sets, exercises, sessions (discard and
// delete); each «Deshacer» clears it. `pnpm db:export` keeps deleted rows.
import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { isSameIdSet } from "@/modules/core/life-area-order";
import { markHabitDoneBySource, unmarkHabitBySource } from "@/modules/habits/contracts";
import {
  healthExercises,
  healthRoutines,
  healthSessionExercises,
  healthSessions,
  healthSets,
} from "./db/schema";
import { MAX_EXERCISE_SETS, MAX_SESSION_EXERCISES, type ExerciseKind } from "./health-constants";
import { lockSession, type Tx } from "./locks";
import { prefillSets, previousForOccurrence } from "./prefill";
import { selectNewRecordCounts, selectSessionRecords } from "./records-data";
import { selectRoutineItems } from "./routine-items";
import type { RotationRoutine } from "./rotation";
import { selectSettingsRow } from "./settings";
import {
  keepShown,
  missingValue,
  type AddExerciseInput,
  type AddSetInput,
  type ExerciseRefInput,
  type FinishResult,
  type FinishSessionInput,
  type OpenSession,
  type PreviousSet,
  type ReorderExercisesInput,
  type RestoreExerciseInput,
  type RestoreSetInput,
  type SessionDetail,
  type SessionExercise,
  type SessionSet,
  type SessionSummary,
  type SessionTimes,
  type SetRefInput,
  type SetValues,
  type StartResult,
  type UndoFinishInput,
  type UpdateNoteInput,
  type UpdateSetInput,
  type UpdateTimesInput,
} from "./sessions-input";

/** Why a session write did nothing. */
export type SessionFailure =
  | "notFound"
  | "routineNotFound"
  | "exerciseNotFound"
  | "setNotFound"
  | "exerciseUnavailable"
  | "tooManyExercises"
  | "tooManySets"
  | "staleOrder"
  | "idTaken"
  /** A write that needs the open session on a finished one (or the other way around). */
  | "notOpen"
  | "notFinished"
  /** «Terminar» without a done set: the sheet offers «Descartar la sesión». */
  | "noDoneSets"
  | "endOutOfRange"
  | "startInFuture"
  /** The «Deshacer» of «Terminar» on a session touched after it. */
  | "changed"
  /** Reopening or restoring an open session while another one is open. */
  | "otherOpen"
  /** Marking a set done without a value its kind needs (the field comes with it). */
  | { missing: keyof SetValues };

/** Thrown inside a transaction to roll it back with a refusal (never leaves this file). */
class Refusal extends Error {
  constructor(readonly failure: SessionFailure) {
    super(typeof failure === "string" ? failure : "missing");
  }
}

async function refusable<T>(run: () => Promise<T>): Promise<T | SessionFailure> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal) return error.failure;
    throw error;
  }
}

const s = healthSessions;
const se = healthSessionExercises;
const st = healthSets;
const liveSession = isNull(s.deletedAt);
const liveExerciseRow = isNull(se.deletedAt);
const liveSet = isNull(st.deletedAt);

/** «Now» to the millisecond (see the header). */
const nowMs = sql`date_trunc('milliseconds', now())`;
/** How far ahead of the database clock a client's «now» may be (clocks drift a little). */
const CLOCK_SKEW_MS = 60_000;

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => (value === null ? null : value.toISOString());

// ── Reads ────────────────────────────────────────────────────────────────────────────────────

const SET = {
  id: st.id,
  position: st.position,
  weightGrams: st.weightGrams,
  reps: st.reps,
  seconds: st.seconds,
  distanceMeters: st.distanceMeters,
  warmup: st.warmup,
  doneAt: st.doneAt,
};

type SetRow = { [K in keyof typeof SET]: (typeof healthSets.$inferSelect)[K] };

const toSet = (row: SetRow): SessionSet => ({
  id: row.id,
  position: row.position,
  weightGrams: row.weightGrams,
  reps: row.reps,
  seconds: row.seconds,
  distanceMeters: row.distanceMeters,
  warmup: row.warmup,
  doneAt: isoOrNull(row.doneAt),
});

const EXERCISE = {
  id: se.id,
  exerciseId: se.exerciseId,
  name: healthExercises.name,
  kind: healthExercises.kind,
  equipment: healthExercises.equipment,
  perDumbbell: healthExercises.perDumbbell,
  restSeconds: se.restSeconds,
  exerciseRestSeconds: healthExercises.restSeconds,
  position: se.position,
};

/**
 * For each exercise, the done, non-warmup sets of the latest finished, live session that started
 * before `before` and did it, other than `excludeId` (SPEC-health "Precarga"): one list per block
 * of that exercise in that session, in the blocks' order (a routine may repeat an exercise, and the
 * n-th block of it takes the n-th one: `previousForOccurrence`).
 */
export async function selectPrevious(
  db: Database | Tx,
  exerciseIds: readonly string[],
  before: Date,
  excludeId: string | null,
): Promise<Map<string, PreviousSet[][]>> {
  const result = new Map<string, PreviousSet[][]>();
  const ids = [...new Set(exerciseIds)];
  if (ids.length === 0) return result;
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const exclude = excludeId === null ? sql`true` : sql`ses.id <> ${excludeId}::uuid`;
  // Tables named by hand (CLAUDE.md "household": Drizzle prints a single table's columns bare).
  const rows = await db.execute<{
    exercise_id: string;
    block_id: string;
    weight_grams: number | null;
    reps: number | null;
    seconds: number | null;
    distance_meters: number | null;
  }>(sql`
    with done as (
      select ex.exercise_id, ses.id as session_id,
        rank() over (partition by ex.exercise_id order by ses.started_at desc, ses.id desc) as rank
      from health_sets sets
      join health_session_exercises ex on ex.id = sets.session_exercise_id and ex.deleted_at is null
      join health_sessions ses on ses.id = ex.session_id
        and ses.deleted_at is null and ses.ended_at is not null
      where sets.deleted_at is null and sets.done_at is not null and not sets.warmup
        and ex.exercise_id in (${list})
        and ses.started_at < ${before.toISOString()}::timestamptz and ${exclude}
      group by ex.exercise_id, ses.id, ses.started_at
    )
    select ex.exercise_id, ex.id as block_id, sets.weight_grams, sets.reps, sets.seconds, sets.distance_meters
    from done
    join health_session_exercises ex on ex.session_id = done.session_id
      and ex.exercise_id = done.exercise_id and ex.deleted_at is null
    join health_sets sets on sets.session_exercise_id = ex.id
      and sets.deleted_at is null and sets.done_at is not null and not sets.warmup
    where done.rank = 1
    order by ex.exercise_id, ex.position, ex.id, sets.position
  `);
  let lastBlock: string | null = null;
  for (const row of rows.rows) {
    const blocks = result.get(row.exercise_id) ?? [];
    if (row.block_id !== lastBlock) blocks.push([]);
    lastBlock = row.block_id;
    blocks.at(-1)!.push({
      weightGrams: row.weight_grams,
      reps: row.reps,
      seconds: row.seconds,
      distanceMeters: row.distance_meters,
    });
    result.set(row.exercise_id, blocks);
  }
  return result;
}

/** The occurrence (0-based) of each block's exercise among the blocks before it. */
function occurrences(blocks: readonly { exerciseId: string }[]): number[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const n = seen.get(block.exerciseId) ?? 0;
    seen.set(block.exerciseId, n + 1);
    return n;
  });
}

/** A session's live exercises in order, each with its live sets and «La vez pasada». */
async function selectExercisesOf(
  db: Database | Tx,
  session: { id: string; startedAt: Date },
): Promise<SessionExercise[]> {
  const exercises = await db
    .select(EXERCISE)
    .from(se)
    .innerJoin(healthExercises, eq(healthExercises.id, se.exerciseId))
    .where(and(eq(se.sessionId, session.id), liveExerciseRow))
    .orderBy(asc(se.position), asc(se.id));
  if (exercises.length === 0) return [];
  const sets = await db
    .select({ ...SET, sessionExerciseId: st.sessionExerciseId })
    .from(st)
    .where(
      and(
        inArray(
          st.sessionExerciseId,
          exercises.map((exercise) => exercise.id),
        ),
        liveSet,
      ),
    )
    .orderBy(asc(st.position), asc(st.id));
  const previous = await selectPrevious(
    db,
    exercises.map((exercise) => exercise.exerciseId),
    session.startedAt,
    session.id,
  );
  const occurrence = occurrences(exercises);
  return exercises.map((exercise, index) => ({
    ...exercise,
    sets: sets.filter((set) => set.sessionExerciseId === exercise.id).map((set) => toSet(set)),
    previous: previousForOccurrence(previous.get(exercise.exerciseId) ?? [], occurrence[index]),
  }));
}

/** One live session for its screen, or null. */
export async function selectSessionDetail(
  db: Database | Tx,
  id: string,
): Promise<SessionDetail | null> {
  const [row] = await db
    .select({
      id: s.id,
      routineId: s.routineId,
      routineName: healthRoutines.name,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      note: s.note,
      updatedAt: s.updatedAt,
    })
    .from(s)
    .leftJoin(healthRoutines, eq(healthRoutines.id, s.routineId))
    .where(and(eq(s.id, id), liveSession));
  if (!row) return null;
  return {
    ...row,
    startedAt: iso(row.startedAt),
    endedAt: isoOrNull(row.endedAt),
    updatedAt: iso(row.updatedAt),
    exercises: await selectExercisesOf(db, row),
  };
}

/** The open session (live, not ended), or null. */
export async function selectOpenSession(db: Database | Tx): Promise<OpenSession | null> {
  const [row] = await db
    .select({ id: s.id, routineName: healthRoutines.name, startedAt: s.startedAt })
    .from(s)
    .leftJoin(healthRoutines, eq(healthRoutines.id, s.routineId))
    .where(and(isNull(s.endedAt), liveSession));
  return row ? { ...row, startedAt: iso(row.startedAt) } : null;
}

// Raw subquery: the table named by hand (see selectPrevious).
const doneSets = sql<number>`(
  select count(*) from health_sets sets
  join health_session_exercises ex on ex.id = sets.session_exercise_id and ex.deleted_at is null
  where ex.session_id = "health_sessions"."id" and sets.deleted_at is null
    and sets.done_at is not null
)`.mapWith(Number);

/** The live sessions, the newest first (`limit` of them), and how many there are. */
export async function selectSessionSummaries(
  db: Database | Tx,
  limit: number,
): Promise<{ sessions: SessionSummary[]; total: number }> {
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: s.id,
        routineName: healthRoutines.name,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        doneSets,
      })
      .from(s)
      .leftJoin(healthRoutines, eq(healthRoutines.id, s.routineId))
      .where(liveSession)
      .orderBy(desc(s.startedAt), desc(s.id))
      .limit(limit),
    db.select({ total: count() }).from(s).where(liveSession),
  ]);
  const records = await selectNewRecordCounts(
    db,
    rows.filter((row) => row.endedAt !== null).map((row) => row.id),
  );
  return {
    sessions: rows.map((row) => ({
      ...row,
      startedAt: iso(row.startedAt),
      endedAt: isoOrNull(row.endedAt),
      newRecords: records.get(row.id) ?? 0,
    })),
    total,
  };
}

/** The live routines with when each was last done (finished, live sessions): the rotation. */
export async function selectRotationRoutines(db: Database | Tx): Promise<RotationRoutine[]> {
  const rows = await db
    .select({
      id: healthRoutines.id,
      name: healthRoutines.name,
      position: healthRoutines.position,
      lastDoneAt: sql<Date | null>`max(${s.startedAt})`,
    })
    .from(healthRoutines)
    .leftJoin(s, and(eq(s.routineId, healthRoutines.id), liveSession, isNotNull(s.endedAt)))
    .where(isNull(healthRoutines.deletedAt))
    .groupBy(healthRoutines.id)
    .orderBy(asc(healthRoutines.position), asc(healthRoutines.id));
  return rows.map((row) => ({
    ...row,
    // A raw aggregate comes back as text from node-postgres.
    lastDoneAt: row.lastDoneAt === null ? null : new Date(row.lastDoneAt).toISOString(),
  }));
}

/** A deleted session (the list's «Sesión eliminada · Deshacer»), or null when it isn't deleted. */
export async function selectDeletedSession(
  db: Database,
  id: string,
): Promise<{ id: string; routineName: string | null } | null> {
  const [row] = await db
    .select({ id: s.id, routineName: healthRoutines.name })
    .from(s)
    .leftJoin(healthRoutines, eq(healthRoutines.id, s.routineId))
    .where(and(eq(s.id, id), isNotNull(s.deletedAt)));
  return row ?? null;
}

// ── Helpers of the writes ────────────────────────────────────────────────────────────────────

type SessionRow = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  updatedAt: Date;
  habitMarkedDay: string | null;
  habitMarkedId: string | null;
  habitMarkAt: Date | null;
};

/** Locks the sessions (first), then the live session's row FOR UPDATE, or refuses. */
async function openSession(
  tx: Tx,
  id: string,
  state: "any" | "open" | "finished" = "any",
): Promise<SessionRow> {
  await lockSession(tx);
  const [row] = await tx
    .select({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      updatedAt: s.updatedAt,
      habitMarkedDay: s.habitMarkedDay,
      habitMarkedId: s.habitMarkedId,
      habitMarkAt: s.habitMarkAt,
    })
    .from(s)
    .where(and(eq(s.id, id), liveSession))
    .for("update");
  if (!row) throw new Refusal("notFound");
  if (state === "open" && row.endedAt !== null) throw new Refusal("notOpen");
  if (state === "finished" && row.endedAt === null) throw new Refusal("notFinished");
  return row;
}

/** The database clock (`now()` of the transaction). */
async function databaseNow(tx: Tx): Promise<number> {
  const result = await tx.execute<{ now: string | Date }>(sql`select now() as now`);
  return new Date(result.rows[0].now).getTime();
}

/** Stamps the session's `updated_at` (see the header). */
async function touch(tx: Tx, id: string) {
  await tx.update(s).set({ updatedAt: nowMs }).where(eq(s.id, id));
}

/** A live exercise row of the session, with its kind, or refuses. */
async function exerciseRow(tx: Tx, sessionId: string, id: string) {
  const [row] = await tx
    .select({ id: se.id, kind: healthExercises.kind })
    .from(se)
    .innerJoin(healthExercises, eq(healthExercises.id, se.exerciseId))
    .where(and(eq(se.id, id), eq(se.sessionId, sessionId), liveExerciseRow));
  if (!row) throw new Refusal("exerciseNotFound");
  return row;
}

/** A set of the session (live, or any with `deleted`), with its exercise's kind, or refuses. */
async function setRow(tx: Tx, sessionId: string, id: string, deleted = false) {
  const [row] = await tx
    .select({
      ...SET,
      sessionExerciseId: st.sessionExerciseId,
      deletedAt: st.deletedAt,
      kind: healthExercises.kind,
    })
    .from(st)
    .innerJoin(se, eq(se.id, st.sessionExerciseId))
    .innerJoin(healthExercises, eq(healthExercises.id, se.exerciseId))
    .where(
      and(
        eq(st.id, id),
        eq(se.sessionId, sessionId),
        liveExerciseRow,
        deleted ? sql`true` : liveSet,
      ),
    )
    .for("update", { of: st });
  if (!row) throw new Refusal("setNotFound");
  return row;
}

async function renumberExercises(tx: Tx, sessionId: string) {
  await tx.execute(sql`
    update health_session_exercises as e
    set position = ranked.position, updated_at = now()
    from (
      select id, (row_number() over (order by position, id) - 1)::integer as position
      from health_session_exercises
      where session_id = ${sessionId} and deleted_at is null
    ) as ranked
    where e.id = ranked.id and e.position <> ranked.position
  `);
}

async function renumberSets(tx: Tx, sessionExerciseId: string) {
  await tx.execute(sql`
    update health_sets as t
    set position = ranked.position, updated_at = now()
    from (
      select id, (row_number() over (order by position, id) - 1)::integer as position
      from health_sets
      where session_exercise_id = ${sessionExerciseId} and deleted_at is null
    ) as ranked
    where t.id = ranked.id and t.position <> ranked.position
  `);
}

/** Inserts an exercise row at `position` with `count` planned sets prefilled from `previous`. */
async function insertExerciseWithSets(
  tx: Tx,
  values: {
    id?: string;
    sessionId: string;
    exerciseId: string;
    kind: ExerciseKind;
    position: number;
    restSeconds: number | null;
  },
  previous: PreviousSet[],
  count: number,
): Promise<string | null> {
  const [row] = await tx
    .insert(se)
    .values({
      ...(values.id ? { id: values.id } : {}),
      sessionId: values.sessionId,
      exerciseId: values.exerciseId,
      position: values.position,
      restSeconds: values.restSeconds,
    })
    .onConflictDoNothing({ target: se.id })
    .returning({ id: se.id });
  if (!row) return null;
  const sets = prefillSets(previous, count).map((prefill, position) => ({
    sessionExerciseId: row.id,
    position,
    ...keepShown(values.kind, prefill),
  }));
  if (sets.length > 0) await tx.insert(st).values(sets);
  return row.id;
}

// ── Start ────────────────────────────────────────────────────────────────────────────────────

/**
 * «Empezar»: from a live routine (its live exercises, in order, with their rest and their target
 * sets as planned sets with the prefill) or free (null). With a session already open, nothing is
 * written and the open one is returned (`started: false`).
 */
export async function startSession(
  db: Database,
  routineId: string | null,
): Promise<StartResult | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await lockSession(tx);
      const [open] = await tx
        .select({ id: s.id })
        .from(s)
        .where(and(isNull(s.endedAt), liveSession));
      if (open) return { started: false as const, openId: open.id };
      let items: Awaited<ReturnType<typeof selectRoutineItems>> = [];
      if (routineId !== null) {
        const [routine] = await tx
          .select({ id: healthRoutines.id })
          .from(healthRoutines)
          .where(and(eq(healthRoutines.id, routineId), isNull(healthRoutines.deletedAt)))
          .for("share");
        if (!routine) throw new Refusal("routineNotFound");
        items = await selectRoutineItems(tx, routineId);
      }
      const [session] = await tx
        .insert(s)
        .values({ routineId, startedAt: nowMs, updatedAt: nowMs })
        .returning({ id: s.id, startedAt: s.startedAt });
      const previous = await selectPrevious(
        tx,
        items.map((item) => item.exerciseId),
        // Every finished session started before this one.
        new Date(session.startedAt.getTime() + 1),
        session.id,
      );
      const occurrence = occurrences(items);
      for (const [position, item] of items.entries()) {
        await insertExerciseWithSets(
          tx,
          {
            sessionId: session.id,
            exerciseId: item.exerciseId,
            kind: item.kind,
            position,
            restSeconds: item.restSeconds,
          },
          previousForOccurrence(previous.get(item.exerciseId) ?? [], occurrence[position]),
          item.targetSets,
        );
      }
      return { started: true as const, id: session.id };
    }),
  );
}

// ── Exercises of a session ───────────────────────────────────────────────────────────────────

async function selectOneExercise(
  tx: Tx,
  session: SessionRow,
  id: string,
): Promise<SessionExercise> {
  const all = await selectExercisesOf(tx, session);
  const found = all.find((exercise) => exercise.id === id);
  if (!found) throw new Refusal("exerciseNotFound");
  return found;
}

/**
 * «Agregar ejercicio» at the end, with as many planned sets as it had done the last time (at
 * least one), prefilled. The id comes from the client, and the call is idempotent: a retry after a
 * lost answer finds its row and returns it.
 */
export async function addExercise(
  db: Database,
  { sessionId, id, exerciseId }: AddExerciseInput,
): Promise<SessionExercise | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      const session = await openSession(tx, sessionId);
      const [existing] = await tx
        .select({ sessionId: se.sessionId, exerciseId: se.exerciseId, deletedAt: se.deletedAt })
        .from(se)
        .where(eq(se.id, id));
      if (existing) {
        // The same call again (its answer was lost): the row it made, if it is still that one.
        if (
          existing.sessionId !== sessionId ||
          existing.exerciseId !== exerciseId ||
          existing.deletedAt !== null
        ) {
          throw new Refusal("idTaken");
        }
        return selectOneExercise(tx, session, id);
      }
      const [exercise] = await tx
        .select({ id: healthExercises.id, kind: healthExercises.kind })
        .from(healthExercises)
        .where(and(eq(healthExercises.id, exerciseId), isNull(healthExercises.deletedAt)))
        .for("share");
      if (!exercise) throw new Refusal("exerciseUnavailable");
      const [{ total }] = await tx
        .select({ total: count() })
        .from(se)
        .where(and(eq(se.sessionId, sessionId), liveExerciseRow));
      if (total >= MAX_SESSION_EXERCISES) throw new Refusal("tooManyExercises");
      const [{ repeated }] = await tx
        .select({ repeated: count() })
        .from(se)
        .where(and(eq(se.sessionId, sessionId), eq(se.exerciseId, exerciseId), liveExerciseRow));
      const previous = previousForOccurrence(
        (await selectPrevious(tx, [exerciseId], session.startedAt, sessionId)).get(exerciseId) ??
          [],
        repeated,
      );
      const inserted = await insertExerciseWithSets(
        tx,
        { id, sessionId, exerciseId, kind: exercise.kind, position: total, restSeconds: null },
        previous,
        Math.min(Math.max(previous.length, 1), MAX_EXERCISE_SETS),
      );
      if (!inserted) throw new Refusal("idTaken");
      await touch(tx, sessionId);
      return selectOneExercise(tx, session, id);
    }),
  );
}

/** Removes an exercise (soft delete, its sets stay with it) and closes the gap. */
export async function removeExercise(
  db: Database,
  { sessionId, id }: ExerciseRefInput,
): Promise<{ id: string; position: number } | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, sessionId);
      const [row] = await tx
        .update(se)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(se.id, id), eq(se.sessionId, sessionId), liveExerciseRow))
        .returning({ id: se.id, position: se.position });
      if (!row) throw new Refusal("exerciseNotFound");
      await renumberExercises(tx, sessionId);
      await touch(tx, sessionId);
      return row;
    }),
  );
}

/**
 * «Deshacer» of a remove: back right after `afterId` while that one is still there, else at
 * `position` clamped to the list; with its sets. A live one changes nothing.
 */
export async function restoreExercise(
  db: Database,
  { sessionId, id, afterId, position }: RestoreExerciseInput,
): Promise<SessionExercise[] | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      const session = await openSession(tx, sessionId);
      const [row] = await tx
        .select({ deletedAt: se.deletedAt })
        .from(se)
        .where(and(eq(se.id, id), eq(se.sessionId, sessionId)));
      if (!row) throw new Refusal("exerciseNotFound");
      if (row.deletedAt !== null) {
        const current = await tx
          .select({ id: se.id, position: se.position })
          .from(se)
          .where(and(eq(se.sessionId, sessionId), liveExerciseRow))
          .orderBy(asc(se.position), asc(se.id));
        if (current.length >= MAX_SESSION_EXERCISES) throw new Refusal("tooManyExercises");
        const anchor = afterId ? current.findIndex((item) => item.id === afterId) : -1;
        const at = anchor !== -1 ? anchor + 1 : Math.min(position, current.length);
        await tx
          .update(se)
          .set({ position: sql`${se.position} + 1` })
          .where(and(eq(se.sessionId, sessionId), liveExerciseRow, sql`${se.position} >= ${at}`));
        await tx
          .update(se)
          .set({ deletedAt: null, position: at })
          .where(and(eq(se.id, id), eq(se.sessionId, sessionId)));
        await renumberExercises(tx, sessionId);
        await touch(tx, sessionId);
      }
      return selectExercisesOf(tx, session);
    }),
  );
}

/** The new order; `staleOrder` (writing nothing) when `ids` isn't exactly the live set. */
export async function reorderExercises(
  db: Database,
  { sessionId, ids }: ReorderExercisesInput,
): Promise<{ ids: string[] } | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, sessionId);
      const current = await tx
        .select({ id: se.id, position: se.position })
        .from(se)
        .where(and(eq(se.sessionId, sessionId), liveExerciseRow));
      if (
        !isSameIdSet(
          current.map((row) => row.id),
          ids,
        )
      ) {
        throw new Refusal("staleOrder");
      }
      const position = new Map(current.map((row) => [row.id, row.position]));
      const changed = ids
        .map((id, index) => ({ id, index }))
        .filter(({ id, index }) => position.get(id) !== index);
      if (changed.length > 0) {
        const cases = sql.join(
          changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
          sql` `,
        );
        await tx
          .update(se)
          .set({ position: sql`case ${se.id} ${cases} end` })
          .where(
            and(
              eq(se.sessionId, sessionId),
              liveExerciseRow,
              inArray(
                se.id,
                changed.map(({ id }) => id),
              ),
            ),
          );
        await touch(tx, sessionId);
      }
      return { ids: [...ids] };
    }),
  );
}

// ── Sets ─────────────────────────────────────────────────────────────────────────────────────

/**
 * «Añadir serie» at the end of the exercise, with the values the client copied. Idempotent: a
 * retry after a lost answer (same id) finds the row it made and returns it.
 */
export async function addSet(
  db: Database,
  { sessionId, sessionExerciseId, id, warmup, ...values }: AddSetInput,
): Promise<SessionSet | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, sessionId);
      const exercise = await exerciseRow(tx, sessionId, sessionExerciseId);
      const [existing] = await tx
        .select({ ...SET, sessionExerciseId: st.sessionExerciseId, deletedAt: st.deletedAt })
        .from(st)
        .where(eq(st.id, id));
      if (existing) {
        if (existing.sessionExerciseId !== sessionExerciseId || existing.deletedAt !== null) {
          throw new Refusal("idTaken");
        }
        return toSet(existing);
      }
      const [{ total }] = await tx
        .select({ total: count() })
        .from(st)
        .where(and(eq(st.sessionExerciseId, sessionExerciseId), liveSet));
      if (total >= MAX_EXERCISE_SETS) throw new Refusal("tooManySets");
      const [row] = await tx
        .insert(st)
        .values({
          id,
          sessionExerciseId,
          position: total,
          warmup,
          ...keepShown(exercise.kind, values),
        })
        .onConflictDoNothing({ target: st.id })
        .returning(SET);
      if (!row) throw new Refusal("idTaken");
      await touch(tx, sessionId);
      return toSet(row);
    }),
  );
}

/**
 * A set, whole: its values (those its kind doesn't show are dropped), «Calentamiento» and «hecha».
 * Marking needs the values its kind requires; a set marked again keeps its first `done_at`.
 */
export async function updateSet(
  db: Database,
  { sessionId, id, warmup, done, ...input }: UpdateSetInput,
): Promise<SessionSet | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, sessionId);
      const current = await setRow(tx, sessionId, id);
      const values = keepShown(current.kind, input);
      if (done) {
        const missing = missingValue(current.kind, values);
        if (missing !== null) throw new Refusal({ missing });
      }
      const [row] = await tx
        .update(st)
        .set({
          ...values,
          warmup,
          doneAt: done ? (current.doneAt ?? nowMs) : null,
        })
        .where(eq(st.id, id))
        .returning(SET);
      await touch(tx, sessionId);
      return toSet(row);
    }),
  );
}

/** Removes a set (soft delete) and closes the gap. */
export async function removeSet(
  db: Database,
  { sessionId, id }: SetRefInput,
): Promise<{ id: string; position: number } | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, sessionId);
      const current = await setRow(tx, sessionId, id);
      await tx
        .update(st)
        .set({ deletedAt: sql`now()` })
        .where(eq(st.id, id));
      await renumberSets(tx, current.sessionExerciseId);
      await touch(tx, sessionId);
      return { id, position: current.position };
    }),
  );
}

/** «Deshacer» of removing a set: back after `afterId` (else at `position`). A live one: nothing. */
export async function restoreSet(
  db: Database,
  { sessionId, id, afterId, position }: RestoreSetInput,
): Promise<SessionSet[] | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, sessionId);
      const row = await setRow(tx, sessionId, id, true);
      const exerciseId = row.sessionExerciseId;
      const liveOf = and(eq(st.sessionExerciseId, exerciseId), liveSet);
      if (row.deletedAt !== null) {
        const current = await tx
          .select({ id: st.id })
          .from(st)
          .where(liveOf)
          .orderBy(asc(st.position), asc(st.id));
        if (current.length >= MAX_EXERCISE_SETS) throw new Refusal("tooManySets");
        const anchor = afterId ? current.findIndex((item) => item.id === afterId) : -1;
        const at = anchor !== -1 ? anchor + 1 : Math.min(position, current.length);
        await tx
          .update(st)
          .set({ position: sql`${st.position} + 1` })
          .where(and(liveOf, sql`${st.position} >= ${at}`));
        await tx.update(st).set({ deletedAt: null, position: at }).where(eq(st.id, id));
        await renumberSets(tx, exerciseId);
        await touch(tx, sessionId);
      }
      const rows = await tx
        .select(SET)
        .from(st)
        .where(liveOf)
        .orderBy(asc(st.position), asc(st.id));
      return rows.map(toSet);
    }),
  );
}

// ── Note, times ──────────────────────────────────────────────────────────────────────────────

export async function updateNote(
  db: Database,
  { sessionId, note }: UpdateNoteInput,
): Promise<{ note: string | null } | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, sessionId);
      await tx.update(s).set({ note, updatedAt: nowMs }).where(eq(s.id, sessionId));
      return { note };
    }),
  );
}

/** The start and end of a finished session: the start not after now, the end from it to now. */
export async function updateTimes(
  db: Database,
  { sessionId, startedAt, endedAt }: UpdateTimesInput,
): Promise<SessionTimes | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, sessionId, "finished");
      const limit = (await databaseNow(tx)) + CLOCK_SKEW_MS;
      if (Date.parse(startedAt) > limit) throw new Refusal("startInFuture");
      if (Date.parse(endedAt) > limit || Date.parse(endedAt) < Date.parse(startedAt)) {
        throw new Refusal("endOutOfRange");
      }
      const [row] = await tx
        .update(s)
        .set({ startedAt: new Date(startedAt), endedAt: new Date(endedAt), updatedAt: nowMs })
        .where(eq(s.id, sessionId))
        .returning({ startedAt: s.startedAt, endedAt: s.endedAt, updatedAt: s.updatedAt });
      return {
        startedAt: iso(row.startedAt),
        endedAt: isoOrNull(row.endedAt),
        updatedAt: iso(row.updatedAt),
      };
    }),
  );
}

// ── Finish, discard, delete ──────────────────────────────────────────────────────────────────

/**
 * «This set belongs to a live exercise of the session»: the column qualified by hand (Drizzle
 * prints it bare inside a single-table statement, CLAUDE.md "household").
 */
const inSession = (sessionId: string) =>
  sql`"health_sets"."session_exercise_id" in (select ex.id from health_session_exercises ex where ex.session_id = ${sessionId}::uuid and ex.deleted_at is null)`;

/**
 * «Terminar»: ends the open session at `endedAt` (between its start and now; null: now) with its
 * note, and removes its planned (unmarked) sets. Those sets get one shared `deleted_at`, the same
 * instant as the session's new `updated_at` (`now()` is fixed for the transaction): the «Deshacer»
 * restores exactly the sets with that stamp, never a list from the client. The removed sets keep
 * their `position` (the done ones close the gap), so the «Deshacer» can rebuild the order. Without
 * a done set it is refused (`noDoneSets`: the sheet offers «Descartar la sesión»).
 */
export async function finishSession(
  db: Database,
  { sessionId, endedAt, note }: FinishSessionInput,
): Promise<FinishResult | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      const session = await openSession(tx, sessionId, "open");
      const [{ done }] = await tx
        .select({ done: count() })
        .from(st)
        .where(and(inSession(sessionId), liveSet, isNotNull(st.doneAt)));
      if (done === 0) throw new Refusal("noDoneSets");
      let end = nowMs;
      const now = await databaseNow(tx);
      let endAt = now;
      if (endedAt !== null) {
        const at = Date.parse(endedAt);
        if (at < session.startedAt.getTime() || at > now + CLOCK_SKEW_MS) {
          throw new Refusal("endOutOfRange");
        }
        endAt = Math.min(at, now);
        end = sql`date_trunc('milliseconds', ${new Date(endAt).toISOString()}::timestamptz)`;
      }
      const removed = await tx
        .update(st)
        .set({ deletedAt: nowMs })
        .where(and(inSession(sessionId), liveSet, isNull(st.doneAt)))
        .returning({ id: st.id, sessionExerciseId: st.sessionExerciseId });
      for (const exerciseId of new Set(removed.map((row) => row.sessionExerciseId))) {
        await renumberSets(tx, exerciseId);
      }
      // E4: the linked habit, on the Lima day of the end (the session remembers only its own mark).
      const habit = await markLinkedHabit(tx, ownerDateKey(new Date(endAt)), new Date(now));
      const [row] = await tx
        .update(s)
        .set({
          endedAt: end,
          note,
          habitMarkedDay: habit?.day ?? null,
          habitMarkedId: habit?.habitId ?? null,
          habitMarkAt: habit?.markAt ?? null,
          updatedAt: nowMs,
        })
        .where(eq(s.id, sessionId))
        .returning({ endedAt: s.endedAt, updatedAt: s.updatedAt });
      return {
        id: sessionId,
        endedAt: iso(row.endedAt as Date),
        updatedAt: iso(row.updatedAt),
        removedSetIds: removed.map((set) => set.id),
        // Read after the end is written: the session now counts as finished.
        records: await selectSessionRecords(tx, sessionId),
        habitMarked: habit?.name ?? null,
      };
    }),
  );
}

/**
 * E4 (SPEC-health "Hábito enlazado"): marks the linked habit done on `day` through `habits`'
 * contract, inside «Terminar»'s transaction (after the sessions lock and the session's row; the
 * settings row FOR SHARE, then the habit FOR SHARE inside the contract, like `setHabitDoneById`).
 * Returns what the session stores (the day, the habit and the log's stamp right after marking)
 * and the habit's name only when this session marked it: a habit already done that day, or one
 * that can't be marked (deleted, archived, another measure, a day out of the window), returns
 * null and the session stores no mark. `now` is the database clock.
 */
async function markLinkedHabit(
  tx: Tx,
  day: string,
  now: Date,
): Promise<{ day: string; habitId: string; markAt: Date; name: string } | null> {
  const settings = await selectSettingsRow(tx, { forShare: true });
  if (!settings?.habitId) return null;
  const mark = await markHabitDoneBySource(tx, settings.habitId, day, now);
  if (mark.result !== "marked") return null;
  return { day, habitId: settings.habitId, markAt: mark.markAt, name: mark.name };
}

/**
 * E4: the «Deshacer» of «Terminar» unmarks exactly what the session marked (`habit_marked_id` on
 * `habit_marked_day`), whatever «Ajustes» says now, and only while that log is as the mark left it
 * (still done, `updated_at` still `habit_mark_at`): a habit unmarked and marked again by hand in
 * between stays. Anything else stays too. The caller clears the three fields.
 */
async function unmarkLinkedHabit(tx: Tx, session: SessionRow) {
  const { habitMarkedDay: day, habitMarkedId: habitId, habitMarkAt: markAt } = session;
  if (day === null || habitId === null || markAt === null) return;
  await unmarkHabitBySource(tx, habitId, day, markAt, new Date(await databaseNow(tx)));
}

/**
 * Puts each exercise's sets back in the order they had before «Terminar»: the restored ones at the
 * positions they kept, the done ones filling the other places in their current order.
 */
async function rebuildOrder(
  tx: Tx,
  restored: { id: string; sessionExerciseId: string; position: number }[],
) {
  for (const exerciseId of new Set(restored.map((row) => row.sessionExerciseId))) {
    const back = restored.filter((row) => row.sessionExerciseId === exerciseId);
    const backIds = new Set(back.map((row) => row.id));
    const live = await tx
      .select({ id: st.id, position: st.position })
      .from(st)
      .where(and(eq(st.sessionExerciseId, exerciseId), liveSet))
      .orderBy(asc(st.position), asc(st.id));
    const total = live.length;
    const taken = new Map<number, string>();
    for (const row of back.toSorted((a, b) => a.position - b.position)) {
      // A stored position past the end (or repeated) can only come from a bug: next free place.
      let at = Math.min(row.position, total - 1);
      while (taken.has(at)) at = (at + 1) % total;
      taken.set(at, row.id);
    }
    const others = live.filter((row) => !backIds.has(row.id));
    let next = 0;
    for (const row of others) {
      while (taken.has(next)) next++;
      taken.set(next, row.id);
    }
    const cases = sql.join(
      [...taken].map(([position, id]) => sql`when ${id}::uuid then ${position}::integer`),
      sql` `,
    );
    await tx
      .update(st)
      .set({ position: sql`case ${st.id} ${cases} end` })
      .where(and(eq(st.sessionExerciseId, exerciseId), liveSet));
  }
}

/**
 * «Deshacer» of «Terminar»: reopens the session and brings back exactly the sets it removed (those
 * with its stamp, see finishSession) in their places, only when nobody touched the session since
 * (`updatedAt` is still the one «Terminar» left) and no other session is open. Reopening an open
 * one changes nothing. Returns the session as it is now.
 */
export async function undoFinish(
  db: Database,
  { sessionId, updatedAt }: UndoFinishInput,
): Promise<SessionDetail | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      const session = await openSession(tx, sessionId);
      if (session.endedAt !== null) {
        if (session.updatedAt.getTime() !== Date.parse(updatedAt)) throw new Refusal("changed");
        const [other] = await tx
          .select({ id: s.id })
          .from(s)
          .where(and(isNull(s.endedAt), liveSession, ne(s.id, sessionId)));
        if (other) throw new Refusal("otherOpen");
        await unmarkLinkedHabit(tx, session);
        await tx
          .update(s)
          .set({
            endedAt: null,
            habitMarkedDay: null,
            habitMarkedId: null,
            habitMarkAt: null,
            updatedAt: nowMs,
          })
          .where(eq(s.id, sessionId));
        const restored = await tx
          .update(st)
          .set({ deletedAt: null })
          .where(and(inSession(sessionId), eq(st.deletedAt, session.updatedAt), isNull(st.doneAt)))
          .returning({
            id: st.id,
            sessionExerciseId: st.sessionExerciseId,
            position: st.position,
          });
        await rebuildOrder(tx, restored);
      }
      return (await selectSessionDetail(tx, sessionId))!;
    }),
  );
}

/**
 * Deletes a session (soft): «Descartar la sesión» of an open one, «Eliminar sesión» of a finished
 * one. Returns what the list's «Deshacer» names.
 */
export async function deleteSession(
  db: Database,
  id: string,
): Promise<{ id: string; routineName: string | null } | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await openSession(tx, id);
      await tx
        .update(s)
        .set({ deletedAt: sql`now()`, updatedAt: nowMs })
        .where(eq(s.id, id));
      const [row] = await tx
        .select({ id: s.id, routineName: healthRoutines.name })
        .from(s)
        .leftJoin(healthRoutines, eq(healthRoutines.id, s.routineId))
        .where(eq(s.id, id));
      return row;
    }),
  );
}

/**
 * «Deshacer» of a delete or a discard. A discarded open session comes back open only while no
 * other is open (`otherOpen`). Restoring a live one changes nothing.
 */
export async function restoreSession(
  db: Database,
  id: string,
): Promise<{ id: string } | SessionFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await lockSession(tx);
      const [row] = await tx
        .select({ endedAt: s.endedAt, deletedAt: s.deletedAt })
        .from(s)
        .where(eq(s.id, id))
        .for("update");
      if (!row) throw new Refusal("notFound");
      if (row.deletedAt !== null) {
        if (row.endedAt === null) {
          const [other] = await tx
            .select({ id: s.id })
            .from(s)
            .where(and(isNull(s.endedAt), liveSession));
          if (other) throw new Refusal("otherOpen");
        }
        await tx.update(s).set({ deletedAt: null, updatedAt: nowMs }).where(eq(s.id, id));
      }
      return { id };
    }),
  );
}
