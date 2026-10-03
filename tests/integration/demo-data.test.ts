// `pnpm db:demo` (scripts/demo-data.ts) against the throwaway database: inserting twice adds
// nothing, every CHECK passes on any weekday, the contracts read valid data ("Hoy" has pending
// habits and tasks, no "Día completo"), `remove` leaves the owner's data exactly as it was and
// `replace` keeps only the demo in the module tables, never touching areas or the account.
import { and, eq, inArray, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { authUsers, lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  getHabitsTodaySummary,
  selectHabitsDueToday,
  selectHabitsTodaySummary,
} from "@/modules/habits/contracts";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { HABITS_ADVISORY_SPACE, HABITS_ORDER_KEY } from "@/modules/habits/habits";
import { listActiveHabits } from "@/modules/habits/queries";
import { getProjectsTodaySummary, selectProjectsTodaySummary } from "@/modules/projects/contracts";
import {
  projectDependencies,
  projectLinks,
  projectMilestones,
  projects,
} from "@/modules/projects/db/schema";
import { PROJECT_LINKS_KEY } from "@/modules/projects/lock-keys";
import { MILESTONES_ADVISORY_SPACE } from "@/modules/projects/milestones";
import { PROJECT_DEPENDENCIES_LOCK, PROJECTS_ADVISORY_SPACE } from "@/modules/projects/projects";
import { listProjects } from "@/modules/projects/queries";
import {
  getTasksDoneTodayCount,
  getTasksTodaySummary,
  selectTasksTodaySummary,
} from "@/modules/tasks/contracts";
import { taskTagLinks, taskTags, tasks } from "@/modules/tasks/db/schema";
import { listInboxTasks } from "@/modules/tasks/queries";
import { TASKS_ADVISORY_SPACE } from "@/modules/tasks/tasks";
import { listDoneTasks, listUpcomingTasks } from "@/modules/tasks/view-queries";
import { habitsTally, isDayComplete } from "@/modules/today/today-board";
import { ownerDateKey } from "@/lib/time";
import {
  MODULE_TABLES,
  countModuleRows,
  demoId,
  demoIds,
  demoLocks,
  gate,
  insertDemoData,
  previewRemoveDemo,
  removeDemoData,
  replaceWithDemoData,
  uuidV5,
} from "../../scripts/demo-data";
import { AUTH_ENV, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

/** Friday 2026-10-02, 10:00 in Lima. */
const NOW = new Date("2026-10-02T15:00:00Z");

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

/** Every row of the module tables (soft-deleted ones too), as sorted JSON per table. */
async function snapshot() {
  const tables: Record<string, string[]> = {};
  for (const table of MODULE_TABLES) {
    const result = await testDb.execute<{ row: string }>(
      sql`select to_jsonb(t)::text as row from ${sql.identifier(table)} t order by 1`,
    );
    tables[table] = result.rows.map((r) => r.row);
  }
  return tables;
}

async function areaId(slug: string) {
  const [row] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, slug));
  return row.id;
}

/** The owner's own data, made before the demo: a project, a task with a tag, a habit with logs. */
async function insertRealData() {
  const [project] = await testDb
    .insert(projects)
    .values({ name: "Curso de Claude", status: "active", lifeAreaId: await areaId("learning") })
    .returning({ id: projects.id });
  const [task] = await testDb
    .insert(tasks)
    .values({ title: "Tarea real", lifeAreaId: await areaId("home") })
    .returning({ id: tasks.id });
  const [tag] = await testDb
    .insert(taskTags)
    .values({ name: "casa" })
    .returning({ id: taskTags.id });
  await testDb.insert(taskTagLinks).values({ taskId: task.id, tagId: tag.id });
  const [habit] = await testDb
    .insert(habits)
    .values({
      name: "Hábito real",
      measure: "check",
      frequency: "daily",
      startDate: "2026-09-20",
      sortOrder: 0,
    })
    .returning({ id: habits.id });
  await testDb
    .insert(habitLogs)
    .values({ habitId: habit.id, day: "2026-10-01", quantity: 1, target: 1 });
  return { project: project.id, task: task.id, tag: tag.id, habit: habit.id };
}

