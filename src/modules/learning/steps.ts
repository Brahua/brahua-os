// Syllabus data access (server only, L1). These functions take the database and trust their
// input: callers check the owner and validate first (the actions through ownerAction(), the
// queries with requireOwner()).
//
// Every write runs in a transaction that takes the track's lock `(8000, hashtext(<track id>))`
// FIRST (tracks.ts documents the rule), then checks the track exists and isn't deleted, holding
// its row FOR SHARE; and every statement on a step filters by its track as well as its id: an id
// from another track is "not found" (no IDOR across tracks). `position` stays contiguous (0…n-1)
// among the track's live steps. A practice has no syllabus: adding to one is refused.
//
// Removing is a soft delete (`deleted_at`): the step leaves the syllabus, the counts and the
// order; «Deshacer» puts it back in its place.
//
// `done_at` is written to the millisecond (`date_trunc`): the client gets it as an ISO string and
// a «Deshacer» compares it with what is stored, which must round-trip exactly.
import "server-only";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { isSameIdSet } from "@/modules/core/life-area-order";
import { learningSteps, learningTracks } from "./db/schema";
import { MAX_STEPS_PER_TRACK } from "./learning-constants";
import type {
  AddStepInput,
  PasteStepsInput,
  RenameStepInput,
  RestoreStepInput,
  StepDoneInput,
  StepDoneResult,
  StepItem,
  StepRefInput,
  UndoPasteInput,
  UndoStepDoneInput,
} from "./steps-input";
import { lockTrack, type Tx } from "./tracks";

/** Why a step write did nothing. */
export type StepFailure =
  | "trackNotFound"
  | "stepNotFound"
  /** The track is a practice (no syllabus). */
  | "noSyllabus"
  | "tooMany"
  /** Only a tampered request (or a uuid collision) reuses an id. */
  | "idTaken"
  | "staleOrder";

const STEP = {
  id: learningSteps.id,
  title: learningSteps.title,
  position: learningSteps.position,
  doneAt: learningSteps.doneAt,
};

type StepRow = { id: string; title: string; position: number; doneAt: Date | null };

const asItem = ({ doneAt, ...row }: StepRow): StepItem => ({
  ...row,
  doneAt: doneAt ? doneAt.toISOString() : null,
});

const liveStep = isNull(learningSteps.deletedAt);

/** One live step of the track. */
const ofTrack = (trackId: string, id: string) =>
  and(eq(learningSteps.id, id), eq(learningSteps.trackId, trackId), liveStep);

/** «Now» to the millisecond (see the header). */
const nowMs = sql`date_trunc('milliseconds', now())`;

/**
 * Locks the track's syllabus (first), then checks the track exists and isn't deleted, holding its
 * row FOR SHARE until the end. Returns its kind, or null.
 */
async function openTrack(tx: Tx, trackId: string): Promise<{ kind: string } | null> {
  await lockTrack(tx, trackId);
  const [track] = await tx
    .select({ kind: learningTracks.kind })
    .from(learningTracks)
    .where(and(eq(learningTracks.id, trackId), isNull(learningTracks.deletedAt)))
    .for("share");
  return track ?? null;
}

/** Rewrites the live steps' `position` as 0…n-1 in their order (only rows that change). */
async function renumber(tx: Tx, trackId: string) {
  await tx.execute(sql`
    update learning_steps as s
    set position = ranked.position, updated_at = now()
    from (
      select id, (row_number() over (order by position, id) - 1)::integer as position
      from learning_steps
      where track_id = ${trackId} and deleted_at is null
    ) as ranked
    where s.id = ranked.id and s.position <> ranked.position
  `);
}

async function liveCount(tx: Tx, trackId: string): Promise<number> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(learningSteps)
    .where(and(eq(learningSteps.trackId, trackId), liveStep));
  return total;
}

/** The track's live steps in order. */
export async function selectSteps(db: Database | Tx, trackId: string): Promise<StepItem[]> {
  const rows = await db
    .select(STEP)
    .from(learningSteps)
    .where(and(eq(learningSteps.trackId, trackId), liveStep))
    .orderBy(asc(learningSteps.position), asc(learningSteps.id));
  return rows.map(asItem);
}

