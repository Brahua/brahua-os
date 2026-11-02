// Sessions data access (server only, L2). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries with
// requireOwner()).
//
// Locks (tracks.ts documents every lock of `learning`): EVERY write of a session takes the timer
// lock `(8000, hashtext('learning:timer'))` FIRST, and no other advisory lock. Then, when it names
// a track, the track's row FOR SHARE (it exists and isn't deleted until the commit). A delete of a
// track takes the status lock and that row FOR UPDATE: no cycle. Two «Estudiar» at once queue on
// the timer lock, so the second sees the first one's running session; the partial unique index
// `learning_sessions_running_unique` is the hard guarantee that only one timer ever runs.
//
// Times come from the database clock (`now()`), to the millisecond: a «Deshacer» gets `ended_at`
// as an ISO string and compares it with what is stored, which must round-trip exactly. A timer
// that ran more than 4 h never saves on its own: the owner confirms or corrects its minutes.
//
// A running session whose track was deleted isn't shown anywhere; starting another timer still
// stops it (saving its minutes), and restoring the track brings it back still running.
//
// Removing is a soft delete (`deleted_at`): out of the lists and the week's minutes; «Deshacer»
// clears it.
import "server-only";
import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { learningSessions, learningTracks } from "./db/schema";
import {
  isManualDay,
  manualSpan,
  maxConfirmMinutes,
  needsConfirmation,
  timerMinutes,
} from "./pace";
import type {
  LogSessionInput,
  RunningSession,
  SessionItem,
  SessionRefInput,
  StartResult,
  StartSessionInput,
  StopSessionInput,
  StoppedSession,
  TrackMinutes,
  UndoStartInput,
  UndoStopInput,
} from "./sessions-input";
import { liveTrack, lockTimer, type Tx } from "./tracks";

/** Why a session write did nothing. */
export type SessionFailure =
  | "trackNotFound"
  /** «Estudiar» on a finished track. */
  | "trackDone"
  /** The session to stop isn't running (stopped elsewhere, or removed). */
  | "notRunning"
  /** The timer ran more than 4 h and no minutes were confirmed. */
  | "confirmNeeded"
  /** The day of «Anotar tiempo» is in the future or more than 30 days back. */
  | "dayOutOfRange"
  | "sessionNotFound"
  /** A «Deshacer» whose rows changed meanwhile. */
  | "changed";

/** The confirmed minutes are more than the timer ran (`max` is what it ran, rounded up). */
export type TooManyMinutes = { failure: "tooManyMinutes"; max: number };

const s = learningSessions;
const liveSession = isNull(s.deletedAt);
const running = and(isNull(s.endedAt), liveSession);

/** «Now» to the millisecond (see the header). */
const nowMs = sql`date_trunc('milliseconds', now())`;
/** Milliseconds since the session started, by the database clock. */
const elapsedColumn = sql<number>`(extract(epoch from (now() - ${s.startedAt})) * 1000)`.mapWith(
  Number,
);

/** The track exists and isn't deleted: its row FOR SHARE until the commit. */
async function openTrack(tx: Tx, trackId: string) {
  const [track] = await tx
    .select({ id: learningTracks.id, title: learningTracks.title, status: learningTracks.status })
    .from(learningTracks)
    .where(and(eq(learningTracks.id, trackId), liveTrack))
    .for("share");
  return track ?? null;
}

/** The running session (any track's, deleted tracks included), its row FOR UPDATE. */
async function runningRow(tx: Tx) {
  const [row] = await tx
    .select({
      id: s.id,
      trackId: s.trackId,
      trackTitle: learningTracks.title,
      startedAt: s.startedAt,
      elapsed: elapsedColumn,
    })
    .from(s)
    .innerJoin(learningTracks, eq(learningTracks.id, s.trackId))
    .where(running)
    .for("update", { of: s });
  return row ?? null;
}

type RunningRow = NonNullable<Awaited<ReturnType<typeof runningRow>>>;

/**
 * The minutes a stop saves: computed up to 4 h; beyond it only the `confirmed` ones, never more
 * than the timer ran.
 */
function minutesFor(
  row: RunningRow,
  confirmed: number | null,
): number | "confirmNeeded" | TooManyMinutes {
  if (!needsConfirmation(row.elapsed)) return timerMinutes(row.elapsed);
  if (confirmed === null) return "confirmNeeded";
  const max = maxConfirmMinutes(row.elapsed);
  return confirmed > max ? { failure: "tooManyMinutes", max } : confirmed;
}

/** Ends the running row with `minutes` and returns what its «Deshacer» needs. */
async function endRow(tx: Tx, row: RunningRow, minutes: number): Promise<StoppedSession> {
  const [ended] = await tx
    .update(s)
    .set({ endedAt: nowMs, minutes })
    .where(eq(s.id, row.id))
    .returning({ endedAt: s.endedAt });
  return {
    id: row.id,
    trackId: row.trackId,
    trackTitle: row.trackTitle,
    minutes,
    endedAt: (ended.endedAt as Date).toISOString(),
  };
}

