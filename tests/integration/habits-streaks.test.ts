// H4 of `habits` against the throwaway database: pauses (window, length, overlaps rejected under
// the habit's lock with two at the same time, resume, remove), logging an earlier day (the 7-day
// window, the start date, the future, a paused day), the streak fields of `HabitItem` read in a
// fixed number of queries, and authorization.
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { HABIT_ERRORS } from "@/modules/habits/habit-input";
import { HABITS_ADVISORY_SPACE, selectActiveHabits } from "@/modules/habits/habits";
import { logHabit, setHabitDone, setHabitQuantity } from "@/modules/habits/log-actions";
import { pauseHabit, removeHabitPause, resumeHabit } from "@/modules/habits/pause-actions";
import { PAUSE_ERRORS } from "@/modules/habits/pause-copy";
import { listActiveHabits } from "@/modules/habits/queries";
import { addDays } from "@/modules/habits/schedule";
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
const MISSING = "00000000-0000-4000-8000-000000000000";
/** The actions use Lima's today by the real clock: so do the tests. */
const today = () => ownerDateKey(new Date());
const day = (offset: number) => addDays(today(), offset);

let order = 0;
/** A habit straight in the database, started `startedDaysAgo` days ago. */
async function insertHabit(values: Partial<typeof habits.$inferInsert> = {}, startedDaysAgo = 30) {
  const [row] = await testDb
    .insert(habits)
    .values({
      name: "Leer",
      measure: "check",
      frequency: "daily",
      startDate: day(-startedDaysAgo),
      sortOrder: order++,
      ...values,
    })
    .returning({ id: habits.id });
  return row.id;
}

const mark = (habitId: string, days: string[], quantity = 1, target = 1) =>
  testDb.insert(habitLogs).values(days.map((d) => ({ habitId, day: d, quantity, target })));

async function pausesOf(habitId: string) {
  return testDb
    .select({
      startDate: habitPauses.startDate,
      endDate: habitPauses.endDate,
      reason: habitPauses.reason,
      deleted: habitPauses.deletedAt,
    })
    .from(habitPauses)
    .where(eq(habitPauses.habitId, habitId))
    .orderBy(habitPauses.startDate);
}

const livePauses = async (habitId: string) =>
  (await pausesOf(habitId)).filter((pause) => pause.deleted === null);

async function itemOf(habitId: string) {
  const items = await selectActiveHabits(testDb, today());
  return items.find((item) => item.id === habitId);
}

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
  order = 0;
});

