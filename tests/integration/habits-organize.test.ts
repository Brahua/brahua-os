// H2 of `habits` against the throwaway database: create with every frequency, edit (frequency,
// area rules, never the measure), the week's done days, archive and reactivate, the manual order
// under the order lock, the CHECK behind a raw frequency change, and authorization.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { createHabit, deleteHabit, restoreHabit } from "@/modules/habits/actions";
import { habitLogs, habits } from "@/modules/habits/db/schema";
import { FREQUENCY_ERRORS } from "@/modules/habits/frequency-copy";
import { HABIT_ERRORS } from "@/modules/habits/habit-input";
import {
  HABITS_ADVISORY_SPACE,
  HABITS_ORDER_KEY,
  selectActiveHabits,
} from "@/modules/habits/habits";
import { setHabitDone } from "@/modules/habits/log-actions";
import {
  archiveHabit,
  reorderHabits,
  unarchiveHabit,
  updateHabit,
} from "@/modules/habits/organize-actions";
import { ORGANIZE_ERRORS } from "@/modules/habits/organize-copy";
import { listActiveHabits, listArchivedHabits } from "@/modules/habits/queries";
import { weekStart } from "@/modules/habits/schedule";
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
/** The actions read Lima's today by the real clock: so do the tests. */
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

async function create(input: Record<string, unknown>) {
  const result = await createHabit(input);
  if (!result.ok) throw new Error(`createHabit failed: ${JSON.stringify(result)}`);
  return result.data;
}

const activeNames = async () => (await listActiveHabits(new Date())).map((item) => item.name);
const archivedNames = async () => (await listArchivedHabits(new Date())).map((item) => item.name);

/** Every habit's sort order by name (deleted and archived ones too). */
async function orders() {
  const rows = await testDb
    .select({ name: habits.name, sortOrder: habits.sortOrder })
    .from(habits)
    .orderBy(habits.sortOrder);
  return rows.map((r) => [r.name, r.sortOrder]);
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

/** Holds an advisory lock of habits on its own connection while `run` goes. */
async function holdingLock(key: string, run: (release: () => Promise<void>) => Promise<void>) {
  const holder = await testDb.$client.connect();
  try {
    await holder.query("begin");
    await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
      HABITS_ADVISORY_SPACE,
      key,
    ]);
    await run(async () => {
      await holder.query("commit");
    });
  } finally {
    holder.release();
  }
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

describe("create with a frequency", () => {
  test("weekly (X) and fixed days (sorted, no repeats) are stored with exactly their field", async () => {
    const gym = await create({ name: "Gimnasio", frequency: "weekly_count", weeklyTarget: 3 });
    expect(gym).toMatchObject({ frequency: "weekly_count", weeklyTarget: 3, weekdays: null });
    const english = await create({
      name: "Inglés",
      frequency: "weekdays",
      weekdays: [5, 1, 3, 1],
      weeklyTarget: 2,
    });
    expect(english).toMatchObject({
      frequency: "weekdays",
      weeklyTarget: null,
      weekdays: [1, 3, 5],
    });
    expect(await row(english.id)).toMatchObject({ weekdays: [1, 3, 5], weeklyTarget: null });
  });

  test("a missing or invalid field is refused on it, writing nothing", async () => {
    expect(await createHabit({ name: "Gym", frequency: "weekly_count" })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { weeklyTarget: [FREQUENCY_ERRORS.weeklyTarget] },
    });
    expect(
      await createHabit({ name: "Todos", frequency: "weekdays", weekdays: [1, 2, 3, 4, 5, 6, 7] }),
    ).toMatchObject({ fieldErrors: { weekdays: [FREQUENCY_ERRORS.weekdaysAll] } });
    expect(await testDb.$count(habits)).toBe(0);
  });
});