test("ids are UUID v5 (RFC 4122 test vector) and the locks are the modules' own", () => {
  expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
    "2ed6657d-e927-568b-95e1-2665a8aea6a2",
  );
  expect(demoId("project:aws")).toBe(demoId("project:aws"));
  const locks = demoLocks();
  // The module-wide ones first, with the modules' own keys (the dependency lock's text too).
  expect(locks.slice(0, 2)).toEqual([
    [PROJECTS_ADVISORY_SPACE, "project_dependencies"],
    [HABITS_ADVISORY_SPACE, HABITS_ORDER_KEY],
  ]);
  const dependencyLock = new PgDialect().sqlToQuery(PROJECT_DEPENDENCIES_LOCK);
  expect(dependencyLock.sql).toContain(String(locks[0][0]));
  expect(dependencyLock.params).toContain(locks[0][1]);
  // Per demo project: its milestones, links and tasks locks; per demo habit: its own.
  const aws = demoId("project:aws");
  expect(locks).toContainEqual([MILESTONES_ADVISORY_SPACE, aws]);
  expect(locks).toContainEqual([PROJECT_LINKS_KEY, aws]);
  expect(locks).toContainEqual([TASKS_ADVISORY_SPACE, aws]);
  expect(locks).toContainEqual([HABITS_ADVISORY_SPACE, demoId("habit:meditar")]);
});

describe("gate: what a run must confirm before any query", () => {
  test.each([
    ["insert", true, false, { ok: true, askHost: false, askWord: false }],
    ["remove", true, false, { ok: true, askHost: false, askWord: false }],
    ["insert", false, true, { ok: true, askHost: true, askWord: false }],
    ["remove", false, true, { ok: true, askHost: true, askWord: false }],
    ["replace", true, true, { ok: true, askHost: false, askWord: true }],
    ["replace", false, true, { ok: true, askHost: true, askWord: true }],
  ] as const)("passes: %s (local %s, tty %s)", (mode, isLocal, isTTY, expected) => {
    expect(gate(mode, isLocal, isTTY)).toEqual(expected);
  });

  test.each([
    ["insert", false, false],
    ["remove", false, false],
    ["replace", true, false],
    ["replace", false, false],
  ] as const)("refuses without a terminal: %s (local %s)", (mode, isLocal, isTTY) => {
    expect(gate(mode, isLocal, isTTY)).toEqual({
      ok: false,
      message: expect.stringMatching(/interactive terminal/),
    });
  });

  test("refuses an unknown mode", () => {
    expect(gate("delete", true, true)).toMatchObject({ ok: false, message: /Usage/ });
    expect(gate("", true, true)).toMatchObject({ ok: false });
  });
});

