// H1 of `habits` against the throwaway database: create (order lock, area check), log a yes/no
// day (idempotent upsert, the 7-day window, concurrent taps), soft delete and undo with
// `visibleHabit`, the advisory locks and authorization.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { createHabit, deleteHabit, restoreHabit } from "@/modules/habits/actions";
import { habitLogs, habits } from "@/modules/habits/db/schema";
import { HABIT_ERRORS } from "@/modules/habits/habit-input";
import {
  HABITS_ADVISORY_SPACE,
  HABITS_ORDER_KEY,
  ofVisibleHabit,
  selectHabitItemById,
} from "@/modules/habits/habits";
import { setHabitDone } from "@/modules/habits/log-actions";
import { listActiveHabits } from "@/modules/habits/queries";
import { addDays } from "@/modules/habits/schedule";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

// The actions read the request headers (session cookie) and the app database: point both at
// the test, and record revalidations instead of touching Next's cache.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const MISSING = "00000000-0000-4000-8000-000000000000";
/** The actions log Lima's today by the real clock: so do the tests. */
const today = () => ownerDateKey(new Date());

async function areaId(slug: string): Promise<string> {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, slug));
  return area.id;
}

async function row(id: string) {
  const [found] = await testDb.select().from(habits).where(eq(habits.id, id));
  return found;
}

async function logs(id: string) {
  return testDb
    .select({ day: habitLogs.day, quantity: habitLogs.quantity, target: habitLogs.target })
    .from(habitLogs)
    .where(eq(habitLogs.habitId, id))
    .orderBy(habitLogs.day);
}

/** Creates a habit through the action and returns it (fails the test otherwise). */
async function create(input: Record<string, unknown>) {
  const result = await createHabit(input);
  if (!result.ok) throw new Error(`createHabit failed: ${JSON.stringify(result)}`);
  return result.data;
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
});

