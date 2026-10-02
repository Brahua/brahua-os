// T1: the CHECKs, the partial unique index and the foreign keys of `tasks`, with raw inserts
// (defense in depth behind Zod: scripts, raw SQL or a bug can't store an invalid task).
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { tasks, taskTags } from "@/modules/tasks/db/schema";
import { testDb } from "./test-db";

let areaId: string;
let projectId: string;
let milestoneId: string;

beforeEach(async () => {
  await seed(testDb);
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "home"));
  areaId = area.id;
  const [project] = await testDb
    .insert(projects)
    .values({ name: "Cocina", lifeAreaId: areaId })
    .returning();
  projectId = project.id;
  const [milestone] = await testDb
    .insert(projectMilestones)
    .values({ projectId, title: "Planos", sortOrder: 0 })
    .returning();
  milestoneId = milestone.id;
});

/** The constraint a raw insert breaks (Postgres error code and constraint name). */
async function violation(values: Partial<typeof tasks.$inferInsert>) {
  try {
    await testDb.insert(tasks).values({ title: "x", ...values });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

const check = (constraint: string) => ({ code: "23514", constraint });

describe("tasks CHECKs", () => {
  test("a valid task in each placement passes", async () => {
    expect(await violation({})).toBeNull();
    expect(await violation({ lifeAreaId: areaId })).toBeNull();
    expect(await violation({ projectId, milestoneId, isNextAction: true })).toBeNull();
  });

  test("title 1–200 and notes 1–20 000", async () => {
    expect(await violation({ title: "" })).toEqual(check("tasks_title_length_check"));
    expect(await violation({ title: "a".repeat(201) })).toEqual(check("tasks_title_length_check"));
    expect(await violation({ title: "a".repeat(200) })).toBeNull();
    expect(await violation({ notes: "" })).toEqual(check("tasks_notes_length_check"));
    expect(await violation({ notes: "a".repeat(20_001) })).toEqual(
      check("tasks_notes_length_check"),
    );
  });

  test("priority is low, medium or high", async () => {
    expect(await violation({ priority: "urgent" as never })).toEqual(check("tasks_priority_check"));
  });

  test("never an own area and a project; a milestone only with a project", async () => {
    expect(await violation({ lifeAreaId: areaId, projectId })).toEqual(
      check("tasks_area_or_project_check"),
    );
    expect(await violation({ milestoneId })).toEqual(check("tasks_milestone_project_check"));
    expect(await violation({ lifeAreaId: areaId, milestoneId })).toEqual(
      check("tasks_milestone_project_check"),
    );
  });

  test("the next action is a pending task of a project", async () => {
    expect(await violation({ isNextAction: true })).toEqual(check("tasks_next_action_check"));
    expect(await violation({ isNextAction: true, lifeAreaId: areaId })).toEqual(
      check("tasks_next_action_check"),
    );
    expect(await violation({ isNextAction: true, projectId, doneAt: new Date() })).toEqual(
      check("tasks_next_action_check"),
    );
  });

  test("one next action per project (partial unique index); a deleted one doesn't count", async () => {
    expect(await violation({ projectId, isNextAction: true })).toBeNull();
    expect(await violation({ projectId, isNextAction: true })).toEqual({
      code: "23505",
      constraint: "tasks_next_action_unique",
    });
    await testDb
      .update(tasks)
      .set({ deletedAt: sql`now()` })
      .where(eq(tasks.isNextAction, true));
    expect(await violation({ projectId, isNextAction: true })).toBeNull();
    // Other projects have their own.
    const [other] = await testDb
      .insert(projects)
      .values({ name: "Otro", lifeAreaId: areaId })
      .returning();
    expect(await violation({ projectId: other.id, isNextAction: true })).toBeNull();
  });

  test("recurrence: each rule with exactly its own field, in range", async () => {
    const ok = [
      { recurrenceKind: "every_days", recurrenceInterval: 3 },
      { recurrenceKind: "every_weeks", recurrenceInterval: 1 },
      { recurrenceKind: "every_months", recurrenceInterval: 365 },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [1] },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [1, 2, 3, 4, 5, 6, 7] },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [2, 5] },
      { recurrenceKind: "month_day", recurrenceMonthDay: 1 },
      { recurrenceKind: "month_day", recurrenceMonthDay: 31 },
    ] as const;
    for (const values of ok) {
      expect(await violation(values as never), JSON.stringify(values)).toBeNull();
    }

    const bad = [
      { recurrenceKind: "yearly" },
      { recurrenceKind: "every_days" },
      { recurrenceKind: "every_days", recurrenceInterval: 0 },
      { recurrenceKind: "every_days", recurrenceInterval: 366 },
      { recurrenceKind: "every_days", recurrenceInterval: 3, recurrenceMonthDay: 3 },
      { recurrenceKind: "every_weeks", recurrenceInterval: 2, recurrenceWeekdays: [1] },
      { recurrenceKind: "weekdays" },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [] },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [0] },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [8] },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [1, 1] },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [3, 1] },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [1, 2, 3, 4, 5, 6, 7, 7] },
      { recurrenceKind: "weekdays", recurrenceWeekdays: [1], recurrenceInterval: 1 },
      { recurrenceKind: "month_day" },
      { recurrenceKind: "month_day", recurrenceMonthDay: 0 },
      { recurrenceKind: "month_day", recurrenceMonthDay: 32 },
      { recurrenceInterval: 3 },
      { recurrenceWeekdays: [1] },
      { recurrenceMonthDay: 1 },
    ] as const;
    for (const values of bad) {
      const result = await violation(values as never);
      expect(result?.code, JSON.stringify(values)).toBe("23514");
      expect(["tasks_recurrence_check", "tasks_recurrence_kind_check"]).toContain(
        result?.constraint,
      );
    }
  });

  test("weekdays with nulls, two dimensions or another lower bound are refused", async () => {
    for (const literal of ["{1,NULL}", "{{1,2},{3,4}}", "[0:1]={1,2}"]) {
      await expect(
        testDb.execute(
          sql`insert into tasks (title, recurrence_kind, recurrence_weekdays) values ('x', 'weekdays', ${literal}::integer[])`,
        ),
        literal,
      ).rejects.toMatchObject({ cause: { code: "23514", constraint: "tasks_recurrence_check" } });
    }
  });

  test("a task is never spawned from itself", async () => {
    const [task] = await testDb.insert(tasks).values({ title: "x" }).returning();
    await expect(
      testDb.update(tasks).set({ spawnedFromId: task.id }).where(eq(tasks.id, task.id)),
    ).rejects.toMatchObject({ cause: { code: "23514", constraint: "tasks_spawned_from_check" } });
  });
});

