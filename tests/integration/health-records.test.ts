// E3 of `health` against the throwaway database: records over real rows. «Terminar» returns the
// new records it set (warmups, removed sets and the open session left out); a session's records
// and the list's count per session agree; editing a set changes the record; deleting a session (or
// removing its exercise) lets the record fall back and makes a later session's value new; the
// exercise's records, line and paged history; and the authorization of the new reads.
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { createExercise, deleteExercise } from "@/modules/health/exercises-actions";
import type { ExerciseItem } from "@/modules/health/exercises-input";
import { getExerciseRecords, getSessionRecords, listSessions } from "@/modules/health/queries";
import { selectExerciseRecords } from "@/modules/health/records-data";
import {
  addHealthSet,
  addSessionExercise,
  deleteHealthSession,
  finishHealthSession,
  readHealthSessionRecords,
  removeHealthSet,
  removeSessionExercise,
  restoreSessionExercise,
  startHealthSession,
  updateHealthSet,
  updateSessionTimes,
} from "@/modules/health/sessions-actions";
import type { SessionSet } from "@/modules/health/sessions-input";
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

function data<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`action failed: ${JSON.stringify(result)}`);
  return result.data;
}

const exercise = async (name: string, kind = "weight_reps"): Promise<ExerciseItem> =>
  data(
    await createExercise({
      name,
      kind,
      muscleGroup: "quads",
      equipment: "barbell",
      perDumbbell: false,
      restSeconds: 90,
    }),
  );

type Lift = { kg: number; reps: number; warmup?: boolean };

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

const DAY = 86_400_000;

/** Starts a free session and marks `lifts` done for each exercise; the sets it wrote. */
async function train(blocks: [ExerciseItem, Lift[]][]) {
  const started = data(await startHealthSession({ routineId: null }));
  if (!started.started) throw new Error("a session was already open");
  const id = started.id;
  const sets = new Map<string, SessionSet[]>();
  const blockIds = new Map<string, string>();
  for (const [item, lifts] of blocks) {
    const block = data(
      await addSessionExercise({ sessionId: id, id: crypto.randomUUID(), exerciseId: item.id }),
    );
    blockIds.set(item.id, block.id);
    const written: SessionSet[] = [];
    for (const [index, lift] of lifts.entries()) {
      const base =
        block.sets[index] ??
        data(
          await addHealthSet({
            sessionId: id,
            sessionExerciseId: block.id,
            id: crypto.randomUUID(),
            weightGrams: null,
            reps: null,
            seconds: null,
            distanceMeters: null,
            warmup: false,
          }),
        );
      written.push(
        data(
          await writeSet(id, base, {
            weightGrams: lift.kg * 1000,
            reps: lift.reps,
            warmup: lift.warmup ?? false,
          }),
        ),
      );
    }
    sets.set(item.id, written);
  }
  return { id, sets, blockIds };
}

const finish = async (id: string) =>
  data(await finishHealthSession({ sessionId: id, endedAt: null, note: "" }));

/** A finished session started `daysAgo` days ago (1 h long). */
async function trainedAgo(daysAgo: number, blocks: [ExerciseItem, Lift[]][]) {
  const session = await train(blocks);
  await finish(session.id);
  const start = Date.now() - daysAgo * DAY;
  data(
    await updateSessionTimes({
      sessionId: session.id,
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(start + 3_600_000).toISOString(),
    }),
  );
  return session;
}

const counts = async () =>
  Object.fromEntries((await listSessions(10)).sessions.map((row) => [row.id, row.newRecords]));

