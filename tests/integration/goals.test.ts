// `goals` against the throwaway database (G1, and G2's habit and project sources): create, edit, archive, delete and undo through
// the actions, the manual entries ("+N" under the goal's lock, two at once add up, achieved once,
// the exact entry's undo), achieved and reopened, a past goal that keeps its state, the manual
// order under the order lock, habit and project goals (their reading, the achievement when they are
// read, editing the source), authorization of every action and the export.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
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
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { projects } from "@/modules/projects/db/schema";
import { GOAL_ERRORS } from "@/modules/goals/goals-copy";
import { GOALS_ADVISORY_SPACE, GOALS_ORDER_KEY } from "@/modules/goals/goals";
import { selectVisibleGoals } from "@/modules/goals/goals";
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
  habitOrder = 0;
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

let habitOrder = 0;
/** A habit (daily, started on 2026-01-01 unless told otherwise) and its id. */
async function newHabit(values: Partial<typeof habits.$inferInsert> = {}): Promise<string> {
  const [habit] = await testDb
    .insert(habits)
    .values({
      name: "Correr",
      measure: "check",
      frequency: "daily",
      startDate: "2026-01-01",
      sortOrder: habitOrder++,
      ...values,
    })
    .returning({ id: habits.id });
  return habit.id;
}

/** A project (active unless told otherwise) and its id. */
async function newProject(values: Partial<typeof projects.$inferInsert> = {}): Promise<string> {
  const [project] = await testDb
    .insert(projects)
    .values({
      name: "Lanzar brahua-os",
      lifeAreaId: await areaId("work"),
      status: "active",
      ...values,
    })
    .returning({ id: projects.id });
  return project.id;
}

