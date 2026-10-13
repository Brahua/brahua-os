// G3 of `goals` against the throwaway database: the weekly objective (set, replace, clear and the
// exact undo, concurrent sets under the week's lock, Monday validation, authorization) and the
// "Metas" section of habits and projects (the provider reads only the visible, non-archived goals
// that follow that habit or project; the composition root registers once).
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ensureGoalExtensions } from "@/lib/goal-extensions";
import { seed } from "@/modules/core/seed";
import {
  archiveGoal,
  clearWeeklyObjective,
  createGoal,
  deleteGoal,
  setWeeklyObjective,
  undoWeeklyObjective,
} from "@/modules/goals/actions";
import { weeklyObjectives } from "@/modules/goals/db/schema";
import { GOAL_ERRORS } from "@/modules/goals/goals-copy";
import { GOALS_ADVISORY_SPACE, selectGoalsFollowing } from "@/modules/goals/goals";
import { goalsWeekKey } from "@/modules/goals/lock-keys";
import { habitGoalsSection, projectGoalsSection } from "@/modules/goals/linked-goals";
import { getWeeklyObjective } from "@/modules/goals/queries";
import { renderHabitSections } from "@/modules/habits/contracts";
import { habits } from "@/modules/habits/db/schema";
import { projects } from "@/modules/projects/db/schema";
import { renderProjectSections } from "@/modules/projects/contracts";
import { lifeAreas } from "@/modules/core/db/schema";
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
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

const WEEK = "2026-10-12";
const NEXT_WEEK = "2026-10-19";

