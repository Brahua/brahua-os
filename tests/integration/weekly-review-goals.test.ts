// W1 of `weekly-review`, the goals side, against the throwaway database: `getGoalsWeekReview` (the
// goals in the works with their reading and pace, the ones achieved within the week on Lima's days,
// the entries logged within it) and the weekly objective through the contract
// (`getWeeklyObjectiveForWeek` / `setWeeklyObjectiveForWeek`, the same row and the same week lock
// as /goals), plus authorization. Habit fixtures start BEFORE the logs they count (lesson of goals).
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  getGoalsWeekReview,
  getWeeklyObjectiveForWeek,
  selectGoalsWeekReview,
  setWeeklyObjectiveForWeek,
} from "@/modules/goals/contracts";
import { goalEntries, goals, weeklyObjectives } from "@/modules/goals/db/schema";
import { GOAL_ERRORS } from "@/modules/goals/goals-copy";
import { GOALS_ADVISORY_SPACE } from "@/modules/goals/lock-keys";
import { goalsWeekKey } from "@/modules/goals/lock-keys";
import { getWeeklyObjective } from "@/modules/goals/queries";
import { habitLogs, habits } from "@/modules/habits/db/schema";
import { projects } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
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

/** Monday 2026-10-19, 10:00 in Lima: reviewing the week 2026-10-12 – 2026-10-18. */
const NOW = new Date("2026-10-19T15:00:00Z");
const WEEK = "2026-10-12";
const NEXT_WEEK = "2026-10-19";

let position = 0;
async function insertGoal(values: Partial<typeof goals.$inferInsert> & { title: string }) {
  const [row] = await testDb
    .insert(goals)
    .values({
      periodKind: "year",
      year: 2026,
      sourceKind: "manual",
      target: 12,
      unit: "libros",
      position: position++,
      ...values,
    })
    .returning({ id: goals.id });
  return row.id;
}

const entry = (goalId: string, entryDate: string, delta = 1, deletedAt: Date | null = null) =>
  testDb.insert(goalEntries).values({ goalId, entryDate, delta, deletedAt });

async function insertHabit(name: string, values: Partial<typeof habits.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(habits)
    .values({
      name,
      measure: "check",
      frequency: "daily",
      startDate: "2026-09-01",
      sortOrder: 0,
      ...values,
    })
    .returning({ id: habits.id });
  return row.id;
}

const review = () => getGoalsWeekReview(WEEK, NOW);

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  await seed(testDb);
  position = 0;
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

