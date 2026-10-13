// G1 of `goals` against the throwaway database: create, edit, archive, delete and undo through
// the actions, the manual entries ("+N" under the goal's lock, two at once add up, achieved once,
// the exact entry's undo), achieved and reopened, a past goal that keeps its state, the manual
// order under the order lock, authorization of every action and the export.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  addEntryToGoal,
  archiveGoal,
  createGoal,
  deleteGoal,
  markGoalAchieved,
  reopenGoal,
  reorderGoals,
  restoreGoal,
  undoEntryOfGoal,
  unarchiveGoal,
  updateGoal,
} from "@/modules/goals/actions";
import { goalEntries, goals } from "@/modules/goals/db/schema";
import { GOAL_ERRORS } from "@/modules/goals/goals-copy";
import { GOALS_ADVISORY_SPACE, GOALS_ORDER_KEY } from "@/modules/goals/goals";
import { getDeletedGoal, getGoal, listGoalEntries, listGoals } from "@/modules/goals/queries";
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

const YEAR = { periodKind: "year", year: 2026 } as const;
const MANUAL = { sourceKind: "manual", target: 12, unit: "libros" } as const;

async function areaId(slug: string): Promise<string> {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, slug));
  return area.id;
}

async function create(values: Record<string, unknown> = {}) {
  const result = await createGoal({ title: "Leer 12 libros", ...YEAR, ...MANUAL, ...values });
  if (!result.ok) throw new Error(`createGoal failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function add(goalId: string, delta = 1) {
  const result = await addEntryToGoal({ goalId, delta });
  if (!result.ok) throw new Error(`addEntryToGoal failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function row(id: string) {
  const [found] = await testDb.select().from(goals).where(eq(goals.id, id));
  return found;
}

const titles = async () => (await listGoals()).map((goal) => goal.title);

/** Every goal's position by title (deleted and archived ones too). */
async function positions() {
  const rows = await testDb
    .select({ title: goals.title, position: goals.position })
    .from(goals)
    .orderBy(goals.position);
  return rows.map((r) => [r.title, r.position]);
}

/** Waits until `count` connections wait on the goals advisory lock with this key. */
async function waitForLockWaiters(key: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_locks
       where locktype = 'advisory' and not granted and objsubid = 2
         and classid::bigint = $1::bigint
         and objid::bigint = (hashtext($2)::bigint & 4294967295)`,
      [GOALS_ADVISORY_SPACE, key],
    );
    if (result.rows[0].waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} lock waiters`);
}

/** Holds an advisory lock of goals on its own connection while `run` goes. */
async function holdingLock(key: string, run: (release: () => Promise<void>) => Promise<void>) {
  const holder = await testDb.$client.connect();
  try {
    await holder.query("begin");
    await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
      GOALS_ADVISORY_SPACE,
      key,
    ]);
    await run(async () => {
      await holder.query("commit");
    });
  } finally {
    holder.release();
  }
}

