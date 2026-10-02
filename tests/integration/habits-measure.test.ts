// H3 of `habits` against the throwaway database: creating quantity habits and habits to avoid
// (with the CHECKs behind Zod), a quantity's tap (atomic delta, clamped to 0–99 999, the day's
// target), "Ajustar el día", a habit to avoid's relapse, a goal change (today on, under the
// habit's lock) and authorization.
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import { createHabit, deleteHabit } from "@/modules/habits/actions";
import { habitLogs, habits } from "@/modules/habits/db/schema";
import { HABIT_ERRORS } from "@/modules/habits/habit-input";
import { HABITS_ADVISORY_SPACE } from "@/modules/habits/habits";
import { logHabit, setHabitDone, setHabitQuantity } from "@/modules/habits/log-actions";
import { updateHabit } from "@/modules/habits/organize-actions";
import { MEASURE_ERRORS } from "@/modules/habits/measure-copy";
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
/** The actions log Lima's today by the real clock: so do the tests. */
const today = () => ownerDateKey(new Date());

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

async function create(input: Record<string, unknown>) {
  const result = await createHabit(input);
  if (!result.ok) throw new Error(`createHabit failed: ${JSON.stringify(result)}`);
  return result.data;
}

/** "Agua, 8 vasos al día", started a week ago (so earlier days can be logged). */
async function water(values: Record<string, unknown> = {}) {
  const habit = await create({
    name: "Agua",
    measure: "quantity",
    goal: 8,
    unit: "vasos",
    ...values,
  });
  await testDb
    .update(habits)
    .set({ startDate: addDays(today(), -7) })
    .where(eq(habits.id, habit.id));
  return habit;
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
  test("a quantity: goal, unit and step stored; the day's target is the goal", async () => {
    const habit = await create({
      name: "Correr",
      measure: "quantity",
      goal: 30,
      unit: " min ",
      step: 5,
    });
    expect(habit).toMatchObject({
      kind: "build",
      measure: "quantity",
      goal: 30,
      unit: "min",
      step: 5,
      frequency: "daily",
      quantity: 0,
      target: 30,
    });
    expect(await row(habit.id)).toMatchObject({ goal: 30, unit: "min", step: 5 });
  });

  test("'varias veces al día' is a daily quantity in veces", async () => {
    const habit = await create({
      name: "Medicación",
      measure: "quantity",
      goal: 2,
      unit: "veces",
      step: 1,
    });
    expect(habit).toMatchObject({
      frequency: "daily",
      measure: "quantity",
      goal: 2,
      unit: "veces",
    });
  });

  test("a habit to avoid is a daily yes/no; a quantity for it is refused", async () => {
    const habit = await create({ name: "No fumar", kind: "avoid" });
    expect(await row(habit.id)).toMatchObject({
      kind: "avoid",
      measure: "check",
      goal: 1,
      unit: null,
      step: 1,
      frequency: "daily",
    });
    expect(
      await createHabit({
        name: "Cafés",
        kind: "avoid",
        measure: "quantity",
        goal: 2,
        unit: "tazas",
      }),
    ).toMatchObject({ ok: false, fieldErrors: { measure: [MEASURE_ERRORS.avoidMeasure] } });
    expect(
      await createHabit({ name: "Agua", measure: "quantity", goal: 4, unit: "vasos", step: 5 }),
    ).toMatchObject({ ok: false, fieldErrors: { step: [MEASURE_ERRORS.stepTooBig] } });
    expect(await testDb.$count(habits)).toBe(1);
  });
});