/** Adds one step at the end. */
export async function insertStep(
  db: Database,
  { trackId, id, title }: AddStepInput,
): Promise<StepItem | StepFailure> {
  return db.transaction(async (tx) => {
    const track = await openTrack(tx, trackId);
    if (!track) return "trackNotFound";
    if (track.kind === "practice") return "noSyllabus";
    const total = await liveCount(tx, trackId);
    if (total >= MAX_STEPS_PER_TRACK) return "tooMany";
    const [step] = await tx
      .insert(learningSteps)
      .values({ id, trackId, title, position: total })
      .onConflictDoNothing({ target: learningSteps.id })
      .returning(STEP);
    return step ? asItem(step) : "idTaken";
  });
}

/** «Pegar temario»: one step per line, at the end, in order. Returns the steps added. */
export async function appendSteps(
  db: Database,
  { trackId, syllabus }: PasteStepsInput,
): Promise<StepItem[] | StepFailure> {
  return db.transaction(async (tx) => {
    const track = await openTrack(tx, trackId);
    if (!track) return "trackNotFound";
    if (track.kind === "practice") return "noSyllabus";
    const total = await liveCount(tx, trackId);
    if (total + syllabus.length > MAX_STEPS_PER_TRACK) return "tooMany";
    const rows = await tx
      .insert(learningSteps)
      .values(syllabus.map((title, index) => ({ trackId, title, position: total + index })))
      .returning(STEP);
    return rows.map(asItem).sort((a, b) => a.position - b.position);
  });
}

/**
 * «Deshacer» of a paste: removes those steps while they are still there (one already removed is
 * left as it is). Returns how many it removed.
 */
export async function removePastedSteps(
  db: Database,
  { trackId, ids }: UndoPasteInput,
): Promise<number | StepFailure> {
  return db.transaction(async (tx) => {
    if (!(await openTrack(tx, trackId))) return "trackNotFound";
    const removed = await tx
      .update(learningSteps)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(learningSteps.trackId, trackId), inArray(learningSteps.id, ids), liveStep))
      .returning({ id: learningSteps.id });
    await renumber(tx, trackId);
    return removed.length;
  });
}

/** Renames one of the track's live steps. */
export async function renameStepById(
  db: Database,
  { trackId, id, title }: RenameStepInput,
): Promise<StepItem | StepFailure> {
  return db.transaction(async (tx) => {
    if (!(await openTrack(tx, trackId))) return "trackNotFound";
    const [step] = await tx
      .update(learningSteps)
      .set({ title })
      .where(ofTrack(trackId, id))
      .returning(STEP);
    return step ? asItem(step) : "stepNotFound";
  });
}

/**
 * «Hecho» (or unchecking): the state wanted. Checking one already done keeps its first time;
 * unchecking one that isn't done changes nothing. Returns the step and what it held before
 * (`previous`), which its «Deshacer» puts back.
 */
export async function setStepDone(
  db: Database,
  { trackId, id, done }: StepDoneInput,
): Promise<StepDoneResult | StepFailure> {
  return db.transaction(async (tx) => {
    if (!(await openTrack(tx, trackId))) return "trackNotFound";
    const [current] = await tx
      .select({ doneAt: learningSteps.doneAt })
      .from(learningSteps)
      .where(ofTrack(trackId, id))
      .for("update");
    if (!current) return "stepNotFound";
    const previous = current.doneAt ? current.doneAt.toISOString() : null;
    if ((current.doneAt !== null) === done) {
      const [step] = await tx.select(STEP).from(learningSteps).where(ofTrack(trackId, id));
      return { step: asItem(step), previous };
    }
    const [step] = await tx
      .update(learningSteps)
      .set({ doneAt: done ? nowMs : null })
      .where(ofTrack(trackId, id))
      .returning(STEP);
    return { step: asItem(step), previous };
  });
}

/**
 * «Deshacer» of a check: writes `restore` only while the step still holds `expected` (what that
 * check left). After another change it writes nothing (`restored: false`) and returns the step as
 * it is.
 */