describe("the goals in the works", () => {
  test("active goals whose period is going on today, in their manual order", async () => {
    const year = await insertGoal({ title: "Leer 12 libros" });
    const quarter = await insertGoal({
      title: "Correr 30 días",
      periodKind: "quarter",
      quarter: 4,
      target: 30,
      unit: "días",
    });
    await insertGoal({ title: "Del año pasado", year: 2025 });
    await insertGoal({ title: "Del año que viene", year: 2027 });
    await insertGoal({ title: "T3 ya pasó", periodKind: "quarter", quarter: 3 });
    await insertGoal({ title: "Archivada", status: "archived" });
    await insertGoal({
      title: "Lograda",
      status: "achieved",
      achievedAt: new Date("2026-03-01T15:00:00Z"),
    });
    await insertGoal({ title: "Borrada", deletedAt: new Date() });
    const { active } = await review();
    expect(active.map((goal) => goal.id)).toEqual([year, quarter]);
  });

  test("a manual goal reads «5 de 12 libros» with the next step as a number and a sentence", async () => {
    const id = await insertGoal({ title: "Leer 12 libros" });
    for (const day of ["2026-03-01", "2026-05-01", "2026-08-01"]) await entry(id, day);
    const [goal] = (await review()).active;
    expect(goal).toMatchObject({
      id,
      title: "Leer 12 libros",
      href: `/goals/${id}`,
      sourceKind: "manual",
      value: 3,
      target: 12,
      unit: "libros",
      count: "3 de 12 libros",
      ratio: 0.25,
      paceState: "next-step",
      // 9 left over the ~10.6 weeks that remain on 2026-10-19: one a week.
      perWeekNeeded: 1,
      line: expect.stringMatching(/^Para llegar: ~1 /),
    });
  });

  test("on pace, ahead and done are states without a next step", async () => {
    const onPace = await insertGoal({ title: "A ritmo", target: 12 });
    const ahead = await insertGoal({ title: "Adelante", target: 12 });
    const done = await insertGoal({ title: "Hecha", target: 12 });
    // On 2026-10-19 the even pace is ~9.6 of 12 (tolerance 1).
    await entry(onPace, "2026-06-01", 10);
    await entry(ahead, "2026-06-01", 12 - 1); // 11: at least a tolerance above
    await entry(done, "2026-06-01", 12);
    const byId = Object.fromEntries((await review()).active.map((goal) => [goal.id, goal]));
    expect(byId[onPace]).toMatchObject({
      paceState: "on",
      perWeekNeeded: null,
      line: "Vas a tu ritmo",
    });
    expect(byId[ahead]).toMatchObject({ paceState: "ahead", perWeekNeeded: null });
    expect(byId[done]).toMatchObject({ paceState: "done", perWeekNeeded: null, ratio: 1 });
  });

  test("a habit goal reads the days done in its period, like /goals", async () => {
    const habitId = await insertHabit("Correr");
    const id = await insertGoal({
      title: "Correr 40 días",
      sourceKind: "habit",
      habitId,
      unit: null,
      target: 40,
    });
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-05"]) {
      await testDb.insert(habitLogs).values({ habitId, day, quantity: 1, target: 1 });
    }
    const [goal] = (await review()).active;
    expect(goal).toMatchObject({ id, sourceKind: "habit", value: 3, target: 40, unit: "días" });
    expect(goal.count).toContain("3 de 40");
    expect(goal.paceState).toBe("next-step");
  });

  test("a project goal has no pace: its progress is the project's", async () => {
    const [area] = await testDb
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, "work"));
    const [project] = await testDb
      .insert(projects)
      .values({ name: "Lanzar v1", lifeAreaId: area.id, status: "active" })
      .returning({ id: projects.id });
    // The progress counts tasks (hitos-agrupan-tareas): 1 of 4 done.
    for (let index = 0; index < 4; index += 1) {
      await testDb.insert(tasks).values({
        title: `Tarea ${index}`,
        projectId: project.id,
        doneAt: index < 1 ? new Date() : null,
      });
    }
    await insertGoal({
      title: "Lanzar",
      sourceKind: "project",
      projectId: project.id,
      unit: null,
      target: 100,
    });
    const [goal] = (await review()).active;
    expect(goal).toMatchObject({
      sourceKind: "project",
      value: 25,
      target: 100,
      unit: "%",
      paceState: "none",
      perWeekNeeded: null,
    });
  });

  test("a goal whose habit was deleted says its source is unavailable", async () => {
    const habitId = await insertHabit("Borrado", { deletedAt: new Date() });
    await insertGoal({ title: "Sin fuente", sourceKind: "habit", habitId, unit: null, target: 40 });
    const [goal] = (await review()).active;
    expect(goal).toMatchObject({
      paceState: "unavailable",
      value: null,
      count: null,
      perWeekNeeded: null,
    });
    expect(goal.line).toBeTruthy();
  });

  test("none in the works: empty lists", async () => {
    expect(await review()).toEqual({ weekStart: WEEK, active: [], achieved: [], entries: [] });
  });

  test("any day of the week names the same Monday; a malformed day is a RangeError", async () => {
    expect((await getGoalsWeekReview("2026-10-16", NOW)).weekStart).toBe(WEEK);
    await expect(selectGoalsWeekReview(testDb, "2026-10-1", NOW)).rejects.toThrow(RangeError);
  });
});