describe("pause", () => {
  test("from today: stored (reason normalized), the habit shows it and is paused today", async () => {
    const id = await insertHabit();
    const result = await pauseHabit({
      id,
      startDate: today(),
      endDate: day(9),
      reason: "  Viaje   a Cusco ",
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        habit: { id, pause: { startDate: today(), endDate: day(9), reason: "Viaje a Cusco" } },
        pause: { startDate: today(), endDate: day(9), reason: "Viaje a Cusco" },
      },
    });
    expect(await livePauses(id)).toEqual([
      { startDate: today(), endDate: day(9), reason: "Viaje a Cusco", deleted: null },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/habits", "layout");
  });

  test("no reason is null; up to 7 days back and a year ahead; at most 90 days", async () => {
    const id = await insertHabit();
    // Positive controls at each edge.
    expect(
      await pauseHabit({ id, startDate: day(-7), endDate: day(-6), reason: "" }),
    ).toMatchObject({ ok: true, data: { pause: { reason: null } } });
    expect(await pauseHabit({ id, startDate: day(365), endDate: day(365 + 89) })).toMatchObject({
      ok: true,
    });
    // Out of the window or too long: refused, nothing stored.
    const before = await pausesOf(id);
    expect(await pauseHabit({ id, startDate: day(-8), endDate: day(-5) })).toMatchObject({
      ok: false,
      fieldErrors: { startDate: [PAUSE_ERRORS.startOutOfWindow] },
    });
    expect(await pauseHabit({ id, startDate: day(366), endDate: day(370) })).toMatchObject({
      ok: false,
      fieldErrors: { startDate: [PAUSE_ERRORS.startOutOfWindow] },
    });
    expect(await pauseHabit({ id, startDate: day(10), endDate: day(10 + 90) })).toMatchObject({
      ok: false,
      fieldErrors: { endDate: [PAUSE_ERRORS.tooLong] },
    });
    expect(await pauseHabit({ id, startDate: day(10), endDate: day(9) })).toMatchObject({
      ok: false,
      fieldErrors: { endDate: [PAUSE_ERRORS.endBeforeStart] },
    });
    expect(
      await pauseHabit({ id, startDate: day(10), endDate: day(11), reason: "x".repeat(61) }),
    ).toMatchObject({ ok: false, fieldErrors: { reason: [PAUSE_ERRORS.reasonTooLong] } });
    expect(await pausesOf(id)).toEqual(before);
  });

  test("an overlap with another pause is refused; touching the next day is fine", async () => {
    const id = await insertHabit();
    expect(await pauseHabit({ id, startDate: day(5), endDate: day(10) })).toMatchObject({
      ok: true,
    });
    for (const [start, end] of [
      [day(0), day(5)],
      [day(10), day(12)],
      [day(6), day(7)],
      [day(1), day(20)],
    ]) {
      expect(await pauseHabit({ id, startDate: start, endDate: end })).toMatchObject({
        ok: false,
        fieldErrors: { startDate: [PAUSE_ERRORS.overlap] },
      });
    }
    // Positive control: the days right before and after.
    expect(await pauseHabit({ id, startDate: day(0), endDate: day(4) })).toMatchObject({
      ok: true,
    });
    expect(await pauseHabit({ id, startDate: day(11), endDate: day(12) })).toMatchObject({
      ok: true,
    });
    // A removed pause doesn't count; another habit's never does.
    const other = await insertHabit({ name: "Otro" });
    expect(await pauseHabit({ id: other, startDate: day(5), endDate: day(10) })).toMatchObject({
      ok: true,
    });
    expect(await livePauses(id)).toHaveLength(3);
  });

  test("a removed pause frees its days", async () => {
    const id = await insertHabit();
    const first = await pauseHabit({ id, startDate: day(5), endDate: day(10) });
    if (!first.ok) throw new Error("pause failed");
    expect(await removeHabitPause({ id, pauseId: first.data.pause.id })).toMatchObject({
      ok: true,
      data: { pause: null },
    });
    expect(await pauseHabit({ id, startDate: day(6), endDate: day(8) })).toMatchObject({
      ok: true,
    });
    // Removed is soft: the row stays (export, backup) with deleted_at.
    expect((await pausesOf(id)).map((pause) => pause.deleted === null)).toEqual([false, true]);
  });

  test("archived, deleted or missing habits can't be paused", async () => {
    const archived = await insertHabit({ archivedAt: new Date() });
    const deleted = await insertHabit({ deletedAt: new Date() });
    expect(await pauseHabit({ id: archived, startDate: day(1), endDate: day(2) })).toEqual({
      ok: false,
      error: HABIT_ERRORS.archived,
    });
    for (const id of [deleted, MISSING]) {
      expect(await pauseHabit({ id, startDate: day(1), endDate: day(2) })).toEqual({
        ok: false,
        error: HABIT_ERRORS.notFound,
      });
    }
    expect(await testDb.$count(habitPauses)).toBe(0);
  });

  test("two overlapping pauses at the same time: the lock lets only one in", async () => {
    const id = await insertHabit();
    const holder = await testDb.$client.connect();
    let results: Awaited<ReturnType<typeof pauseHabit>>[];
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HABITS_ADVISORY_SPACE,
        id,
      ]);
      const pending = [
        pauseHabit({ id, startDate: day(1), endDate: day(10) }),
        pauseHabit({ id, startDate: day(5), endDate: day(15) }),
      ];
      // Both wait on the habit's lock, the first lock they take.
      await waitForLockWaiters(id, 2);
      expect(await testDb.$count(habitPauses)).toBe(0);
      await holder.query("commit");
      results = await Promise.all(pending);
    } finally {
      holder.release();
    }
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      {
        ok: false,
        error: expect.any(String),
        fieldErrors: { startDate: [PAUSE_ERRORS.overlap] },
      },
    ]);
    expect(await livePauses(id)).toHaveLength(1);
  });

  test("positive control: two pauses that don't overlap, at the same time, both go in", async () => {
    const id = await insertHabit();
    const results = await Promise.all([
      pauseHabit({ id, startDate: day(1), endDate: day(4) }),
      pauseHabit({ id, startDate: day(5), endDate: day(15) }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await livePauses(id)).toHaveLength(2);
  });
});

