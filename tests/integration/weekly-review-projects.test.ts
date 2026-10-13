// W1 of `weekly-review`, the projects side, against the throwaway database: `getProjectsWeekReview`
// (the projects still in the works with the same progress as the list, their next action and what
// blocks them, and the milestones met within the week on Lima's days), states, deleted projects,
// a fixed number of queries, and authorization.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { getProjectsWeekReview, selectProjectsWeekReview } from "@/modules/projects/contracts";
import { projectDependencies, projectMilestones, projects } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

/** Monday 2026-10-19, 10:00 in Lima: reviewing the week 2026-10-12 – 2026-10-18. */
const NOW = new Date("2026-10-19T15:00:00Z");
const WEEK = "2026-10-12";

let areaId: string;

async function insertProject(name: string, values: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: areaId, status: "active", ...values })
    .returning({ id: projects.id });
  return row.id;
}

let sortOrder = 0;
async function milestone(
  projectId: string,
  title: string,
  values: Partial<typeof projectMilestones.$inferInsert> = {},
) {
  const [row] = await testDb
    .insert(projectMilestones)
    .values({ projectId, title, sortOrder: sortOrder++, ...values })
    .returning({ id: projectMilestones.id });
  return row.id;
}

const names = async () => (await getProjectsWeekReview(WEEK, NOW)).projects.map((p) => p.name);

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  await seed(testDb);
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "work"));
  areaId = area.id;
  sortOrder = 0;
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

describe("the projects in the works", () => {
  test("lists what isn't finished, canceled or deleted: the active ones first, then by name", async () => {
    await insertProject("Zeta", { status: "active" });
    await insertProject("Alfa", { status: "active" });
    await insertProject("Pausa", { status: "paused" });
    await insertProject("Casa", { status: "maintenance" });
    await insertProject("Idea", { status: "idea" });
    await insertProject("Hecho", { status: "done", completedAt: new Date() });
    await insertProject("Cancelado", { status: "canceled" });
    await insertProject("Borrado", { deletedAt: new Date() });
    expect(await names()).toEqual(["Alfa", "Zeta", "Pausa", "Casa", "Idea"]);
    const review = await getProjectsWeekReview(WEEK, NOW);
    expect(review.projects.map((project) => project.status)).toEqual([
      "active",
      "active",
      "paused",
      "maintenance",
      "idea",
    ]);
  });

  test("progress is the list's: milestones plus the tasks the registered sources add", async () => {
    const id = await insertProject("Lanzar v1");
    for (let index = 0; index < 4; index += 1) {
      await milestone(id, `Hito ${index}`, { doneAt: index < 1 ? new Date() : null });
    }
    for (let index = 0; index < 4; index += 1) {
      await testDb.insert(tasks).values({
        title: `Tarea ${index}`,
        projectId: id,
        doneAt: index < 3 ? new Date() : null,
      });
    }
    // 1 of 4 milestones + 3 of 4 tasks = 4 of 8.
    const [project] = (await getProjectsWeekReview(WEEK, NOW)).projects;
    expect(project).toMatchObject({ id, name: "Lanzar v1", progressPercent: 50 });
  });

  test("nothing to show reads 0 %: no milestones, or Mantenimiento", async () => {
    await insertProject("Vacío");
    const maintenance = await insertProject("Casa", { status: "maintenance" });
    await milestone(maintenance, "Hito", { doneAt: new Date() });
    const review = await getProjectsWeekReview(WEEK, NOW);
    expect(review.projects.map((project) => project.progressPercent)).toEqual([0, 0]);
  });

  test("the next action is the task `tasks` marks; none when there is none", async () => {
    const withAction = await insertProject("Con acción");
    const without = await insertProject("Sin acción");
    await testDb.insert(tasks).values([
      { title: "Escribir la spec", projectId: withAction, isNextAction: true },
      { title: "Otra", projectId: withAction },
      { title: "Hecha", projectId: without, doneAt: new Date() },
    ]);
    const review = await getProjectsWeekReview(WEEK, NOW);
    const byName = Object.fromEntries(review.projects.map((project) => [project.name, project]));
    expect(byName["Con acción"].nextAction).toEqual({
      id: expect.any(String),
      title: "Escribir la spec",
    });
    expect(byName["Sin acción"].nextAction).toBeNull();
  });

  test("a blocked project says by whom, as a fact; a finished blocker no longer blocks", async () => {
    const blocked = await insertProject("Web");
    const blockerA = await insertProject("Diseño");
    const blockerB = await insertProject("Dominio");
    const finished = await insertProject("Contrato", { status: "done", completedAt: new Date() });
    await testDb.insert(projectDependencies).values([
      { projectId: blocked, blockedById: blockerA },
      { projectId: blocked, blockedById: blockerB },
      { projectId: blocked, blockedById: finished },
    ]);
    const review = await getProjectsWeekReview(WEEK, NOW);
    const web = review.projects.find((project) => project.id === blocked);
    expect(web?.blockedBy.map((b) => b.name)).toEqual(["Diseño", "Dominio"]);
    expect(review.projects.find((project) => project.id === blockerA)?.blockedBy).toEqual([]);
    // Positive control: once the first blockers finish, the project is free.
    await testDb
      .update(projects)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(projects.id, blockerA));
    await testDb.update(projects).set({ status: "canceled" }).where(eq(projects.id, blockerB));
    const after = await getProjectsWeekReview(WEEK, NOW);
    expect(after.projects.find((project) => project.id === blocked)?.blockedBy).toEqual([]);
  });

  test("a deleted blocker does not block", async () => {
    const blocked = await insertProject("Web");
    const gone = await insertProject("Borrado", { deletedAt: new Date() });
    await testDb.insert(projectDependencies).values({ projectId: blocked, blockedById: gone });
    const review = await getProjectsWeekReview(WEEK, NOW);
    expect(review.projects.find((project) => project.id === blocked)?.blockedBy).toEqual([]);
  });

  test("no projects: empty, and the week is named", async () => {
    expect(await getProjectsWeekReview("2026-10-15", NOW)).toEqual({
      weekStart: WEEK,
      projects: [],
      milestonesDone: [],
    });
  });

  test("a malformed week is a RangeError", async () => {
    await expect(selectProjectsWeekReview(testDb, "12/10")).rejects.toThrow(RangeError);
  });
});