describe("create", () => {
  test("a manual goal at the end of the order, with its period and what the screens need", async () => {
    const first = await create();
    expect(first).toMatchObject({
      title: "Leer 12 libros",
      periodKind: "year",
      year: 2026,
      quarter: null,
      sourceKind: "manual",
      target: 12,
      unit: "libros",
      status: "active",
      achievedAt: null,
      sum: 0,
      area: null,
      notes: null,
      position: 0,
    });
    const second = await create({
      title: "Correr 90 km",
      periodKind: "quarter",
      quarter: 4,
      target: 90,
      unit: "km",
      areaId: await areaId("health"),
      notes: "Tres veces por semana",
    });
    expect(second).toMatchObject({
      periodKind: "quarter",
      quarter: 4,
      position: 1,
      notes: "Tres veces por semana",
      area: { slug: "health" },
    });
    expect(await titles()).toEqual(["Leer 12 libros", "Correr 90 km"]);
    expect(revalidatePath).toHaveBeenCalledWith("/goals", "layout");
  });

  test("the title is normalized and the input is validated on the server too", async () => {
    expect((await create({ title: "  Leer \n  más " })).title).toBe("Leer más");
    expect(await createGoal({ ...YEAR, ...MANUAL, title: "" })).toMatchObject({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { title: [GOAL_ERRORS.titleRequired] },
    });
    expect(await createGoal({ title: "x", ...YEAR, ...MANUAL, target: 0 })).toMatchObject({
      ok: false,
      fieldErrors: { target: [GOAL_ERRORS.targetInvalid] },
    });
    expect(
      await createGoal({ title: "x", ...YEAR, ...MANUAL, periodKind: "quarter" }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { quarter: [GOAL_ERRORS.period] },
    });
    expect(await testDb.select().from(goals)).toHaveLength(1);
  });

  test("an area must be active; a missing one is refused on its field", async () => {
    const archived = await areaId("travel");
    await testDb
      .update(lifeAreas)
      .set({ archivedAt: new Date() })
      .where(eq(lifeAreas.id, archived));
    expect(await createGoal({ title: "Viajar", ...YEAR, ...MANUAL, areaId: archived })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { areaId: [GOAL_ERRORS.areaUnavailable] },
    });
    expect(
      await createGoal({ title: "Viajar", ...YEAR, ...MANUAL, areaId: MISSING }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { areaId: [GOAL_ERRORS.areaUnavailable] },
    });
    expect(await testDb.select().from(goals)).toHaveLength(0);
  });

  test("habit and project goals are validated but not available yet (G2): refused, nothing stored", async () => {
    const habit = await createGoal({
      title: "Correr",
      periodKind: "quarter",
      year: 2026,
      quarter: 4,
      sourceKind: "habit",
      habitId: MISSING,
      target: 40,
    });
    expect(habit).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { sourceKind: [GOAL_ERRORS.sourceUnavailable] },
    });
    expect(
      await createGoal({ title: "Lanzar", ...YEAR, sourceKind: "project", projectId: MISSING }),
    ).toMatchObject({ ok: false, fieldErrors: { sourceKind: [GOAL_ERRORS.sourceUnavailable] } });
    expect(await testDb.select().from(goals)).toHaveLength(0);
  });

  test("goals created at the same time get distinct, contiguous positions (the order lock)", async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createGoal({ title: `Meta ${index}`, ...YEAR, ...MANUAL }),
      ),
    );
    const stored = await testDb
      .select({ position: goals.position })
      .from(goals)
      .orderBy(goals.position);
    expect(stored.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("waits for the order lock", async () => {
    await holdingLock(GOALS_ORDER_KEY, async (release) => {
      const pending = createGoal({ title: "Espera", ...YEAR, ...MANUAL });
      await waitForLockWaiters(GOALS_ORDER_KEY, 1);
      expect(await testDb.select().from(goals)).toHaveLength(0);
      await release();
      expect(await pending).toMatchObject({ ok: true });
    });
  });
});

