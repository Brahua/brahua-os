// `pnpm db:demo` (scripts/demo-data.ts) against the throwaway database: inserting twice adds
// nothing, every CHECK passes on any weekday, the contracts read valid data ("Hoy" has pending
// habits and tasks, no "Día completo"), `remove` leaves the owner's data exactly as it was and
// `replace` keeps only the demo in the module tables, never touching areas or the account.
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { authUsers, lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  getHabitsTodaySummary,
  selectHabitsDueToday,
  selectHabitsTodaySummary,
} from "@/modules/habits/contracts";
import { habitLogs, habits } from "@/modules/habits/db/schema";
import { HABITS_ADVISORY_SPACE } from "@/modules/habits/habits";
import { listActiveHabits } from "@/modules/habits/queries";
import { getProjectsTodaySummary, selectProjectsTodaySummary } from "@/modules/projects/contracts";
import { projects } from "@/modules/projects/db/schema";
import { MILESTONES_ADVISORY_SPACE } from "@/modules/projects/milestones";
import { PROJECTS_ADVISORY_SPACE } from "@/modules/projects/projects";
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
  DEMO_LOCK_SPACES,
  MODULE_TABLES,
  countModuleRows,
  demoId,
  demoIds,
  insertDemoData,
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
  expect(DEMO_LOCK_SPACES).toEqual({
    projects: PROJECTS_ADVISORY_SPACE,
    milestones: MILESTONES_ADVISORY_SPACE,
    tasks: TASKS_ADVISORY_SPACE,
    habits: HABITS_ADVISORY_SPACE,
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

    const result = await removeDemoData(testDb);
    expect(result).toMatchObject({
      projects: 7,
      tasks: 27,
      habits: 8,
      pauses: 1,
      detachedTasks: 0,
    });
    expect(result.tags).toBe(3); // "casa" is the owner's
    expect(await snapshot()).toEqual(before);
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
    expect(result).toMatchObject({ tasks: 28, detachedTasks: 1 });
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