/** Thrown inside a transaction to roll it back with a refusal (never leaves this file). */
class Refusal extends Error {
  constructor(readonly failure: SessionFailure | TooManyMinutes) {
    super(typeof failure === "string" ? failure : failure.failure);
  }
}

async function refusable<T>(run: () => Promise<T>): Promise<T | SessionFailure | TooManyMinutes> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal) return error.failure;
    throw error;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────

/** The timer that runs now, or null (also null when its track was deleted). */
export async function selectRunningSession(db: Database | Tx): Promise<RunningSession | null> {
  const [row] = await db
    .select({
      id: s.id,
      trackId: s.trackId,
      trackTitle: learningTracks.title,
      startedAt: s.startedAt,
    })
    .from(s)
    .innerJoin(learningTracks, eq(learningTracks.id, s.trackId))
    .where(and(running, liveTrack));
  return row ? { ...row, startedAt: row.startedAt.toISOString() } : null;
}

/** A track's ended, live sessions that started from `since` on, the newest first. */
export async function selectTrackSessions(
  db: Database | Tx,
  trackId: string,
  since: Date,
): Promise<SessionItem[]> {
  const rows = await db
    .select({
      id: s.id,
      source: s.source,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      minutes: s.minutes,
    })
    .from(s)
    .where(and(eq(s.trackId, trackId), liveSession, isNotNull(s.endedAt), gte(s.startedAt, since)))
    .orderBy(desc(s.startedAt), desc(s.id));
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    startedAt: row.startedAt.toISOString(),
    endedAt: (row.endedAt as Date).toISOString(),
    minutes: row.minutes as number,
  }));
}

/**
 * Each track's minutes (ended, live sessions): those that started in [from, to) — a Lima week —
 * and all of them. Only tracks with some session appear; `trackId` narrows it to one.
 */
export async function selectTrackMinutes(
  db: Database | Tx,
  { from, to }: { from: Date; to: Date },
  trackId?: string,
): Promise<Record<string, TrackMinutes>> {
  const rows = await db
    .select({
      trackId: s.trackId,
      week: sql<number>`coalesce(sum(${s.minutes}) filter (where ${s.startedAt} >= ${from} and ${s.startedAt} < ${to}), 0)`.mapWith(
        Number,
      ),
      total: sql<number>`coalesce(sum(${s.minutes}), 0)`.mapWith(Number),
    })
    .from(s)
    .where(and(liveSession, isNotNull(s.endedAt), trackId ? eq(s.trackId, trackId) : undefined))
    .groupBy(s.trackId);
  return Object.fromEntries(rows.map(({ trackId: id, ...minutes }) => [id, minutes]));
}

// ── The timer ────────────────────────────────────────────────────────────────────────────────

/**
 * «Estudiar» (SPEC-learning "Cronómetro"): starts the timer on a track. On the track whose timer
 * already runs it changes nothing (idempotent). Another track's running timer is stopped and saved
 * in the same transaction (with the confirmed `stopMinutes` when it ran more than 4 h); its
 * snapshot comes back for «Deshacer». A finished track can't start one.
 */
export async function startTimer(
  db: Database,
  { trackId, stopMinutes }: StartSessionInput,
): Promise<StartResult | SessionFailure | TooManyMinutes> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await lockTimer(tx);
      const track = await openTrack(tx, trackId);
      if (!track) throw new Refusal("trackNotFound");
      const current = await runningRow(tx);
      if (current && current.trackId === trackId) {
        return {
          session: {
            id: current.id,
            trackId,
            trackTitle: track.title,
            startedAt: current.startedAt.toISOString(),
          },
          stopped: null,
        };
      }
      if (track.status === "done") throw new Refusal("trackDone");
      let stopped: StoppedSession | null = null;
      if (current) {
        const minutes = minutesFor(current, stopMinutes);
        if (typeof minutes !== "number") throw new Refusal(minutes);
        stopped = await endRow(tx, current, minutes);
      }
      const [row] = await tx
        .insert(s)
        .values({ trackId, source: "timer", startedAt: nowMs })
        .returning({ id: s.id, startedAt: s.startedAt });
      return {
        session: {
          id: row.id,
          trackId,
          trackTitle: track.title,
          startedAt: row.startedAt.toISOString(),
        },
        stopped,
      };
    }),
  );
}

/**
 * «Detener»: ends that running session and saves its minutes (computed up to 4 h; beyond it only
 * the confirmed or corrected `minutes`). Returns what its «Deshacer» needs.
 */