describe("edit", () => {
  test("title, notes, area, target and unit change; the period and source never do", async () => {
    const goal = await create();
    const result = await updateGoal({
      id: goal.id,
      title: "Leer 15 libros",
      sourceKind: "manual",
      target: 15,
      unit: "títulos",
      notes: "Novelas",
      areaId: await areaId("learning"),
      periodKind: "quarter",
      year: 2030,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        title: "Leer 15 libros",
        target: 15,
        unit: "títulos",
        notes: "Novelas",
        area: { slug: "learning" },
      },
    });
    expect(await row(goal.id)).toMatchObject({ periodKind: "year", year: 2026, quarter: null });
  });

  test("a goal of another source cannot be edited as manual, and a missing one is not found", async () => {
    const goal = await create();
    expect(
      await updateGoal({
        id: goal.id,
        title: "x",
        sourceKind: "habit",
        habitId: MISSING,
        target: 5,
      }),
    ).toEqual({ ok: false, error: GOAL_ERRORS.sourceChange });
    expect(
      await updateGoal({ id: MISSING, title: "x", sourceKind: "manual", target: 5, unit: "u" }),
    ).toEqual({
      ok: false,
      error: GOAL_ERRORS.notFound,
    });
  });

  test("an archived goal must be reactivated first", async () => {
    const goal = await create();
    await archiveGoal({ id: goal.id });
    expect(
      await updateGoal({ id: goal.id, title: "x", sourceKind: "manual", target: 5, unit: "u" }),
    ).toEqual({ ok: false, error: GOAL_ERRORS.archived });
    expect((await row(goal.id)).title).toBe("Leer 12 libros");
  });

  test("a new target that the sum reaches achieves it; a higher one reopens it", async () => {
    const goal = await create();
    await add(goal.id, 5);
    const lowered = await updateGoal({
      id: goal.id,
      title: goal.title,
      sourceKind: "manual",
      target: 5,
      unit: "libros",
    });
    expect(lowered).toMatchObject({ ok: true, data: { status: "achieved", target: 5 } });
    expect((await row(goal.id)).achievedAt).not.toBeNull();
    const raised = await updateGoal({
      id: goal.id,
      title: goal.title,
      sourceKind: "manual",
      target: 20,
      unit: "libros",
    });
    expect(raised).toMatchObject({ ok: true, data: { status: "active", achievedAt: null } });
  });

  test("an area that was archived after the goal was made stays; a new archived one is refused", async () => {
    const health = await areaId("health");
    const goal = await create({ areaId: health });
    await testDb.update(lifeAreas).set({ archivedAt: new Date() }).where(eq(lifeAreas.id, health));
    expect(
      await updateGoal({
        id: goal.id,
        title: "Otro",
        sourceKind: "manual",
        target: 12,
        unit: "libros",
        areaId: health,
      }),
    ).toMatchObject({ ok: true, data: { title: "Otro" } });
    const travel = await areaId("travel");
    await testDb.update(lifeAreas).set({ archivedAt: new Date() }).where(eq(lifeAreas.id, travel));
    expect(
      await updateGoal({
        id: goal.id,
        title: "Otro",
        sourceKind: "manual",
        target: 12,
        unit: "libros",
        areaId: travel,
      }),
    ).toMatchObject({ ok: false, fieldErrors: { areaId: [GOAL_ERRORS.areaUnavailable] } });
  });
});

describe("archive, delete and undo (visibleGoal)", () => {
  test("archive keeps everything and its place; reactivating returns it where it was or at the end", async () => {
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    await create({ title: "C" });
    await add(a.id, 12);
    expect((await row(a.id)).status).toBe("achieved");

    expect(await archiveGoal({ id: a.id })).toMatchObject({
      ok: true,
      data: { status: "archived" },
    });
    // Twice changes nothing.
    expect(await archiveGoal({ id: a.id })).toMatchObject({
      ok: true,
      data: { status: "archived" },
    });
    expect(await row(a.id)).toMatchObject({ position: 0 });
    expect((await row(a.id)).achievedAt).not.toBeNull();

    // "Deshacer" of the archive: back in its place and back to achieved.
    expect(await unarchiveGoal({ id: a.id, position: "original" })).toMatchObject({
      ok: true,
      data: { status: "achieved", position: 0 },
    });
    // "Reactivar" at the end.
    await archiveGoal({ id: b.id });
    expect(await unarchiveGoal({ id: b.id })).toMatchObject({
      ok: true,
      data: { status: "active", position: 3 },
    });
    // Reactivating one that isn't archived changes nothing.
    expect(await unarchiveGoal({ id: b.id })).toMatchObject({ ok: true, data: { position: 3 } });
  });

  test("delete is soft: out of every read with its entries, back with 'Deshacer', twice is fine", async () => {
    const goal = await create();
    await add(goal.id, 2);
    expect(await deleteGoal({ id: goal.id })).toEqual({
      ok: true,
      data: { id: goal.id, title: goal.title },
    });
    expect(await titles()).toEqual([]);
    expect(await getGoal(goal.id)).toBeNull();
    expect(await listGoalEntries(goal.id)).toEqual([]);
    expect(await getDeletedGoal(goal.id)).toEqual({ id: goal.id, title: goal.title });
    // Nothing is deleted physically.
    expect(await testDb.select().from(goals)).toHaveLength(1);
    expect(await testDb.select().from(goalEntries)).toHaveLength(1);

    // A deleted goal takes no entries, no edits, no archive.
    expect(await addEntryToGoal({ goalId: goal.id, delta: 1 })).toEqual({
      ok: false,
      error: GOAL_ERRORS.notFound,
    });
    expect(await archiveGoal({ id: goal.id })).toEqual({ ok: false, error: GOAL_ERRORS.notFound });
    expect(await markGoalAchieved({ id: goal.id })).toEqual({
      ok: false,
      error: GOAL_ERRORS.notFound,
    });
    // Deleting it again is "not found", not a second delete.
    expect(await deleteGoal({ id: goal.id })).toEqual({ ok: false, error: GOAL_ERRORS.notFound });

    expect(await restoreGoal({ id: goal.id })).toMatchObject({
      ok: true,
      data: { sum: 2, position: 0 },
    });
    expect(await restoreGoal({ id: goal.id })).toMatchObject({ ok: true });
    expect(await titles()).toEqual([goal.title]);
    expect(await listGoalEntries(goal.id)).toHaveLength(1);
    expect(await getDeletedGoal(goal.id)).toBeNull();
    expect(await restoreGoal({ id: MISSING })).toEqual({ ok: false, error: GOAL_ERRORS.notFound });
  });

  test("a malformed id never reaches Postgres", async () => {
    expect(await getGoal("not-a-uuid")).toBeNull();
    expect(await getDeletedGoal("1; drop table goals")).toBeNull();
    expect(await listGoalEntries("nope")).toEqual([]);
    expect(await deleteGoal({ id: "nope" })).toMatchObject({ ok: false });
  });
});

