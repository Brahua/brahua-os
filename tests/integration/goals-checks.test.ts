// G1 of `goals`: the CHECKs, indexes and foreign keys of the three tables, with raw inserts
// (defense in depth behind Zod: scripts, raw SQL or a bug can't store an invalid goal). Every
// invalid combination of source fields is tried, with positive controls for the valid ones.
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { goalEntries, goals, weeklyObjectives } from "@/modules/goals/db/schema";
import { habits } from "@/modules/habits/db/schema";
import { projects } from "@/modules/projects/db/schema";
import { testDb } from "./test-db";

let habitId: string;
let projectId: string;
let goalId: string;

const BASE = {
  title: "Leer 12 libros",
  periodKind: "year",
  year: 2026,
  sourceKind: "manual",
  target: 12,
  unit: "libros",
  position: 0,
} as const;

beforeEach(async () => {
  await seed(testDb);
  const [area] = await testDb.select({ id: lifeAreas.id }).from(lifeAreas).limit(1);
  const [habit] = await testDb
    .insert(habits)
    .values({
      name: "Correr",
      measure: "check",
      frequency: "daily",
      startDate: "2026-10-01",
      sortOrder: 0,
    })
    .returning();
  habitId = habit.id;
  const [project] = await testDb
    .insert(projects)
    .values({ name: "Lanzar v1", lifeAreaId: area.id })
    .returning();
  projectId = project.id;
  const [goal] = await testDb.insert(goals).values(BASE).returning();
  goalId = goal.id;
});

