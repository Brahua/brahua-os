// E4 of `health` against the throwaway database: «Ajustes» (the single row, created then updated;
// habits a session can't mark refused; the foreign key is RESTRICT); «Terminar» marks the linked
// habit on the Lima day of the end (marked, already done, archived, deleted, another measure) and
// its «Deshacer» unmarks exactly the habit and day it marked, only while that log is as the mark
// left it (whatever «Ajustes» says now); a session across Lima's midnight marks the day it ended;
// deleting a session never unmarks; the habits contract on its own (window, measure,
// unmark only what is done); Hoy's summary (running, the habit due, the routine that comes next)
// and the weekly review's counts across the Lima week's edges; authorization.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { habitLogs, habits } from "@/modules/habits/db/schema";
import { markHabitDoneBySource, unmarkHabitBySource } from "@/modules/habits/contracts";
import { getHealthTodaySummary, getHealthWeekReview } from "@/modules/health/contracts";
import {
  healthSessionExercises,
  healthSessions,
  healthSets,
  healthSettings,
} from "@/modules/health/db/schema";
import { createExercise } from "@/modules/health/exercises-actions";
import { getHealthSettings } from "@/modules/health/queries";
import { addRoutineItem, createRoutine } from "@/modules/health/routines-actions";
import {
  addSessionExercise,
  deleteHealthSession,
  finishHealthSession,
  startHealthSession,
  undoFinishHealthSession,
  updateHealthSet,
} from "@/modules/health/sessions-actions";
import { updateHealthSettings } from "@/modules/health/settings-actions";
import { SETTINGS_ERRORS } from "@/modules/health/settings-copy";
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

let habitOrder = 0;
/** A habit straight in the database (daily yes/no to build, started 2026-01-01 by default). */
async function newHabit(values: Partial<typeof habits.$inferInsert> = {}): Promise<string> {
  const [habit] = await testDb
    .insert(habits)
    .values({
      name: "Gimnasio",
      measure: "check",
      frequency: "daily",
      startDate: "2026-01-01",
      sortOrder: habitOrder++,
      ...values,
    })
    .returning({ id: habits.id });
  return habit.id;
}

/** The habit's log of `day` (quantity), or null without one. */
async function logOf(habitId: string, day: string): Promise<number | null> {
  const [row] = await testDb
    .select({ quantity: habitLogs.quantity })
    .from(habitLogs)
    .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.day, day)));
  return row?.quantity ?? null;
}

async function markDone(habitId: string, day: string) {
  await testDb.insert(habitLogs).values({ habitId, day, quantity: 1, target: 1 });
}

async function sessionRow(id: string) {
  const [row] = await testDb.select().from(healthSessions).where(eq(healthSessions.id, id));
  return row;
}

let exerciseSerial = 0;
async function exercise() {
  return data(
    await createExercise({
      name: `Sentadilla ${exerciseSerial++}`,
      kind: "weight_reps",
      muscleGroup: "quads",
      equipment: "barbell",
      perDumbbell: false,
      restSeconds: 90,
    }),
  );
}

/** A free session with one done set: it can be finished. */
async function openSessionWithDoneSet(): Promise<string> {
  const started = data(await startHealthSession({ routineId: null }));
  if (!started.started) throw new Error("a session was already open");
  const squat = await exercise();
  const block = data(
    await addSessionExercise({
      sessionId: started.id,
      id: crypto.randomUUID(),
      exerciseId: squat.id,
    }),
  );
  const set = block.sets[0];
  data(
    await updateHealthSet({
      sessionId: started.id,
      id: set.id,
      weightGrams: 60_000,
      reps: 10,
      seconds: null,
      distanceMeters: null,
      warmup: false,
      done: true,
    }),
  );
  return started.id;
}

const finish = async (sessionId: string) =>
  data(await finishHealthSession({ sessionId, endedAt: null, note: "" }));

const link = async (habitId: string | null) => data(await updateHealthSettings({ habitId }));

/** A live routine with one exercise. */
async function newRoutine() {
  const squat = await exercise();
  const routine = data(await createRoutine({}));
  data(
    await addRoutineItem({
      routineId: routine.id,
      id: crypto.randomUUID(),
      exerciseId: squat.id,
      targetSets: 3,
      repsMin: 8,
      repsMax: 12,
      targetSeconds: null,
      restSeconds: null,
    }),
  );
  return routine;
}