describe("resume", () => {
  async function paused(start: number, end: number) {
    const id = await insertHabit();
    const result = await pauseHabit({ id, startDate: day(start), endDate: day(end) });
    if (!result.ok) throw new Error("pause failed");
    return { id, pauseId: result.data.pause.id };
  }

  test("a pause that started before today ends yesterday", async () => {
    const { id, pauseId } = await paused(-3, 5);
    expect(await resumeHabit({ id, pauseId })).toMatchObject({
      ok: true,
      data: { outcome: "ended", habit: { pause: null }, pause: { endDate: day(5) } },
    });
    expect(await livePauses(id)).toEqual([
      { startDate: day(-3), endDate: day(-1), reason: null, deleted: null },
    ]);
  });

  test("one that starts today or later is removed (soft)", async () => {
    for (const start of [0, 4]) {
      const { id, pauseId } = await paused(start, start + 3);
      expect(await resumeHabit({ id, pauseId })).toMatchObject({
        ok: true,
        data: { outcome: "removed", habit: { pause: null } },
      });
      expect(await livePauses(id)).toEqual([]);
      expect(await pausesOf(id)).toHaveLength(1);
    }
  });

  test("one that already ended stays as it is", async () => {
    const { id, pauseId } = await paused(-6, -2);
    expect(await resumeHabit({ id, pauseId })).toMatchObject({
      ok: true,
      data: { outcome: "none" },
    });
    expect(await livePauses(id)).toEqual([
      { startDate: day(-6), endDate: day(-2), reason: null, deleted: null },
    ]);
  });

  test("a pause of another habit, a removed one or a missing one: not found", async () => {
    const { id, pauseId } = await paused(0, 3);
    const other = await insertHabit({ name: "Otro" });
    expect(await resumeHabit({ id: other, pauseId })).toEqual({
      ok: false,
      error: PAUSE_ERRORS.notFound,
    });
    expect(await removeHabitPause({ id, pauseId })).toMatchObject({ ok: true });
    for (const call of [
      () => resumeHabit({ id, pauseId }),
      () => removeHabitPause({ id, pauseId }),
      () => resumeHabit({ id, pauseId: MISSING }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: PAUSE_ERRORS.notFound });
    }
  });

  test("waits for the habit's lock (first)", async () => {
    const { id, pauseId } = await paused(-2, 5);
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HABITS_ADVISORY_SPACE,
        id,
      ]);
      const pending = resumeHabit({ id, pauseId });
      await waitForLockWaiters(id, 1);
      expect((await livePauses(id))[0].endDate).toBe(day(5));
      await holder.query("commit");
      expect(await pending).toMatchObject({ ok: true, data: { outcome: "ended" } });
    } finally {
      holder.release();
    }
  });
});