export async function stopTimer(
  db: Database,
  { id, minutes }: StopSessionInput,
): Promise<StoppedSession | SessionFailure | TooManyMinutes> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await lockTimer(tx);
      const current = await runningRow(tx);
      if (!current || current.id !== id) throw new Refusal("notRunning");
      const saved = minutesFor(current, minutes);
      if (typeof saved !== "number") throw new Refusal(saved);
      return endRow(tx, current, saved);
    }),
  );
}

/**
 * «Deshacer» of «Estudiar»: removes the session it started, while it still runs, and runs again
 * the one it stopped, while that one still holds exactly what the stop left. Otherwise nothing
 * is written (`changed`).
 */
export async function undoStartTimer(
  db: Database,
  { id, stopped }: UndoStartInput,
): Promise<{ restored: true } | SessionFailure> {
  return db.transaction(async (tx) => {
    await lockTimer(tx);
    const current = await runningRow(tx);
    if (!current || current.id !== id) return "changed";
    if (stopped && !(await holdsStop(tx, stopped))) return "changed";
    // First out of the running index, then the stopped one back into it.
    await tx
      .update(s)
      .set({ deletedAt: sql`now()` })
      .where(eq(s.id, id));
    if (stopped) await reopen(tx, stopped.id);
    return { restored: true };
  });
}

/**
 * «Deshacer» of «Detener»: the timer runs again from when it started, while the session still
 * holds what the stop left and no other timer started since.
 */
export async function undoStopTimer(
  db: Database,
  stopped: UndoStopInput,
): Promise<{ restored: true } | SessionFailure> {
  return db.transaction(async (tx) => {
    await lockTimer(tx);
    if (await runningRow(tx)) return "changed";
    if (!(await holdsStop(tx, stopped))) return "changed";
    await reopen(tx, stopped.id);
    return { restored: true };
  });
}

/** Whether a live session still has the end and minutes a stop wrote (row FOR UPDATE). */
async function holdsStop(tx: Tx, { id, endedAt, minutes }: UndoStopInput): Promise<boolean> {
  const [row] = await tx
    .select({ id: s.id })
    .from(s)
    .where(and(eq(s.id, id), liveSession, eq(s.endedAt, new Date(endedAt)), eq(s.minutes, minutes)))
    .for("update");
  return Boolean(row);
}

async function reopen(tx: Tx, id: string) {
  await tx.update(s).set({ endedAt: null, minutes: null }).where(eq(s.id, id));
}

// ── By hand ──────────────────────────────────────────────────────────────────────────────────

/**
 * «Anotar tiempo»: minutes on a day, today or up to 30 days back (Lima, at `now`). The session sits
 * on that day (pace.ts `manualSpan`), so it counts in that day's week.
 */
export async function insertManualSession(
  db: Database,
  { trackId, minutes, day }: LogSessionInput,
  now: Date,
): Promise<SessionItem | SessionFailure> {
  if (!isManualDay(day, ownerDateKey(now))) return "dayOutOfRange";
  return db.transaction(async (tx) => {
    await lockTimer(tx);
    if (!(await openTrack(tx, trackId))) return "trackNotFound";
    const { startedAt, endedAt } = manualSpan(day, minutes, now);
    const [row] = await tx
      .insert(s)
      .values({ trackId, source: "manual", startedAt, endedAt, minutes })
      .returning({ id: s.id });
    return {
      id: row.id,
      source: "manual",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      minutes,
    };
  });
}

/** «Quitar»: an ended session of that track leaves the lists and the minutes. */
export async function removeSession(
  db: Database,
  { trackId, id }: SessionRefInput,
): Promise<SessionItem | SessionFailure> {
  return setDeleted(db, { trackId, id }, true);
}

/** «Deshacer» of «Quitar» (or of «Anotar tiempo»'s removal): the same session back. */
export async function restoreSession(
  db: Database,
  { trackId, id }: SessionRefInput,
): Promise<SessionItem | SessionFailure> {
  return setDeleted(db, { trackId, id }, false);
}

async function setDeleted(
  db: Database,
  { trackId, id }: SessionRefInput,
  deleted: boolean,
): Promise<SessionItem | SessionFailure> {
  return db.transaction(async (tx) => {
    await lockTimer(tx);
    const [row] = await tx
      .update(s)
      .set({ deletedAt: deleted ? sql`now()` : null })
      .where(
        and(
          eq(s.id, id),
          eq(s.trackId, trackId),
          isNotNull(s.endedAt),
          deleted ? liveSession : isNotNull(s.deletedAt),
        ),
      )
      .returning({
        id: s.id,
        source: s.source,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        minutes: s.minutes,
      });
    if (!row) return deleted ? "sessionNotFound" : "changed";
    return {
      id: row.id,
      source: row.source,
      startedAt: row.startedAt.toISOString(),
      endedAt: (row.endedAt as Date).toISOString(),
      minutes: row.minutes as number,
    };
  });
}
