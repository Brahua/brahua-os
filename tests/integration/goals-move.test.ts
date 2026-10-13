// G4 of `goals` against the throwaway database: «Pasar al próximo periodo» (the same goal moves to
// the next period and the end of the order, entries and source kept), its exact «Deshacer» (it
// only applies while the goal still has the period the move gave it), the goals that can't move,
// two moves at once (it moves once) and authorization.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import {
  archiveGoal,
  createGoal,
  deleteGoal,
  markGoalAchieved,
  moveGoalToNext,
  undoMoveOfGoal,
} from "@/modules/goals/actions";
import { goalEntries, goals } from "@/modules/goals/db/schema";
import { GOAL_ERRORS } from "@/modules/goals/goals-copy";
import { GOALS_ADVISORY_SPACE, GOALS_ORDER_KEY } from "@/modules/goals/goals";
import { currentPeriod, nextPeriod } from "@/modules/goals/pace";
import { habits } from "@/modules/habits/db/schema";
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

// A quarter well in the past (so the goal is in "Anteriores") and the owner's current quarter.
const PAST = { periodKind: "quarter", year: 2026, quarter: 1 } as const;
const MANUAL = { sourceKind: "manual", target: 12, unit: "libros" } as const;

async function create(values: Record<string, unknown> = {}) {
  const result = await createGoal({ title: "Leer 12 libros", ...PAST, ...MANUAL, ...values });
  if (!result.ok) throw new Error(`createGoal failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function move(id: string, year: number, quarter: number | null) {
  const result = await moveGoalToNext({ id, year, quarter });
  if (!result.ok) throw new Error(`moveGoalToNext failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function row(id: string) {
  const [found] = await testDb.select().from(goals).where(eq(goals.id, id));
  return found;
}

async function positions() {
  const rows = await testDb
    .select({ title: goals.title, position: goals.position })
    .from(goals)
    .orderBy(goals.position);
  return rows.map((r) => [r.title, r.position]);
}

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

describe("move to the next period", () => {
  test("the same goal goes to the next quarter and the end of the order, entries kept", async () => {
    const a = await create({ title: "A" });
    await create({ title: "B" });
    await create({ title: "C" });
    // The entries of a goal of a past period can't be added through the action (the screen hides
    // "+1"), so they are written as the data of that period.
    await testDb.insert(goalEntries).values({ goalId: a.id, delta: 4, entryDate: "2026-02-10" });
    const moved = await move(a.id, 2026, 1);
    expect(moved.moved).toBe(true);
    expect(moved.from).toEqual({ year: 2026, quarter: 1, position: 0 });
    expect(moved.goal).toMatchObject({ id: a.id, year: 2026, quarter: 2, sum: 4, position: 2 });
    expect(await row(a.id)).toMatchObject({
      sourceKind: "manual",
      target: 12,
      unit: "libros",
      status: "active",
    });
    // Contiguous: the others closed the gap.
    expect(await positions()).toEqual([
      ["B", 0],
      ["C", 1],
      ["A", 2],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/goals", "layout");
  });

  test("T4 goes to T1 of the next year and a year goal to the next year", async () => {
    const q = await create({ title: "T4", year: 2026, quarter: 4 });
    expect((await move(q.id, 2026, 4)).goal).toMatchObject({ year: 2027, quarter: 1 });
    const y = await create({ title: "Año", periodKind: "year", year: 2025, quarter: null });
    expect((await move(y.id, 2025, null)).goal).toMatchObject({
      periodKind: "year",
      year: 2026,
      quarter: null,
    });
  });

  test("the current period moves too, and a habit goal keeps its habit and days", async () => {
    const today = ownerDateKey(new Date());
    const now = currentPeriod("quarter", today);
    if (now.kind !== "quarter") throw new Error("expected a quarter");
    const [habit] = await testDb
      .insert(habits)
      .values({
        name: "Correr",
        measure: "check",
        frequency: "daily",
        startDate: "2026-01-01",
        sortOrder: 0,
      })
      .returning({ id: habits.id });
    const goal = await create({
      title: "Correr",
      year: now.year,
      quarter: now.quarter,
      sourceKind: "habit",
      habitId: habit.id,
      target: 40,
      unit: undefined,
    });
    const next = nextPeriod(now);
    if (next.kind !== "quarter") throw new Error("expected a quarter");
    const moved = await move(goal.id, now.year, now.quarter);
    expect(moved.goal).toMatchObject({
      year: next.year,
      quarter: next.quarter,
      sourceKind: "habit",
      habitId: habit.id,
      target: 40,
    });
  });

  test("a goal moves again from its new period (a second roll-over)", async () => {
    const goal = await create();
    await move(goal.id, 2026, 1);
    expect((await move(goal.id, 2026, 2)).goal).toMatchObject({ year: 2026, quarter: 3 });
  });
});

describe("what can't move", () => {
  test("archived, achieved, deleted and missing goals; a period that hasn't started", async () => {
    const archived = await create({ title: "Archivada" });
    await archiveGoal({ id: archived.id });
    const achieved = await create({ title: "Lograda" });
    await markGoalAchieved({ id: achieved.id });
    const deleted = await create({ title: "Eliminada" });
    await deleteGoal({ id: deleted.id });
    const future = await create({ title: "Futura", year: 2099, quarter: 1 });
    // Positive control: a goal in course does move.
    const fine = await create({ title: "En curso" });
    expect(await moveGoalToNext({ id: fine.id, year: 2026, quarter: 1 })).toMatchObject({
      ok: true,
    });

    expect(await moveGoalToNext({ id: archived.id, year: 2026, quarter: 1 })).toEqual({
      ok: false,
      error: GOAL_ERRORS.archived,
    });
    for (const [id, year, quarter] of [
      [achieved.id, 2026, 1],
      [future.id, 2099, 1],
    ] as const) {
      expect(await moveGoalToNext({ id, year, quarter })).toEqual({
        ok: false,
        error: GOAL_ERRORS.notMovable,
      });
    }
    for (const id of [deleted.id, MISSING]) {
      expect(await moveGoalToNext({ id, year: 2026, quarter: 1 })).toEqual({
        ok: false,
        error: GOAL_ERRORS.notFound,
      });
    }
    expect(await row(achieved.id)).toMatchObject({ year: 2026, quarter: 1 });
    expect(await row(future.id)).toMatchObject({ year: 2099, quarter: 1 });
    expect(await row(archived.id)).toMatchObject({ year: 2026, quarter: 1 });
  });

  test("bad input never reaches the database", async () => {
    const goal = await create();
    for (const input of [
      {},
      { id: "x", year: 2026, quarter: 1 },
      { id: goal.id, year: 1800, quarter: 1 },
      { id: goal.id, year: 2026, quarter: 9 },
    ]) {
      expect(await moveGoalToNext(input)).toMatchObject({ ok: false });
    }
    expect(await row(goal.id)).toMatchObject({ year: 2026, quarter: 1 });
  });
});

describe("undo", () => {
  test("puts the goal back in its period and its place, entries untouched", async () => {
    const a = await create({ title: "A" });
    await create({ title: "B" });
    await create({ title: "C" });
    await testDb.insert(goalEntries).values({ goalId: a.id, delta: 3, entryDate: "2026-02-10" });
    const moved = await move(a.id, 2026, 1);
    const undone = await undoMoveOfGoal({
      id: a.id,
      from: moved.from,
      applied: { year: moved.goal.year, quarter: moved.goal.quarter },
    });
    expect(undone).toMatchObject({
      ok: true,
      data: { restored: true, goal: { year: 2026, quarter: 1, position: 0, sum: 3 } },
    });
    expect(await positions()).toEqual([
      ["A", 0],
      ["B", 1],
      ["C", 2],
    ]);
  });

  test("a second undo, or one after the goal changed, changes nothing and says so", async () => {
    const a = await create({ title: "A" });
    const moved = await move(a.id, 2026, 1);
    const undo = {
      id: a.id,
      from: moved.from,
      applied: { year: 2026, quarter: 2 },
    };
    expect(await undoMoveOfGoal(undo)).toMatchObject({ ok: true, data: { restored: true } });
    // Twice: the goal is not in the period the move gave it any more.
    expect(await undoMoveOfGoal(undo)).toMatchObject({
      ok: true,
      data: { restored: false, goal: { year: 2026, quarter: 1 } },
    });

    // Moved again meanwhile: the old undo must not drag it back.
    await move(a.id, 2026, 1);
    await move(a.id, 2026, 2);
    expect(await undoMoveOfGoal(undo)).toMatchObject({
      ok: true,
      data: { restored: false, goal: { year: 2026, quarter: 3 } },
    });
    expect(await row(a.id)).toMatchObject({ year: 2026, quarter: 3 });

    // Archived meanwhile: left alone too.
    await move(a.id, 2026, 3);
    await archiveGoal({ id: a.id });
    expect(await undoMoveOfGoal({ ...undo, applied: { year: 2026, quarter: 4 } })).toMatchObject({
      ok: true,
      data: { restored: false },
    });
    expect(await row(a.id)).toMatchObject({ year: 2026, quarter: 4, status: "archived" });
  });

  test("an undo of a goal that is gone is refused", async () => {
    expect(
      await undoMoveOfGoal({
        id: MISSING,
        from: { year: 2026, quarter: 1, position: 0 },
        applied: { year: 2026, quarter: 2 },
      }),
    ).toEqual({ ok: false, error: GOAL_ERRORS.notFound });
  });

  test("a place past the end lands last (the list shrank meanwhile)", async () => {
    const a = await create({ title: "A" });
    const moved = await move(a.id, 2026, 1);
    const undone = await undoMoveOfGoal({
      id: a.id,
      from: { ...moved.from, position: 99 },
      applied: { year: 2026, quarter: 2 },
    });
    expect(undone).toMatchObject({ ok: true, data: { restored: true } });
    expect(await positions()).toEqual([["A", 0]]);
  });
});

describe("concurrency", () => {
  test("two moves at once move the goal once (positive control: two goals move twice)", async () => {
    const goal = await create({ title: "Una" });
    const [first, second] = await Promise.all([
      moveGoalToNext({ id: goal.id, year: 2026, quarter: 1 }),
      moveGoalToNext({ id: goal.id, year: 2026, quarter: 1 }),
    ]);
    expect([first, second].every((result) => result.ok)).toBe(true);
    const moved = [first, second].map((result) => (result.ok ? result.data.moved : null));
    expect(moved.filter(Boolean)).toHaveLength(1);
    expect(await row(goal.id)).toMatchObject({ year: 2026, quarter: 2 });

    const x = await create({ title: "X" });
    const y = await create({ title: "Y" });
    const both = await Promise.all([
      moveGoalToNext({ id: x.id, year: 2026, quarter: 1 }),
      moveGoalToNext({ id: y.id, year: 2026, quarter: 1 }),
    ]);
    expect(both.map((result) => (result.ok ? result.data.moved : null))).toEqual([true, true]);
    const stored = await testDb
      .select({ position: goals.position })
      .from(goals)
      .orderBy(goals.position);
    expect(stored.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  test("waits for the order lock", async () => {
    const goal = await create({ title: "Una" });
    await holdingLock(GOALS_ORDER_KEY, async (release) => {
      const pending = moveGoalToNext({ id: goal.id, year: 2026, quarter: 1 });
      await waitForLockWaiters(GOALS_ORDER_KEY, 1);
      expect(await row(goal.id)).toMatchObject({ quarter: 1 });
      await release();
      expect(await pending).toMatchObject({ ok: true, data: { moved: true } });
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
  ])("with %s both actions are refused and nothing changes", async (_, headers) => {
    const goal = await create();
    request.headers = await headers();
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await moveGoalToNext({ id: goal.id, year: 2026, quarter: 1 })).toEqual(refused);
    expect(
      await undoMoveOfGoal({
        id: goal.id,
        from: { year: 2026, quarter: 1, position: 0 },
        applied: { year: 2026, quarter: 1 },
      }),
    ).toEqual(refused);
    expect(await row(goal.id)).toMatchObject({ year: 2026, quarter: 1 });
  });
});