describe("milestones met within the week", () => {
  test("those checked on the week's Lima days, bounds included; the latest first", async () => {
    const id = await insertProject("Lanzar v1");
    const mondayStart = await milestone(id, "Lunes 00:00", {
      doneAt: new Date("2026-10-12T05:00:00Z"),
    });
    const mid = await milestone(id, "Miércoles", { doneAt: new Date("2026-10-14T20:00:00Z") });
    const sundayEnd = await milestone(id, "Domingo 23:59", {
      doneAt: new Date("2026-10-19T04:59:00Z"),
    });
    await milestone(id, "Antes (domingo 23:59 anterior)", {
      doneAt: new Date("2026-10-12T04:59:00Z"),
    });
    await milestone(id, "Después (lunes 00:00)", { doneAt: new Date("2026-10-19T05:00:00Z") });
    await milestone(id, "Pendiente");
    const review = await getProjectsWeekReview(WEEK, NOW);
    expect(review.milestonesDone.map((m) => m.id)).toEqual([sundayEnd, mid, mondayStart]);
    expect(review.milestonesDone[0]).toMatchObject({
      title: "Domingo 23:59",
      projectId: id,
      projectName: "Lanzar v1",
    });
    expect(review.milestonesDone[0].doneAt).toEqual(new Date("2026-10-19T04:59:00Z"));
  });

  test("counts milestones of any project that isn't deleted (also a finished one), never a deleted milestone", async () => {
    const finished = await insertProject("Terminado", { status: "done", completedAt: new Date() });
    const deleted = await insertProject("Borrado", { deletedAt: new Date() });
    const live = await insertProject("Vivo");
    const at = new Date("2026-10-14T20:00:00Z");
    await milestone(finished, "En terminado", { doneAt: at });
    await milestone(deleted, "En borrado", { doneAt: at });
    await milestone(live, "Borrado suave", { doneAt: at, deletedAt: new Date() });
    await milestone(live, "Bueno", { doneAt: at });
    const review = await getProjectsWeekReview(WEEK, NOW);
    expect(review.milestonesDone.map((m) => m.title).sort()).toEqual(["Bueno", "En terminado"]);
  });
});

describe("a fixed number of queries", () => {
  test("whatever the number of projects", async () => {
    const one = await insertProject("Uno");
    await milestone(one, "H", { doneAt: new Date("2026-10-14T20:00:00Z") });
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    await selectProjectsWeekReview(testDb, WEEK);
    const forOne = select.mock.calls.length + execute.mock.calls.length;
    for (let index = 0; index < 6; index += 1) {
      const id = await insertProject(`P${index}`);
      await milestone(id, `H${index}`);
      await testDb.insert(tasks).values({ title: `T${index}`, projectId: id, isNextAction: true });
    }
    select.mockClear();
    execute.mockClear();
    const review = await selectProjectsWeekReview(testDb, WEEK);
    expect(review.projects).toHaveLength(7);
    expect(select.mock.calls.length + execute.mock.calls.length).toBe(forOne);
    select.mockRestore();
    execute.mockRestore();
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
  ])("with %s the contract redirects to /login", async (_, headers) => {
    await insertProject("Uno");
    // Positive control: the owner reads it.
    expect((await getProjectsWeekReview(WEEK, NOW)).projects).toHaveLength(1);
    request.headers = await headers();
    await expect(getProjectsWeekReview(WEEK, NOW)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