describe("undo of resume and removal limits", () => {
  test("Deshacer of Reanudar: a pause from today to the old end, next to the ended one", async () => {
    const id = await insertHabit();
    const first = await pauseHabit({ id, startDate: day(-3), endDate: day(5), reason: "Viaje" });
    if (!first.ok) throw new Error("pause failed");
    expect(await resumeHabit({ id, pauseId: first.data.pause.id })).toMatchObject({
      ok: true,
      data: { outcome: "ended" },
    });
    const again = await pauseHabit({ id, startDate: day(0), endDate: day(5), reason: "Viaje" });
    expect(again).toMatchObject({ ok: true });
    expect(await livePauses(id)).toEqual([
      { startDate: day(-3), endDate: day(-1), reason: "Viaje", deleted: null },
      { startDate: day(0), endDate: day(5), reason: "Viaje", deleted: null },
    ]);
    expect((await itemOf(id))?.pause).toMatchObject({ startDate: day(0), endDate: day(5) });
    expect((await itemOf(id))?.recentPaused).toEqual([day(-3), day(-2), day(-1)]);
  });

  test("a pause can't start before the habit; an old pause can't be removed", async () => {
    const young = await insertHabit({ name: "Nuevo" }, 2);
    expect(await pauseHabit({ id: young, startDate: day(-3), endDate: day(1) })).toMatchObject({
      ok: false,
      fieldErrors: { startDate: [PAUSE_ERRORS.startOutOfWindow] },
    });
    // Positive control: from its start date.
    expect(await pauseHabit({ id: young, startDate: day(-2), endDate: day(1) })).toMatchObject({
      ok: true,
    });
    const id = await insertHabit({}, 60);
    const [old] = await testDb
      .insert(habitPauses)
      .values({ habitId: id, startDate: day(-40), endDate: day(-30) })
      .returning({ id: habitPauses.id });
    expect(await removeHabitPause({ id, pauseId: old.id })).toEqual({
      ok: false,
      error: PAUSE_ERRORS.notFound,
    });
    expect(await livePauses(id)).toHaveLength(1);
  });
});

describe("logging another day (up to 7 back)", () => {
  test("yesterday and 7 days back are fine; 8 back, the future and before the start are not", async () => {
    const id = await insertHabit({}, 7);
    for (const offset of [-1, -7]) {
      expect(await setHabitDone({ id, day: day(offset), done: true })).toMatchObject({
        ok: true,
        data: { quantity: 1 },
      });
    }
    for (const offset of [-8, 1]) {
      expect(await setHabitDone({ id, day: day(offset), done: true })).toEqual({
        ok: false,
        error: HABIT_ERRORS.dayOutOfWindow,
      });
    }
    const young = await insertHabit({ name: "Nuevo" }, 2);
    expect(await setHabitDone({ id: young, day: day(-3), done: true })).toEqual({
      ok: false,
      error: HABIT_ERRORS.dayOutOfWindow,
    });
    // Positive control: its start date itself.
    expect(await setHabitDone({ id: young, day: day(-2), done: true })).toMatchObject({
      ok: true,
    });
    const quantity = await insertHabit(
      { name: "Agua", measure: "quantity", goal: 8, unit: "vasos" },
      7,
    );
    expect(await setHabitQuantity({ id: quantity, day: day(-3), quantity: 6 })).toMatchObject({
      ok: true,
      data: { quantity: 6, target: 8 },
    });
    expect(await logHabit({ id: quantity, day: day(-8), delta: 1 })).toEqual({
      ok: false,
      error: HABIT_ERRORS.dayOutOfWindow,
    });
  });

  test("a logged earlier day moves today's streak and shows in recentLogs", async () => {
    const id = await insertHabit({}, 10);
    await mark(id, [day(-1), day(-3)]);
    expect((await itemOf(id))?.streak).toEqual({ unit: "days", done: 2, notDone: 1 });
    // Forgot the day before yesterday: logged now, the run joins.
    expect(await setHabitDone({ id, day: day(-2), done: true })).toMatchObject({ ok: true });
    const item = await itemOf(id);
    expect(item?.streak).toEqual({ unit: "days", done: 4, notDone: 3 });
    expect(item?.recentLogs.map((log) => log.day)).toEqual([day(-3), day(-2), day(-1)]);
  });

  test("a paused day can be logged but doesn't count", async () => {
    const id = await insertHabit({}, 10);
    await mark(id, [day(-1)]);
    expect(await pauseHabit({ id, startDate: day(-3), endDate: day(-2) })).toMatchObject({
      ok: true,
    });
    expect(await setHabitDone({ id, day: day(-2), done: true })).toMatchObject({ ok: true });
    // -2 and -3 are neutral: the streak is yesterday's alone (-4 is open).
    expect((await itemOf(id))?.streak).toEqual({ unit: "days", done: 2, notDone: 1 });
  });
});