const logDay = (habitId: string, day: string) =>
  testDb.insert(habitLogs).values({ habitId, day, quantity: 1, target: 1 });

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

  test("a habit or project that doesn't exist (or is deleted, or a habit archived) is refused, nothing stored", async () => {
    const refusal = {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { sourceKind: [GOAL_ERRORS.sourceUnavailable] },
    };
    const habit = (habitId: string) =>
      createGoal({
        title: "Correr",
        periodKind: "quarter",
        year: 2026,
        quarter: 4,
        sourceKind: "habit",
        habitId,
        target: 40,
      });
    const project = (projectId: string) =>
      createGoal({ title: "Lanzar", ...YEAR, sourceKind: "project", projectId });
    expect(await habit(MISSING)).toEqual(refusal);
    expect(await project(MISSING)).toEqual(refusal);
    expect(await habit(await newHabit({ deletedAt: new Date() }))).toEqual(refusal);
    expect(await habit(await newHabit({ archivedAt: new Date() }))).toEqual(refusal);
    expect(await project(await newProject({ deletedAt: new Date() }))).toEqual(refusal);
    expect(await testDb.select().from(goals)).toHaveLength(0);
    // Positive control: the same calls with a live habit and project are created.
    expect(await habit(await newHabit())).toMatchObject({ ok: true });
    expect(await project(await newProject())).toMatchObject({ ok: true });
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

  test("a missing goal is not found", async () => {
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

describe("habit and project goals (G2)", () => {
  /** Monday 2026-10-12, 10:00 in Lima (T4 2026). Only Date is faked (the pool's timers stay real). */
  const NOW = new Date("2026-10-12T15:00:00Z");
  const T4 = { periodKind: "quarter", year: 2026, quarter: 4 } as const;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function createHabitGoal(
    habitId: string,
    target = 40,
    values: Record<string, unknown> = {},
  ) {
    const result = await createGoal({
      title: "Correr",
      ...T4,
      sourceKind: "habit",
      habitId,
      target,
      ...values,
    });
    if (!result.ok) throw new Error(`createGoal failed: ${JSON.stringify(result)}`);
    return result.data;
  }

  async function createProjectGoal(projectId: string, values: Record<string, unknown> = {}) {
    const result = await createGoal({
      title: "Lanzar la v1",
      ...YEAR,
      sourceKind: "project",
      projectId,
      ...values,
    });
    if (!result.ok) throw new Error(`createGoal failed: ${JSON.stringify(result)}`);
    return result.data;
  }

  test("a habit goal reads the days done in its period: pauses and days outside it are out", async () => {
    const habitId = await newHabit();
    // September 30 is the previous quarter; October 2 is paused (its log doesn't count).
    for (const day of ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]) {
      await logDay(habitId, day);
    }
    await testDb.insert(habitPauses).values({
      habitId,
      startDate: "2026-10-02",
      endDate: "2026-10-02",
    });
    const created = await createHabitGoal(habitId);
    expect(created).toMatchObject({
      sourceKind: "habit",
      habitId,
      projectId: null,
      unit: null,
      target: 40,
      status: "active",
    });
    // 1–11 October elapsed (today isn't done, so it isn't expected yet) minus the paused day.
    expect((await getGoal(created.id))?.source).toEqual({
      kind: "habit",
      name: "Correr",
      done: 2,
      expected: 10,
    });
  });

  test("a habit that isn't scheduled on some weekdays leaves them out; 'X por semana' counts each logged day", async () => {
    const fixed = await newHabit({ name: "Gimnasio", frequency: "weekdays", weekdays: [1, 3] });
    // Monday 10-05, Tuesday 10-06 (not scheduled), Wednesday 10-07.
    for (const day of ["2026-10-05", "2026-10-06", "2026-10-07"]) await logDay(fixed, day);
    const weekly = await newHabit({ name: "Nadar", frequency: "weekly_count", weeklyTarget: 2 });
    for (const day of ["2026-10-05", "2026-10-06", "2026-10-07"]) await logDay(weekly, day);
    const fixedGoal = await createHabitGoal(fixed, 20, { title: "Gimnasio" });
    const weeklyGoal = await createHabitGoal(weekly, 20, { title: "Nadar" });
    expect((await getGoal(fixedGoal.id))?.source).toMatchObject({ done: 2 });
    expect((await getGoal(weeklyGoal.id))?.source).toMatchObject({ done: 3 });
  });

  test("a project goal reads the project's percentage and name; the project's page figure is the same", async () => {
    const projectId = await newProject();
    const goal = await createProjectGoal(projectId);
    expect(goal).toMatchObject({ sourceKind: "project", projectId, habitId: null, target: 100 });
    expect((await getGoal(goal.id))?.source).toEqual({
      kind: "project",
      name: "Lanzar brahua-os",
      percent: 0,
      finished: false,
    });
  });

  test("a habit goal is achieved, once, when it is read after reaching its days; never reopened by itself", async () => {
    const habitId = await newHabit();
    const goal = await createHabitGoal(habitId, 3);
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) await logDay(habitId, day);
    // Several reads at once: one achievement, one date.
    const reads = await Promise.all([listGoals(), listGoals(), getGoal(goal.id), listGoals()]);
    for (const read of reads) {
      const found = Array.isArray(read) ? read.find((item) => item.id === goal.id) : read;
      expect(found).toMatchObject({ status: "achieved" });
    }
    const first = await row(goal.id);
    expect(first).toMatchObject({ status: "achieved" });
    expect(first.achievedAt).not.toBeNull();
    // Idempotent: the next read leaves the date alone.
    await listGoals();
    expect((await row(goal.id)).achievedAt).toEqual(first.achievedAt);
    // The owner corrects a past log: the goal stays achieved (decisión autónoma para revisar con el owner).
    await testDb.delete(habitLogs).where(eq(habitLogs.habitId, habitId));
    const after = (await listGoals()).find((item) => item.id === goal.id);
    expect(after).toMatchObject({ status: "achieved", source: { done: 0 } });
    expect((await row(goal.id)).achievedAt).toEqual(first.achievedAt);
  });

  test("a goal that is below its days is not achieved by a read (positive control of the test above)", async () => {
    const habitId = await newHabit();
    const goal = await createHabitGoal(habitId, 3);
    await logDay(habitId, "2026-10-01");
    await logDay(habitId, "2026-10-02");
    expect((await listGoals()).find((item) => item.id === goal.id)).toMatchObject({
      status: "active",
    });
    expect((await row(goal.id)).achievedAt).toBeNull();
  });

  test("an archived goal is not achieved by a read; reactivated, the next read does", async () => {
    const habitId = await newHabit();
    const goal = await createHabitGoal(habitId, 1);
    await archiveGoal({ id: goal.id });
    await logDay(habitId, "2026-10-01");
    expect((await listGoals()).find((item) => item.id === goal.id)).toMatchObject({
      status: "archived",
    });
    await unarchiveGoal({ id: goal.id });
    expect((await listGoals()).find((item) => item.id === goal.id)).toMatchObject({
      status: "achieved",
    });
  });

  test("a project goal is achieved when the project becomes «terminado», not before", async () => {
    const projectId = await newProject();
    const goal = await createProjectGoal(projectId);
    expect((await listGoals())[0]).toMatchObject({ status: "active" });
    await testDb
      .update(projects)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(projects.id, projectId));
    const achieved = (await listGoals())[0];
    expect(achieved).toMatchObject({
      id: goal.id,
      status: "achieved",
      source: { finished: true },
    });
    expect((await row(goal.id)).achievedAt).not.toBeNull();
  });

  test("creating a goal whose source already reached the target achieves it right away", async () => {
    const habitId = await newHabit();
    await logDay(habitId, "2026-10-01");
    const goal = await createHabitGoal(habitId, 1);
    expect(goal).toMatchObject({ status: "achieved" });
    expect(goal.achievedAt).not.toBeNull();
  });

  test("'Reabrir' on a goal whose source still reaches the target is refused; below it, it reopens", async () => {
    const habitId = await newHabit();
    const goal = await createHabitGoal(habitId, 1);
    await logDay(habitId, "2026-10-01");
    await listGoals(); // achieved by the read
    expect(await reopenGoal({ id: goal.id })).toEqual({
      ok: false,
      error: GOAL_ERRORS.sourceReached,
    });
    expect(await row(goal.id)).toMatchObject({ status: "achieved" });
    // The owner corrects the log: now "Reabrir" has something to do, and the next read keeps it.
    await testDb.delete(habitLogs).where(eq(habitLogs.habitId, habitId));
    expect(await reopenGoal({ id: goal.id })).toMatchObject({
      ok: true,
      data: { status: "active", achievedAt: null },
    });
    expect((await listGoals())[0]).toMatchObject({ status: "active" });
  });

  test("a higher target reopens an achieved habit goal; a lower one achieves it again", async () => {
    const habitId = await newHabit();
    await logDay(habitId, "2026-10-01");
    await logDay(habitId, "2026-10-02");
    const goal = await createHabitGoal(habitId, 2);
    expect(goal.status).toBe("achieved");
    const raised = await updateGoal({
      id: goal.id,
      title: "Correr",
      sourceKind: "habit",
      habitId,
      target: 5,
    });
    expect(raised).toMatchObject({ ok: true, data: { status: "active", target: 5 } });
    const lowered = await updateGoal({
      id: goal.id,
      title: "Correr",
      sourceKind: "habit",
      habitId,
      target: 2,
    });
    expect(lowered).toMatchObject({ ok: true, data: { status: "achieved", target: 2 } });
  });

  test("editing the source keeps a manual goal's entries and resets the reading", async () => {
    const goal = await create({ target: 3 });
    await add(goal.id, 3); // achieved by its entries
    expect((await row(goal.id)).status).toBe("achieved");
    const habitId = await newHabit();
    const toHabit = await updateGoal({
      id: goal.id,
      title: "Correr",
      sourceKind: "habit",
      habitId,
      target: 40,
    });
    // The achievement came from the old source: it is active again, and nothing of the entries is lost.
    expect(toHabit).toMatchObject({
      ok: true,
      data: {
        sourceKind: "habit",
        habitId,
        projectId: null,
        unit: null,
        target: 40,
        status: "active",
        achievedAt: null,
      },
    });
    expect(await testDb.$count(goalEntries, eq(goalEntries.goalId, goal.id))).toBe(1);

    const projectId = await newProject();
    expect(
      await updateGoal({ id: goal.id, title: "Lanzar", sourceKind: "project", projectId }),
    ).toMatchObject({
      ok: true,
      data: { sourceKind: "project", habitId: null, projectId, unit: null, target: 100 },
    });
    // Back to a quantity: the entries are still there and count again (and achieve it on the spot).
    const back = await updateGoal({
      id: goal.id,
      title: "Leer",
      sourceKind: "manual",
      target: 3,
      unit: "libros",
    });
    expect(back).toMatchObject({
      ok: true,
      data: {
        sourceKind: "manual",
        habitId: null,
        projectId: null,
        unit: "libros",
        sum: 3,
        status: "achieved",
      },
    });
    expect(await testDb.$count(goalEntries, eq(goalEntries.goalId, goal.id))).toBe(1);
  });

  test("a new source must exist; the goal's own can be gone and the title is still editable", async () => {
    const habitId = await newHabit();
    const goal = await createHabitGoal(habitId);
    const refused = await updateGoal({
      id: goal.id,
      title: "Correr",
      sourceKind: "habit",
      habitId: MISSING,
      target: 40,
    });
    expect(refused).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { sourceKind: [GOAL_ERRORS.sourceUnavailable] },
    });
    expect(await row(goal.id)).toMatchObject({ habitId });
    // The habit is deleted: the goal says it has no reading, and still takes edits that keep it.
    await testDb.update(habits).set({ deletedAt: new Date() }).where(eq(habits.id, habitId));
    expect((await getGoal(goal.id))?.source).toBeNull();
    expect(
      await updateGoal({
        id: goal.id,
        title: "Correr más",
        sourceKind: "habit",
        habitId,
        target: 40,
      }),
    ).toMatchObject({ ok: true, data: { title: "Correr más", habitId } });
  });

  test("a goal keeps following an archived habit and a finished project", async () => {
    const habitId = await newHabit();
    const goal = await createHabitGoal(habitId);
    await testDb.update(habits).set({ archivedAt: new Date() }).where(eq(habits.id, habitId));
    expect((await getGoal(goal.id))?.source).toMatchObject({ kind: "habit", done: 0 });
    const edited = await updateGoal({
      id: goal.id,
      title: "Correr (archivado)",
      sourceKind: "habit",
      habitId,
      target: 40,
    });
    expect(edited).toMatchObject({ ok: true });
  });

  test("the list reads the sources in a fixed number of queries, whatever the number of goals", async () => {
    const habitId = await newHabit();
    const projectId = await newProject();
    await createHabitGoal(habitId, 40, { title: "H1" });
    await createProjectGoal(projectId, { title: "P1" });
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    await selectVisibleGoals(testDb, NOW);
    const queries = () => select.mock.calls.length + execute.mock.calls.length;
    const forTwo = queries();
    for (let index = 0; index < 4; index += 1) {
      await createHabitGoal(await newHabit({ name: `h${index}` }), 40, { title: `H${index + 2}` });
      await createProjectGoal(await newProject({ name: `p${index}` }), { title: `P${index + 2}` });
    }
    select.mockClear();
    execute.mockClear();
    const goalsRead = await selectVisibleGoals(testDb, NOW);
    expect(goalsRead).toHaveLength(10);
    expect(queries()).toBe(forTwo);
    select.mockRestore();
    execute.mockRestore();
  });
});