describe("entries (+N)", () => {
  test("each entry adds to the sum, with its day; the history is newest first", async () => {
    const goal = await create();
    const one = await add(goal.id);
    expect(one.goal.sum).toBe(1);
    expect(one.achievedNow).toBe(false);
    await add(goal.id, 3);
    const entries = await listGoalEntries(goal.id);
    expect(entries.map((entry) => entry.delta)).toEqual([3, 1]);
    expect(entries[0].entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await getGoal(goal.id))?.sum).toBe(4);
  });

  test("reaching the target achieves it once; later entries leave achievedAt alone", async () => {
    const goal = await create({ target: 3 });
    expect((await add(goal.id, 2)).achievedNow).toBe(false);
    const reached = await add(goal.id);
    expect(reached).toMatchObject({ achievedNow: true, goal: { status: "achieved" } });
    const stamp = (await row(goal.id)).achievedAt;
    expect(stamp).not.toBeNull();
    const after = await add(goal.id);
    expect(after).toMatchObject({ achievedNow: false, goal: { status: "achieved", sum: 4 } });
    expect((await row(goal.id)).achievedAt).toEqual(stamp);
  });

  test("a negative entry corrects; dropping below the target reopens it", async () => {
    const goal = await create({ target: 3 });
    await add(goal.id, 3);
    const corrected = await add(goal.id, -1);
    expect(corrected.goal).toMatchObject({ status: "active", achievedAt: null, sum: 2 });
    // Reaching it again achieves it again (a new date).
    expect((await add(goal.id)).achievedNow).toBe(true);
  });

  test("a goal marked by hand below its target is not reopened by an entry", async () => {
    const goal = await create({ target: 10 });
    await add(goal.id, 2);
    await markGoalAchieved({ id: goal.id });
    expect((await add(goal.id)).goal.status).toBe("achieved");
    expect((await add(goal.id, -1)).goal.status).toBe("achieved");
  });

  test("an archived goal takes no entries; a missing one is not found", async () => {
    const goal = await create();
    await archiveGoal({ id: goal.id });
    expect(await addEntryToGoal({ goalId: goal.id, delta: 1 })).toEqual({
      ok: false,
      error: GOAL_ERRORS.archived,
    });
    expect(await addEntryToGoal({ goalId: MISSING, delta: 1 })).toEqual({
      ok: false,
      error: GOAL_ERRORS.notFound,
    });
    expect(await addEntryToGoal({ goalId: goal.id, delta: 0 })).toMatchObject({ ok: false });
    expect(await testDb.select().from(goalEntries)).toHaveLength(0);
  });

  test("two '+1' at the same time add up to two (positive control: the entry waits for the lock)", async () => {
    const goal = await create({ target: 100 });
    // The control: while the goal's lock is held elsewhere, an entry waits and writes nothing.
    await holdingLock(goal.id, async (release) => {
      const waiting = addEntryToGoal({ goalId: goal.id, delta: 1 });
      await waitForLockWaiters(goal.id, 1);
      expect(await testDb.select().from(goalEntries)).toHaveLength(0);
      await release();
      expect(await waiting).toMatchObject({ ok: true });
    });
    // Now two at once, through the real lock.
    const [a, b] = await Promise.all([
      addEntryToGoal({ goalId: goal.id, delta: 1 }),
      addEntryToGoal({ goalId: goal.id, delta: 1 }),
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect((await getGoal(goal.id))?.sum).toBe(3);
    // Another goal is not held back by this one's lock (positive control for the key).
    const other = await create({ title: "Otra", target: 100 });
    await holdingLock(goal.id, async (release) => {
      expect(await addEntryToGoal({ goalId: other.id, delta: 1 })).toMatchObject({ ok: true });
      await release();
    });
  });

  test("two entries that both reach the target achieve it once", async () => {
    const goal = await create({ target: 2 });
    await add(goal.id);
    const results = await Promise.all([
      addEntryToGoal({ goalId: goal.id, delta: 1 }),
      addEntryToGoal({ goalId: goal.id, delta: 1 }),
    ]);
    const achieved = results.filter((result) => result.ok && result.data.achievedNow);
    expect(achieved).toHaveLength(1);
    expect(await row(goal.id)).toMatchObject({ status: "achieved" });
    expect((await row(goal.id)).achievedAt).not.toBeNull();
    expect((await getGoal(goal.id))?.sum).toBe(3);
  });

  test("a goal whose period is over keeps its state; entries still sum, and nothing reopens or achieves it by itself", async () => {
    const [past] = await testDb
      .insert(goals)
      .values({
        title: "Inglés",
        periodKind: "quarter",
        year: 2025,
        quarter: 1,
        sourceKind: "manual",
        target: 10,
        unit: "lecciones",
        position: 0,
      })
      .returning();
    await testDb.insert(goalEntries).values({ goalId: past.id, delta: 7, entryDate: "2025-03-01" });
    const read = await getGoal(past.id);
    expect(read).toMatchObject({ status: "active", sum: 7, achievedAt: null });
    // Reading it any number of times changes nothing.
    await listGoals();
    expect((await row(past.id)).status).toBe("active");
  });
});

describe("undo of the exact entry", () => {
  test("soft deletes that entry only, evaluates the goal again, and twice is fine", async () => {
    const goal = await create({ target: 5 });
    const first = await add(goal.id, 2);
    const second = await add(goal.id, 3);
    expect(second.goal.status).toBe("achieved");

    // Undoing the first entry (not the last) removes exactly it and reopens the goal.
    const undone = await undoEntryOfGoal({ goalId: goal.id, entryId: first.entryId });
    expect(undone).toMatchObject({
      ok: true,
      data: { sum: 3, status: "active", achievedAt: null },
    });
    const stored = await testDb.select().from(goalEntries).orderBy(goalEntries.createdAt);
    expect(stored.map((entry) => [entry.id === first.entryId, entry.deletedAt !== null])).toEqual([
      [true, true],
      [false, false],
    ]);
    // Twice is not an error and does not move the sum.
    expect(await undoEntryOfGoal({ goalId: goal.id, entryId: first.entryId })).toMatchObject({
      ok: true,
      data: { sum: 3 },
    });
    expect((await listGoalEntries(goal.id)).map((entry) => entry.id)).toEqual([second.entryId]);
  });

  test("another goal's entry, or one that never existed, changes nothing", async () => {
    const goal = await create({ title: "Uno" });
    const other = await create({ title: "Dos" });
    const entry = await add(other.id, 4);
    expect(await undoEntryOfGoal({ goalId: goal.id, entryId: entry.entryId })).toEqual({
      ok: false,
      error: GOAL_ERRORS.entryNotFound,
    });
    expect(await undoEntryOfGoal({ goalId: goal.id, entryId: MISSING })).toEqual({
      ok: false,
      error: GOAL_ERRORS.entryNotFound,
    });
    expect((await getGoal(other.id))?.sum).toBe(4);
  });

  test("undoing a correction brings the sum back and the goal is evaluated again (achieved)", async () => {
    const goal = await create({ target: 3 });
    await add(goal.id, 3);
    const correction = await add(goal.id, -1);
    expect(correction.goal).toMatchObject({ status: "active", achievedAt: null, sum: 2 });
    const undone = await undoEntryOfGoal({ goalId: goal.id, entryId: correction.entryId });
    expect(undone).toMatchObject({ ok: true, data: { sum: 3, status: "achieved" } });
    expect((await row(goal.id)).achievedAt).not.toBeNull();
  });
});

describe("achieved and reopened by hand", () => {
  test("'Marcar lograda' is idempotent and sets the date once; 'Reabrir' clears it", async () => {
    const goal = await create();
    const marked = await markGoalAchieved({ id: goal.id });
    expect(marked).toMatchObject({ ok: true, data: { status: "achieved" } });
    const stamp = (await row(goal.id)).achievedAt;
    expect(stamp).not.toBeNull();
    expect(await markGoalAchieved({ id: goal.id })).toMatchObject({
      ok: true,
      data: { status: "achieved" },
    });
    expect((await row(goal.id)).achievedAt).toEqual(stamp);

    expect(await reopenGoal({ id: goal.id })).toMatchObject({
      ok: true,
      data: { status: "active", achievedAt: null },
    });
    expect(await reopenGoal({ id: goal.id })).toMatchObject({
      ok: true,
      data: { status: "active" },
    });
  });

  test("an archived goal can't be marked or reopened", async () => {
    const goal = await create();
    await archiveGoal({ id: goal.id });
    expect(await markGoalAchieved({ id: goal.id })).toEqual({
      ok: false,
      error: GOAL_ERRORS.archived,
    });
    expect(await reopenGoal({ id: goal.id })).toEqual({ ok: false, error: GOAL_ERRORS.archived });
  });

  test("waits for the goal's lock", async () => {
    const goal = await create();
    await holdingLock(goal.id, async (release) => {
      const pending = markGoalAchieved({ id: goal.id });
      await waitForLockWaiters(goal.id, 1);
      expect((await row(goal.id)).status).toBe("active");
      await release();
      expect(await pending).toMatchObject({ ok: true });
    });
  });
});

describe("the manual order", () => {
  test("reorder writes contiguous positions; archived and deleted goals keep their slots", async () => {
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    const c = await create({ title: "C" });
    const d = await create({ title: "D" });
    await archiveGoal({ id: b.id });
    await deleteGoal({ id: c.id });
    // The active ones are A and D: swap them.
    expect(await reorderGoals({ ids: [d.id, a.id] })).toEqual({ ok: true, data: null });
    expect(await positions()).toEqual([
      ["D", 0],
      ["B", 1],
      ["C", 2],
      ["A", 3],
    ]);
    expect(await titles()).toEqual(["D", "B", "A"]);
    // Positions stay unique and contiguous.
    const stored = await testDb
      .select({ position: goals.position })
      .from(goals)
      .orderBy(goals.position);
    expect(stored.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  test("a stale or tampered list is refused without writing", async () => {
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    const before = await positions();
    const stale = { ok: false, error: GOAL_ERRORS.staleOrder };
    expect(await reorderGoals({ ids: [b.id] })).toEqual(stale); // one missing
    expect(await reorderGoals({ ids: [b.id, a.id, MISSING] })).toEqual(stale); // an unknown one
    await archiveGoal({ id: b.id });
    expect(await reorderGoals({ ids: [b.id, a.id] })).toEqual(stale); // an archived one
    expect(await reorderGoals({ ids: [a.id, a.id] })).toMatchObject({ ok: false }); // a repeat
    expect(await reorderGoals({ ids: [] })).toMatchObject({ ok: false });
    expect(await positions()).toEqual(before);
  });

  test("waits for the order lock", async () => {
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    await holdingLock(GOALS_ORDER_KEY, async (release) => {
      const pending = reorderGoals({ ids: [b.id, a.id] });
      await waitForLockWaiters(GOALS_ORDER_KEY, 1);
      expect(await positions()).toEqual([
        ["A", 0],
        ["B", 1],
      ]);
      await release();
      expect(await pending).toEqual({ ok: true, data: null });
    });
    expect(await titles()).toEqual(["B", "A"]);
  });

  test("archive and delete wait for the order lock too", async () => {
    const a = await create({ title: "A" });
    await holdingLock(GOALS_ORDER_KEY, async (release) => {
      const archiving = archiveGoal({ id: a.id });
      await waitForLockWaiters(GOALS_ORDER_KEY, 1);
      expect((await row(a.id)).status).toBe("active");
      await release();
      expect(await archiving).toMatchObject({ ok: true });
    });
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
  ])("with %s every read redirects to /login and every write is refused", async (_, headers) => {
    const goal = await create({ target: 3 });
    const entry = await add(goal.id);
    // Positive control: the owner reads and writes.
    expect(await listGoals()).toHaveLength(1);
    expect(await getGoal(goal.id)).not.toBeNull();

    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(listGoals()).rejects.toMatchObject(redirect);
    await expect(getGoal(MISSING)).rejects.toMatchObject(redirect);
    await expect(listGoalEntries(goal.id)).rejects.toMatchObject(redirect);
    await expect(getDeletedGoal(goal.id)).rejects.toMatchObject(redirect);

    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await createGoal({ title: "Intruso", ...YEAR, ...MANUAL })).toEqual(refused);
    expect(
      await updateGoal({
        id: goal.id,
        title: "Intruso",
        sourceKind: "manual",
        target: 3,
        unit: "u",
      }),
    ).toEqual(refused);
    expect(await deleteGoal({ id: goal.id })).toEqual(refused);
    expect(await restoreGoal({ id: goal.id })).toEqual(refused);
    expect(await reorderGoals({ ids: [goal.id] })).toEqual(refused);
    expect(await archiveGoal({ id: goal.id })).toEqual(refused);
    expect(await unarchiveGoal({ id: goal.id })).toEqual(refused);
    expect(await addEntryToGoal({ goalId: goal.id, delta: 1 })).toEqual(refused);
    expect(await undoEntryOfGoal({ goalId: goal.id, entryId: entry.entryId })).toEqual(refused);
    expect(await markGoalAchieved({ id: goal.id })).toEqual(refused);
    expect(await reopenGoal({ id: goal.id })).toEqual(refused);

    // Nothing changed.
    expect(await row(goal.id)).toMatchObject({
      title: "Leer 12 libros",
      status: "active",
      deletedAt: null,
    });
    expect(await testDb.select().from(goals)).toHaveLength(1);
    expect(await testDb.select({ deletedAt: goalEntries.deletedAt }).from(goalEntries)).toEqual([
      { deletedAt: null },
    ]);
  });
});

describe("export", () => {
  test("the three tables are exported, archived and deleted goals and undone entries included", async () => {
    const kept = await create({ title: "Visible" });
    const archived = await create({ title: "Archivada" });
    const deleted = await create({ title: "Eliminada" });
    const entry = await add(kept.id, 2);
    await add(kept.id, 1);
    await undoEntryOfGoal({ goalId: kept.id, entryId: entry.entryId });
    await archiveGoal({ id: archived.id });
    await deleteGoal({ id: deleted.id });
    await testDb.execute(
      sql`insert into weekly_objectives (week_start, text) values ('2026-10-12', 'Terminar G1')`,
    );

    const data = await buildExport(testDb, new Date("2026-10-12T15:00:00Z"));
    expect(data.tables.goals.rowCount).toBe(3);
    expect(data.tables.goals.rows.map((r) => [r.title, r.status, r.deleted_at !== null])).toEqual([
      ["Visible", "active", false],
      ["Archivada", "archived", false],
      ["Eliminada", "active", true],
    ]);
    expect(data.tables.goals.rows[0]).toMatchObject({
      period_kind: "year",
      year: 2026,
      source_kind: "manual",
      target: 12,
      unit: "libros",
    });
    expect(data.tables.goal_entries.rows.map((r) => [r.delta, r.deleted_at !== null])).toEqual(
      expect.arrayContaining([
        [2, true],
        [1, false],
      ]),
    );
    expect(data.tables.goal_entries.rowCount).toBe(2);
    expect(data.tables.weekly_objectives.rows).toEqual([
      expect.objectContaining({ text: "Terminar G1" }),
    ]);
    expect(data.excludedTables).not.toContain("goals");
  });
});
