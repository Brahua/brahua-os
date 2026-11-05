// Records and history data access (server only, E3). Each screen reads ONE query of done,
// non-warmup sets of finished, live sessions (live session exercises and sets too: the same model
// as `selectPrevious` in sessions.ts) and computes on it with records.ts. Nothing is stored: an
// edited set, a deleted session or new times change the records on the next read.
//
// These functions take the database and trust their input: callers check the owner and validate
// the ids first (queries.ts, the actions through ownerAction()). Tables are named by hand in the
// raw SQL (CLAUDE.md "household": Drizzle prints a single table's columns bare).
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import type { ExerciseKind } from "./health-constants";
import type { Tx } from "./locks";
import { previousLine } from "./prefill";
import {
  bestLine,
  displayValue,
  exerciseRecords,
  lineMetric,
  newRecordCounts,
  newRecords,
  type ExerciseRecordsView,
  type RecordSet,
  type SessionRecord,
} from "./records";
import { lineWindowStart } from "./session-time";

type Row = {
  session_id: string;
  started_at: Date | string;
  routine_name: string | null;
  exercise_id: string;
  exercise_name: string;
  kind: ExerciseKind;
  weight_grams: number | null;
  reps: number | null;
  seconds: number | null;
  distance_meters: number | null;
};

/** The done, non-warmup sets of finished, live sessions that match `where`, in session order. */
async function selectRecordRows(db: Database | Tx, where: SQL, order: SQL): Promise<Row[]> {
  const result = await db.execute<Row>(sql`
    select ses.id as session_id, ses.started_at, r.name as routine_name,
      ex.exercise_id, e.name as exercise_name, e.kind,
      sets.weight_grams, sets.reps, sets.seconds, sets.distance_meters
    from health_sets sets
    join health_session_exercises ex on ex.id = sets.session_exercise_id and ex.deleted_at is null
    join health_sessions ses on ses.id = ex.session_id
      and ses.deleted_at is null and ses.ended_at is not null
    join health_exercises e on e.id = ex.exercise_id
    left join health_routines r on r.id = ses.routine_id
    where sets.deleted_at is null and sets.done_at is not null and not sets.warmup
      and ${where}
    order by ${order}
  `);
  return result.rows;
}

const toRecordSet = (row: Row): RecordSet => ({
  sessionId: row.session_id,
  startedAt: new Date(row.started_at).toISOString(),
  exerciseId: row.exercise_id,
  weightGrams: row.weight_grams,
  reps: row.reps,
  seconds: row.seconds,
  distanceMeters: row.distance_meters,
});

const kindsOf = (rows: readonly Row[]) =>
  new Map(rows.map((row) => [row.exercise_id, row.kind] as const));

const idList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * The new records of one session (SPEC-health "Al terminar"): against every earlier session of the
 * exercises it holds. Empty for an open, deleted or missing session (its sets aren't read).
 */
export async function selectSessionRecords(
  db: Database | Tx,
  sessionId: string,
): Promise<SessionRecord[]> {
  const rows = await selectRecordRows(
    db,
    sql`ex.exercise_id in (
        select own.exercise_id from health_session_exercises own
        where own.session_id = ${sessionId}::uuid and own.deleted_at is null
      )
      and ses.started_at <= (select self.started_at from health_sessions self where self.id = ${sessionId}::uuid)`,
    sql`ses.started_at, ses.id, ex.position, ex.id, sets.position, sets.id`,
  );
  const names = new Map(rows.map((row) => [row.exercise_id, row.exercise_name]));
  // The order of the session's blocks: its exercises as they come in its own rows.
  const order = [
    ...new Set(rows.filter((row) => row.session_id === sessionId).map((row) => row.exercise_id)),
  ];
  return newRecords(rows.map(toRecordSet), kindsOf(rows))
    .filter((record) => record.sessionId === sessionId)
    .sort((a, b) => order.indexOf(a.exerciseId) - order.indexOf(b.exerciseId))
    .map((record) => ({
      exerciseId: record.exerciseId,
      exerciseName: names.get(record.exerciseId) ?? "",
      metric: record.metric,
      value: displayValue(record.metric, record.score),
    }));
}

/**
 * How many new records each of `sessionIds` has (the session lists' «· 2 récords»), in one query:
 * the exercises they hold, over every session up to the newest of them. Sessions without any are
 * left out of the map.
 */
export async function selectNewRecordCounts(
  db: Database | Tx,
  sessionIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) return new Map();
  const rows = await selectRecordRows(
    db,
    sql`ex.exercise_id in (
        select own.exercise_id from health_session_exercises own
        where own.session_id in (${idList(ids)}) and own.deleted_at is null
      )
      and ses.started_at <= (select max(page.started_at) from health_sessions page where page.id in (${idList(ids)}))`,
    sql`ses.started_at, ses.id`,
  );
  const counts = newRecordCounts(rows.map(toRecordSet), kindsOf(rows));
  const wanted = new Set(ids);
  return new Map([...counts].filter(([id]) => wanted.has(id)));
}

/**
 * An exercise's records, its best-of line over the last 12 months (from 00:00 Lima of the same
 * day a year ago: lineWindowStart) and its history by session (the
 * newest `limit`), from one query (SPEC-health "Detalle del ejercicio"). `kind` is the exercise's
 * current kind. `now` is injectable for tests.
 */
export async function selectExerciseRecords(
  db: Database | Tx,
  exerciseId: string,
  kind: ExerciseKind,
  limit: number,
  now: Date = new Date(),
): Promise<ExerciseRecordsView> {
  const rows = await selectRecordRows(
    db,
    sql`ex.exercise_id = ${exerciseId}::uuid`,
    sql`ses.started_at desc, ses.id desc, ex.position, ex.id, sets.position, sets.id`,
  );
  const sets = rows.map(toRecordSet);
  const metric = lineMetric(kind, sets);
  const from = lineWindowStart(now);
  const sessions: ExerciseRecordsView["history"] = [];
  const bySession = new Map<string, Row[]>();
  for (const row of rows) {
    const group = bySession.get(row.session_id);
    if (group) group.push(row);
    else {
      bySession.set(row.session_id, [row]);
      sessions.push({
        sessionId: row.session_id,
        startedAt: new Date(row.started_at).toISOString(),
        routineName: row.routine_name,
        sets: "",
      });
    }
  }
  const history = sessions.slice(0, limit).map((entry) => ({
    ...entry,
    sets:
      previousLine(
        kind,
        (bySession.get(entry.sessionId) ?? []).map((row) => ({
          weightGrams: row.weight_grams,
          reps: row.reps,
          seconds: row.seconds,
          distanceMeters: row.distance_meters,
        })),
      ) ?? "",
  }));
  return {
    records: exerciseRecords(sets, kind).map((record) => ({
      ...record,
      value: displayValue(record.metric, record.score),
    })),
    lineMetric: metric,
    line: bestLine(sets, metric, from),
    history,
    totalSessions: sessions.length,
  };
}