/** The habit log's `updated_at` of `day`. */
async function logStamp(habitId: string, day: string): Promise<Date | null> {
  const [row] = await testDb
    .select({ updatedAt: habitLogs.updatedAt })
    .from(habitLogs)
    .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.day, day)));
  return row?.updatedAt ?? null;
}

/** A Lima day `days` after `day` (YYYY-MM-DD). */
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Lima's today, by the same clock the server uses. */
const today = () => ownerDateKey(new Date());

describe("«Ajustes»", () => {
  test("the first save creates the single row, the next ones update it", async () => {
    const gym = await newHabit();
    const read = await newHabit({ name: "Leer" });
    expect(await getHealthSettings()).toEqual({
      habitId: null,
      options: [
        { id: gym, name: "Gimnasio" },
        { id: read, name: "Leer" },
      ],
    });
    expect((await link(gym)).habitId).toBe(gym);
    expect((await link(read)).habitId).toBe(read);
    expect((await link(null)).habitId).toBeNull();
    const rows = await testDb.select().from(healthSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, habitId: null });
    expect(revalidatePath).toHaveBeenCalledWith("/health", "layout");
  });

  test("a habit a session can't mark is refused and left out of the options", async () => {
    const archived = await newHabit({ name: "Archivado", archivedAt: new Date() });
    const deleted = await newHabit({ name: "Borrado", deletedAt: new Date() });
    const quantity = await newHabit({ name: "Agua", measure: "quantity", goal: 8, unit: "vasos" });
    const avoid = await newHabit({ name: "No fumar", kind: "avoid" });
    for (const habitId of [archived, deleted, quantity, avoid, MISSING]) {
      expect(await updateHealthSettings({ habitId })).toEqual({
        ok: false,
        error: SETTINGS_ERRORS.habitUnavailable,
      });
    }
    expect((await getHealthSettings()).options).toEqual([]);
    expect(await testDb.select().from(healthSettings)).toHaveLength(0);
  });

  test("the linked habit can't be hard-deleted: ON DELETE RESTRICT is 23001", async () => {
    const gym = await newHabit();
    await link(gym);
    await expect(testDb.delete(habits).where(eq(habits.id, gym))).rejects.toMatchObject({
      cause: { code: "23001" },
    });
  });

  test("a linked habit archived later reads as no longer available", async () => {
    const gym = await newHabit();
    await link(gym);
    await testDb.update(habits).set({ archivedAt: new Date() }).where(eq(habits.id, gym));
    expect(await getHealthSettings()).toEqual({ habitId: gym, options: [] });
  });
});