describe("insert", () => {
  test("inserting twice adds nothing the second time", async () => {
    const first = await insertDemoData(testDb, NOW);
    expect(first).toMatchObject({
      projects: 7,
      tasks: 27,
      tags: 4,
      habits: 8,
      pauses: 1,
      dependencies: 1,
    });
    expect(first.logs).toBeGreaterThan(100);
    const counts = await countModuleRows(testDb);

    // A later day too: the rows are already there, so nothing moves.
    const second = await insertDemoData(testDb, new Date("2026-10-09T15:00:00Z"));
    expect(Object.values(second).every((value) => value === 0)).toBe(true);
    expect(await countModuleRows(testDb)).toEqual(counts);
  });

  test("the contracts read a lively 'Hoy': pending habits and tasks, projects due, no 'Día completo'", async () => {
    await insertDemoData(testDb, NOW);

    const habitItems = await getHabitsTodaySummary(NOW);
    expect(habitItems).toHaveLength(8); // Friday: the fixed-days ones are due too
    const byName = new Map(habitItems.map((item) => [item.name, item]));
    expect(byName.get("Meditar 10 min")).toMatchObject({
      done: true,
      streak: { count: 6, unit: "days" },
    });
    expect(byName.get("Sin pantallas después de las 11 p. m.")).toMatchObject({
      kind: "avoid",
      done: true,
      streak: { count: 9, unit: "days" },
    });
    expect(byName.get("Tomar agua")).toMatchObject({ quantity: 3, done: false });
    expect(byName.get("Medicación")).toMatchObject({
      quantity: 1,
      done: false,
      streak: { count: 3 },
    });
    expect(byName.get("Gimnasio")?.week).not.toBeNull();
    expect(habitItems.filter((item) => !item.done).length).toBeGreaterThanOrEqual(4);

    const taskItems = await getTasksTodaySummary(NOW);
    expect(taskItems.filter((item) => item.due.kind === "overdue")).toHaveLength(2);
    expect(taskItems.filter((item) => item.due.kind === "today")).toHaveLength(6);
    expect(taskItems[0].due.kind).toBe("overdue");
    expect(taskItems.some((item) => item.isNextAction && item.project)).toBe(true);
    expect(await getTasksDoneTodayCount(NOW)).toBe(0);

    const projectItems = await getProjectsTodaySummary(NOW);
    expect(projectItems.map((item) => item.name).sort()).toEqual(
      [
        "Certificación AWS Solutions Architect",
        "Ordenar y pintar el depa",
        "Viaje a Europa 2027",
      ].sort(),
    );
    const trip = projectItems.find((item) => item.name === "Viaje a Europa 2027");
    expect(trip?.blockedBy.map((blocker) => blocker.name)).toEqual(["Renovar pasaporte"]);

    expect(await listInboxTasks()).toHaveLength(4);
    expect((await listUpcomingTasks(NOW)).length).toBeGreaterThanOrEqual(5);
    expect(await listDoneTasks(NOW)).toHaveLength(6);
    const projectList = await listProjects();
    expect(projectList).toHaveLength(7);
    expect(projectList.filter((project) => project.status === "done")).toHaveLength(1);
    expect(await listActiveHabits(NOW)).toHaveLength(8);

    const due = await selectHabitsDueToday(testDb, NOW);
    const tally = habitsTally(due, ownerDateKey(NOW));
    expect(
      isDayComplete({ habits: tally, tasks: { pending: taskItems.length, doneToday: 0 } }),
    ).toBe(false);
  });

  test("every weekday and the end of a month: the CHECKs pass and 'Hoy' has pending work", async () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map(
      (offset) => new Date(NOW.getTime() + offset * 86_400_000),
    );
    days.push(new Date("2027-01-31T15:00:00Z"), new Date("2028-02-29T15:00:00Z"));
    for (const now of days) {
      await insertDemoData(testDb, now);
      const habitItems = await selectHabitsTodaySummary(testDb, now);
      expect(habitItems.length).toBeGreaterThanOrEqual(5);
      expect(habitItems.some((item) => !item.done)).toBe(true);
      expect(await selectTasksTodaySummary(testDb, now)).toHaveLength(8);
      expect((await selectProjectsTodaySummary(testDb, now)).length).toBeGreaterThanOrEqual(3);
      await removeDemoData(testDb);
      expect(Object.values(await countModuleRows(testDb)).every((n) => n === 0)).toBe(true);
    }
  });

  test("timestamps tell a coherent story", async () => {
    await insertDemoData(testDb, NOW);
    // A spawned occurrence is created when the previous one is completed.
    const [previous] = await testDb
      .select()
      .from(tasks)
      .where(eq(tasks.id, demoId("task:regar-anterior")));
    const [next] = await testDb
      .select()
      .from(tasks)
      .where(eq(tasks.id, demoId("task:regar")));
    expect(next.spawnedFromId).toBe(previous.id);
    expect(next.createdAt).toEqual(previous.doneAt);
    expect(next.updatedAt).toEqual(previous.doneAt);
    // The finished project closes at or after its last milestone and its last task.
    const done = demoId("project:ingles");
    const [project] = await testDb.select().from(projects).where(eq(projects.id, done));
    const milestones = await testDb
      .select({ doneAt: projectMilestones.doneAt })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, done));
    const projectTasks = await testDb
      .select({ doneAt: tasks.doneAt })
      .from(tasks)
      .where(eq(tasks.projectId, done));
    const last = Math.max(...[...milestones, ...projectTasks].map((row) => row.doneAt!.getTime()));
    expect(project.completedAt!.getTime()).toBeGreaterThanOrEqual(last);
    expect(project.updatedAt.getTime()).toBeGreaterThanOrEqual(project.completedAt!.getTime());
  });
});