describe("achieved within the week", () => {
  test("those achieved on the week's Lima days, bounds included", async () => {
    const monday = await insertGoal({
      title: "Lunes 00:00",
      status: "achieved",
      achievedAt: new Date("2026-10-12T05:00:00Z"),
    });
    const sunday = await insertGoal({
      title: "Domingo 23:59",
      status: "achieved",
      achievedAt: new Date("2026-10-19T04:59:00Z"),
    });
    await insertGoal({
      title: "Antes",
      status: "achieved",
      achievedAt: new Date("2026-10-12T04:59:00Z"),
    });
    await insertGoal({
      title: "Después",
      status: "achieved",
      achievedAt: new Date("2026-10-19T05:00:00Z"),
    });
    await insertGoal({
      title: "Borrada",
      status: "achieved",
      achievedAt: new Date("2026-10-14T20:00:00Z"),
      deletedAt: new Date(),
    });
    await insertGoal({ title: "En curso" });
    const { achieved, active } = await review();
    expect(achieved.map((goal) => goal.id).sort()).toEqual([monday, sunday].sort());
    expect(achieved[0]).toMatchObject({
      href: expect.stringMatching(/^\/goals\//),
      achievedAt: expect.any(String),
    });
    // An achieved goal is no longer «in the works».
    expect(active.map((goal) => goal.title)).toEqual(["En curso"]);
  });

  test("a goal whose habit reached its target is achieved by the read, as /goals does", async () => {
    const habitId = await insertHabit("Correr");
    const id = await insertGoal({
      title: "Correr 2 días",
      sourceKind: "habit",
      habitId,
      unit: null,
      target: 2,
    });
    for (const day of ["2026-10-13", "2026-10-14"]) {
      await testDb.insert(habitLogs).values({ habitId, day, quantity: 1, target: 1 });
    }
    // The same settle as /goals: it becomes achieved, stamped with the database clock's now (which
    // week that is depends on when the test runs, so only the state is asserted).
    const result = await review();
    expect(result.active).toEqual([]);
    const [row] = await testDb.select().from(goals).where(eq(goals.id, id));
    expect(row.status).toBe("achieved");
  });
});

describe("entries logged within the week", () => {
  test("grouped per goal by the day logged; undone and other weeks' entries stay out", async () => {
    const books = await insertGoal({ title: "Leer 12 libros" });
    const km = await insertGoal({ title: "Correr 300 km", unit: "km", target: 300 });
    const untouched = await insertGoal({ title: "Sin movimiento" });
    await entry(books, "2026-10-12");
    await entry(books, "2026-10-18");
    await entry(books, "2026-10-11"); // the day before
    await entry(books, "2026-10-19"); // the day after
    await entry(books, "2026-10-14", 1, new Date()); // undone
    await entry(km, "2026-10-13", 10);
    await entry(km, "2026-10-15", 5);
    await entry(km, "2026-10-16", -3); // a correction
    const { entries } = await review();
    expect(entries).toEqual([
      { goalId: books, title: "Leer 12 libros", unit: "libros", count: 2, total: 2 },
      { goalId: km, title: "Correr 300 km", unit: "km", count: 3, total: 12 },
    ]);
    expect(entries.some((e) => e.goalId === untouched)).toBe(false);
  });

  test("entries of a deleted goal do not show; achieved and archived goals' entries do", async () => {
    const deleted = await insertGoal({ title: "Borrada", deletedAt: new Date() });
    const done = await insertGoal({
      title: "Lograda",
      status: "achieved",
      achievedAt: new Date("2026-03-01T15:00:00Z"),
    });
    await entry(deleted, "2026-10-13");
    await entry(done, "2026-10-13");
    expect((await review()).entries.map((e) => e.goalId)).toEqual([done]);
  });
});

describe("a fixed number of queries", () => {
  test("whatever the number of goals", async () => {
    await insertGoal({ title: "Uno" });
    const select = vi.spyOn(testDb, "select");
    await selectGoalsWeekReview(testDb, WEEK, NOW);
    const forOne = select.mock.calls.length;
    for (let index = 0; index < 6; index += 1) {
      const id = await insertGoal({ title: `G${index}` });
      await entry(id, "2026-10-13");
    }
    select.mockClear();
    const result = await selectGoalsWeekReview(testDb, WEEK, NOW);
    expect(result.active).toHaveLength(7);
    expect(select.mock.calls.length).toBe(forOne);
    select.mockRestore();
  });
});

describe("the weekly objective through the contract", () => {
  const rowCount = async () => (await testDb.select().from(weeklyObjectives)).length;

  test("reads null, sets, replaces and says what it replaced; it is the row /goals reads", async () => {
    expect(await getWeeklyObjectiveForWeek(NEXT_WEEK)).toBeNull();
    expect(await setWeeklyObjectiveForWeek(NEXT_WEEK, "Cerrar el informe")).toEqual({
      ok: true,
      change: { weekStart: NEXT_WEEK, text: "Cerrar el informe", previous: null },
    });
    expect(await getWeeklyObjectiveForWeek(NEXT_WEEK)).toEqual({
      weekStart: NEXT_WEEK,
      text: "Cerrar el informe",
    });
    // The same store as /goals' own read.
    expect(await getWeeklyObjective(NEXT_WEEK)).toEqual({
      weekStart: NEXT_WEEK,
      text: "Cerrar el informe",
    });
    expect(await setWeeklyObjectiveForWeek(NEXT_WEEK, "Otro")).toMatchObject({
      ok: true,
      change: { text: "Otro", previous: "Cerrar el informe" },
    });
    expect(await rowCount()).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith("/goals", "layout");
    // Another week is another row.
    expect(await getWeeklyObjectiveForWeek(WEEK)).toBeNull();
  });

  test("normalizes and validates like /goals: never throws, never writes an invalid one", async () => {
    expect(await setWeeklyObjectiveForWeek(NEXT_WEEK, "  Cerrar \n  el   informe ")).toMatchObject({
      ok: true,
      change: { text: "Cerrar el informe" },
    });
    expect(await setWeeklyObjectiveForWeek(NEXT_WEEK, "   ")).toEqual({
      ok: false,
      error: GOAL_ERRORS.weeklyRequired,
    });
    expect(await setWeeklyObjectiveForWeek(NEXT_WEEK, "a".repeat(141))).toEqual({
      ok: false,
      error: GOAL_ERRORS.weeklyTooLong,
    });
    expect(await setWeeklyObjectiveForWeek(NEXT_WEEK, "ho​la")).toEqual({
      ok: false,
      error: GOAL_ERRORS.weeklyInvisible,
    });
    for (const week of ["2026-10-20", "2026-02-30", "lunes", ""]) {
      expect(await setWeeklyObjectiveForWeek(week, "x")).toEqual({
        ok: false,
        error: GOAL_ERRORS.weekInvalid,
      });
    }
    expect(await getWeeklyObjectiveForWeek("2026-10-20")).toBeNull();
    expect((await getWeeklyObjectiveForWeek(NEXT_WEEK))?.text).toBe("Cerrar el informe");
    expect(await rowCount()).toBe(1);
  });

  test("it takes the week's lock of goals: it waits while another holds it, and other weeks do not", async () => {
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        GOALS_ADVISORY_SPACE,
        goalsWeekKey(NEXT_WEEK),
      ]);
      const waiting = setWeeklyObjectiveForWeek(NEXT_WEEK, "Espera");
      // Another week is not held back (positive control).
      expect(await setWeeklyObjectiveForWeek(WEEK, "Libre")).toMatchObject({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await getWeeklyObjectiveForWeek(NEXT_WEEK)).toBeNull();
      await holder.query("commit");
      expect(await waiting).toMatchObject({ ok: true });
    } finally {
      holder.release();
    }
    expect((await getWeeklyObjectiveForWeek(NEXT_WEEK))?.text).toBe("Espera");
  });

  test("concurrent sets of one week end with one row", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        setWeeklyObjectiveForWeek(NEXT_WEEK, `Texto ${index}`),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await rowCount()).toBe(1);
    // Exactly one of them found no previous text.
    expect(results.filter((r) => r.ok && r.change.previous === null)).toHaveLength(1);
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
  ])("with %s every contract redirects to /login and nothing is written", async (_, headers) => {
    await insertGoal({ title: "Leer 12 libros" });
    // Positive control: the owner reads and writes.
    expect((await review()).active).toHaveLength(1);
    expect(await setWeeklyObjectiveForWeek(NEXT_WEEK, "Mío")).toMatchObject({ ok: true });
    request.headers = await headers();
    const toLogin = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(review()).rejects.toMatchObject(toLogin);
    await expect(getWeeklyObjectiveForWeek(NEXT_WEEK)).rejects.toMatchObject(toLogin);
    await expect(setWeeklyObjectiveForWeek(NEXT_WEEK, "Intruso")).rejects.toMatchObject(toLogin);
    const [row] = await testDb.select().from(weeklyObjectives);
    expect(row.text).toBe("Mío");
  });
});