describe("CHECKs behind Zod (raw writes)", () => {
  /** The constraint a raw statement breaks, or null. */
  async function violation(run: () => Promise<unknown>) {
    try {
      await run();
    } catch (error) {
      return (error as { cause?: { constraint?: string } }).cause?.constraint ?? "unknown";
    }
    return null;
  }

  test("turning a habit to avoid into a quantity or a weekly one is refused", async () => {
    const habit = await create({ name: "No fumar", kind: "avoid" });
    const set = (values: Partial<typeof habits.$inferInsert>) => () =>
      testDb.update(habits).set(values).where(eq(habits.id, habit.id));
    expect(await violation(set({ measure: "quantity", goal: 2, unit: "cig" }))).toBe(
      "habits_avoid_check",
    );
    expect(await violation(set({ frequency: "weekly_count", weeklyTarget: 3 }))).toBe(
      "habits_avoid_check",
    );
    // Positive control: renaming it is fine.
    expect(await violation(set({ name: "No fumar nunca" }))).toBeNull();
  });

  test("a quantity's fields: a unit, goal 1–10 000, step 1–goal; a log 0–99 999, target ≥ 1", async () => {
    const habit = await water();
    const set = (values: Partial<typeof habits.$inferInsert>) => () =>
      testDb.update(habits).set(values).where(eq(habits.id, habit.id));
    expect(await violation(set({ unit: null }))).toBe("habits_measure_rule_check");
    expect(await violation(set({ goal: 10_001 }))).toBe("habits_measure_rule_check");
    expect(await violation(set({ step: 9 }))).toBe("habits_measure_rule_check");
    expect(await violation(set({ goal: 10_000, step: 10_000 }))).toBeNull();
    const log = (quantity: number, target: number) => () =>
      testDb.insert(habitLogs).values({ habitId: habit.id, day: today(), quantity, target });
    expect(await violation(log(100_000, 8))).toBe("habit_logs_quantity_check");
    expect(await violation(log(-1, 8))).toBe("habit_logs_quantity_check");
    expect(await violation(log(3, 0))).toBe("habit_logs_target_check");
    expect(await violation(log(99_999, 8))).toBeNull();
  });

  test("a habit to avoid inserted raw: only a daily yes/no", async () => {
    const insert = (values: Partial<typeof habits.$inferInsert>) => () =>
      testDb.insert(habits).values({
        name: "No fumar",
        kind: "avoid",
        measure: "check",
        frequency: "daily",
        startDate: today(),
        sortOrder: 0,
        ...values,
      });
    expect(await violation(insert({ measure: "quantity", goal: 2, unit: "cig" }))).toBe(
      "habits_avoid_check",
    );
    expect(await violation(insert({ frequency: "weekly_count", weeklyTarget: 3 }))).toBe(
      "habits_avoid_check",
    );
    expect(await violation(insert({ frequency: "weekdays", weekdays: [1, 3] }))).toBe(
      "habits_avoid_check",
    );
    // Positive control: a daily yes/no to avoid is stored.
    expect(await violation(insert({}))).toBeNull();
  });
});

