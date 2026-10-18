// G2 of `goals`, the projects side, against the throwaway database: `getProjectProgress` (the
// same figure as the list and the detail: the tasks the registered sources count; a milestone is a
// phase, not a unit of progress),
// the states, deleted and missing projects, a fixed number of queries, the option lists a goal's
// form uses, and authorization.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  getProjectOptions,
  getProjectProgress,
  selectProjectAvailability,
  selectProjectOptions,
  selectProjectsProgress,
} from "@/modules/projects/contracts";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
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
const MISSING = "00000000-0000-4000-8000-000000000000";

async function insertProject(name: string, values: Partial<typeof projects.$inferInsert> = {}) {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "work"));
  const [row] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: area.id, status: "active", ...values })
    .returning({ id: projects.id });
  return row.id;
}

/** `total` tasks of the project, the first `done` of them done. */
async function milestones(projectId: string, done: number, total: number) {
  for (let index = 0; index < total; index += 1) {
    await testDb.insert(tasks).values({
      title: `Tarea ${index}`,
      projectId,
      doneAt: index < done ? new Date() : null,
    });
  }
}

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

describe("getProjectProgress", () => {
  test("the tasks' percentage and the project's state", async () => {
    const id = await insertProject("Lanzar brahua-os");
    await milestones(id, 1, 4);
    expect(await getProjectProgress(id)).toEqual({ percent: 25, status: "active" });
  });

  test("milestones are phases, not units: they never change the percentage (3 of 4 tasks = 75 %)", async () => {
    const id = await insertProject("Con hitos");
    await milestones(id, 3, 4);
    // Four milestones (phases): nothing to do with the progress.
    for (let index = 0; index < 4; index += 1) {
      await testDb.insert(projectMilestones).values({
        projectId: id,
        title: `Hito ${index}`,
        sortOrder: index,
      });
    }
    expect(await getProjectProgress(id)).toEqual({ percent: 75, status: "active" });
  });

  test("nothing to show reads 0 %: no tasks, or Mantenimiento", async () => {
    const empty = await insertProject("Vacío");
    expect(await getProjectProgress(empty)).toEqual({ percent: 0, status: "active" });
    const maintenance = await insertProject("Casa", { status: "maintenance" });
    await milestones(maintenance, 2, 2);
    expect(await getProjectProgress(maintenance)).toEqual({ percent: 0, status: "maintenance" });
  });

  test("a finished project says «terminado» (done), whatever its percentage", async () => {
    const id = await insertProject("Hecho", { status: "done", completedAt: new Date() });
    await milestones(id, 1, 4);
    expect(await getProjectProgress(id)).toEqual({ percent: 25, status: "done" });
  });

  test("a deleted or missing project is null", async () => {
    const deleted = await insertProject("Borrado", { deletedAt: new Date() });
    expect(await getProjectProgress(deleted)).toBeNull();
    expect(await getProjectProgress(MISSING)).toBeNull();
  });

  test("a fixed number of queries whatever the number of projects", async () => {
    const one = await insertProject("Uno");
    await milestones(one, 1, 2);
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    await selectProjectsProgress(testDb, [one]);
    const forOne = select.mock.calls.length + execute.mock.calls.length;
    select.mockClear();
    execute.mockClear();
    const ids = [one];
    for (let index = 0; index < 6; index += 1) {
      const id = await insertProject(`P${index}`);
      await milestones(id, index % 2, 2);
      ids.push(id);
    }
    select.mockClear();
    execute.mockClear();
    const result = await selectProjectsProgress(testDb, ids);
    expect(result.size).toBe(7);
    expect(select.mock.calls.length + execute.mock.calls.length).toBe(forOne);
    select.mockRestore();
    execute.mockRestore();
  });
});

describe("the options a goal can follow", () => {
  test("projects in Idea, Activo and Pausado, by name; never finished, canceled, maintenance or deleted", async () => {
    await insertProject("Beta", { status: "paused" });
    await insertProject("Alfa", { status: "idea" });
    await insertProject("Gamma");
    await insertProject("Hecho", { status: "done", completedAt: new Date() });
    await insertProject("Cancelado", { status: "canceled" });
    await insertProject("Casa", { status: "maintenance" });
    await insertProject("Borrado", { deletedAt: new Date() });
    const names = (await getProjectOptions()).map((option) => option.name);
    expect(names).toEqual(["Alfa", "Beta", "Gamma"]);
    expect((await selectProjectOptions(testDb)).map((option) => option.name)).toEqual(names);
  });

  test("availability: any project that isn't deleted (a goal keeps following a finished one)", async () => {
    const done = await insertProject("Hecho", { status: "done", completedAt: new Date() });
    const deleted = await insertProject("Borrado", { deletedAt: new Date() });
    const live = await insertProject("Vivo");
    const available = await selectProjectAvailability(testDb, [done, deleted, live, MISSING]);
    expect([...available].sort()).toEqual([done, live].sort());
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
  ])("with %s the contracts redirect to /login", async (_, headers) => {
    const id = await insertProject("Vivo");
    // Positive control: the owner reads it.
    expect(await getProjectProgress(id)).not.toBeNull();
    expect(await getProjectOptions()).toHaveLength(1);
    request.headers = await headers();
    const toLogin = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getProjectProgress(id)).rejects.toMatchObject(toLogin);
    await expect(getProjectOptions()).rejects.toMatchObject(toLogin);
  });
});