export async function undoStepDone(
  db: Database,
  { trackId, id, expected, restore }: UndoStepDoneInput,
): Promise<{ step: StepItem; restored: boolean } | StepFailure> {
  return db.transaction(async (tx) => {
    if (!(await openTrack(tx, trackId))) return "trackNotFound";
    const [updated] = await tx
      .update(learningSteps)
      .set({ doneAt: restore ? new Date(restore) : null })
      .where(
        and(
          ofTrack(trackId, id),
          expected ? eq(learningSteps.doneAt, new Date(expected)) : isNull(learningSteps.doneAt),
        ),
      )
      .returning(STEP);
    if (updated) return { step: asItem(updated), restored: true };
    const [step] = await tx.select(STEP).from(learningSteps).where(ofTrack(trackId, id));
    return step ? { step: asItem(step), restored: false } : "stepNotFound";
  });
}

/**
 * Removes a step (soft delete) and closes the gap. Returns the row as it was and its position
 * (what «Deshacer» sends back). A removed one is "not found".
 */
export async function removeStep(
  db: Database,
  { trackId, id }: StepRefInput,
): Promise<{ step: StepItem; position: number } | StepFailure> {
  return db.transaction(async (tx) => {
    if (!(await openTrack(tx, trackId))) return "trackNotFound";
    const [step] = await tx
      .update(learningSteps)
      .set({ deletedAt: sql`now()` })
      .where(ofTrack(trackId, id))
      .returning(STEP);
    if (!step) return "stepNotFound";
    await renumber(tx, trackId);
    return { step: asItem(step), position: step.position };
  });
}

/**
 * «Deshacer» of a remove: clears `deleted_at` and puts the step back right after `afterId` (the
 * neighbour it had above it) while that one is still there, else at `position` clamped to the
 * list. Restoring a live one changes nothing (a second «Deshacer» is not an error).
 */
export async function restoreStep(
  db: Database,
  { trackId, id, position, afterId }: RestoreStepInput,
): Promise<StepItem[] | StepFailure> {
  return db.transaction(async (tx) => {
    if (!(await openTrack(tx, trackId))) return "trackNotFound";
    const [row] = await tx
      .select({ deletedAt: learningSteps.deletedAt })
      .from(learningSteps)
      .where(and(eq(learningSteps.id, id), eq(learningSteps.trackId, trackId)));
    if (!row) return "stepNotFound";
    if (row.deletedAt === null) return selectSteps(tx, trackId);
    const current = await selectSteps(tx, trackId);
    if (current.length >= MAX_STEPS_PER_TRACK) return "tooMany";
    const anchor = afterId ? current.findIndex((item) => item.id === afterId) : -1;
    const at = anchor !== -1 ? anchor + 1 : Math.min(position, current.length);
    await tx
      .update(learningSteps)
      .set({ position: sql`${learningSteps.position} + 1` })
      .where(and(eq(learningSteps.trackId, trackId), liveStep, gte(learningSteps.position, at)));
    await tx
      .update(learningSteps)
      .set({ deletedAt: null, position: at })
      .where(
        and(
          eq(learningSteps.id, id),
          eq(learningSteps.trackId, trackId),
          isNotNull(learningSteps.deletedAt),
        ),
      );
    await renumber(tx, trackId);
    return selectSteps(tx, trackId);
  });
}

/**
 * Writes the new order of a track's live steps. `"staleOrder"` (writing nothing) when `ids` is not
 * exactly that set: one was added or removed elsewhere, or the request was tampered with.
 */
export async function reorderStepsByIds(
  db: Database,
  trackId: string,
  ids: readonly string[],
): Promise<StepItem[] | StepFailure> {
  return db.transaction(async (tx) => {
    if (!(await openTrack(tx, trackId))) return "trackNotFound";
    const current = await selectSteps(tx, trackId);
    if (
      !isSameIdSet(
        current.map((step) => step.id),
        ids,
      )
    ) {
      return "staleOrder";
    }
    const position = new Map(current.map((step) => [step.id, step.position]));
    const changed = ids
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => position.get(id) !== index);
    if (changed.length > 0) {
      const cases = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(learningSteps)
        .set({ position: sql`case ${learningSteps.id} ${cases} end` })
        .where(
          and(
            eq(learningSteps.trackId, trackId),
            liveStep,
            inArray(
              learningSteps.id,
              changed.map(({ id }) => id),
            ),
          ),
        );
    }
    return selectSteps(tx, trackId);
  });
}