describe("a quantity's tap (logHabit)", () => {
  test("adds the delta to the day, storing the goal in force as its target", async () => {
    const habit = await water();
    expect(await logHabit({ id: habit.id, day: today(), delta: 1 })).toMatchObject({
      ok: true,
      data: { quantity: 1, target: 8 },
    });
    expect(await logHabit({ id: habit.id, day: today(), delta: 3 })).toMatchObject({
      ok: true,
      data: { quantity: 4, target: 8, hasLogs: true },
    });
    // "Deshacer" subtracts the same delta.
    expect(await logHabit({ id: habit.id, day: today(), delta: -3 })).toMatchObject({
      ok: true,
      data: { quantity: 1 },
    });
    expect(await logs(habit.id)).toEqual([{ day: today(), quantity: 1, target: 8 }]);
    expect(revalidatePath).toHaveBeenCalledWith("/habits", "layout");
  });

  test("taps at the same time add up (atomic upsert, no lost update)", async () => {
    const habit = await water();
    const holder = await testDb.$client.connect();
    let taps: Awaited<ReturnType<typeof logHabit>>[];
    try {
      // Hold every tap at its FOR SHARE read, then let them race to the upsert together.
      await holder.query("begin");
      await holder.query("select id from habits where id = $1 for update", [habit.id]);
      const pending = Array.from({ length: 4 }, () =>
        logHabit({ id: habit.id, day: today(), delta: 1 }),
      );
      await waitForBlockedBackends(4);
      await holder.query("commit");
      taps = await Promise.all(pending);
    } finally {
      holder.release();
    }
    expect(taps.every((result) => result.ok)).toBe(true);
    expect(await logs(habit.id)).toEqual([{ day: today(), quantity: 4, target: 8 }]);
  });

  test("clamped to 0–99 999: past the goal is fine, never below 0 or above the max", async () => {
    const habit = await water({ goal: 10_000, step: 10_000 });
    expect(await logHabit({ id: habit.id, day: today(), delta: -5 })).toMatchObject({
      ok: true,
      data: { quantity: 0 },
    });
    for (let tap = 0; tap < 11; tap++) {
      expect((await logHabit({ id: habit.id, day: today(), delta: 10_000 })).ok).toBe(true);
    }
    expect(await logs(habit.id)).toEqual([{ day: today(), quantity: 99_999, target: 10_000 }]);
    expect(await logHabit({ id: habit.id, day: today(), delta: -10_000 })).toMatchObject({
      ok: true,
      data: { quantity: 89_999 },
    });
  });

  test("the 7-day window from the start date; never the future", async () => {
    const habit = await water();
    expect(await logHabit({ id: habit.id, day: addDays(today(), -7), delta: 2 })).toMatchObject({
      ok: true,
      data: { quantity: 2 },
    });
    for (const day of [addDays(today(), -8), addDays(today(), 1)]) {
      expect(await logHabit({ id: habit.id, day, delta: 1 })).toEqual({
        ok: false,
        error: HABIT_ERRORS.dayOutOfWindow,
      });
    }
    expect(await logs(habit.id)).toHaveLength(1);
  });

  test("a yes/no, a deleted, an archived or a missing habit is refused", async () => {
    const check = await create({ name: "Leer" });
    expect(await logHabit({ id: check.id, day: today(), delta: 1 })).toEqual({
      ok: false,
      error: MEASURE_ERRORS.notQuantity,
    });
    const avoid = await create({ name: "No fumar", kind: "avoid" });
    expect(await logHabit({ id: avoid.id, day: today(), delta: 1 })).toEqual({
      ok: false,
      error: MEASURE_ERRORS.notQuantity,
    });
    expect(await setHabitQuantity({ id: avoid.id, day: today(), quantity: 2 })).toEqual({
      ok: false,
      error: MEASURE_ERRORS.notQuantity,
    });
    // …and a quantity can't be marked as a yes/no.
    const habit = await water();
    expect(await setHabitDone({ id: habit.id, day: today(), done: true })).toEqual({
      ok: false,
      error: HABIT_ERRORS.measureMismatch,
    });
    await testDb
      .update(habits)
      .set({ archivedAt: sql`now()` })
      .where(eq(habits.id, habit.id));
    expect(await logHabit({ id: habit.id, day: today(), delta: 1 })).toEqual({
      ok: false,
      error: HABIT_ERRORS.archived,
    });
    await testDb.update(habits).set({ archivedAt: null }).where(eq(habits.id, habit.id));
    await deleteHabit({ id: habit.id });
    expect(await logHabit({ id: habit.id, day: today(), delta: 1 })).toEqual({
      ok: false,
      error: HABIT_ERRORS.notFound,
    });
    expect(await logHabit({ id: MISSING, day: today(), delta: 1 })).toEqual({
      ok: false,
      error: HABIT_ERRORS.notFound,
    });
    expect(await testDb.$count(habitLogs)).toBe(0);
    // Invalid input never reaches the database.
    expect(await logHabit({ id: check.id, day: today(), delta: 0 })).toMatchObject({ ok: false });
  });
});

describe("Ajustar el día (setHabitQuantity)", () => {
  test("sets the exact value (also down to 0); the row stays, with its target", async () => {
    const habit = await water();
    await logHabit({ id: habit.id, day: today(), delta: 5 });
    expect(await setHabitQuantity({ id: habit.id, day: today(), quantity: 2 })).toMatchObject({
      ok: true,
      data: { quantity: 2, target: 8 },
    });
    expect(await setHabitQuantity({ id: habit.id, day: today(), quantity: 0 })).toMatchObject({
      ok: true,
      data: { quantity: 0, hasLogs: true },
    });
    expect(await logs(habit.id)).toEqual([{ day: today(), quantity: 0, target: 8 }]);
    // A past day within the window too (H4's calendar uses it).
    expect(
      await setHabitQuantity({ id: habit.id, day: addDays(today(), -2), quantity: 9 }),
    ).toMatchObject({ ok: true, data: { quantity: 9, target: 8 } });
  });

  test("0–99 999 and the window; a yes/no is refused", async () => {
    const habit = await water();
    expect(await setHabitQuantity({ id: habit.id, day: today(), quantity: 100_000 })).toMatchObject(
      { ok: false, fieldErrors: { quantity: [MEASURE_ERRORS.quantityInvalid] } },
    );
    expect(
      await setHabitQuantity({ id: habit.id, day: addDays(today(), -8), quantity: 1 }),
    ).toEqual({ ok: false, error: HABIT_ERRORS.dayOutOfWindow });
    const check = await create({ name: "Leer" });
    expect(await setHabitQuantity({ id: check.id, day: today(), quantity: 1 })).toEqual({
      ok: false,
      error: MEASURE_ERRORS.notQuantity,
    });
    expect(await testDb.$count(habitLogs)).toBe(0);
  });
});