describe("the CHECK behind a frequency change", () => {
  test("a raw change of frequency without its field is refused by the database", async () => {
    const habit = await create({ name: "Leer" });
    const violation = async (statement: ReturnType<typeof sql>) => {
      try {
        await testDb.execute(statement);
        return null;
      } catch (error) {
        return (error as { cause?: { constraint?: string } }).cause?.constraint;
      }
    };
    expect(
      await violation(sql`update habits set frequency = 'weekly_count' where id = ${habit.id}`),
    ).toBe("habits_frequency_rule_check");
    expect(
      await violation(
        sql`update habits set frequency = 'weekdays', weekdays = '{}' where id = ${habit.id}`,
      ),
    ).toBe("habits_frequency_rule_check");
    // Positive control: with its field it goes through.
    expect(
      await violation(
        sql`update habits set frequency = 'weekly_count', weekly_target = 2 where id = ${habit.id}`,
      ),
    ).toBeNull();
  });
});

describe("edit (updateHabit)", () => {
  test("name, area and frequency change; the other frequency's field is cleared", async () => {
    const habit = await create({ name: "Inglés", frequency: "weekdays", weekdays: [1, 3] });
    const health = await areaId("health");
    const result = await updateHabit({
      id: habit.id,
      name: "  Inglés   oral ",
      lifeAreaId: health,
      frequency: "weekly_count",
      weeklyTarget: 2,
      weekdays: [1, 3],
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        id: habit.id,
        name: "Inglés oral",
        area: { id: health },
        frequency: "weekly_count",
        weeklyTarget: 2,
        weekdays: null,
      },
    });
    expect(await row(habit.id)).toMatchObject({ weeklyTarget: 2, weekdays: null });
    expect(revalidatePath).toHaveBeenCalledWith("/habits", "layout");
    // And back to daily: both fields null.
    await updateHabit({ id: habit.id, name: "Inglés", lifeAreaId: null, frequency: "daily" });
    expect(await row(habit.id)).toMatchObject({
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
      lifeAreaId: null,
    });
  });

  test("never touches the measure, the order, the start date or the logs", async () => {
    const habit = await create({ name: "Agua" });
    // A quantity habit (H3 creates them; raw here).
    await testDb
      .update(habits)
      .set({ measure: "quantity", goal: 8, unit: "vasos", step: 1 })
      .where(eq(habits.id, habit.id));
    await testDb
      .insert(habitLogs)
      .values({ habitId: habit.id, day: today(), quantity: 3, target: 8 });
    const before = await row(habit.id);
    expect(
      await updateHabit({
        id: habit.id,
        name: "Agua",
        frequency: "daily",
        measure: "check",
        goal: 1,
        sortOrder: 99,
        startDate: "2020-01-01",
      }),
    ).toMatchObject({ ok: true, data: { measure: "quantity", goal: 8, quantity: 3, target: 8 } });
    expect(await row(habit.id)).toMatchObject({
      measure: before.measure,
      goal: before.goal,
      unit: before.unit,
      sortOrder: before.sortOrder,
      startDate: before.startDate,
    });
  });

  test("a new area must be active; the one it has stays even if archived since", async () => {
    const work = await areaId("work");
    const habit = await create({ name: "Revisar correo", lifeAreaId: work });
    await testDb.update(lifeAreas).set({ archivedAt: new Date() }).where(eq(lifeAreas.id, work));
    // Kept: same (now archived) area.
    expect(
      await updateHabit({ id: habit.id, name: "Correo", lifeAreaId: work, frequency: "daily" }),
    ).toMatchObject({ ok: true, data: { name: "Correo", area: { id: work } } });
    // A different archived or missing area is refused on its field.
    const other = await create({ name: "Otro" });
    for (const lifeAreaId of [work, MISSING]) {
      expect(
        await updateHabit({ id: other.id, name: "Otro", lifeAreaId, frequency: "daily" }),
      ).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { lifeAreaId: [HABIT_ERRORS.areaUnavailable] },
      });
    }
    expect((await row(other.id)).lifeAreaId).toBeNull();
  });

  test("an archived habit is refused (reactivate first); a deleted or missing one is not found", async () => {
    const archived = await create({ name: "Archivado" });
    await archiveHabit({ id: archived.id });
    expect(await updateHabit({ id: archived.id, name: "Nuevo", frequency: "daily" })).toEqual({
      ok: false,
      error: ORGANIZE_ERRORS.archivedEdit,
    });
    expect((await row(archived.id)).name).toBe("Archivado");

    const deleted = await create({ name: "Borrado" });
    await deleteHabit({ id: deleted.id });
    for (const id of [deleted.id, MISSING]) {
      expect(await updateHabit({ id, name: "Nuevo", frequency: "daily" })).toEqual({
        ok: false,
        error: HABIT_ERRORS.notFound,
      });
    }
    expect((await row(deleted.id)).name).toBe("Borrado");
  });

  test("waits for the habit's own lock; archiving another habit (order lock) doesn't", async () => {
    const habit = await create({ name: "Meditar" });
    const other = await create({ name: "Leer" });
    await holdingLock(habit.id, async (release) => {
      // Positive control: the order lock is free.
      expect(await archiveHabit({ id: other.id })).toMatchObject({ ok: true });
      const pending = updateHabit({ id: habit.id, name: "Meditar 10", frequency: "daily" });
      await waitForLockWaiters(habit.id, 1);
      expect((await row(habit.id)).name).toBe("Meditar");
      await release();
      expect(await pending).toMatchObject({ ok: true });
    });
    expect((await row(habit.id)).name).toBe("Meditar 10");
  });
});

