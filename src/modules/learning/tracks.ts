// Tracks data access (server only, L1). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries with
// requireOwner()).
//
// Locks (CLAUDE.md "Advisory locks"; SPEC-learning "Modelo de datos"), in LEARNING_ADVISORY_SPACE
// (8000), two keys:
// - `(8000, hashtext('learning:active'))` (`lockStatuses`): EVERY write that changes a track's
//   status, its place in a status, or whether it is visible: create, put in progress, pause,
//   finish, reopen, the status' «Deshacer», delete and restore. The limit of 2 in progress is
//   counted after taking it, so two requests at once can never make a third.
// - `(8000, hashtext(<track id>))` (`lockTrack`, steps.ts): a track's syllabus; a settings edit
//   takes it too (a kind change to `practice` checks the track has no steps).
// - `(8000, hashtext('learning:timer'))` (`lockTimer`, sessions.ts, L2): every write of a session.
// Rule: advisory locks are always the first locks of the transaction, never taken after a row
// lock; no transaction takes two of them. Only then the rows (the project FOR SHARE).
//
// Deleting is a soft delete (`deleted_at`), like everywhere (CLAUDE.md): the track and its steps
// leave every view; «Deshacer» clears it. `pnpm db:export` keeps deleted rows.
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
// `learning` reads `projects` only through its contract (eslint.config.mjs).
import { selectProjectAvailability } from "@/modules/projects/contracts";
import { learningSteps, learningTracks } from "./db/schema";
import { MAX_ACTIVE_TRACKS, type TrackStatus } from "./learning-constants";
import {
  LEARNING_ACTIVE_KEY,
  LEARNING_ADVISORY_SPACE,
  LEARNING_TIMER_KEY,
  trackLockKey,
} from "./lock-keys";
import type {
  ChangeStatusInput,
  CreateResult,
  CreateTrackInput,
  DeletedTrack,
  RestoreResult,
  StatusChange,
  StatusResult,
  StepRef,
  TrackItem,
  TrackRef,
  UndoStatusInput,
  UpdateTrackInput,
} from "./tracks-input";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function advisoryLock(tx: Tx, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(LEARNING_ADVISORY_SPACE))}, hashtext(${key}))`,
  );
}

/** The status lock. Must be the first lock of the transaction (see the header). */
export function lockStatuses(tx: Tx) {
  return advisoryLock(tx, LEARNING_ACTIVE_KEY);
}

/** One track's syllabus lock. Must be the first lock of the transaction (see the header). */
export function lockTrack(tx: Tx, trackId: string) {
  return advisoryLock(tx, trackLockKey(trackId));
}

/** The timer lock (sessions.ts). Must be the first lock of the transaction (see the header). */
export function lockTimer(tx: Tx) {
  return advisoryLock(tx, LEARNING_TIMER_KEY);
}

/** Tracks that aren't deleted. EVERY read and write of tracks filters with it. */
export const liveTrack = isNull(learningTracks.deletedAt);

/** Why a write was refused. */
export type TrackFailure =
  | "notFound"
  /** A third track in progress (and no valid one to pause). */
  | "limitReached"
  /** The track to pause isn't in progress (or doesn't exist). */
  | "pauseUnavailable"
  /** The project doesn't exist or is deleted. */
  | "projectUnavailable"
  /** A kind change to `practice` on a track with steps. */
  | "practiceHasSteps";

// Raw subqueries name their tables by hand: Drizzle prints a single table's columns without it
// (CLAUDE.md "household"), so `${learningTracks.id}` inside would read the step's own `id`.
const stepCount = (doneOnly: boolean) =>
  sql<number>`(
    select count(*) from learning_steps step
    where step.track_id = "learning_tracks"."id" and step.deleted_at is null
    ${doneOnly ? sql`and step.done_at is not null` : sql``}
  )`.mapWith(Number);

const upcomingColumn = sql<StepRef[]>`(
  select coalesce(json_agg(json_build_object('id', next.id, 'title', next.title) order by next.position, next.id), '[]'::json)
  from (
    select step.id, step.title, step.position from learning_steps step
    where step.track_id = "learning_tracks"."id" and step.deleted_at is null and step.done_at is null
    order by step.position, step.id
    limit 2
  ) next
)`;

const TRACK = {
  id: learningTracks.id,
  title: learningTracks.title,
  kind: learningTracks.kind,
  status: learningTracks.status,
  projectId: learningTracks.projectId,
  url: learningTracks.url,
  weeklyTargetMinutes: learningTracks.weeklyTargetMinutes,
  targetDate: learningTracks.targetDate,
  position: learningTracks.position,
  finishedAt: learningTracks.finishedAt,
  done: stepCount(true),
  total: stepCount(false),
  upcoming: upcomingColumn,
};

function selectRows(db: Database | Tx, where?: SQL) {
  return db
    .select(TRACK)
    .from(learningTracks)
    .where(where ? and(liveTrack, where) : liveTrack)
    .orderBy(asc(learningTracks.position), asc(learningTracks.createdAt), asc(learningTracks.id));
}

type TrackRow = Awaited<ReturnType<typeof selectRows>>[number];

function asItem({ done, total, upcoming, finishedAt, ...rest }: TrackRow): TrackItem {
  return {
    ...rest,
    finishedAt: finishedAt ? finishedAt.toISOString() : null,
    steps: { done, total },
    upcoming: upcoming ?? [],
  };
}

/** Live tracks as `TrackItem`s, by position inside their status (callers may filter more). */
export async function selectTrackItems(db: Database | Tx, where?: SQL): Promise<TrackItem[]> {
  return (await selectRows(db, where)).map(asItem);
}

/** One live track, or null. */
export async function selectTrackItem(db: Database | Tx, id: string): Promise<TrackItem | null> {
  const [track] = await selectTrackItems(db, eq(learningTracks.id, id));
  return track ?? null;
}

/** The tracks in progress, by their order (the limit's offer names them). */
export async function selectActiveTrackRefs(db: Database | Tx): Promise<TrackRef[]> {
  return db
    .select({ id: learningTracks.id, title: learningTracks.title })
    .from(learningTracks)
    .where(and(liveTrack, eq(learningTracks.status, "active")))
    .orderBy(asc(learningTracks.position), asc(learningTracks.createdAt), asc(learningTracks.id));
}

/** A deleted track (the list's «Frente eliminado · Deshacer»), or null when it isn't deleted. */
export async function selectDeletedTrack(db: Database, id: string): Promise<DeletedTrack | null> {
  const [row] = await db
    .select({ id: learningTracks.id, title: learningTracks.title })
    .from(learningTracks)
    .where(and(eq(learningTracks.id, id), isNotNull(learningTracks.deletedAt)));
  return row ?? null;
}

/** The next free position at the end of `status` (under the status lock). */
async function endOf(tx: Tx, status: TrackStatus, exceptId?: string): Promise<number> {
  const [{ last }] = await tx
    .select({ last: sql<number | null>`max(${learningTracks.position})` })
    .from(learningTracks)
    .where(
      and(
        liveTrack,
        eq(learningTracks.status, status),
        exceptId ? ne(learningTracks.id, exceptId) : undefined,
      ),
    );
  return last === null ? 0 : Number(last) + 1;
}

async function activeIds(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: learningTracks.id })
    .from(learningTracks)
    .where(and(liveTrack, eq(learningTracks.status, "active")));
  return rows.map((row) => row.id);
}

/** A project a track may point at: exists and isn't deleted (any state). */
async function projectAvailable(tx: Tx, projectId: string | null): Promise<boolean> {
  if (projectId === null) return true;
  return (await selectProjectAvailability(tx, [projectId])).has(projectId);
}

/** The status columns of a track as a change's «from». */
type StatusRow = {
  id: string;
  title: string;
  status: TrackStatus;
  position: number;
  finishedAt: Date | null;
};

const STATUS_ROW = {
  id: learningTracks.id,
  title: learningTracks.title,
  status: learningTracks.status,
  position: learningTracks.position,
  finishedAt: learningTracks.finishedAt,
};

/**
 * Moves one track (already read, under the status lock) to the end of `to`. A done track gets its
 * finished time (to the millisecond: «Deshacer» sends it back and compares it), any other loses it.
 */
async function moveTo(tx: Tx, row: StatusRow, to: TrackStatus): Promise<StatusChange> {
  const position = await endOf(tx, to, row.id);
  await tx
    .update(learningTracks)
    .set({
      status: to,
      position,
      finishedAt: to === "done" ? sql`date_trunc('milliseconds', now())` : null,
    })
    .where(eq(learningTracks.id, row.id));
  return {
    id: row.id,
    title: row.title,
    from: {
      status: row.status,
      position: row.position,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    },
    to,
  };
}

/**
 * Makes room for one more track in progress: pauses `pauseId` when given (it must be in progress)
 * and refuses when 2 would still be. Under the status lock; `exceptId` is the track being put in
 * progress (it doesn't count against itself).
 */
async function makeRoom(
  tx: Tx,
  pauseId: string | null,
  exceptId?: string,
): Promise<StatusChange[] | "limitReached" | "pauseUnavailable"> {
  const active = (await activeIds(tx)).filter((id) => id !== exceptId);
  if (pauseId === null) return active.length >= MAX_ACTIVE_TRACKS ? "limitReached" : [];
  if (!active.includes(pauseId)) return "pauseUnavailable";
  const [row] = await tx
    .select(STATUS_ROW)
    .from(learningTracks)
    .where(eq(learningTracks.id, pauseId))
    .for("update");
  const change = await moveTo(tx, row, "waiting");
  if (active.length - 1 >= MAX_ACTIVE_TRACKS) return "limitReached";
  return [change];
}

/** Thrown inside a transaction to roll it back with a refusal (never leaves this file). */
class Refusal extends Error {
  constructor(readonly failure: TrackFailure) {
    super(failure);
  }
}

async function refusable<T>(run: () => Promise<T>): Promise<T | TrackFailure> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal) return error.failure;
    throw error;
  }
}

/**
 * Creates a track at the end of its status, with its pasted syllabus in order (none for a
 * practice: the schema refuses it). In progress only if fewer than 2 are, or after pausing
 * `pauseTrackId` in the same transaction (its change comes back for «Deshacer»).
 */
export async function insertTrack(
  db: Database,
  { syllabus, status, pauseTrackId, ...fields }: CreateTrackInput,
): Promise<CreateResult | TrackFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await lockStatuses(tx);
      let changes: StatusChange[] = [];
      if (status === "active") {
        const room = await makeRoom(tx, pauseTrackId);
        if (typeof room === "string") throw new Refusal(room);
        changes = room;
      }
      if (!(await projectAvailable(tx, fields.projectId))) {
        throw new Refusal("projectUnavailable");
      }
      const position = await endOf(tx, status);
      const [row] = await tx
        .insert(learningTracks)
        .values({ ...fields, status, position })
        .returning({ id: learningTracks.id });
      if (fields.kind !== "practice" && syllabus.length > 0) {
        await tx
          .insert(learningSteps)
          .values(syllabus.map((title, index) => ({ trackId: row.id, title, position: index })));
      }
      const track = await selectTrackItem(tx, row.id);
      return { track: track as TrackItem, changes };
    }),
  );
}

/**
 * «Ajustes»: title, kind, project, link, weekly target and target date, sent whole. Under the
 * track's lock: a kind change to `practice` is refused while the track has live steps.
 */
export async function updateTrackFields(
  db: Database,
  { id, ...fields }: UpdateTrackInput,
): Promise<TrackItem | TrackFailure> {
  return db.transaction(async (tx) => {
    await lockTrack(tx, id);
    const [row] = await tx
      .select({ id: learningTracks.id })
      .from(learningTracks)
      .where(and(eq(learningTracks.id, id), liveTrack))
      .for("update");
    if (!row) return "notFound";
    if (fields.kind === "practice") {
      const [{ steps }] = await tx
        .select({ steps: sql<number>`count(*)`.mapWith(Number) })
        .from(learningSteps)
        .where(and(eq(learningSteps.trackId, id), isNull(learningSteps.deletedAt)));
      if (steps > 0) return "practiceHasSteps";
    }
    if (!(await projectAvailable(tx, fields.projectId))) return "projectUnavailable";
    await tx.update(learningTracks).set(fields).where(eq(learningTracks.id, id));
    return (await selectTrackItem(tx, id)) as TrackItem;
  });
}

/**
 * Puts a track in a status (SPEC-learning "Estados"): the status wanted, so asking for the one it
 * has changes nothing (`changes` empty). Into progress only with room for it, or after pausing
 * `pauseTrackId` in the same transaction. Every change comes back with what it replaced: its
 * «Deshacer» (`undoStatusChanges`) puts exactly that back.
 */
export async function changeTrackStatus(
  db: Database,
  { id, to, pauseTrackId }: ChangeStatusInput,
): Promise<StatusResult | TrackFailure> {
  return refusable(() =>
    db.transaction(async (tx) => {
      await lockStatuses(tx);
      const [row] = await tx
        .select(STATUS_ROW)
        .from(learningTracks)
        .where(and(eq(learningTracks.id, id), liveTrack))
        .for("update");
      if (!row) throw new Refusal("notFound");
      if (row.status === to) {
        return { track: (await selectTrackItem(tx, id)) as TrackItem, changes: [] };
      }
      let changes: StatusChange[] = [];
      if (to === "active") {
        const room = await makeRoom(tx, pauseTrackId, id);
        if (typeof room === "string") throw new Refusal(room);
        changes = room;
      }
      changes = [...changes, await moveTo(tx, row, to)];
      return { track: (await selectTrackItem(tx, id)) as TrackItem, changes };
    }),
  );
}

/**
 * «Deshacer» of a status change (or a swap): puts each track back exactly as it was (status,
 * position, finished time), only while every one still has the status the change left and the
 * result keeps at most 2 in progress. Otherwise nothing is written (`restored: false`).
 */
export async function undoStatusChanges(
  db: Database,
  { changes }: UndoStatusInput,
): Promise<{ restored: boolean }> {
  return db.transaction(async (tx) => {
    await lockStatuses(tx);
    const ids = changes.map((change) => change.id);
    const rows = await tx
      .select({ id: learningTracks.id, status: learningTracks.status })
      .from(learningTracks)
      .where(and(inArray(learningTracks.id, ids), liveTrack))
      .for("update");
    const now = new Map(rows.map((row) => [row.id, row.status]));
    if (changes.some((change) => now.get(change.id) !== change.to)) return { restored: false };
    const active = (await activeIds(tx)).filter((id) => !ids.includes(id));
    const back = changes.filter((change) => change.from.status === "active").length;
    if (active.length + back > MAX_ACTIVE_TRACKS) return { restored: false };
    for (const change of changes) {
      await tx
        .update(learningTracks)
        .set({
          status: change.from.status,
          position: change.from.position,
          finishedAt: change.from.finishedAt ? new Date(change.from.finishedAt) : null,
        })
        .where(eq(learningTracks.id, change.id));
    }
    return { restored: true };
  });
}

/** Soft delete: out of every view with its steps, back with «Deshacer». A deleted one is null. */
export async function softDeleteTrack(db: Database, id: string): Promise<DeletedTrack | null> {
  return db.transaction(async (tx) => {
    await lockStatuses(tx);
    const [row] = await tx
      .update(learningTracks)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(learningTracks.id, id), liveTrack))
      .returning({ id: learningTracks.id, title: learningTracks.title });
    return row ?? null;
  });
}

/**
 * «Deshacer» of a delete: back with its steps, in its place. One that was in progress comes back
 * «En espera» when 2 already are (never a third). Restoring a live one changes nothing.
 */
export async function restoreTrackById(db: Database, id: string): Promise<RestoreResult | null> {
  return db.transaction(async (tx) => {
    await lockStatuses(tx);
    const [row] = await tx
      .select({ status: learningTracks.status, deletedAt: learningTracks.deletedAt })
      .from(learningTracks)
      .where(eq(learningTracks.id, id))
      .for("update");
    if (!row) return null;
    let movedToWaiting = false;
    if (row.deletedAt !== null) {
      if (row.status === "active" && (await activeIds(tx)).length >= MAX_ACTIVE_TRACKS) {
        movedToWaiting = true;
        await tx
          .update(learningTracks)
          .set({ deletedAt: null, status: "waiting", position: await endOf(tx, "waiting", id) })
          .where(eq(learningTracks.id, id));
      } else {
        await tx.update(learningTracks).set({ deletedAt: null }).where(eq(learningTracks.id, id));
      }
    }
    const track = await selectTrackItem(tx, id);
    return track ? { track, movedToWaiting } : null;
  });
}