describe("new records of a session", () => {
  test("«Terminar» returns them; warmups, removed sets and other exercises don't count", async () => {
    const squat = await exercise("Sentadilla con barra");
    const bench = await exercise("Press de banca con barra");
    const first = await trainedAgo(10, [
      [squat, [{ kg: 80, reps: 8 }]],
      [bench, [{ kg: 60, reps: 10 }]],
    ]);
    const now = await train([
      [
        squat,
        [
          { kg: 100, reps: 5, warmup: true },
          { kg: 82.5, reps: 7 },
          { kg: 120, reps: 1 },
        ],
      ],
      // Lighter than the first time: nothing new.
      [bench, [{ kg: 55, reps: 10 }]],
    ]);
    // The 120 kg set is removed before finishing (soft delete): it doesn't count.
    const heavy = now.sets.get(squat.id)![2];
    data(await removeHealthSet({ sessionId: now.id, id: heavy.id }));

    const finished = await finish(now.id);
    // 82,5 beats 80 (not the 100 kg warmup), and 82,5 × 37 beats 80 × 38 for the 1RM (shown
    // rounded to 0,5 kg: 101,75 → 102 kg).
    expect(finished.records).toEqual([
      { exerciseId: squat.id, exerciseName: squat.name, metric: "maxWeight", value: 82_500 },
      { exerciseId: squat.id, exerciseName: squat.name, metric: "e1rm", value: 102_000 },
    ]);
    expect(await getSessionRecords(now.id)).toEqual(finished.records);
    // The first session of an exercise sets nothing new.
    expect(await getSessionRecords(first.id)).toEqual([]);
    expect(await counts()).toEqual({ [now.id]: 2, [first.id]: 0 });
  });

  test("an open session has none and its sets count for nobody", async () => {
    const squat = await exercise("Sentadilla con barra");
    const earlier = await trainedAgo(5, [[squat, [{ kg: 80, reps: 5 }]]]);
    const later = await trainedAgo(2, [[squat, [{ kg: 85, reps: 5 }]]]);
    const open = await train([[squat, [{ kg: 200, reps: 5 }]]]);
    expect(await getSessionRecords(open.id)).toEqual([]);
    // Positive control: the later session beats the earlier one.
    expect(await counts()).toEqual({ [open.id]: 0, [later.id]: 2, [earlier.id]: 0 });
    const view = await getExerciseRecords(squat, 20);
    expect(view.records.map((record) => record.value)).toEqual([85_000, 99_000]);
    expect(view.totalSessions).toBe(2);
  });

  test("editing a set of a finished session changes its records", async () => {
    const squat = await exercise("Sentadilla con barra");
    await trainedAgo(10, [[squat, [{ kg: 80, reps: 8 }]]]);
    const now = await train([[squat, [{ kg: 82.5, reps: 7 }]]]);
    expect((await finish(now.id)).records).toHaveLength(2);
    const [set] = now.sets.get(squat.id)!;
    data(await writeSet(now.id, set, { weightGrams: 78_000, reps: 7 }));
    expect(await getSessionRecords(now.id)).toEqual([]);
    // The read the screen uses after a correction says the same.
    expect(data(await readHealthSessionRecords({ sessionId: now.id }))).toEqual([]);
    // Marked as a warmup it doesn't count either; back to a work set at 90 kg, it is new again.
    data(await writeSet(now.id, set, { weightGrams: 90_000, reps: 3, warmup: true }));
    expect(await getSessionRecords(now.id)).toEqual([]);
    data(await writeSet(now.id, set, { weightGrams: 90_000, reps: 3, warmup: false }));
    expect((await getSessionRecords(now.id)).map((record) => record.metric)).toEqual(["maxWeight"]);
  });

  test("deleting a session, or removing its exercise, lets the record fall back", async () => {
    const squat = await exercise("Sentadilla con barra");
    const a = await trainedAgo(9, [[squat, [{ kg: 80, reps: 5 }]]]);
    const b = await trainedAgo(6, [[squat, [{ kg: 90, reps: 5 }]]]);
    const c = await trainedAgo(3, [[squat, [{ kg: 85, reps: 5 }]]]);
    expect(await counts()).toEqual({ [a.id]: 0, [b.id]: 2, [c.id]: 0 });
    expect((await getExerciseRecords(squat, 20)).records[0]).toMatchObject({
      metric: "maxWeight",
      value: 90_000,
      sessionId: b.id,
    });

    // b's exercise removed: c now beats a.
    data(await removeSessionExercise({ sessionId: b.id, id: b.blockIds.get(squat.id)! }));
    expect(await counts()).toEqual({ [a.id]: 0, [b.id]: 0, [c.id]: 2 });
    data(
      await restoreSessionExercise({
        sessionId: b.id,
        id: b.blockIds.get(squat.id)!,
        afterId: null,
        position: 0,
      }),
    );
    expect(await counts()).toEqual({ [a.id]: 0, [b.id]: 2, [c.id]: 0 });

    // b deleted: the record falls back to c's 85 kg, which is new against a.
    data(await deleteHealthSession({ sessionId: b.id }));
    expect(await counts()).toEqual({ [a.id]: 0, [c.id]: 2 });
    expect(await getSessionRecords(c.id)).toHaveLength(2);
    expect((await getExerciseRecords(squat, 20)).records[0]).toMatchObject({
      value: 85_000,
      sessionId: c.id,
    });
  });
});