async function set(weekStart: string, text: string) {
  const result = await setWeeklyObjective({ weekStart, text });
  if (!result.ok) throw new Error(`setWeeklyObjective failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function textOf(weekStart: string): Promise<string | null> {
  return (await getWeeklyObjective(weekStart))?.text ?? null;
}

const rowCount = async () => (await testDb.select().from(weeklyObjectives)).length;

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

describe("set and replace", () => {
  test("a new week has no objective; setting it creates the row and says there was none before", async () => {
    expect(await getWeeklyObjective(WEEK)).toBeNull();
    expect(await set(WEEK, "Cerrar el informe")).toEqual({
      weekStart: WEEK,
      text: "Cerrar el informe",
      previous: null,
    });
    expect(await getWeeklyObjective(WEEK)).toEqual({ weekStart: WEEK, text: "Cerrar el informe" });
    expect(revalidatePath).toHaveBeenCalledWith("/goals", "layout");
  });

  test("setting again replaces it (one row) and returns the text it replaced", async () => {
    await set(WEEK, "Uno");
    expect(await set(WEEK, "Dos")).toMatchObject({ text: "Dos", previous: "Uno" });
    expect(await textOf(WEEK)).toBe("Dos");
    expect(await rowCount()).toBe(1);
  });

  test("each week is its own: the next one starts empty", async () => {
    await set(WEEK, "Esta");
    expect(await textOf(NEXT_WEEK)).toBeNull();
    await set(NEXT_WEEK, "La otra");
    expect(await textOf(WEEK)).toBe("Esta");
    expect(await rowCount()).toBe(2);
  });

  test("the text is normalized and validated on the server", async () => {
    expect((await set(WEEK, "  Cerrar \n  el   informe ")).text).toBe("Cerrar el informe");
    expect(await setWeeklyObjective({ weekStart: WEEK, text: "   " })).toMatchObject({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { text: [GOAL_ERRORS.weeklyRequired] },
    });
    expect(await setWeeklyObjective({ weekStart: WEEK, text: "a".repeat(141) })).toMatchObject({
      ok: false,
      fieldErrors: { text: [GOAL_ERRORS.weeklyTooLong] },
    });
    expect(await set(WEEK, "a".repeat(140))).toMatchObject({ weekStart: WEEK });
    expect(await setWeeklyObjective({ weekStart: WEEK, text: "ho​la" })).toMatchObject({
      ok: false,
      fieldErrors: { text: [GOAL_ERRORS.weeklyInvisible] },
    });
    // Nothing invalid was written: the last valid text is there.
    expect(await textOf(WEEK)).toBe("a".repeat(140));
  });

  test("the week must be an existing Monday", async () => {
    for (const weekStart of ["2026-10-13", "2026-10-18", "2026-02-30", "lunes", "", null, 5]) {
      expect(await setWeeklyObjective({ weekStart, text: "x" })).toMatchObject({
        ok: false,
        fieldErrors: { weekStart: [GOAL_ERRORS.weekInvalid] },
      });
      expect(await clearWeeklyObjective({ weekStart })).toMatchObject({ ok: false });
      expect(await undoWeeklyObjective({ weekStart, previous: null, applied: "x" })).toMatchObject({
        ok: false,
      });
    }
    expect(await rowCount()).toBe(0);
    // A malformed week never reaches a query on the read side either.
    expect(await getWeeklyObjective("2026-10-13")).toBeNull();
  });
});

describe("clear and the exact undo", () => {
  test("clearing removes the row and returns what it removed; an empty week clears without error", async () => {
    await set(WEEK, "Cerrar el informe");
    const cleared = await clearWeeklyObjective({ weekStart: WEEK });
    expect(cleared).toEqual({
      ok: true,
      data: { weekStart: WEEK, text: null, previous: "Cerrar el informe" },
    });
    expect(await rowCount()).toBe(0);
    expect(await clearWeeklyObjective({ weekStart: WEEK })).toEqual({
      ok: true,
      data: { weekStart: WEEK, text: null, previous: null },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/goals", "layout");
  });

  test("undoing the first set puts back the absence", async () => {
    const change = await set(WEEK, "Nuevo");
    expect(
      await undoWeeklyObjective({
        weekStart: WEEK,
        previous: change.previous,
        applied: change.text,
      }),
    ).toEqual({ ok: true, data: { weekStart: WEEK, text: null, restored: true } });
    expect(await rowCount()).toBe(0);
  });

  test("undoing a replace puts back exactly the text it replaced", async () => {
    await set(WEEK, "Antes");
    const change = await set(WEEK, "Después");
    expect(
      await undoWeeklyObjective({
        weekStart: WEEK,
        previous: change.previous,
        applied: change.text,
      }),
    ).toMatchObject({ ok: true, data: { text: "Antes", restored: true } });
    expect(await textOf(WEEK)).toBe("Antes");
  });

  test("undoing a clear puts the text back", async () => {
    await set(WEEK, "Cerrar el informe");
    const cleared = await clearWeeklyObjective({ weekStart: WEEK });
    if (!cleared.ok) throw new Error("clear failed");
    expect(
      await undoWeeklyObjective({
        weekStart: WEEK,
        previous: cleared.data.previous,
        applied: cleared.data.text,
      }),
    ).toMatchObject({ ok: true, data: { text: "Cerrar el informe", restored: true } });
    expect(await textOf(WEEK)).toBe("Cerrar el informe");
  });

  test("an undo twice, or after another edit, changes nothing (it never writes 'whatever is current')", async () => {
    await set(WEEK, "Antes");
    const change = await set(WEEK, "Después");
    const input = { weekStart: WEEK, previous: change.previous, applied: change.text };
    expect(await undoWeeklyObjective(input)).toMatchObject({ data: { restored: true } });
    // Twice: the week holds "Antes", not what the change left.
    expect(await undoWeeklyObjective(input)).toMatchObject({
      ok: true,
      data: { text: "Antes", restored: false },
    });
    expect(await textOf(WEEK)).toBe("Antes");

    // Another edit in between: the undo of the older change leaves it alone.
    const first = await set(WEEK, "Uno");
    await set(WEEK, "Dos");
    expect(
      await undoWeeklyObjective({ weekStart: WEEK, previous: first.previous, applied: first.text }),
    ).toMatchObject({ ok: true, data: { text: "Dos", restored: false } });
    expect(await textOf(WEEK)).toBe("Dos");
  });

  test("the undo is for its own week", async () => {
    await set(WEEK, "Esta");
    await set(NEXT_WEEK, "Otra");
    await undoWeeklyObjective({ weekStart: NEXT_WEEK, previous: null, applied: "Otra" });
    expect(await textOf(WEEK)).toBe("Esta");
    expect(await textOf(NEXT_WEEK)).toBeNull();
  });
});

describe("concurrency (the week's lock)", () => {
  test("sets of one week wait for the lock; different weeks do not (positive control)", async () => {
    await holdingLock(goalsWeekKey(WEEK), async (release) => {
      const waiting = setWeeklyObjective({ weekStart: WEEK, text: "Espera" });
      await waitForLockWaiters(goalsWeekKey(WEEK), 1);
      expect(await rowCount()).toBe(0);
      // Another week is not held back by this one's lock.
      expect(await setWeeklyObjective({ weekStart: NEXT_WEEK, text: "Libre" })).toMatchObject({
        ok: true,
      });
      await release();
      expect(await waiting).toMatchObject({ ok: true });
    });
    expect(await textOf(WEEK)).toBe("Espera");
    expect(await textOf(NEXT_WEEK)).toBe("Libre");
  });

  test("concurrent sets of the same week end with one row, and each saw a consistent previous text", async () => {
    const texts = ["Uno", "Dos", "Tres", "Cuatro", "Cinco"];
    const results = await Promise.all(
      texts.map((text) => setWeeklyObjective({ weekStart: WEEK, text })),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await rowCount()).toBe(1);
    expect(texts).toContain(await textOf(WEEK));
    // The lock serializes them: the previous texts form a chain (one saw none, the rest each saw
    // another's text, no two the same).
    const previous = results.map((result) => (result.ok ? result.data.previous : "?"));
    expect(previous.filter((value) => value === null)).toHaveLength(1);
    expect(new Set(previous).size).toBe(texts.length);
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
  ])("with %s the read redirects to /login and every write is refused", async (_, headers) => {
    await set(WEEK, "Del owner");
    // Positive control: the owner reads.
    expect(await textOf(WEEK)).toBe("Del owner");

    request.headers = await headers();
    await expect(getWeeklyObjective(WEEK)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await setWeeklyObjective({ weekStart: WEEK, text: "Intruso" })).toEqual(refused);
    expect(await clearWeeklyObjective({ weekStart: WEEK })).toEqual(refused);
    expect(
      await undoWeeklyObjective({ weekStart: WEEK, previous: null, applied: "Del owner" }),
    ).toEqual(refused);

    const rows = await testDb.select().from(weeklyObjectives);
    expect(rows.map((row) => row.text)).toEqual(["Del owner"]);
  });
});

describe("revalidation of the screens that show goals", () => {
  test("a goal change revalidates /goals, and the habit and project pages that list it", async () => {
    const result = await createGoal({
      title: "Leer",
      periodKind: "year",
      year: 2026,
      sourceKind: "manual",
      target: 12,
      unit: "libros",
    });
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/goals", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/habits", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
  });

  test("the weekly objective only revalidates /goals", async () => {
    await set(WEEK, "Algo");
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/goals", "layout"]]);
  });
});

describe("the 'Metas' section of habits and projects", () => {
  const NOW = new Date("2026-10-12T15:00:00Z");
  const T4 = { periodKind: "quarter", year: 2026, quarter: 4 } as const;
  const YEAR = { periodKind: "year", year: 2026 } as const;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  let order = 0;
  async function newHabit(name = "Correr"): Promise<string> {
    const [habit] = await testDb
      .insert(habits)
      .values({
        name,
        measure: "check",
        frequency: "daily",
        startDate: "2026-01-01",
        sortOrder: order++,
      })
      .returning({ id: habits.id });
    return habit.id;
  }

  async function newProject(name = "Lanzar brahua-os"): Promise<string> {
    const [area] = await testDb
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, "work"));
    const [project] = await testDb
      .insert(projects)
      .values({ name, lifeAreaId: area.id, status: "active" })
      .returning({ id: projects.id });
    return project.id;
  }

  async function goalOf(values: Record<string, unknown>) {
    const result = await createGoal(values);
    if (!result.ok) throw new Error(`createGoal failed: ${JSON.stringify(result)}`);
    return result.data;
  }

  const habitGoal = (habitId: string, title: string, extra: Record<string, unknown> = {}) =>
    goalOf({ title, ...T4, sourceKind: "habit", habitId, target: 40, ...extra });
  const projectGoal = (projectId: string, title: string, extra: Record<string, unknown> = {}) =>
    goalOf({ title, ...YEAR, sourceKind: "project", projectId, ...extra });

  test("a habit's goals: only the ones that follow it, visible and not archived, the newest period first", async () => {
    const correr = await newHabit();
    const meditar = await newHabit("Meditar");
    const quarter = await habitGoal(correr, "Correr en T4");
    const year = await habitGoal(correr, "Correr todo el año", {
      ...YEAR,
      quarter: null,
      target: 200,
    });
    await habitGoal(meditar, "Meditar");
    const archived = await habitGoal(correr, "Archivada");
    const deleted = await habitGoal(correr, "Eliminada");
    await goalOf({ title: "Manual", ...YEAR, sourceKind: "manual", target: 3, unit: "u" });
    await archiveGoal({ id: archived.id });
    await deleteGoal({ id: deleted.id });

    const found = await selectGoalsFollowing(testDb, { kind: "habit", id: correr });
    // A year-long goal lists before the quarters of that year.
    expect(found.map((goal) => goal.title)).toEqual(["Correr todo el año", "Correr en T4"]);
    expect(found.map((goal) => goal.id)).toEqual([year.id, quarter.id]);
    // It reads its source like the goals screen (the habit's name and days done).
    expect(found[0].source).toMatchObject({ kind: "habit", name: "Correr", done: 0 });
    // Positive control: with nothing following, the habit gets none.
    expect(await selectGoalsFollowing(testDb, { kind: "project", id: correr })).toEqual([]);
  });

  test("a project's goals, and a project nobody follows has none", async () => {
    const lanzar = await newProject();
    const otro = await newProject("Otro");
    const goal = await projectGoal(lanzar, "Lanzar la v1");
    await projectGoal(otro, "De otro");
    const found = await selectGoalsFollowing(testDb, { kind: "project", id: lanzar });
    expect(found.map((item) => item.id)).toEqual([goal.id]);
    expect(found[0].source).toMatchObject({ kind: "project", name: "Lanzar brahua-os" });
    const sinMetas = await newProject("Sin metas");
    expect(await selectGoalsFollowing(testDb, { kind: "project", id: sinMetas })).toEqual([]);
  });

  test("an undone delete brings the goal back to the section", async () => {
    const habitId = await newHabit();
    const goal = await habitGoal(habitId, "Correr");
    await deleteGoal({ id: goal.id });
    expect(await selectGoalsFollowing(testDb, { kind: "habit", id: habitId })).toEqual([]);
    const { restoreGoal } = await import("@/modules/goals/actions");
    await restoreGoal({ id: goal.id });
    expect(await selectGoalsFollowing(testDb, { kind: "habit", id: habitId })).toHaveLength(1);
  });

  test("the providers render the section for their habit or project, and nothing for the rest", async () => {
    const habitId = await newHabit();
    const projectId = await newProject();
    await habitGoal(habitId, "Correr");
    await projectGoal(projectId, "Lanzar");

    const habitNode = (await habitGoalsSection.render({
      habit: { id: habitId, name: "Correr", archived: false },
    })) as React.ReactElement<{ goals: { title: string }[]; sourceName: string }>;
    expect(habitNode.props.sourceName).toBe("Correr");
    expect(habitNode.props.goals.map((goal) => goal.title)).toEqual(["Correr"]);

    const projectNode = (await projectGoalsSection.render({
      project: { id: projectId, name: "Lanzar brahua-os", status: "active" },
      milestones: [],
    })) as React.ReactElement<{ goals: { title: string }[] }>;
    expect(projectNode.props.goals.map((goal) => goal.title)).toEqual(["Lanzar"]);

    const none = (await habitGoalsSection.render({
      habit: { id: await newHabit("Otro"), name: "Otro", archived: false },
    })) as React.ReactElement<{ goals: unknown[] }>;
    expect(none.props.goals).toEqual([]);
  });

  test("the providers check the owner themselves", async () => {
    const habitId = await newHabit();
    request.headers = new Headers();
    await expect(
      habitGoalsSection.render({ habit: { id: habitId, name: "Correr", archived: false } }),
    ).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) });
  });

  test("ensureGoalExtensions registers once: calling it twice leaves one 'goals' section on each page", async () => {
    ensureGoalExtensions();
    ensureGoalExtensions();
    const habitId = await newHabit();
    const projectId = await newProject();
    const habitSections = await renderHabitSections({
      habit: { id: habitId, name: "Correr", archived: false },
    });
    expect(habitSections.filter((section) => section.id === "goals")).toHaveLength(1);
    const projectSections = await renderProjectSections({
      project: { id: projectId, name: "Lanzar", status: "active" },
      milestones: [],
    });
    expect(projectSections.filter((section) => section.id === "goals")).toHaveLength(1);
  });
});
