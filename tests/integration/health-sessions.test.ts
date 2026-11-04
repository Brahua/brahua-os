// E2 of `health` against the throwaway database: the CHECKs, the open-session index and the
// foreign keys of the three new tables with raw inserts; two «Empezar» at once (one session opens;
// positive control: after finishing, another one starts); starting from a routine (its exercises,
// rest and planned sets with the prefill by position, warmups left out); the sets (values by kind,
// marking needs them, no ids from another session); «Terminar» (planned sets go, the 4 h end) and
// its exact «Deshacer» (refused once touched or with another session open); discard and delete
// with their «Deshacer»; the rotation; authorization of every action; and the export.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { healthSessionExercises, healthSessions, healthSets } from "@/modules/health/db/schema";
import { createExercise } from "@/modules/health/exercises-actions";
import {
  getDeletedSession,
  getNextRoutine,
  getOpenSession,
  getSession,
  listSessions,
} from "@/modules/health/queries";
import { addRoutineItem, createRoutine, renameRoutine } from "@/modules/health/routines-actions";
import {
  addHealthSet,
  addSessionExercise,
  deleteHealthSession,
  finishHealthSession,
  removeHealthSet,
  removeSessionExercise,
  reorderSessionExercises,
  restoreHealthSession,
  restoreHealthSet,
  restoreSessionExercise,
  startHealthSession,
  undoFinishHealthSession,
  updateHealthSet,
  updateSessionNote,
  updateSessionTimes,
} from "@/modules/health/sessions-actions";
import { SESSION_ERRORS } from "@/modules/health/sessions-copy";
import type { SessionDetail, SessionSet } from "@/modules/health/sessions-input";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

const MISSING = "00000000-0000-4000-8000-0000000000ff";

function data<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`action failed: ${JSON.stringify(result)}`);
  return result.data;
}

const exercise = async (name: string, kind = "weight_reps", restSeconds = 90) =>
  data(
    await createExercise({
      name,
      kind,
      muscleGroup: kind === "time" ? "abs" : "quads",
      equipment: kind === "time" ? "bodyweight" : "barbell",
      perDumbbell: false,
      restSeconds,
    }),
  );

const REPS = { targetSets: 4, repsMin: 6, repsMax: 8, targetSeconds: null, restSeconds: 120 };
const TIME = { targetSets: 3, repsMin: null, repsMax: null, targetSeconds: 45, restSeconds: null };

async function routineWith(...items: [string, object][]) {
  const routine = data(await createRoutine({}));
  for (const [exerciseId, targets] of items) {
    data(
      await addRoutineItem({
        routineId: routine.id,
        id: crypto.randomUUID(),
        exerciseId,
        ...targets,
      }),
    );
  }
  return routine;
}

async function start(routineId: string | null = null): Promise<string> {
  const result = data(await startHealthSession({ routineId }));
  if (!result.started) throw new Error("a session was already open");
  return result.id;
}

const detail = async (id: string) => (await getSession(id)) as SessionDetail;

/** Writes a set whole (marking it or not). */
const writeSet = (sessionId: string, set: SessionSet, values: Partial<SessionSet>, done = true) =>
  updateHealthSet({
    sessionId,
    id: set.id,
    weightGrams: set.weightGrams,
    reps: set.reps,
    seconds: set.seconds,
    distanceMeters: set.distanceMeters,
    warmup: set.warmup,
    ...values,
    done,
  });

/** A free session with one exercise whose first set is done (it can be finished). */
async function sessionWithDoneSet(exerciseId: string) {
  const id = await start();
  const block = data(
    await addSessionExercise({ sessionId: id, id: crypto.randomUUID(), exerciseId }),
  );
  data(await writeSet(id, block.sets[0], { weightGrams: 60_000, reps: 10 }));
  return { id, block };
}