describe("an exercise's page", () => {
  test("records, the line oldest first, and the history newest first, paged", async () => {
    const squat = await exercise("Sentadilla con barra");
    const a = await trainedAgo(30, [
      [
        squat,
        [
          { kg: 80, reps: 8 },
          { kg: 80, reps: 8 },
        ],
      ],
    ]);
    const b = await trainedAgo(20, [
      [
        squat,
        [
          { kg: 60, reps: 10, warmup: true },
          { kg: 82.5, reps: 7 },
        ],
      ],
    ]);
    const c = await trainedAgo(10, [[squat, [{ kg: 81, reps: 6 }]]]);

    const view = await getExerciseRecords(squat, 20);
    expect(view.lineMetric).toBe("maxWeight");
    expect(view.line.map((point) => [point.sessionId, point.value])).toEqual([
      [a.id, 80_000],
      [b.id, 82_500],
      [c.id, 81_000],
    ]);
    expect(view.history.map((entry) => [entry.sessionId, entry.sets])).toEqual([
      [c.id, "81 kg × 6"],
      [b.id, "82,5 kg × 7"],
      [a.id, "80 kg × 8 · 80 × 8"],
    ]);
    expect(view.records.find((record) => record.metric === "maxWeight")).toMatchObject({
      value: 82_500,
      sessionId: b.id,
    });

    const page = await getExerciseRecords(squat, 1);
    expect(page.history).toHaveLength(1);
    expect(page.totalSessions).toBe(3);
  });

  test("an exercise never trained: no records, no line, no history", async () => {
    const plank = await exercise("Plancha", "time");
    expect(await getExerciseRecords(plank, 20)).toEqual({
      records: [],
      lineMetric: "maxSeconds",
      line: [],
      history: [],
      totalSessions: 0,
    });
  });
});

describe("rules pinned on real rows", () => {
  test("an exercise deleted from the catalogue keeps its records in past sessions", async () => {
    const squat = await exercise("Sentadilla con barra");
    await trainedAgo(6, [[squat, [{ kg: 80, reps: 5 }]]]);
    const later = await trainedAgo(3, [[squat, [{ kg: 85, reps: 5 }]]]);
    data(await deleteExercise({ id: squat.id }));
    // The sessions keep their history (E2): the summary and the list still count it, by name.
    expect((await getSessionRecords(later.id)).map((record) => record.exerciseName)).toEqual([
      squat.name,
      squat.name,
    ]);
    expect((await counts())[later.id]).toBe(2);
  });

  test("the line's window starts at 00:00 Lima of the same day a year before", async () => {
    const squat = await exercise("Sentadilla con barra");
    const session = await trainedAgo(200, [[squat, [{ kg: 80, reps: 5 }]]]);
    const [stored] = (await getExerciseRecords(squat, 20)).history;
    expect(stored.sessionId).toBe(session.id);
    // Lima's calendar day of the session, a year later at noon Lima: inside; a day later: out.
    const day = new Date(Date.parse(stored.startedAt) - 5 * 3_600_000).toISOString().slice(0, 10);
    const yearLater = `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
    const noon = new Date(`${yearLater}T12:00:00-05:00`);
    const inside = await selectExerciseRecords(testDb, squat.id, "weight_reps", 20, noon);
    expect(inside.line.map((point) => point.sessionId)).toEqual([session.id]);
    const after = new Date(noon.getTime() + DAY);
    const outside = await selectExerciseRecords(testDb, squat.id, "weight_reps", 20, after);
    expect(outside.line).toEqual([]);
    // The records and the history are not windowed.
    expect(outside.records).toHaveLength(2);
    expect(outside.history).toHaveLength(1);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the record reads redirect and the read action is refused", async (_, headers) => {
    const squat = await exercise("Sentadilla con barra");
    const session = await trainedAgo(3, [[squat, [{ kg: 80, reps: 5 }]]]);
    // Positive control: the owner reads.
    expect(data(await readHealthSessionRecords({ sessionId: session.id }))).toEqual([]);
    expect((await getExerciseRecords(squat, 20)).totalSessions).toBe(1);

    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getSessionRecords(session.id)).rejects.toMatchObject(redirect);
    await expect(getExerciseRecords(squat, 20)).rejects.toMatchObject(redirect);
    expect(await readHealthSessionRecords({ sessionId: session.id })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
  });

  test("a malformed id reads nothing", async () => {
    expect(await getSessionRecords("nope")).toEqual([]);
    expect((await readHealthSessionRecords({ sessionId: "nope" })).ok).toBe(false);
  });
});