describe("a habit to avoid", () => {
  test("a relapse is a yes/no day: logged, undone, idempotent; done means clean", async () => {
    const habit = await create({ name: "No fumar", kind: "avoid" });
    let [item] = await listActiveHabits(new Date());
    expect(item).toMatchObject({ kind: "avoid", quantity: 0 });
    expect(await setHabitDone({ id: habit.id, day: today(), done: true })).toMatchObject({
      ok: true,
      data: { quantity: 1 },
    });
    expect(await setHabitDone({ id: habit.id, day: today(), done: true })).toMatchObject({
      ok: true,
      data: { quantity: 1 },
    });
    [item] = await listActiveHabits(new Date());
    expect(item.quantity).toBe(1);
    expect(await setHabitDone({ id: habit.id, day: today(), done: false })).toMatchObject({
      ok: true,
      data: { quantity: 0 },
    });
    expect(await logs(habit.id)).toEqual([{ day: today(), quantity: 0, target: 1 }]);
  });
});

/** An edit (H2's `updateHabit`) that changes only a quantity's measure fields. */
function updateHabitMeasure(input: { id: string; goal: number; unit: string; step?: number }) {
  return updateHabit({ name: "Agua", lifeAreaId: null, frequency: "daily", ...input });
}

describe("a goal change (editing a quantity)", () => {
  test("only today on takes the new target; past days keep theirs", async () => {
    const habit = await water();
    await logHabit({ id: habit.id, day: addDays(today(), -2), delta: 8 });
    await logHabit({ id: habit.id, day: addDays(today(), -1), delta: 5 });
    await logHabit({ id: habit.id, day: today(), delta: 9 });
    const result = await updateHabitMeasure({ id: habit.id, goal: 10, unit: "vasos", step: 2 });
    expect(result).toMatchObject({
      ok: true,
      data: { goal: 10, step: 2, quantity: 9, target: 10 },
    });
    expect(await logs(habit.id)).toEqual([
      { day: addDays(today(), -2), quantity: 8, target: 8 },
      { day: addDays(today(), -1), quantity: 5, target: 8 },
      { day: today(), quantity: 9, target: 10 },
    ]);
    // A new day's first tap stores the new goal.
    expect(await row(habit.id)).toMatchObject({ goal: 10, unit: "vasos", step: 2 });
  });

  test("lowering the goal never undoes a past day; a later log of today keeps the new one", async () => {
    const habit = await water();
    await logHabit({ id: habit.id, day: addDays(today(), -1), delta: 4 });
    await updateHabitMeasure({ id: habit.id, goal: 4, unit: "vasos" });
    // Yesterday kept its 8: 4 of 8 is not done, even with today's goal at 4.
    expect((await logs(habit.id))[0]).toEqual({
      day: addDays(today(), -1),
      quantity: 4,
      target: 8,
    });
    expect(await logHabit({ id: habit.id, day: today(), delta: 4 })).toMatchObject({
      ok: true,
      data: { quantity: 4, target: 4 },
    });
  });

  test("an archived habit isn't edited (H2's rule): its goal and targets stay", async () => {
    const habit = await water();
    await logHabit({ id: habit.id, day: today(), delta: 2 });
    await testDb
      .update(habits)
      .set({ archivedAt: sql`now()` })
      .where(eq(habits.id, habit.id));
    expect(await updateHabitMeasure({ id: habit.id, goal: 5, unit: "vasos" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/archivado/),
    });
    expect(await logs(habit.id)).toEqual([{ day: today(), quantity: 2, target: 8 }]);
  });

  test("an edit keeps a habit to avoid daily; its name still changes", async () => {
    const habit = await create({ name: "No fumar", kind: "avoid" });
    expect(
      await updateHabit({
        id: habit.id,
        name: "No fumar",
        lifeAreaId: null,
        frequency: "weekly_count",
        weeklyTarget: 3,
      }),
    ).toMatchObject({ ok: false, fieldErrors: { frequency: [MEASURE_ERRORS.avoidDaily] } });
    expect((await row(habit.id)).frequency).toBe("daily");
    // Positive control: a daily edit goes through.
    expect(
      await updateHabit({
        id: habit.id,
        name: "No fumar nunca",
        lifeAreaId: null,
        frequency: "daily",
      }),
    ).toMatchObject({ ok: true, data: { name: "No fumar nunca", frequency: "daily" } });
  });

  test("a yes/no's, a deleted or a bad one is refused", async () => {
    const check = await create({ name: "Leer" });
    expect(await updateHabitMeasure({ id: check.id, goal: 3, unit: "veces" })).toEqual({
      ok: false,
      error: MEASURE_ERRORS.notQuantity,
    });
    const habit = await water();
    expect(
      await updateHabitMeasure({ id: habit.id, goal: 3, unit: "vasos", step: 4 }),
    ).toMatchObject({ ok: false, fieldErrors: { step: [MEASURE_ERRORS.stepTooBig] } });
    await deleteHabit({ id: habit.id });
    expect(await updateHabitMeasure({ id: habit.id, goal: 3, unit: "vasos" })).toEqual({
      ok: false,
      error: HABIT_ERRORS.notFound,
    });
    expect((await row(habit.id)).goal).toBe(8);
  });

  test("waits for the habit's lock (first); a tap doesn't take it", async () => {
    const habit = await water();
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HABITS_ADVISORY_SPACE,
        habit.id,
      ]);
      // Positive control: a tap goes through while the habit's lock is held.
      expect(await logHabit({ id: habit.id, day: today(), delta: 1 })).toMatchObject({ ok: true });
      const pending = updateHabitMeasure({ id: habit.id, goal: 12, unit: "vasos" });
      await waitForLockWaiters(habit.id, 1);
      expect((await row(habit.id)).goal).toBe(8);
      await holder.query("commit");
      expect(await pending).toMatchObject({ ok: true, data: { target: 12 } });
    } finally {
      holder.release();
    }
    expect(await logs(habit.id)).toEqual([{ day: today(), quantity: 1, target: 12 }]);
  });

  test("a tap waits for a goal change in flight (FOR UPDATE) and stores the new target", async () => {
    const habit = await water();
    const holder = await testDb.$client.connect();
    try {
      // Holds the goal change after it locked the habit's row, before it commits.
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HABITS_ADVISORY_SPACE,
        habit.id,
      ]);
      await holder.query("select id from habits where id = $1 for update", [habit.id]);
      await holder.query("update habits set goal = 12 where id = $1", [habit.id]);
      const tapping = logHabit({ id: habit.id, day: today(), delta: 1 });
      await waitForBlockedBackends(1);
      await holder.query("commit");
      expect(await tapping).toMatchObject({ ok: true, data: { quantity: 1, target: 12 } });
    } finally {
      holder.release();
    }
    expect(
      await testDb
        .select({ target: habitLogs.target })
        .from(habitLogs)
        .where(and(eq(habitLogs.habitId, habit.id), eq(habitLogs.day, today()))),
    ).toEqual([{ target: 12 }]);
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
  ])("with %s every H3 action is refused and nothing changes", async (_, headers) => {
    const habit = await water();
    const before = await row(habit.id);
    request.headers = await headers();
    for (const call of [
      () => createHabit({ name: "Otro", measure: "quantity", goal: 2, unit: "veces" }),
      () => logHabit({ id: habit.id, day: today(), delta: 1 }),
      () => setHabitQuantity({ id: habit.id, day: today(), quantity: 3 }),
      () => updateHabitMeasure({ id: habit.id, goal: 3, unit: "vasos" }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await row(habit.id)).toEqual(before);
    expect(await testDb.$count(habits)).toBe(1);
    expect(await testDb.$count(habitLogs)).toBe(0);
    // Positive control: the owner's session still works.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect(await logHabit({ id: habit.id, day: today(), delta: 1 })).toMatchObject({ ok: true });
  });
});