/** The constraint a raw statement breaks (Postgres error code and constraint name), or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

describe("CHECKs, the open-session index and foreign keys (raw inserts)", () => {
  test("sessions: note, end after start, one open at a time", async () => {
    const started = new Date("2026-11-04T18:00:00Z");
    const raw = (values: Partial<typeof healthSessions.$inferInsert>) => () =>
      testDb.insert(healthSessions).values({ startedAt: started, endedAt: started, ...values });
    expect(await violation(raw({ note: "x".repeat(500) }))).toBeNull();
    expect(await violation(raw({ note: "x".repeat(501) }))).toEqual({
      code: "23514",
      constraint: "health_sessions_note_check",
    });
    expect(await violation(raw({ endedAt: new Date("2026-11-04T17:59:59Z") }))).toEqual({
      code: "23514",
      constraint: "health_sessions_ended_check",
    });
    // One open session; a deleted open one doesn't count.
    expect(await violation(raw({ endedAt: null }))).toBeNull();
    expect(await violation(raw({ endedAt: null }))).toEqual({
      code: "23505",
      constraint: "health_sessions_open_unique",
    });
    expect(await violation(raw({ endedAt: null, deletedAt: started }))).toBeNull();
  });

  test("sets: weight in steps of 250 g, reps, seconds and distance in range", async () => {
    const squat = await exercise("Sentadilla con barra");
    const [session] = await testDb
      .insert(healthSessions)
      .values({ startedAt: new Date() })
      .returning();
    const [row] = await testDb
      .insert(healthSessionExercises)
      .values({ sessionId: session.id, exerciseId: squat.id, position: 0 })
      .returning();
    const raw = (values: Partial<typeof healthSets.$inferInsert>) => () =>
      testDb.insert(healthSets).values({ sessionExerciseId: row.id, position: 0, ...values });
    const check = (constraint: string) => ({ code: "23514", constraint });
    expect(await violation(raw({ weightGrams: 82_500, reps: 8 }))).toBeNull();
    expect(await violation(raw({ weightGrams: 0, reps: 999, seconds: 36_000 }))).toBeNull();
    expect(await violation(raw({ weightGrams: 1_000_000, distanceMeters: 1_000_000 }))).toBeNull();
    expect(await violation(raw({ weightGrams: 82_300 }))).toEqual(
      check("health_sets_weight_check"),
    );
    expect(await violation(raw({ weightGrams: 1_000_250 }))).toEqual(
      check("health_sets_weight_check"),
    );
    expect(await violation(raw({ weightGrams: -250 }))).toEqual(check("health_sets_weight_check"));
    expect(await violation(raw({ reps: 0 }))).toEqual(check("health_sets_reps_check"));
    expect(await violation(raw({ reps: 1_000 }))).toEqual(check("health_sets_reps_check"));
    expect(await violation(raw({ seconds: 0 }))).toEqual(check("health_sets_seconds_check"));
    expect(await violation(raw({ seconds: 36_001 }))).toEqual(check("health_sets_seconds_check"));
    expect(await violation(raw({ distanceMeters: 1_000_001 }))).toEqual(
      check("health_sets_distance_check"),
    );
    expect(await violation(raw({ position: -1 }))).toEqual(check("health_sets_position_check"));
    await expect(
      testDb
        .insert(healthSessionExercises)
        .values({ sessionId: session.id, exerciseId: squat.id, position: 1, restSeconds: 20 }),
    ).rejects.toMatchObject({ cause: { constraint: "health_session_exercises_rest_check" } });
    // ON DELETE RESTRICT is 23001 (CLAUDE.md "goals"); a missing parent is 23503.
    expect(
      await violation(() => testDb.delete(healthSessions).where(eq(healthSessions.id, session.id))),
    ).toEqual({
      code: "23001",
      constraint: "health_session_exercises_session_id_health_sessions_id_fk",
    });
    expect(
      await violation(() =>
        testDb.insert(healthSets).values({ sessionExerciseId: MISSING, position: 0 }),
      ),
    ).toEqual({
      code: "23503",
      constraint: "health_sets_session_exercise_id_health_session_exercises_id_fk",
    });
  });
});

describe("start", () => {
  test("two «Empezar» at once open one session; after finishing, another one starts", async () => {
    const both = await Promise.all([
      startHealthSession({ routineId: null }),
      startHealthSession({ routineId: null }),
    ]);
    const results = both.map(data);
    const started = results.filter((result) => result.started);
    expect(started).toHaveLength(1);
    const openId = (started[0] as { id: string }).id;
    expect(results.find((result) => !result.started)).toEqual({ started: false, openId });
    const [{ open }] = (
      await testDb.execute<{ open: number }>(
        sql`select count(*)::int as open from health_sessions where ended_at is null and deleted_at is null`,
      )
    ).rows;
    expect(open).toBe(1);
    expect(await getOpenSession()).toMatchObject({ id: openId, routineName: null });

    // Positive control: finished, the next «Empezar» opens a new one.
    const squat = await exercise("Sentadilla con barra");
    const block = data(
      await addSessionExercise({
        sessionId: openId,
        id: crypto.randomUUID(),
        exerciseId: squat.id,
      }),
    );
    data(await writeSet(openId, block.sets[0], { weightGrams: 60_000, reps: 10 }));
    data(await finishHealthSession({ sessionId: openId, endedAt: null, note: "" }));
    expect(await getOpenSession()).toBeNull();
    const next = data(await startHealthSession({ routineId: null }));
    expect(next).toMatchObject({ started: true });
    expect((next as { id: string }).id).not.toBe(openId);
  });

  test("from a routine: its exercises with their rest and planned sets prefilled by position", async () => {
    const squat = await exercise("Sentadilla con barra");
    const plank = await exercise("Plancha", "time", 60);
    const routine = await routineWith([squat.id, REPS], [plank.id, TIME]);

    // The first time: nothing to prefill.
    const first = await start(routine.id);
    const firstDetail = await detail(first);
    expect(firstDetail.routineName).toBe(routine.name);
    expect(
      firstDetail.exercises.map((row) => [row.name, row.restSeconds, row.sets.length]),
    ).toEqual([
      ["Sentadilla con barra", 120, 4],
      ["Plancha", null, 3],
    ]);
    expect(firstDetail.exercises[0].sets[0]).toMatchObject({
      weightGrams: null,
      reps: null,
      doneAt: null,
      warmup: false,
    });
    expect(firstDetail.exercises[0].previous).toEqual([]);

    // A warmup, then three work sets (the fourth stays planned and goes at «Terminar»).
    const [a, b, c, d] = firstDetail.exercises[0].sets;
    data(await writeSet(first, a, { weightGrams: 40_000, reps: 10, warmup: true }));
    data(await writeSet(first, b, { weightGrams: 80_000, reps: 8 }));
    data(await writeSet(first, c, { weightGrams: 80_000, reps: 8 }));
    data(await writeSet(first, d, { weightGrams: 82_500, reps: 7 }));
    data(await finishHealthSession({ sessionId: first, endedAt: null, note: "" }));

    const second = await detail(await start(routine.id));
    const values = (set: SessionSet) => [set.weightGrams, set.reps];
    expect(second.exercises[0].previous).toEqual([
      { weightGrams: 80_000, reps: 8, seconds: null, distanceMeters: null },
      { weightGrams: 80_000, reps: 8, seconds: null, distanceMeters: null },
      { weightGrams: 82_500, reps: 7, seconds: null, distanceMeters: null },
    ]);
    // Same position; past the end, the last done set.
    expect(second.exercises[0].sets.map(values)).toEqual([
      [80_000, 8],
      [80_000, 8],
      [82_500, 7],
      [82_500, 7],
    ]);
    expect(second.exercises[0].sets.every((set) => set.doneAt === null && !set.warmup)).toBe(true);
    // The plank was never done: empty.
    expect(second.exercises[1].sets.map((set) => set.seconds)).toEqual([null, null, null]);
  });

  test("a deleted routine can't start; an id that isn't one is refused", async () => {
    expect(await startHealthSession({ routineId: MISSING })).toEqual({
      ok: false,
      error: SESSION_ERRORS.routineNotFound,
    });
    expect(await startHealthSession({ routineId: "nope" })).toMatchObject({ ok: false });
    expect(await getOpenSession()).toBeNull();
  });
});

describe("exercises and sets of a session", () => {
  test("sets: values by kind, marking needs them, the first done_at stays", async () => {
    const plank = await exercise("Plancha", "time", 60);
    const id = await start();
    const block = data(
      await addSessionExercise({ sessionId: id, id: crypto.randomUUID(), exerciseId: plank.id }),
    );
    expect(block.sets).toHaveLength(1);
    const set = block.sets[0];

    // Marking without its time is refused on the field.
    expect(await writeSet(id, set, {})).toEqual({
      ok: false,
      error: "Revisa los campos marcados.",
      fieldErrors: { seconds: [SESSION_ERRORS.missing.seconds] },
    });
    // A value the kind doesn't show is dropped.
    const marked = data(await writeSet(id, set, { seconds: 45, weightGrams: 10_000, reps: 3 }));
    expect(marked).toMatchObject({ seconds: 45, weightGrams: null, reps: null });
    expect(marked.doneAt).not.toBeNull();
    const again = data(await writeSet(id, marked, { seconds: 50 }));
    expect(again).toMatchObject({ seconds: 50, doneAt: marked.doneAt });
    // Unmarked: planned again.
    expect(data(await writeSet(id, again, {}, false)).doneAt).toBeNull();
    // A weight off the 0.25 kg steps never reaches the database.
    expect(await writeSet(id, again, { weightGrams: 82_300 }, false)).toMatchObject({ ok: false });
  });

  test("adding a set or an exercise again with the same id (a lost answer) returns the same row", async () => {
    const squat = await exercise("Sentadilla con barra");
    const id = await start();
    const blockId = crypto.randomUUID();
    const first = data(
      await addSessionExercise({ sessionId: id, id: blockId, exerciseId: squat.id }),
    );
    const again = data(
      await addSessionExercise({ sessionId: id, id: blockId, exerciseId: squat.id }),
    );
    expect(again).toEqual(first);
    const setInput = {
      sessionId: id,
      sessionExerciseId: blockId,
      id: crypto.randomUUID(),
      weightGrams: 60_000,
      reps: 10,
      seconds: null,
      distanceMeters: null,
      warmup: false,
    };
    const added = data(await addHealthSet(setInput));
    expect(data(await addHealthSet(setInput))).toEqual(added);
    expect((await detail(id)).exercises.map((row) => row.sets.length)).toEqual([2]);
    // The same id under another exercise is someone else's: refused.
    const other = data(
      await addSessionExercise({ sessionId: id, id: crypto.randomUUID(), exerciseId: squat.id }),
    );
    expect(await addHealthSet({ ...setInput, sessionExerciseId: other.id })).toEqual({
      ok: false,
      error: SESSION_ERRORS.idTaken,
    });
  });

  test("a repeated exercise is prefilled block by block", async () => {
    const squat = await exercise("Sentadilla con barra");
    const routine = await routineWith(
      [squat.id, { ...REPS, targetSets: 1 }],
      [squat.id, { ...REPS, targetSets: 1 }],
    );
    const first = await start(routine.id);
    const [heavy, light] = (await detail(first)).exercises;
    data(await writeSet(first, heavy.sets[0], { weightGrams: 100_000, reps: 5 }));
    data(await writeSet(first, light.sets[0], { weightGrams: 60_000, reps: 12 }));
    data(await finishHealthSession({ sessionId: first, endedAt: null, note: "" }));
    const second = await detail(await start(routine.id));
    expect(second.exercises.map((row) => [row.sets[0].weightGrams, row.sets[0].reps])).toEqual([
      [100_000, 5],
      [60_000, 12],
    ]);
  });

  test("add, remove and restore sets and exercises in place; reorder; no ids from another session", async () => {
    const squat = await exercise("Sentadilla con barra");
    const press = await exercise("Press de banca con barra");
    const id = await start();
    const first = data(
      await addSessionExercise({ sessionId: id, id: crypto.randomUUID(), exerciseId: squat.id }),
    );
    const second = data(
      await addSessionExercise({ sessionId: id, id: crypto.randomUUID(), exerciseId: press.id }),
    );
    const added = data(
      await addHealthSet({
        sessionId: id,
        sessionExerciseId: first.id,
        id: crypto.randomUUID(),
        weightGrams: 60_000,
        reps: 10,
        seconds: 30,
        distanceMeters: null,
        warmup: false,
      }),
    );
    expect(added).toMatchObject({ position: 1, weightGrams: 60_000, reps: 10, seconds: null });

    data(await removeHealthSet({ sessionId: id, id: first.sets[0].id }));
    expect((await detail(id)).exercises[0].sets.map((set) => [set.id, set.position])).toEqual([
      [added.id, 0],
    ]);
    const restored = data(
      await restoreHealthSet({ sessionId: id, id: first.sets[0].id, afterId: null, position: 0 }),
    );
    expect(restored.map((set) => set.id)).toEqual([first.sets[0].id, added.id]);

    data(await removeSessionExercise({ sessionId: id, id: first.id }));
    expect((await detail(id)).exercises.map((row) => row.id)).toEqual([second.id]);
    const back = data(
      await restoreSessionExercise({ sessionId: id, id: first.id, afterId: null, position: 0 }),
    );
    expect(back.map((row) => [row.id, row.sets.length])).toEqual([
      [first.id, 2],
      [second.id, 1],
    ]);

    data(await reorderSessionExercises({ sessionId: id, ids: [second.id, first.id] }));
    expect((await detail(id)).exercises.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(await reorderSessionExercises({ sessionId: id, ids: [second.id] })).toEqual({
      ok: false,
      error: SESSION_ERRORS.staleOrder,
    });

    // Another session's set or exercise is "not found" here (no IDOR).
    const other = await testDb
      .insert(healthSessions)
      .values({ startedAt: new Date(), endedAt: new Date() })
      .returning();
    expect(await writeSet(other[0].id, first.sets[0], { weightGrams: 1_000, reps: 1 })).toEqual({
      ok: false,
      error: SESSION_ERRORS.setNotFound,
    });
    expect(await removeSessionExercise({ sessionId: other[0].id, id: first.id })).toEqual({
      ok: false,
      error: SESSION_ERRORS.exerciseNotFound,
    });
    expect(await updateSessionNote({ sessionId: MISSING, note: "x" })).toEqual({
      ok: false,
      error: SESSION_ERRORS.notFound,
    });
  });
});

describe("finish and its «Deshacer»", () => {
  test("the planned sets go; «Deshacer» reopens with exactly those (not one removed before)", async () => {
    const squat = await exercise("Sentadilla con barra");
    const routine = await routineWith([squat.id, REPS]);
    const id = await start(routine.id);
    const [a, b, c, d] = (await detail(id)).exercises[0].sets;
    data(await writeSet(id, a, { weightGrams: 80_000, reps: 8 }));
    data(await writeSet(id, b, { weightGrams: 80_000, reps: 8 }));
    data(await removeHealthSet({ sessionId: id, id: d.id }));

    const finished = data(
      await finishHealthSession({ sessionId: id, endedAt: null, note: " Buen día " }),
    );
    expect(finished.removedSetIds).toEqual([c.id]);
    const after = await detail(id);
    expect(after.endedAt).toBe(finished.endedAt);
    expect(after.note).toBe("Buen día");
    expect(after.updatedAt).toBe(finished.updatedAt);
    expect(after.exercises[0].sets.map((set) => set.id)).toEqual([a.id, b.id]);
    expect(await getOpenSession()).toBeNull();
    // Finishing twice is refused.
    expect(await finishHealthSession({ sessionId: id, endedAt: null, note: "" })).toEqual({
      ok: false,
      error: SESSION_ERRORS.notOpen,
    });

    const reopened = data(await undoFinishHealthSession({ sessionId: id, ...finished }));
    expect(reopened.endedAt).toBeNull();
    expect(reopened.exercises[0].sets.map((set) => [set.id, set.position])).toEqual([
      [a.id, 0],
      [b.id, 1],
      [c.id, 2],
    ]);
    // A second «Deshacer» changes nothing.
    expect(data(await undoFinishHealthSession({ sessionId: id, ...finished })).endedAt).toBeNull();
  });

  test("«Deshacer» rebuilds the order: planned sets in the middle go back to their places", async () => {
    const squat = await exercise("Sentadilla con barra");
    const routine = await routineWith([squat.id, { ...REPS, targetSets: 6 }]);
    const id = await start(routine.id);
    const sets = (await detail(id)).exercises[0].sets;
    // Done, planned, planned, done, planned, done.
    for (const index of [0, 3, 5]) {
      data(await writeSet(id, sets[index], { weightGrams: 80_000, reps: 8 }));
    }
    const finished = data(await finishHealthSession({ sessionId: id, endedAt: null, note: "" }));
    expect(finished.removedSetIds.toSorted()).toEqual(
      [sets[1].id, sets[2].id, sets[4].id].toSorted(),
    );
    expect((await detail(id)).exercises[0].sets.map((set) => [set.id, set.position])).toEqual([
      [sets[0].id, 0],
      [sets[3].id, 1],
      [sets[5].id, 2],
    ]);
    const reopened = data(await undoFinishHealthSession({ sessionId: id, ...finished }));
    expect(reopened.exercises[0].sets.map((set) => [set.id, set.position])).toEqual(
      sets.map((set, index) => [set.id, index]),
    );
  });

  test("«Deshacer» restores only what «Terminar» removed, whatever the client sends", async () => {
    const squat = await exercise("Sentadilla con barra");
    const routine = await routineWith([squat.id, REPS]);
    const id = await start(routine.id);
    const [a, b, c] = (await detail(id)).exercises[0].sets;
    data(await writeSet(id, a, { weightGrams: 80_000, reps: 8 }));
    data(await removeHealthSet({ sessionId: id, id: b.id }));
    const finished = data(await finishHealthSession({ sessionId: id, endedAt: null, note: "" }));
    expect(finished.removedSetIds).not.toContain(b.id);
    // A tampered list naming the set removed by hand: it stays removed.
    const reopened = data(
      await undoFinishHealthSession({
        sessionId: id,
        updatedAt: finished.updatedAt,
        removedSetIds: [b.id, ...finished.removedSetIds],
      }),
    );
    const ids = reopened.exercises[0].sets.map((set) => set.id);
    expect(ids).toContain(c.id);
    expect(ids).not.toContain(b.id);
  });

  test("«Deshacer» is refused once the session was touched, or with another one open", async () => {
    const squat = await exercise("Sentadilla con barra");
    const touched = await sessionWithDoneSet(squat.id);
    const finished = data(
      await finishHealthSession({ sessionId: touched.id, endedAt: null, note: "" }),
    );
    data(await updateSessionNote({ sessionId: touched.id, note: "Después" }));
    expect(await undoFinishHealthSession({ sessionId: touched.id, ...finished })).toEqual({
      ok: false,
      error: SESSION_ERRORS.changed,
    });

    const other = await sessionWithDoneSet(squat.id);
    const done = data(await finishHealthSession({ sessionId: other.id, endedAt: null, note: "" }));
    const third = await start();
    expect(await undoFinishHealthSession({ sessionId: other.id, ...done })).toEqual({
      ok: false,
      error: SESSION_ERRORS.otherOpen,
    });
    // Positive control: with the third one gone, it reopens.
    data(await deleteHealthSession({ sessionId: third }));
    expect(
      data(await undoFinishHealthSession({ sessionId: other.id, ...done })).endedAt,
    ).toBeNull();
  });

  test("after 4 h the end is the one sent (from the start to now); without a done set, no finish", async () => {
    const squat = await exercise("Sentadilla con barra");
    const { id } = await sessionWithDoneSet(squat.id);
    const startedAt = new Date(Date.now() - 6 * 3_600_000);
    await testDb.update(healthSessions).set({ startedAt }).where(eq(healthSessions.id, id));
    expect(
      await finishHealthSession({
        sessionId: id,
        endedAt: new Date(startedAt.getTime() - 60_000).toISOString(),
        note: "",
      }),
    ).toEqual({ ok: false, error: SESSION_ERRORS.endOutOfRange });
    expect(
      await finishHealthSession({
        sessionId: id,
        endedAt: new Date(Date.now() + 3_600_000).toISOString(),
        note: "",
      }),
    ).toEqual({ ok: false, error: SESSION_ERRORS.endOutOfRange });
    const end = new Date(startedAt.getTime() + 65 * 60_000).toISOString();
    expect(data(await finishHealthSession({ sessionId: id, endedAt: end, note: "" })).endedAt).toBe(
      end,
    );

    const empty = await start();
    expect(await finishHealthSession({ sessionId: empty, endedAt: null, note: "" })).toEqual({
      ok: false,
      error: SESSION_ERRORS.noDoneSets,
    });
  });

  test("the times of a finished session can be corrected; an open one's can't", async () => {
    const squat = await exercise("Sentadilla con barra");
    const { id } = await sessionWithDoneSet(squat.id);
    // Relative to now: corrected starts must be within the last year.
    const base = Math.floor((Date.now() - 3 * 86_400_000) / 1000) * 1000;
    const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
    expect(await updateSessionTimes({ sessionId: id, startedAt: at(0), endedAt: at(60) })).toEqual({
      ok: false,
      error: SESSION_ERRORS.notFinished,
    });
    data(await finishHealthSession({ sessionId: id, endedAt: null, note: "" }));
    expect(
      data(await updateSessionTimes({ sessionId: id, startedAt: at(0), endedAt: at(60) })),
    ).toMatchObject({ startedAt: at(0), endedAt: at(60) });
    expect(
      await updateSessionTimes({ sessionId: id, startedAt: at(0), endedAt: at(-60) }),
    ).toMatchObject({ ok: false, fieldErrors: { endedAt: [SESSION_ERRORS.endBeforeStart] } });
    // Longer than 24 h, or a start years back: refused on the field, never a 500.
    expect(
      await updateSessionTimes({ sessionId: id, startedAt: at(0), endedAt: at(25 * 60) }),
    ).toMatchObject({ ok: false, fieldErrors: { endedAt: [SESSION_ERRORS.tooLong] } });
    expect(
      await updateSessionTimes({
        sessionId: id,
        startedAt: "1970-01-01T00:00:00.000Z",
        endedAt: "1970-01-01T01:00:00.000Z",
      }),
    ).toMatchObject({ ok: false, fieldErrors: { startedAt: [SESSION_ERRORS.startTooOld] } });
  });
});

describe("discard, delete and their «Deshacer»", () => {
  test("a discarded open session comes back open only while no other is open", async () => {
    const id = await start();
    expect(data(await deleteHealthSession({ sessionId: id }))).toEqual({ id, routineName: null });
    expect(await getSession(id)).toBeNull();
    expect(await getDeletedSession(id)).toEqual({ id, routineName: null });
    expect(await getOpenSession()).toBeNull();

    const other = await start();
    expect(await restoreHealthSession({ sessionId: id })).toEqual({
      ok: false,
      error: SESSION_ERRORS.otherOpen,
    });
    data(await deleteHealthSession({ sessionId: other }));
    expect(data(await restoreHealthSession({ sessionId: id }))).toEqual({ id });
    expect(await getOpenSession()).toMatchObject({ id });
    expect(revalidatePath).toHaveBeenCalledWith("/health", "layout");
    // Restoring a live one changes nothing.
    expect(data(await restoreHealthSession({ sessionId: id }))).toEqual({ id });
  });

  test("a deleted finished session leaves the lists and comes back with «Deshacer»", async () => {
    const squat = await exercise("Sentadilla con barra");
    const { id } = await sessionWithDoneSet(squat.id);
    data(await finishHealthSession({ sessionId: id, endedAt: null, note: "" }));
    expect((await listSessions(10)).sessions.map((row) => [row.id, row.doneSets])).toEqual([
      [id, 1],
    ]);
    data(await deleteHealthSession({ sessionId: id }));
    expect(await listSessions(10)).toEqual({ sessions: [], total: 0 });
    data(await restoreHealthSession({ sessionId: id }));
    expect((await listSessions(10)).total).toBe(1);
  });
});

describe("rotation", () => {
  test("the never-done routines first by order, then the one done longest ago", async () => {
    const squat = await exercise("Sentadilla con barra");
    const a = await routineWith([squat.id, REPS]);
    const b = await routineWith([squat.id, REPS]);
    expect(await getNextRoutine()).toMatchObject({ id: a.id, lastDoneAt: null });

    const doSession = async (routineId: string) => {
      const id = await start(routineId);
      const set = (await detail(id)).exercises[0].sets[0];
      data(await writeSet(id, set, { weightGrams: 60_000, reps: 8 }));
      data(await finishHealthSession({ sessionId: id, endedAt: null, note: "" }));
    };
    await doSession(a.id);
    expect(await getNextRoutine()).toMatchObject({ id: b.id });
    await doSession(b.id);
    expect(await getNextRoutine()).toMatchObject({ id: a.id });
    // The name follows the routine.
    data(await renameRoutine({ id: a.id, name: "Piernas" }));
    expect(await getNextRoutine()).toMatchObject({ id: a.id, name: "Piernas" });
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the reads redirect to /login and every write is refused", async (_, headers) => {
    const squat = await exercise("Sentadilla con barra");
    const { id, block } = await sessionWithDoneSet(squat.id);
    const set = block.sets[0];
    // Positive control: the owner reads.
    expect(await getSession(id)).not.toBeNull();

    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getSession(id)).rejects.toMatchObject(redirect);
    await expect(getOpenSession()).rejects.toMatchObject(redirect);
    await expect(getNextRoutine()).rejects.toMatchObject(redirect);
    await expect(listSessions(10)).rejects.toMatchObject(redirect);
    await expect(getDeletedSession(id)).rejects.toMatchObject(redirect);

    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    const ref = { sessionId: id };
    for (const result of [
      await startHealthSession({ routineId: null }),
      await addSessionExercise({ ...ref, id: crypto.randomUUID(), exerciseId: squat.id }),
      await removeSessionExercise({ ...ref, id: block.id }),
      await restoreSessionExercise({ ...ref, id: block.id, afterId: null, position: 0 }),
      await reorderSessionExercises({ ...ref, ids: [block.id] }),
      await addHealthSet({
        ...ref,
        sessionExerciseId: block.id,
        id: crypto.randomUUID(),
        weightGrams: null,
        reps: null,
        seconds: null,
        distanceMeters: null,
        warmup: false,
      }),
      await writeSet(id, set, { weightGrams: 0, reps: 1 }),
      await removeHealthSet({ ...ref, id: set.id }),
      await restoreHealthSet({ ...ref, id: set.id, afterId: null, position: 0 }),
      await updateSessionNote({ ...ref, note: "x" }),
      await updateSessionTimes({
        ...ref,
        startedAt: "2026-11-01T18:00:00.000Z",
        endedAt: "2026-11-01T19:00:00.000Z",
      }),
      await finishHealthSession({ ...ref, endedAt: null, note: "" }),
      await undoFinishHealthSession({
        ...ref,
        updatedAt: "2026-11-01T18:00:00.000Z",
        removedSetIds: [],
      }),
      await deleteHealthSession(ref),
      await restoreHealthSession(ref),
    ]) {
      expect(result).toEqual(refused);
    }
    // Nothing changed.
    const [row] = await testDb.select().from(healthSessions);
    expect(row).toMatchObject({ id, endedAt: null, deletedAt: null, note: null });
    expect(await testDb.select().from(healthSessions)).toHaveLength(1);
    expect(await testDb.select().from(healthSets)).toMatchObject([
      { id: set.id, weightGrams: 60_000, reps: 10, deletedAt: null },
    ]);
  });
});

describe("export", () => {
  test("sessions, their exercises and sets are exported, deleted ones included", async () => {
    const squat = await exercise("Sentadilla con barra");
    const { id, block } = await sessionWithDoneSet(squat.id);
    data(
      await addHealthSet({
        sessionId: id,
        sessionExerciseId: block.id,
        id: crypto.randomUUID(),
        weightGrams: 60_000,
        reps: 8,
        seconds: null,
        distanceMeters: null,
        warmup: false,
      }),
    );
    data(await finishHealthSession({ sessionId: id, endedAt: null, note: "Nota" }));

    const exported = await buildExport(testDb, new Date("2026-11-04T15:00:00Z"));
    expect(exported.tables.health_sessions.rows).toMatchObject([{ id, note: "Nota" }]);
    expect(exported.tables.health_session_exercises.rows).toMatchObject([
      { id: block.id, session_id: id },
    ]);
    // The planned set «Terminar» removed is there too.
    expect(
      exported.tables.health_sets.rows.map((row) => [row.weight_grams, row.deleted_at !== null]),
    ).toEqual([
      [60_000, false],
      [60_000, true],
    ]);
  });
});