describe("«Terminar» marks the linked habit", () => {
  test("marked: the Lima day of the end, remembered by the session and named", async () => {
    const gym = await newHabit();
    await link(gym);
    const id = await openSessionWithDoneSet();
    const finished = await finish(id);
    const day = ownerDateKey(new Date(finished.endedAt));
    expect(finished.habitMarked).toBe("Gimnasio");
    expect(await logOf(gym, day)).toBe(1);
    const row = await sessionRow(id);
    expect(row).toMatchObject({ habitMarkedDay: day, habitMarkedId: gym });
    expect(row.habitMarkAt).toEqual(await logStamp(gym, day));
  });

  test("the mark is all or nothing (CHECK), and its habit can't be hard-deleted (23001)", async () => {
    const gym = await newHabit();
    const raw = (values: Partial<typeof healthSessions.$inferInsert>) =>
      testDb
        .insert(healthSessions)
        .values({ startedAt: new Date(), endedAt: new Date(), ...values });
    await expect(raw({ habitMarkedDay: "2026-11-04" })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "health_sessions_habit_mark_check" },
    });
    await expect(raw({ habitMarkedId: gym, habitMarkAt: new Date() })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "health_sessions_habit_mark_check" },
    });
    // Positive control: all three together.
    await raw({ habitMarkedDay: "2026-11-04", habitMarkedId: gym, habitMarkAt: new Date() });
    await expect(testDb.delete(habits).where(eq(habits.id, gym))).rejects.toMatchObject({
      cause: { code: "23001" },
    });
  });

  test("a session from 23:40 to 00:30 (Lima) marks the day it ended, not the one before", async () => {
    const gym = await newHabit();
    await link(gym);
    const ended = addDays(today(), -1);
    const before = addDays(today(), -2);
    const id = await openSessionWithDoneSet();
    await testDb
      .update(healthSessions)
      .set({ startedAt: new Date(`${before}T23:40:00-05:00`) })
      .where(eq(healthSessions.id, id));
    const finished = data(
      await finishHealthSession({
        sessionId: id,
        endedAt: new Date(`${ended}T00:30:00-05:00`).toISOString(),
        note: "",
      }),
    );
    expect(finished.habitMarked).toBe("Gimnasio");
    expect(await logOf(gym, ended)).toBe(1);
    expect(await logOf(gym, before)).toBeNull();
    expect((await sessionRow(id)).habitMarkedDay).toBe(ended);
  });

  test("already done that day: nothing changes, nothing remembered, the «Deshacer» keeps it", async () => {
    const gym = await newHabit();
    await link(gym);
    await markDone(gym, today());
    const id = await openSessionWithDoneSet();
    const finished = await finish(id);
    expect(finished.habitMarked).toBeNull();
    expect((await sessionRow(id)).habitMarkedDay).toBeNull();
    data(await undoFinishHealthSession({ sessionId: id, updatedAt: finished.updatedAt }));
    expect(await logOf(gym, today())).toBe(1);
  });

  test.each([
    ["archived", { archivedAt: new Date() }],
    ["deleted", { deletedAt: new Date() }],
    ["now a quantity habit", { measure: "quantity" as const, goal: 8, unit: "vasos" }],
  ])("a linked habit %s after linking marks nothing", async (_, change) => {
    const gym = await newHabit();
    await link(gym);
    await testDb.update(habits).set(change).where(eq(habits.id, gym));
    const id = await openSessionWithDoneSet();
    const finished = await finish(id);
    expect(finished.habitMarked).toBeNull();
    expect(await logOf(gym, today())).toBeNull();
    expect((await sessionRow(id)).habitMarkedDay).toBeNull();
  });

  test("no linked habit: nothing marked (positive control: a linked one is)", async () => {
    const gym = await newHabit();
    const first = await finish(await openSessionWithDoneSet());
    expect(first.habitMarked).toBeNull();
    expect(await logOf(gym, today())).toBeNull();
    await link(gym);
    expect((await finish(await openSessionWithDoneSet())).habitMarked).toBe("Gimnasio");
  });

  test("its «Deshacer» unmarks its own mark and forgets it", async () => {
    const gym = await newHabit();
    await link(gym);
    const id = await openSessionWithDoneSet();
    const finished = await finish(id);
    const day = (await sessionRow(id)).habitMarkedDay as string;
    data(await undoFinishHealthSession({ sessionId: id, updatedAt: finished.updatedAt }));
    expect(await logOf(gym, day)).toBe(0);
    expect(await sessionRow(id)).toMatchObject({
      endedAt: null,
      habitMarkedDay: null,
      habitMarkedId: null,
      habitMarkAt: null,
    });
    // Finishing again marks it again.
    expect((await finish(id)).habitMarked).toBe("Gimnasio");
    expect(await logOf(gym, day)).toBe(1);
  });

  test("its «Deshacer» leaves a day unmarked in between as it is", async () => {
    const gym = await newHabit();
    await link(gym);
    const id = await openSessionWithDoneSet();
    const finished = await finish(id);
    const day = (await sessionRow(id)).habitMarkedDay as string;
    await testDb
      .update(habitLogs)
      .set({ quantity: 0 })
      .where(and(eq(habitLogs.habitId, gym), eq(habitLogs.day, day)));
    data(await undoFinishHealthSession({ sessionId: id, updatedAt: finished.updatedAt }));
    expect(await logOf(gym, day)).toBe(0);
  });

  test("its «Deshacer» leaves a day unmarked and marked again by hand", async () => {
    const gym = await newHabit();
    await link(gym);
    const id = await openSessionWithDoneSet();
    const finished = await finish(id);
    const day = (await sessionRow(id)).habitMarkedDay as string;
    const thatDay = and(eq(habitLogs.habitId, gym), eq(habitLogs.day, day));
    await testDb.update(habitLogs).set({ quantity: 0 }).where(thatDay);
    await testDb.update(habitLogs).set({ quantity: 1 }).where(thatDay);
    data(await undoFinishHealthSession({ sessionId: id, updatedAt: finished.updatedAt }));
    expect(await logOf(gym, day)).toBe(1);
    expect((await sessionRow(id)).habitMarkedId).toBeNull();
  });

  test("after the settings changed, the «Deshacer» unmarks the habit it marked, and only it", async () => {
    const gym = await newHabit();
    const read = await newHabit({ name: "Leer" });
    await link(gym);
    const id = await openSessionWithDoneSet();
    const finished = await finish(id);
    const day = (await sessionRow(id)).habitMarkedDay as string;
    await markDone(read, day);
    await link(read);
    data(await undoFinishHealthSession({ sessionId: id, updatedAt: finished.updatedAt }));
    expect(await logOf(gym, day)).toBe(0);
    expect(await logOf(read, day)).toBe(1);
    expect((await sessionRow(id)).habitMarkedDay).toBeNull();
  });

  test("deleting the session later never unmarks", async () => {
    const gym = await newHabit();
    await link(gym);
    const id = await openSessionWithDoneSet();
    await finish(id);
    const day = (await sessionRow(id)).habitMarkedDay as string;
    data(await deleteHealthSession({ sessionId: id }));
    expect(await logOf(gym, day)).toBe(1);
  });
});