/** The constraint a raw statement breaks (Postgres error code and constraint name), or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

const goal = (values: Record<string, unknown>) => () =>
  testDb.insert(goals).values({ ...BASE, ...values } as typeof goals.$inferInsert);
const entry = (values: Partial<typeof goalEntries.$inferInsert>) => () =>
  testDb.insert(goalEntries).values({ goalId, delta: 1, entryDate: "2026-10-12", ...values });
const objective = (values: Partial<typeof weeklyObjectives.$inferInsert>) => () =>
  testDb
    .insert(weeklyObjectives)
    .values({ weekStart: "2026-10-12", text: "Terminar el módulo", ...values });

const check = (constraint: string) => ({ code: "23514", constraint });

describe("goals CHECKs", () => {
  test("valid goals of every source and period pass", async () => {
    expect(await violation(goal({}))).toBeNull();
    expect(await violation(goal({ periodKind: "quarter", quarter: 4 }))).toBeNull();
    expect(
      await violation(goal({ sourceKind: "habit", habitId, unit: null, target: 40 })),
    ).toBeNull();
    expect(
      await violation(goal({ sourceKind: "project", projectId, unit: null, target: 100 })),
    ).toBeNull();
    expect(await violation(goal({ notes: "Una nota", status: "achieved" }))).toBeNull();
  });

  test("lengths: title 1–80, notes 1–2000, unit 1–20", async () => {
    expect(await violation(goal({ title: "" }))).toEqual(check("goals_title_length_check"));
    expect(await violation(goal({ title: "a".repeat(81) }))).toEqual(
      check("goals_title_length_check"),
    );
    expect(await violation(goal({ title: "a".repeat(80) }))).toBeNull();
    expect(await violation(goal({ notes: "" }))).toEqual(check("goals_notes_length_check"));
    expect(await violation(goal({ notes: "a".repeat(2001) }))).toEqual(
      check("goals_notes_length_check"),
    );
    expect(await violation(goal({ notes: "a".repeat(2000) }))).toBeNull();
    expect(await violation(goal({ unit: "" }))).toEqual(check("goals_unit_length_check"));
    expect(await violation(goal({ unit: "a".repeat(21) }))).toEqual(
      check("goals_unit_length_check"),
    );
    expect(await violation(goal({ unit: "a".repeat(20) }))).toBeNull();
  });

  test("an unknown period kind, source kind or status", async () => {
    expect(await violation(goal({ periodKind: "month" }))).toEqual(
      check("goals_period_kind_check"),
    );
    expect(await violation(goal({ sourceKind: "money" }))).toEqual(
      check("goals_source_kind_check"),
    );
    expect(await violation(goal({ status: "paused" }))).toEqual(check("goals_status_check"));
  });

  test("year between 2000 and 2100", async () => {
    expect(await violation(goal({ year: 1999 }))).toEqual(check("goals_year_check"));
    expect(await violation(goal({ year: 2101 }))).toEqual(check("goals_year_check"));
    expect(await violation(goal({ year: 2000 }))).toBeNull();
    expect(await violation(goal({ year: 2100 }))).toBeNull();
  });

  test("a quarter (1–4) if and only if the period is a quarter", async () => {
    const rule = check("goals_quarter_rule_check");
    expect(await violation(goal({ periodKind: "year", quarter: 1 }))).toEqual(rule);
    expect(await violation(goal({ periodKind: "quarter", quarter: null }))).toEqual(rule);
    expect(await violation(goal({ periodKind: "quarter", quarter: 0 }))).toEqual(rule);
    expect(await violation(goal({ periodKind: "quarter", quarter: 5 }))).toEqual(rule);
    for (const quarter of [1, 2, 3, 4]) {
      expect(await violation(goal({ periodKind: "quarter", quarter }))).toBeNull();
    }
  });

  describe("each source with exactly its own fields", () => {
    const rule = check("goals_source_rule_check");

    test("habit: a habit, no project, no unit, a target of 1–100 000", async () => {
      const habit = { sourceKind: "habit", habitId, unit: null, target: 40 };
      expect(await violation(goal(habit))).toBeNull();
      expect(await violation(goal({ ...habit, habitId: null }))).toEqual(rule);
      expect(await violation(goal({ ...habit, projectId }))).toEqual(rule);
      expect(await violation(goal({ ...habit, unit: "días" }))).toEqual(rule);
      expect(await violation(goal({ ...habit, target: 0 }))).toEqual(rule);
      expect(await violation(goal({ ...habit, target: 100_001 }))).toEqual(rule);
      expect(await violation(goal({ ...habit, target: 100_000 }))).toBeNull();
    });

    test("project: a project, no habit, no unit, a target of exactly 100", async () => {
      const project = { sourceKind: "project", projectId, unit: null, target: 100 };
      expect(await violation(goal(project))).toBeNull();
      expect(await violation(goal({ ...project, projectId: null }))).toEqual(rule);
      expect(await violation(goal({ ...project, habitId }))).toEqual(rule);
      expect(await violation(goal({ ...project, unit: "%" }))).toEqual(rule);
      expect(await violation(goal({ ...project, target: 99 }))).toEqual(rule);
      expect(await violation(goal({ ...project, target: 101 }))).toEqual(rule);
    });

    test("manual: a unit, no habit, no project, a target of 1–100 000", async () => {
      expect(await violation(goal({ unit: null }))).toEqual(rule);
      expect(await violation(goal({ habitId }))).toEqual(rule);
      expect(await violation(goal({ projectId }))).toEqual(rule);
      expect(await violation(goal({ habitId, projectId }))).toEqual(rule);
      expect(await violation(goal({ target: 0 }))).toEqual(rule);
      expect(await violation(goal({ target: -1 }))).toEqual(rule);
      expect(await violation(goal({ target: 100_001 }))).toEqual(rule);
      expect(await violation(goal({ target: 100_000 }))).toBeNull();
    });

    test("a missing field never lets a row through (coalesce): no source fields at all", async () => {
      expect(await violation(goal({ sourceKind: "habit", unit: null }))).toEqual(rule);
      expect(await violation(goal({ sourceKind: "project", unit: null, target: 100 }))).toEqual(
        rule,
      );
    });
  });

  test("foreign keys: a habit or a project that does not exist, and the restrict on delete", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(
      await violation(goal({ sourceKind: "habit", habitId: missing, unit: null, target: 5 })),
    ).toMatchObject({ code: "23503" });
    expect(
      await violation(goal({ sourceKind: "project", projectId: missing, unit: null, target: 100 })),
    ).toMatchObject({ code: "23503" });
    expect(await violation(goal({ areaId: missing }))).toMatchObject({ code: "23503" });
    await testDb
      .insert(goals)
      .values({ ...BASE, sourceKind: "habit", habitId, unit: null, target: 5 });
    expect(await violation(() => testDb.delete(habits))).toMatchObject({ code: "23503" });
  });

  test("the list's index only covers visible goals", async () => {
    const result = await testDb.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'goals_position_idx'`,
    );
    expect(result.rows[0].indexdef).toMatch(/deleted_at IS NULL/);
  });
});

describe("goal_entries CHECKs", () => {
  test("delta: never zero, |delta| up to 100 000, negative to correct", async () => {
    const rule = check("goal_entries_delta_check");
    expect(await violation(entry({ delta: 1 }))).toBeNull();
    expect(await violation(entry({ delta: -5 }))).toBeNull();
    expect(await violation(entry({ delta: 100_000 }))).toBeNull();
    expect(await violation(entry({ delta: -100_000 }))).toBeNull();
    expect(await violation(entry({ delta: 0 }))).toEqual(rule);
    expect(await violation(entry({ delta: 100_001 }))).toEqual(rule);
    expect(await violation(entry({ delta: -100_001 }))).toEqual(rule);
  });

  test("an entry needs a goal that exists, and a goal with entries cannot be deleted", async () => {
    expect(
      await violation(entry({ goalId: "00000000-0000-4000-8000-000000000000" })),
    ).toMatchObject({ code: "23503" });
    await testDb.insert(goalEntries).values({ goalId, delta: 1, entryDate: "2026-10-12" });
    expect(await violation(() => testDb.delete(goals))).toMatchObject({ code: "23503" });
  });
});

describe("weekly_objectives CHECKs", () => {
  test("the week starts on a Monday (2026-10-12 is one)", async () => {
    const rule = check("weekly_objectives_monday_check");
    expect(await violation(objective({}))).toBeNull();
    expect(await violation(objective({ weekStart: "2026-10-13" }))).toEqual(rule); // Tuesday
    expect(await violation(objective({ weekStart: "2026-10-18" }))).toEqual(rule); // Sunday
    expect(await violation(objective({ weekStart: "2026-10-19" }))).toBeNull(); // the next Monday
  });

  test("the text is 1–140 characters, and one row per week", async () => {
    const rule = check("weekly_objectives_text_length_check");
    expect(await violation(objective({ text: "" }))).toEqual(rule);
    expect(await violation(objective({ text: "a".repeat(141) }))).toEqual(rule);
    expect(
      await violation(objective({ text: "a".repeat(140), weekStart: "2026-10-26" })),
    ).toBeNull();
    // The Monday is the primary key: a second row for the same week is a unique violation.
    expect(await violation(objective({}))).toBeNull();
    expect(await violation(objective({}))).toMatchObject({ code: "23505" });
  });
});