describe("foreign keys (restrict) and tags", () => {
  // ON DELETE RESTRICT answers restrict_violation (23001), not foreign_key_violation (23503).
  test("an area, project or milestone with tasks can't be physically deleted", async () => {
    // An area that only a task uses (not the project's), so the task's FK is the one that refuses.
    const [health] = await testDb
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, "health"));
    await testDb.insert(tasks).values([
      { title: "a", lifeAreaId: health.id },
      { title: "b", projectId, milestoneId },
    ]);
    const restricted = (constraint: string) => ({ cause: { code: "23001", constraint } });
    await expect(
      testDb.delete(projectMilestones).where(eq(projectMilestones.id, milestoneId)),
    ).rejects.toMatchObject(restricted("tasks_milestone_id_project_milestones_id_fk"));
    await expect(testDb.delete(projects).where(eq(projects.id, projectId))).rejects.toMatchObject({
      cause: { code: "23001" },
    });
    await expect(testDb.delete(lifeAreas).where(eq(lifeAreas.id, health.id))).rejects.toMatchObject(
      restricted("tasks_life_area_id_core_life_areas_id_fk"),
    );
    // Positive control: the same delete goes through once no task points at it.
    await testDb.delete(tasks).where(eq(tasks.lifeAreaId, health.id));
    await expect(
      testDb.delete(lifeAreas).where(eq(lifeAreas.id, health.id)),
    ).resolves.toBeDefined();
  });

  test("tags are lowercase, 1–30 characters and unique", async () => {
    await testDb.insert(taskTags).values({ name: "compras" });
    for (const [name, code] of [
      ["Compras", "23514"],
      ["", "23514"],
      ["a".repeat(31), "23514"],
      ["compras", "23505"],
    ] as const) {
      await expect(testDb.insert(taskTags).values({ name }), name).rejects.toMatchObject({
        cause: { code },
      });
    }
    await expect(testDb.insert(taskTags).values({ name: "a".repeat(30) })).resolves.toBeDefined();
  });
});