describe("the habits contract on its own", () => {
  test("marks within the window only; unmarks only its own untouched mark", async () => {
    const gym = await newHabit();
    const now = new Date("2026-11-04T15:00:00Z");
    const result = await testDb.transaction(async (tx) => [
      await markHabitDoneBySource(tx, gym, "2026-11-04", now),
      await markHabitDoneBySource(tx, gym, "2026-11-04", now),
      // Tomorrow and more than 7 days back are out of the window.
      await markHabitDoneBySource(tx, gym, "2026-11-05", now),
      await markHabitDoneBySource(tx, gym, "2026-10-27", now),
      await markHabitDoneBySource(tx, gym, "2026-10-28", now),
      await markHabitDoneBySource(tx, MISSING, "2026-11-04", now),
    ]);
    expect(result.map((mark) => mark.result)).toEqual([
      "marked",
      "already",
      "unavailable",
      "unavailable",
      "marked",
      "unavailable",
    ]);
    const first = result[0] as { result: "marked"; name: string; markAt: Date };
    expect(first.name).toBe("Gimnasio");
    expect(first.markAt).toEqual(await logStamp(gym, "2026-11-04"));
    const unmarked = await testDb.transaction(async (tx) => [
      // Another stamp (somebody touched it since): left alone.
      await unmarkHabitBySource(tx, gym, "2026-11-04", new Date(first.markAt.getTime() - 1), now),
      await unmarkHabitBySource(tx, gym, "2026-11-04", first.markAt, now),
      await unmarkHabitBySource(tx, gym, "2026-11-04", first.markAt, now),
      await unmarkHabitBySource(tx, gym, "2026-11-03", first.markAt, now),
    ]);
    expect(unmarked).toEqual([false, true, false, false]);
    expect(await logOf(gym, "2026-11-04")).toBe(0);
    expect(await logOf(gym, "2026-10-28")).toBe(1);
  });

  test("a habit that started later than the day can't be marked that day", async () => {
    const gym = await newHabit({ startDate: "2026-11-04" });
    const now = new Date("2026-11-04T15:00:00Z");
    expect(
      await testDb.transaction((tx) => markHabitDoneBySource(tx, gym, "2026-11-03", now)),
    ).toEqual({ result: "unavailable" });
  });
});