describe("remove", () => {
  test("leaves the owner's data exactly as it was (positive control: it is there)", async () => {
    const real = await insertRealData();
    const before = await snapshot();
    expect(before.projects).toHaveLength(1);

    await insertDemoData(testDb, NOW);
    // The demo reuses the owner's "casa" tag instead of a second one.
    const [{ count }] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(taskTagLinks)
      .where(eq(taskTagLinks.tagId, real.tag));
    expect(count).toBeGreaterThan(1);
    // The demo habits go after the owner's.
    const [first] = await testDb.select().from(habits).where(eq(habits.id, demoIds().habits[0]));
    expect(first.sortOrder).toBe(1);

    const preview = await previewRemoveDemo(testDb);
    const result = await removeDemoData(testDb);
    expect(result).toEqual(preview);
    expect(result).toMatchObject({
      projects: 7,
      tasks: 27,
      habits: 8,
      pauses: 1,
      tags: 3, // "casa" is the owner's
      spawnedOccurrences: 0,
      keptOccurrences: 0,
      movedTasks: 0,
      ownMilestones: 0,
      ownLinks: 0,
      ownDependencies: 0,
      ownLogs: 0,
      ownPauses: 0,
    });
    expect(await snapshot()).toEqual(before);
  });

  test("an owner's habit created after the demo keeps its place and the order closes up", async () => {
    const real = await insertRealData();
    await insertDemoData(testDb, NOW);
    const [later] = await testDb
      .insert(habits)
      .values({
        name: "Hábito nuevo",
        measure: "check",
        frequency: "daily",
        startDate: "2026-10-02",
        sortOrder: 9, // after the owner's (0) and the demo's (1–8), like a new habit
      })
      .returning({ id: habits.id });

    await removeDemoData(testDb);
    const left = await testDb
      .select({ id: habits.id, sortOrder: habits.sortOrder })
      .from(habits)
      .orderBy(habits.sortOrder);
    expect(left).toEqual([
      { id: real.habit, sortOrder: 0 },
      { id: later.id, sortOrder: 1 },
    ]);
  });

  test("counts and handles what hangs from the demo: the owner's occurrences, milestones, links, dependencies, logs and pauses", async () => {
    const real = await insertRealData();
    await insertDemoData(testDb, NOW);
    const aws = demoId("project:aws");
    const meditar = demoId("habit:meditar");
    // The app's untouched copy after completing the demo "Luz": deleted with it.
    await testDb.insert(tasks).values({
      title: "Pagar recibo de luz",
      spawnedFromId: demoId("task:luz"),
      lifeAreaId: await areaId("home"),
    });
    // Occurrences the owner edited, or moved to one of their projects: kept, unlinked.
    const [edited] = await testDb
      .insert(tasks)
      .values({
        title: "Regar las plantas (y abonar)",
        spawnedFromId: demoId("task:regar"),
        updatedAt: new Date("2026-10-04T15:00:00Z"),
      })
      .returning({ id: tasks.id });
    const [moved] = await testDb
      .insert(tasks)
      .values({
        title: "Inscripción",
        spawnedFromId: demoId("task:inscripcion"),
        projectId: real.project,
      })
      .returning({ id: tasks.id });
    await testDb
      .insert(projectMilestones)
      .values({ projectId: aws, title: "Mi hito", sortOrder: 5 });
    await testDb
      .insert(projectLinks)
      .values({ projectId: aws, url: "https://example.com", sortOrder: 2 });
    await testDb.insert(projectDependencies).values({ projectId: real.project, blockedById: aws });
    // A tap on a demo habit today (a correction of the demo's own log) and a new pause.
    await testDb
      .update(habitLogs)
      .set({ quantity: 0 })
      .where(and(eq(habitLogs.habitId, meditar), eq(habitLogs.day, ownerDateKey(NOW))));
    await testDb
      .insert(habitPauses)
      .values({ habitId: meditar, startDate: "2026-10-10", endDate: "2026-10-12" });

    const preview = await previewRemoveDemo(testDb);
    expect(preview).toMatchObject({
      spawnedOccurrences: 1,
      keptOccurrences: 2,
      movedTasks: 0,
      ownMilestones: 1,
      ownLinks: 1,
      ownDependencies: 1,
      ownLogs: 1,
      ownPauses: 1,
      pauses: 2,
    });
    expect(await removeDemoData(testDb)).toEqual(preview);

    const kept = await testDb
      .select({ id: tasks.id, spawnedFromId: tasks.spawnedFromId, projectId: tasks.projectId })
      .from(tasks)
      .where(inArray(tasks.id, [edited.id, moved.id]));
    expect(kept).toHaveLength(2);
    expect(kept.every((task) => task.spawnedFromId === null)).toBe(true);
    expect(kept.find((task) => task.id === moved.id)?.projectId).toBe(real.project);
    // Positive control: the owner's project is still there, only its edge to the demo is gone.
    expect(await testDb.select().from(projects)).toHaveLength(1);
    expect(await testDb.select().from(projectDependencies)).toEqual([]);
    expect(await testDb.select().from(projectMilestones)).toEqual([]);
  });

  test("keeps the owner's task in a demo project (moved to its area) and drops spawned occurrences", async () => {
    await insertDemoData(testDb, NOW);
    const aws = demoId("project:aws");
    const [own] = await testDb
      .insert(tasks)
      .values({ title: "Mi tarea en el proyecto de demo", projectId: aws })
      .returning({ id: tasks.id });
    // Completing the demo "Regar las plantas" spawned the next occurrence (a random id).
    await testDb.insert(tasks).values({
      title: "Regar las plantas",
      spawnedFromId: demoId("task:regar"),
      dueDate: "2026-10-09",
    });

    const result = await removeDemoData(testDb);
    expect(result).toMatchObject({ tasks: 27, spawnedOccurrences: 1, movedTasks: 1 });
    const left = await testDb.select().from(tasks);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      id: own.id,
      projectId: null,
      milestoneId: null,
      isNextAction: false,
      lifeAreaId: await areaId("learning"),
    });
    expect(await testDb.select().from(projects)).toEqual([]);
  });
});