describe("the streak fields of HabitItem", () => {
  test("older than 7 days: marked days are read, partial ones break (the SQL filter)", async () => {
    const run = Array.from({ length: 20 }, (_, index) => day(-20 + index));
    const daily = await insertHabit({}, 40);
    await mark(daily, run);
    expect((await itemOf(daily))?.streak).toEqual({ unit: "days", done: 21, notDone: 20 });
    const water = await insertHabit(
      { name: "Agua", measure: "quantity", goal: 8, unit: "vasos" },
      40,
    );
    await mark(
      water,
      run.filter((d) => d !== day(-10)),
      8,
      8,
    );
    await mark(water, [day(-10)], 3, 8);
    // 3 of 8 ten days ago is open: the run is the 9 days after it.
    expect((await itemOf(water))?.streak).toEqual({ unit: "days", done: 10, notDone: 9 });
    const avoid = await insertHabit({ name: "No fumar", kind: "avoid" }, 30);
    expect((await itemOf(avoid))?.streak).toEqual({ unit: "days", done: 31, notDone: 0 });
    await mark(avoid, [day(-12)]);
    expect((await itemOf(avoid))?.streak).toEqual({ unit: "days", done: 12, notDone: 0 });
    // An unmarked old relapse (0) is a clean day.
    await testDb
      .update(habitLogs)
      .set({ quantity: 0 })
      .where(and(eq(habitLogs.habitId, avoid), eq(habitLogs.day, day(-12))));
    expect((await itemOf(avoid))?.streak).toEqual({ unit: "days", done: 31, notDone: 0 });
  });

  test("a relapse logged yesterday on a habit to avoid: today alone", async () => {
    const id = await insertHabit({ name: "No fumar", kind: "avoid" }, 10);
    expect((await itemOf(id))?.streak.done).toBe(11);
    expect(await setHabitDone({ id, day: day(-1), done: true })).toMatchObject({ ok: true });
    expect((await itemOf(id))?.streak).toEqual({ unit: "days", done: 1, notDone: 0 });
    expect((await itemOf(id))?.recentLogs).toEqual([{ day: day(-1), quantity: 1, target: 1 }]);
  });

  test("streak, paused today, the week's available days and done days before today", async () => {
    const daily = await insertHabit({}, 20);
    await mark(daily, [day(-2), day(-1), day(0)]);
    await insertHabit({ name: "Gimnasio", frequency: "weekly_count", weeklyTarget: 3 }, 20);
    await insertHabit({ name: "No fumar", kind: "avoid" }, 4);
    const resting = await insertHabit({ name: "Correr" }, 20);
    await pauseHabit({ id: resting, startDate: day(-1), endDate: day(3), reason: "Viaje" });

    const items = await listActiveHabits(new Date());
    const byName = Object.fromEntries(items.map((item) => [item.name, item]));
    expect(byName.Leer.streak).toEqual({ unit: "days", done: 3, notDone: 2 });
    expect(byName.Gimnasio.streak.unit).toBe("weeks");
    expect(byName.Gimnasio.weekAvailable).toBe(7);
    // Started 4 days ago, no relapses: 5 clean days with today.
    expect(byName["No fumar"].streak).toEqual({ unit: "days", done: 5, notDone: 0 });
    expect(byName.Correr.pause).toMatchObject({
      startDate: day(-1),
      endDate: day(3),
      reason: "Viaje",
    });
    expect(byName.Correr.weekAvailable).toBeLessThan(7);
  });

  test("a paused day's log doesn't count in the week's done days", async () => {
    // Fixed days, so the week is known: Thursday 2026-10-08, Monday 2026-10-05.
    const [row] = await testDb
      .insert(habits)
      .values({
        name: "Gimnasio",
        measure: "check",
        frequency: "weekly_count",
        weeklyTarget: 3,
        startDate: "2026-09-01",
        sortOrder: 0,
      })
      .returning({ id: habits.id });
    await mark(row.id, ["2026-10-05", "2026-10-06", "2026-10-07"]);
    await testDb
      .insert(habitPauses)
      .values({ habitId: row.id, startDate: "2026-10-06", endDate: "2026-10-06" });
    const [item] = await selectActiveHabits(testDb, "2026-10-08");
    expect(item).toMatchObject({ weekDoneBefore: 2, weekAvailable: 6 });
  });

  test("a deleted habit's logs and pauses never show; a deleted pause is ignored", async () => {
    const id = await insertHabit({}, 5);
    await mark(id, [day(-1)]);
    await testDb
      .insert(habitPauses)
      .values({ habitId: id, startDate: day(0), endDate: day(2), deletedAt: new Date() });
    expect(await itemOf(id)).toMatchObject({ pause: null, streak: { done: 2, notDone: 1 } });
  });

  test("three queries, whatever the number of habits (no query per habit)", async () => {
    for (let index = 0; index < 6; index += 1) {
      const id = await insertHabit({ name: `H${index}` }, 20);
      await mark(id, [day(-2), day(-1)]);
      await testDb.insert(habitPauses).values({ habitId: id, startDate: day(1), endDate: day(2) });
    }
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const items = await selectActiveHabits(testDb, today());
    expect(items).toHaveLength(6);
    expect(items.every((item) => item.streak.notDone === 2 && item.pause !== null)).toBe(true);
    expect(select).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
    select.mockRestore();
    execute.mockRestore();
    // With none, one query.
    await testDb.update(habits).set({ archivedAt: new Date() }).where(isNull(habits.archivedAt));
    const empty = vi.spyOn(testDb, "select");
    expect(await selectActiveHabits(testDb, today())).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
    empty.mockRestore();
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every H4 action is refused and nothing changes", async (_, headers) => {
    const id = await insertHabit();
    const first = await pauseHabit({ id, startDate: day(3), endDate: day(4) });
    if (!first.ok) throw new Error("pause failed");
    const before = await pausesOf(id);
    request.headers = await headers();
    for (const call of [
      () => pauseHabit({ id, startDate: day(10), endDate: day(12) }),
      () => resumeHabit({ id, pauseId: first.data.pause.id }),
      () => removeHabitPause({ id, pauseId: first.data.pause.id }),
      () => setHabitDone({ id, day: day(-1), done: true }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await pausesOf(id)).toEqual(before);
    expect(
      await testDb.$count(habitLogs, and(eq(habitLogs.habitId, id), eq(habitLogs.day, day(-1)))),
    ).toBe(0);
    // Positive control: the owner's session still works.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect(await resumeHabit({ id, pauseId: first.data.pause.id })).toMatchObject({ ok: true });
  });
});

/** Waits until `count` connections wait on the habits advisory lock with this key. */
async function waitForLockWaiters(key: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_locks
       where locktype = 'advisory' and not granted and objsubid = 2
         and classid::bigint = $1::bigint
         and objid::bigint = (hashtext($2)::bigint & 4294967295)`,
      [HABITS_ADVISORY_SPACE, key],
    );
    if (result.rows[0].waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} lock waiters`);
}