describe("Hoy's summary", () => {
  test("running, the routine that comes next and the linked habit due", async () => {
    const gym = await newHabit();
    await link(gym);
    const now = new Date();
    // No routine: nothing to start, so the habit isn't due here.
    expect((await getHealthTodaySummary(now)).habitDue).toBe(false);
    await link(null);
    const routine = await newRoutine();
    // No linked habit: nothing due.
    expect(await getHealthTodaySummary(now)).toEqual({
      running: null,
      next: { routineId: routine.id, routineName: routine.name },
      habitDue: false,
    });
    await link(gym);
    expect((await getHealthTodaySummary(now)).habitDue).toBe(true);
    // An open session: running, and the habit no longer read.
    const id = await openSessionWithDoneSet();
    const running = await getHealthTodaySummary(now);
    expect(running.running).toMatchObject({ id, routineName: null });
    expect(running.habitDue).toBe(false);
    // Finished: the habit is done today, nothing due.
    await finish(id);
    expect(await getHealthTodaySummary(now)).toMatchObject({ running: null, habitDue: false });
  });

  test("a habit not scheduled today, or archived, is not due", async () => {
    await newRoutine();
    const weekday = new Date(`${today()}T12:00:00Z`).getUTCDay() || 7;
    const other = (weekday % 7) + 1;
    const gym = await newHabit({ frequency: "weekdays", weekdays: [other] });
    await link(gym);
    expect((await getHealthTodaySummary(new Date())).habitDue).toBe(false);
    const daily = await newHabit({ name: "Correr" });
    await link(daily);
    expect((await getHealthTodaySummary(new Date())).habitDue).toBe(true);
    await testDb.update(habits).set({ archivedAt: new Date() }).where(eq(habits.id, daily));
    expect((await getHealthTodaySummary(new Date())).habitDue).toBe(false);
  });
});

describe("the weekly review's «Entreno»", () => {
  /** A finished session started at `at` with one done set of `exerciseId` (weight × reps). */
  async function rawSession(
    at: string,
    exerciseId: string,
    weightGrams: number,
    values: Partial<typeof healthSessions.$inferInsert> = {},
  ) {
    const startedAt = new Date(at);
    const [session] = await testDb
      .insert(healthSessions)
      .values({ startedAt, endedAt: new Date(startedAt.getTime() + 3_600_000), ...values })
      .returning();
    const [row] = await testDb
      .insert(healthSessionExercises)
      .values({ sessionId: session.id, exerciseId, position: 0 })
      .returning();
    await testDb
      .insert(healthSets)
      .values({ sessionExerciseId: row.id, position: 0, weightGrams, reps: 5, doneAt: startedAt });
    return session.id;
  }

  test("finished, live sessions started in the Lima week, and their new records", async () => {
    const squat = await exercise();
    // The week of Monday 2026-10-26 (Lima): from 2026-10-26T05:00Z to 2026-11-02T05:00Z.
    await rawSession("2026-10-20T12:00:00Z", squat.id, 80_000); // the week before: the base
    await rawSession("2026-10-26T05:00:00Z", squat.id, 82_500); // Monday 00:00 Lima: in, records
    await rawSession("2026-11-02T04:59:00Z", squat.id, 82_500); // Sunday 23:59 Lima: in, a tie
    await rawSession("2026-11-02T05:00:00Z", squat.id, 90_000); // next Monday 00:00: out
    await rawSession("2026-10-28T12:00:00Z", squat.id, 100_000, { deletedAt: new Date() });
    await rawSession("2026-10-29T12:00:00Z", squat.id, 100_000, { endedAt: null });
    // Monday's 82,5 kg × 5 beats the base twice (weight and estimated 1RM); Sunday's tie, never.
    expect(await getHealthWeekReview("2026-10-26")).toEqual({ sessions: 2, records: 2 });
    // Any day of the week reads that week.
    expect(await getHealthWeekReview("2026-11-01")).toEqual({ sessions: 2, records: 2 });
    expect(await getHealthWeekReview("2026-11-02")).toEqual({ sessions: 1, records: 2 });
    expect(await getHealthWeekReview("2026-10-19")).toEqual({ sessions: 1, records: 0 });
    expect(await getHealthWeekReview("2026-02-30")).toEqual({ sessions: 0, records: 0 });
    expect(await getHealthWeekReview("semana")).toEqual({ sessions: 0, records: 0 });
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s nothing is read or written", async (_, headers) => {
    const gym = await newHabit();
    // Positive control: the owner reads and writes.
    expect((await getHealthSettings()).options).toHaveLength(1);
    request.headers = await headers();
    expect(await updateHealthSettings({ habitId: gym })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getHealthSettings()).rejects.toMatchObject(redirect);
    await expect(getHealthTodaySummary(new Date())).rejects.toMatchObject(redirect);
    await expect(getHealthWeekReview("2026-10-26")).rejects.toMatchObject(redirect);
    expect(await testDb.select().from(healthSettings)).toHaveLength(0);
  });
});