describe("replace", () => {
  test("a failure after the deletes rolls everything back", async () => {
    await insertRealData();
    const before = await snapshot();
    expect(before.projects).toHaveLength(1);
    // An invalid date fails inside insertDemoRows, after every table was emptied.
    await expect(replaceWithDemoData(testDb, new Date(Number.NaN))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  test("keeps only the demo in the module tables; areas and the account untouched", async () => {
    await insertRealData();
    // A soft-deleted project counts too.
    await testDb
      .insert(projects)
      .values({ name: "Borrado", lifeAreaId: await areaId("work"), deletedAt: NOW });
    const areasBefore = await testDb.select().from(lifeAreas).orderBy(lifeAreas.slug);
    const usersBefore = await testDb.select().from(authUsers);
    expect(usersBefore).toHaveLength(1);
    expect(areasBefore).toHaveLength(8);

    const { deleted, inserted } = await replaceWithDemoData(testDb, NOW);
    expect(deleted).toMatchObject({
      projects: 2,
      tasks: 1,
      task_tags: 1,
      habits: 1,
      habit_logs: 1,
    });
    expect(inserted).toMatchObject({ projects: 7, tasks: 27, habits: 8, tags: 4 });

    const ids = demoIds();
    const projectRows = await testDb.select({ id: projects.id }).from(projects);
    expect(projectRows.map((row) => row.id).sort()).toEqual([...ids.projects].sort());
    const taskRows = await testDb.select({ id: tasks.id }).from(tasks);
    expect(taskRows.map((row) => row.id).sort()).toEqual([...ids.tasks].sort());
    const tagRows = await testDb.select({ id: taskTags.id }).from(taskTags);
    expect(tagRows.map((row) => row.id).sort()).toEqual([...ids.tags].sort());
    const habitRows = await testDb
      .select({ id: habits.id, sortOrder: habits.sortOrder })
      .from(habits);
    expect(habitRows.map((row) => row.id).sort()).toEqual([...ids.habits].sort());
    expect(habitRows.map((row) => row.sortOrder).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    const strayLogs = await testDb
      .select({ day: habitLogs.day })
      .from(habitLogs)
      .where(
        sql`${habitLogs.habitId} not in (${sql.join(
          ids.habits.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
    expect(strayLogs).toEqual([]);

    expect(await testDb.select().from(lifeAreas).orderBy(lifeAreas.slug)).toEqual(areasBefore);
    expect(await testDb.select().from(authUsers)).toEqual(usersBefore);
  });

  test("without the seed's areas it fails before deleting anything", async () => {
    const real = await insertRealData();
    await testDb.execute(sql`update core_life_areas set slug = 'renamed' where slug = 'hobbies'`);
    await expect(replaceWithDemoData(testDb, NOW)).rejects.toThrow(/pnpm db:seed/);
    expect(
      await testDb
        .select()
        .from(projects)
        .where(inArray(projects.id, [real.project])),
    ).toHaveLength(1);
  });
});