describe("the week's done days (weekDoneBefore)", () => {
  // Fixed days (the read takes the day), so every case runs whatever today is.
  const THURSDAY = "2026-10-08";
  const MONDAY = "2026-10-05";

  async function weeklyHabit(values: Partial<typeof habits.$inferInsert> = {}) {
    const [inserted] = await testDb
      .insert(habits)
      .values({
        name: "Gimnasio",
        measure: "check",
        frequency: "weekly_count",
        weeklyTarget: 3,
        startDate: "2026-09-01",
        sortOrder: 0,
        ...values,
      })
      .returning({ id: habits.id });
    return inserted.id;
  }

  const log = (habitId: string, day: string, quantity: number, target = 1) =>
    testDb.insert(habitLogs).values({ habitId, day, quantity, target });

  test("this week's done days before the day read: not that day, not last week, not unmarked", async () => {
    const id = await weeklyHabit();
    await log(id, "2026-10-04", 1); // last Sunday: another week
    await log(id, MONDAY, 0); // unmarked
    await log(id, "2026-10-06", 1);
    await log(id, "2026-10-07", 1);
    await log(id, THURSDAY, 1); // the day read: the pad adds it itself
    await log(id, "2026-10-09", 1); // after the day read
    const [item] = await selectActiveHabits(testDb, THURSDAY);
    expect(item).toMatchObject({ weekDoneBefore: 2, quantity: 1 });
    // On Monday nothing comes before it; on Sunday the whole week does.
    expect((await selectActiveHabits(testDb, MONDAY))[0].weekDoneBefore).toBe(0);
    expect((await selectActiveHabits(testDb, "2026-10-11"))[0].weekDoneBefore).toBe(4);
    // The week changes on Monday (across the month and the year too).
    expect((await selectActiveHabits(testDb, "2026-10-12"))[0].weekDoneBefore).toBe(0);
  });

  test("a quantity day counts only once it reaches its own target; each habit its own", async () => {
    const water = await weeklyHabit({ name: "Agua", measure: "quantity", goal: 8, unit: "vasos" });
    const other = await weeklyHabit({ name: "Otro", sortOrder: 1 });
    await log(water, MONDAY, 7, 8);
    await log(water, "2026-10-06", 9, 8);
    await log(other, MONDAY, 1);
    const read = async () =>
      Object.fromEntries(
        (await selectActiveHabits(testDb, THURSDAY)).map((item) => [
          item.name,
          item.weekDoneBefore,
        ]),
      );
    expect(await read()).toEqual({ Agua: 1, Otro: 1 });
    await testDb.update(habitLogs).set({ quantity: 8 }).where(eq(habitLogs.day, MONDAY));
    expect(await read()).toEqual({ Agua: 2, Otro: 1 });
  });

  test("across the year: the week of Thu 2026-12-31 starts Mon 2026-12-28", async () => {
    const id = await weeklyHabit();
    await log(id, "2026-12-27", 1); // Sunday before
    await log(id, "2026-12-28", 1);
    await log(id, "2026-12-30", 1);
    expect((await selectActiveHabits(testDb, "2027-01-01"))[0].weekDoneBefore).toBe(2);
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("archive and reactivate", () => {
  test("archived: out of the active list into the archived one, logs kept; twice is fine", async () => {
    const a = await create({ name: "A" });
    await create({ name: "B" });
    await setHabitDone({ id: a.id, day: today(), done: true });
    expect(await archiveHabit({ id: a.id })).toMatchObject({ ok: true, data: { id: a.id } });
    expect(await activeNames()).toEqual(["B"]);
    expect(await archivedNames()).toEqual(["A"]);
    expect((await row(a.id)).archivedAt).not.toBeNull();
    expect(await testDb.$count(habitLogs)).toBe(1);
    const stamp = (await row(a.id)).archivedAt;
    expect(await archiveHabit({ id: a.id })).toMatchObject({ ok: true });
    expect((await row(a.id)).archivedAt).toEqual(stamp);
    // Logging an archived habit is refused (H1).
    expect(await setHabitDone({ id: a.id, day: today(), done: false })).toEqual({
      ok: false,
      error: HABIT_ERRORS.archived,
    });
  });

  test("Reactivar goes last; the archive's Deshacer (original) goes back in place", async () => {
    const a = await create({ name: "A" });
    await create({ name: "B" });
    await create({ name: "C" });
    await archiveHabit({ id: a.id });
    expect(await unarchiveHabit({ id: a.id, position: "original" })).toMatchObject({ ok: true });
    expect(await activeNames()).toEqual(["A", "B", "C"]);
    await archiveHabit({ id: a.id });
    expect(await unarchiveHabit({ id: a.id })).toMatchObject({ ok: true, data: { name: "A" } });
    expect(await activeNames()).toEqual(["B", "C", "A"]);
    expect(await archivedNames()).toEqual([]);
    // Reactivating an active one changes nothing (not even its place).
    const before = await orders();
    expect(await unarchiveHabit({ id: a.id })).toMatchObject({ ok: true });
    expect(await orders()).toEqual(before);
  });

  test("a deleted or missing habit is not found; a deleted archived one isn't listed", async () => {
    const a = await create({ name: "A" });
    await archiveHabit({ id: a.id });
    await deleteHabit({ id: a.id });
    expect(await archivedNames()).toEqual([]);
    for (const id of [a.id, MISSING]) {
      expect(await archiveHabit({ id })).toEqual({ ok: false, error: HABIT_ERRORS.notFound });
      expect(await unarchiveHabit({ id })).toEqual({ ok: false, error: HABIT_ERRORS.notFound });
    }
    // Restored, it is still archived.
    await restoreHabit({ id: a.id });
    expect(await archivedNames()).toEqual(["A"]);
  });

  test("archive and reactivate wait for the order lock; logging doesn't take it", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    await archiveHabit({ id: b.id });
    await holdingLock(HABITS_ORDER_KEY, async (release) => {
      // Positive control: logging a day goes through.
      expect(await setHabitDone({ id: a.id, day: today(), done: true })).toMatchObject({
        ok: true,
      });
      const archiving = archiveHabit({ id: a.id });
      const reactivating = unarchiveHabit({ id: b.id });
      await waitForLockWaiters(HABITS_ORDER_KEY, 2);
      expect((await row(a.id)).archivedAt).toBeNull();
      expect((await row(b.id)).archivedAt).not.toBeNull();
      await release();
      expect(await archiving).toMatchObject({ ok: true });
      expect(await reactivating).toMatchObject({ ok: true });
    });
    expect(await activeNames()).toEqual(["B"]);
  });
});

describe("manual order (reorderHabits)", () => {
  test("the active habits in the new order; archived and deleted keep their slots; contiguous", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    const c = await create({ name: "C" });
    const d = await create({ name: "D" });
    const e = await create({ name: "E" });
    await archiveHabit({ id: b.id });
    await deleteHabit({ id: d.id });
    expect(await reorderHabits({ ids: [e.id, c.id, a.id] })).toEqual({ ok: true, data: null });
    expect(await activeNames()).toEqual(["E", "C", "A"]);
    expect(await orders()).toEqual([
      ["E", 0],
      ["B", 1],
      ["C", 2],
      ["D", 3],
      ["A", 4],
    ]);
    // Both come back to their slots.
    await restoreHabit({ id: d.id });
    await unarchiveHabit({ id: b.id, position: "original" });
    expect(await activeNames()).toEqual(["E", "B", "C", "D", "A"]);
  });

  test("a stale or tampered list is refused without writing (and revalidates)", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    const archived = await create({ name: "X" });
    await archiveHabit({ id: archived.id });
    const before = await orders();
    vi.mocked(revalidatePath).mockClear();
    for (const ids of [[b.id], [b.id, a.id, archived.id], [b.id, MISSING], [b.id, a.id, MISSING]]) {
      expect(await reorderHabits({ ids })).toEqual({
        ok: false,
        error: ORGANIZE_ERRORS.staleOrder,
      });
    }
    expect(revalidatePath).toHaveBeenCalledWith("/habits", "layout");
    // Repeats and non-ids never reach the database.
    expect(await reorderHabits({ ids: [a.id, a.id] })).toMatchObject({
      fieldErrors: { ids: [ORGANIZE_ERRORS.order] },
    });
    expect(await reorderHabits({ ids: ["x"] })).toMatchObject({ ok: false });
    expect(await reorderHabits({ ids: [] })).toMatchObject({ ok: false });
    expect(await orders()).toEqual(before);
    // Positive control: the right set goes through.
    expect(await reorderHabits({ ids: [b.id, a.id] })).toMatchObject({ ok: true });
  });

  test("waits for the order lock (positive control: logging goes through meanwhile)", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    await holdingLock(HABITS_ORDER_KEY, async (release) => {
      expect(await setHabitDone({ id: a.id, day: today(), done: true })).toMatchObject({
        ok: true,
      });
      const pending = reorderHabits({ ids: [b.id, a.id] });
      await waitForLockWaiters(HABITS_ORDER_KEY, 1);
      expect(await activeNames()).toEqual(["A", "B"]);
      await release();
      expect(await pending).toMatchObject({ ok: true });
    });
    expect(await activeNames()).toEqual(["B", "A"]);
  });

  test("reorders and creates at once never share a place", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    const results = await Promise.all([
      reorderHabits({ ids: [b.id, a.id] }),
      createHabit({ name: "C" }),
      reorderHabits({ ids: [a.id, b.id] }),
      createHabit({ name: "D" }),
    ]);
    // Both creates go through; a reorder that lost the race to a create sees a stale list and
    // is refused without writing.
    expect(results[1].ok && results[3].ok).toBe(true);
    for (const result of [results[0], results[2]]) {
      if (!result.ok) expect(result.error).toBe(ORGANIZE_ERRORS.staleOrder);
    }
    const sortOrders = (await orders()).map(([, order]) => Number(order));
    expect([...sortOrders].sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every H2 action is refused and nothing changes", async (_, headers) => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    const before = await orders();
    request.headers = await headers();
    for (const call of [
      () => updateHabit({ id: a.id, name: "Z", frequency: "daily" }),
      () => reorderHabits({ ids: [b.id, a.id] }),
      () => archiveHabit({ id: a.id }),
      () => unarchiveHabit({ id: a.id }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await orders()).toEqual(before);
    expect((await row(a.id)).archivedAt).toBeNull();
    // Positive control: the owner's session still works.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect(await archiveHabit({ id: a.id })).toMatchObject({ ok: true });
  });

  test("the archived list redirects to /login without a session", async () => {
    request.headers = new Headers();
    await expect(listArchivedHabits(new Date())).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