describe("create", () => {
  test("a name alone: a daily yes/no habit to keep, from today, without an area", async () => {
    const habit = await create({ name: "  Meditar   10 min " });
    expect(habit).toMatchObject({
      name: "Meditar 10 min",
      kind: "build",
      measure: "check",
      goal: 1,
      unit: null,
      step: 1,
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
      startDate: today(),
      area: null,
      quantity: 0,
      target: 1,
      hasLogs: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/habits", "layout");
    expect((await listActiveHabits(new Date())).map((item) => item.id)).toEqual([habit.id]);
  });

  test("with an active area; an archived or missing one is refused on its field", async () => {
    const health = await areaId("health");
    const habit = await create({ name: "Caminar", lifeAreaId: health });
    expect(habit.area).toMatchObject({ id: health, slug: "health", color: "health" });

    await testDb
      .update(lifeAreas)
      .set({ archivedAt: new Date() })
      .where(eq(lifeAreas.id, await areaId("work")));
    for (const lifeAreaId of [await areaId("work"), MISSING]) {
      expect(await createHabit({ name: "Leer", lifeAreaId })).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { lifeAreaId: [HABIT_ERRORS.areaUnavailable] },
      });
    }
    expect(await testDb.$count(habits)).toBe(1);
    // Refused or not, the page is revalidated (its areas were out of date).
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });

  test("invalid input writes nothing", async () => {
    expect(await createHabit({ name: "" })).toMatchObject({
      ok: false,
      fieldErrors: { name: [HABIT_ERRORS.nameRequired] },
    });
    expect(await createHabit({ name: "x", lifeAreaId: "salud" })).toMatchObject({
      ok: false,
      fieldErrors: { lifeAreaId: [HABIT_ERRORS.area] },
    });
    expect(await testDb.$count(habits)).toBe(0);
  });

  test("a new habit goes last, after deleted and archived ones too", async () => {
    const first = await create({ name: "Uno" });
    const second = await create({ name: "Dos" });
    await deleteHabit({ id: first.id });
    await testDb.update(habits).set({ archivedAt: new Date() }).where(eq(habits.id, second.id));
    const third = await create({ name: "Tres" });
    expect(
      [await row(first.id), await row(second.id), await row(third.id)].map((r) => r.sortOrder),
    ).toEqual([0, 1, 2]);
    // Restored, the first one is back in its place: first.
    await restoreHabit({ id: first.id });
    expect((await listActiveHabits(new Date())).map((item) => item.name)).toEqual(["Uno", "Tres"]);
  });

  test("two creates at once never share a place (the order lock)", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) => createHabit({ name: `H${index}` })),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const orders = (await testDb.select({ sortOrder: habits.sortOrder }).from(habits)).map(
      (r) => r.sortOrder,
    );
    expect([...orders].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("log a yes/no day (setHabitDone)", () => {
  test("marking is an upsert: twice keeps one row, unmarking keeps it with 0", async () => {
    const habit = await create({ name: "Meditar" });
    const day = today();
    const marked = await setHabitDone({ id: habit.id, day, done: true });
    expect(marked).toMatchObject({
      ok: true,
      data: { id: habit.id, quantity: 1, target: 1, hasLogs: true },
    });
    expect(revalidatePath).toHaveBeenLastCalledWith("/habits", "layout");
    expect(await setHabitDone({ id: habit.id, day, done: true })).toMatchObject({
      ok: true,
      data: { quantity: 1 },
    });
    expect(await logs(habit.id)).toEqual([{ day, quantity: 1, target: 1 }]);

    expect(await setHabitDone({ id: habit.id, day, done: false })).toMatchObject({
      ok: true,
      // Unmarked, but the day was logged: it still "has logs" (deleting it asks first).
      data: { quantity: 0, hasLogs: true },
    });
    expect(await setHabitDone({ id: habit.id, day, done: false })).toMatchObject({ ok: true });
    // Rows are never deleted: unmarked is quantity 0.
    expect(await logs(habit.id)).toEqual([{ day, quantity: 0, target: 1 }]);
    expect((await listActiveHabits(new Date()))[0]).toMatchObject({ quantity: 0, hasLogs: true });
  });

  test("two taps at once: one row, marked (idempotent under concurrency)", async () => {
    const habit = await create({ name: "Leer" });
    const day = today();
    const results = await Promise.all([
      setHabitDone({ id: habit.id, day, done: true }),
      setHabitDone({ id: habit.id, day, done: true }),
      setHabitDone({ id: habit.id, day, done: true }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await logs(habit.id)).toEqual([{ day, quantity: 1, target: 1 }]);
  });

  test("mark and unmark at once: both succeed and the row is one of the two states", async () => {
    const habit = await create({ name: "Leer" });
    const day = today();
    const results = await Promise.all([
      setHabitDone({ id: habit.id, day, done: true }),
      setHabitDone({ id: habit.id, day, done: false }),
    ]);
    // Each call reports its own write (the upsert returns the state it left).
    expect(results).toMatchObject([
      { ok: true, data: { quantity: 1 } },
      { ok: true, data: { quantity: 0 } },
    ]);
    const stored = await logs(habit.id);
    expect(stored).toHaveLength(1);
    // The last to commit wins: one of the two states, never a sum or a second row.
    expect([0, 1]).toContain(stored[0].quantity);
  });

  test("the window: today and the 7 days before, from the start date; never the future", async () => {
    const habit = await create({ name: "Estirar" });
    // Started 30 days ago, so only the window limits it.
    await testDb
      .update(habits)
      .set({ startDate: addDays(today(), -30) })
      .where(eq(habits.id, habit.id));
    const outside = { ok: false, error: HABIT_ERRORS.dayOutOfWindow };
    expect(
      await setHabitDone({ id: habit.id, day: addDays(today(), -7), done: true }),
    ).toMatchObject({
      ok: true,
      data: { quantity: 1 },
    });
    expect(await setHabitDone({ id: habit.id, day: addDays(today(), -8), done: true })).toEqual(
      outside,
    );
    expect(await setHabitDone({ id: habit.id, day: addDays(today(), 1), done: true })).toEqual(
      outside,
    );
    // Before its start date, inside the window: refused too.
    await testDb.update(habits).set({ startDate: today() }).where(eq(habits.id, habit.id));
    expect(await setHabitDone({ id: habit.id, day: addDays(today(), -1), done: true })).toEqual(
      outside,
    );
    expect((await logs(habit.id)).map((log) => log.day)).toEqual([addDays(today(), -7)]);
  });

  test("an archived, deleted, missing or quantity habit is refused", async () => {
    const archived = await create({ name: "Archivado" });
    await testDb.update(habits).set({ archivedAt: new Date() }).where(eq(habits.id, archived.id));
    expect(await setHabitDone({ id: archived.id, day: today(), done: true })).toEqual({
      ok: false,
      error: HABIT_ERRORS.archived,
    });
    const removed = await create({ name: "Eliminado" });
    await deleteHabit({ id: removed.id });
    expect(await setHabitDone({ id: removed.id, day: today(), done: true })).toEqual({
      ok: false,
      error: HABIT_ERRORS.notFound,
    });
    expect(await setHabitDone({ id: MISSING, day: today(), done: true })).toEqual({
      ok: false,
      error: HABIT_ERRORS.notFound,
    });
    const quantity = await create({ name: "Agua" });
    await testDb
      .update(habits)
      .set({ measure: "quantity", goal: 8, unit: "vasos" })
      .where(eq(habits.id, quantity.id));
    expect(await setHabitDone({ id: quantity.id, day: today(), done: true })).toEqual({
      ok: false,
      error: HABIT_ERRORS.measureMismatch,
    });
    expect(await testDb.$count(habitLogs)).toBe(0);
  });
});

describe("Lima's day, not UTC's", () => {
  // 23:30 in Lima on Oct 2 is already Oct 3 in UTC. Only Date is faked; set before the session.
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T04:30:00.000Z"));
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("at 23:30 in Lima a habit starts and logs on the 2nd; the 3rd is the future", async () => {
    const habit = await create({ name: "Leer" });
    expect(habit.startDate).toBe("2026-10-02");
    expect(await setHabitDone({ id: habit.id, day: "2026-10-03", done: true })).toEqual({
      ok: false,
      error: HABIT_ERRORS.dayOutOfWindow,
    });
    expect(await setHabitDone({ id: habit.id, day: "2026-10-02", done: true })).toMatchObject({
      ok: true,
    });
    expect((await listActiveHabits(new Date()))[0]).toMatchObject({ id: habit.id, quantity: 1 });
  });
});

describe("soft delete and undo", () => {
  test("deleted: out of every read with its logs, kept in the table; restored with them", async () => {
    const habit = await create({ name: "Meditar" });
    const other = await create({ name: "Leer" });
    await setHabitDone({ id: habit.id, day: today(), done: true });

    expect(await deleteHabit({ id: habit.id })).toEqual({
      ok: true,
      data: { id: habit.id, name: "Meditar" },
    });
    expect(revalidatePath).toHaveBeenLastCalledWith("/habits", "layout");
    expect((await row(habit.id)).deletedAt).not.toBeNull();
    expect((await listActiveHabits(new Date())).map((item) => item.id)).toEqual([other.id]);
    expect(await selectHabitItemById(testDb, habit.id, today())).toBeNull();
    // Its logs stay in the table, but reads through `ofVisibleHabit` don't see them.
    expect(await testDb.$count(habitLogs)).toBe(1);
    const visibleLogs = () =>
      testDb.$count(
        habitLogs,
        and(eq(habitLogs.habitId, habit.id), ofVisibleHabit(habitLogs.habitId)),
      );
    expect(await visibleLogs()).toBe(0);
    // Twice: not found (nothing left to delete).
    expect(await deleteHabit({ id: habit.id })).toEqual({
      ok: false,
      error: HABIT_ERRORS.notFound,
    });

    const restored = await restoreHabit({ id: habit.id });
    expect(restored).toMatchObject({
      ok: true,
      data: { id: habit.id, quantity: 1, hasLogs: true },
    });
    expect(await visibleLogs()).toBe(1);
    expect((await listActiveHabits(new Date())).map((item) => item.id)).toEqual([
      habit.id,
      other.id,
    ]);
    // Restoring twice is not an error; a missing habit is.
    expect(await restoreHabit({ id: habit.id })).toMatchObject({ ok: true });
    expect(await restoreHabit({ id: MISSING })).toEqual({
      ok: false,
      error: HABIT_ERRORS.notFound,
    });
  });
});

describe("locks", () => {
  test("delete waits for the order lock; logging a day doesn't take it", async () => {
    const habit = await create({ name: "Meditar" });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HABITS_ADVISORY_SPACE,
        HABITS_ORDER_KEY,
      ]);
      // Positive control first: a log goes through while the order lock is held.
      expect(await setHabitDone({ id: habit.id, day: today(), done: true })).toMatchObject({
        ok: true,
      });
      const pending = deleteHabit({ id: habit.id });
      await waitForLockWaiters(HABITS_ORDER_KEY, 1);
      expect((await row(habit.id)).deletedAt).toBeNull();
      await holder.query("commit");
      expect(await pending).toMatchObject({ ok: true });
    } finally {
      holder.release();
    }
    expect((await row(habit.id)).deletedAt).not.toBeNull();
  });

  test("create and restore wait for the order lock too", async () => {
    const deleted = await create({ name: "Borrado" });
    await deleteHabit({ id: deleted.id });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HABITS_ADVISORY_SPACE,
        HABITS_ORDER_KEY,
      ]);
      const creating = createHabit({ name: "Nuevo" });
      const restoring = restoreHabit({ id: deleted.id });
      await waitForLockWaiters(HABITS_ORDER_KEY, 2);
      expect(await testDb.$count(habits)).toBe(1);
      expect((await row(deleted.id)).deletedAt).not.toBeNull();
      await holder.query("commit");
      expect(await creating).toMatchObject({ ok: true });
      expect(await restoring).toMatchObject({ ok: true });
    } finally {
      holder.release();
    }
    expect(await testDb.$count(habits)).toBe(2);
  });

  test("delete waits for the habit's own lock; creating another habit doesn't", async () => {
    const habit = await create({ name: "Meditar" });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HABITS_ADVISORY_SPACE,
        habit.id,
      ]);
      // Positive control: the order lock is free, so a create goes through.
      expect(await createHabit({ name: "Otro" })).toMatchObject({ ok: true });
      const pending = deleteHabit({ id: habit.id });
      await waitForLockWaiters(habit.id, 1);
      expect((await row(habit.id)).deletedAt).toBeNull();
      await holder.query("commit");
      expect(await pending).toMatchObject({ ok: true });
    } finally {
      holder.release();
    }
    expect((await row(habit.id)).deletedAt).not.toBeNull();
  });

  test("an area archived while a create checks it: the create waits (FOR SHARE) and is refused", async () => {
    const health = await areaId("health");
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("update core_life_areas set archived_at = now() where id = $1", [health]);
      const pending = createHabit({ name: "Caminar", lifeAreaId: health });
      await waitForBlockedBackends(1);
      await holder.query("commit");
      expect(await pending).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { lifeAreaId: [HABIT_ERRORS.areaUnavailable] },
      });
    } finally {
      holder.release();
    }
    expect(await testDb.$count(habits)).toBe(0);
  });

  test("a delete waits for a log that read the habit (FOR SHARE), then wins", async () => {
    const habit = await create({ name: "Meditar" });
    const holder = await testDb.$client.connect();
    try {
      // Stalls the log at its upsert, after it has read (and FOR SHARE-locked) the habit.
      await holder.query("begin");
      await holder.query("lock table habit_logs in exclusive mode");
      const logging = setHabitDone({ id: habit.id, day: today(), done: true });
      await waitForBlockedBackends(1);
      const deleting = deleteHabit({ id: habit.id });
      // The delete's UPDATE waits for the log's FOR SHARE: two blocked backends.
      await waitForBlockedBackends(2);
      await holder.query("commit");
      expect(await logging).toMatchObject({ ok: true, data: { quantity: 1 } });
      expect(await deleting).toMatchObject({ ok: true });
    } finally {
      holder.release();
    }
    expect(await logs(habit.id)).toHaveLength(1);
    expect((await row(habit.id)).deletedAt).not.toBeNull();
  });
});

/** Waits until `count` backends of this database are blocked on a lock (any kind). */
async function waitForBlockedBackends(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ blocked: number }>(
      `select count(*)::int as blocked from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (result.rows[0].blocked >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} blocked backends`);
}

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

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every action is refused and nothing changes", async (_, headers) => {
    const habit = await create({ name: "Meditar" });
    const before = await row(habit.id);
    request.headers = await headers();
    for (const call of [
      () => createHabit({ name: "Otro" }),
      () => setHabitDone({ id: habit.id, day: today(), done: true }),
      () => deleteHabit({ id: habit.id }),
      () => restoreHabit({ id: habit.id }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await row(habit.id)).toEqual(before);
    expect(await testDb.$count(habits)).toBe(1);
    expect(await testDb.$count(habitLogs)).toBe(0);
    // Positive control: the owner's session still works.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect(await setHabitDone({ id: habit.id, day: today(), done: true })).toMatchObject({
      ok: true,
    });
  });

  test("the read redirects to /login without a session", async () => {
    request.headers = new Headers();
    await expect(listActiveHabits(new Date())).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
