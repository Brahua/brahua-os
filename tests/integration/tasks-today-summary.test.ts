// T6 of `tasks` against the throwaway database: the summary for `today` (overdue and due today
// by Lima's day; never done, deleted, of a deleted project, future or undated), its order, its
// DTO (area or project with its area), one query, and authorization.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { projects } from "@/modules/projects/db/schema";
import { getTasksTodaySummary, selectTasksTodaySummary } from "@/modules/tasks/contracts";
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

// Friday 2026-10-02, 10:00 in Lima.
const NOW = new Date("2026-10-02T15:00:00Z");
// 23:59:59 in Lima on the 2nd (already the 3rd in UTC) and Lima's midnight a second later.
const LIMA_LAST_SECOND = new Date("2026-10-03T04:59:59Z");
const LIMA_MIDNIGHT = new Date("2026-10-03T05:00:00Z");

async function area(slug: string) {
  const [row] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, slug));
  return row;
}

async function newProject(values: Partial<typeof projects.$inferInsert> = {}) {
  const [project] = await testDb
    .insert(projects)
    .values({ name: "Cocina", lifeAreaId: (await area("home")).id, status: "active", ...values })
    .returning();
  return project;
}

/** A task straight in the database (created a minute apart, in call order). */
let minute = 0;
async function insert(values: Partial<typeof tasks.$inferInsert> & { title: string }) {
  minute += 1;
  const [task] = await testDb
    .insert(tasks)
    .values({ createdAt: new Date(Date.UTC(2026, 8, 1, 0, minute)), ...values })
    .returning();
  return task;
}

const titles = (items: { title: string }[]) => items.map((item) => item.title);

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
  minute = 0;
});

describe("getTasksTodaySummary", () => {
  test("overdue and due today, pending and visible; nothing else", async () => {
    const project = await newProject();
    const gone = await newProject({ name: "Borrado" });
    await insert({ title: "hoy", dueDate: "2026-10-02" });
    await insert({ title: "retrasada", dueDate: "2026-09-25" });
    await insert({ title: "del proyecto", projectId: project.id, dueDate: "2026-10-02" });
    await insert({ title: "mañana", dueDate: "2026-10-03" });
    await insert({ title: "en un mes", dueDate: "2026-11-02" });
    await insert({ title: "sin fecha" });
    await insert({ title: "hecha", dueDate: "2026-10-01", doneAt: NOW });
    await insert({ title: "eliminada", dueDate: "2026-10-02", deletedAt: NOW });
    await insert({ title: "de un proyecto eliminado", projectId: gone.id, dueDate: "2026-10-01" });
    await testDb.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, gone.id));

    expect(titles(await getTasksTodaySummary(NOW))).toEqual(["retrasada", "hoy", "del proyecto"]);

    // Positive control: restoring the project brings its task back.
    await testDb.update(projects).set({ deletedAt: null }).where(eq(projects.id, gone.id));
    expect(titles(await getTasksTodaySummary(NOW))).toContain("de un proyecto eliminado");
  });

  test("most overdue first, then priority (Alta first), then creation", async () => {
    await insert({ title: "hoy media vieja", dueDate: "2026-10-02" });
    await insert({ title: "hoy baja", dueDate: "2026-10-02", priority: "low" });
    await insert({ title: "hoy alta", dueDate: "2026-10-02", priority: "high" });
    await insert({ title: "hoy media nueva", dueDate: "2026-10-02" });
    await insert({ title: "retrasada 1 día", dueDate: "2026-10-01", priority: "low" });
    await insert({ title: "retrasada 10 días", dueDate: "2026-09-22", priority: "low" });
    expect(titles(await getTasksTodaySummary(NOW))).toEqual([
      "retrasada 10 días",
      "retrasada 1 día",
      "hoy alta",
      "hoy media vieja",
      "hoy media nueva",
      "hoy baja",
    ]);
  });

  test("Lima's day: at 23:59:59 tomorrow isn't in yet; at 00:00 it is and today is late", async () => {
    await insert({ title: "del 2", dueDate: "2026-10-02" });
    await insert({ title: "del 3", dueDate: "2026-10-03" });
    const labels = async (now: Date) =>
      (await getTasksTodaySummary(now)).map((item) => [item.title, item.due.label]);
    expect(await labels(LIMA_LAST_SECOND)).toEqual([["del 2", "Vence hoy"]]);
    expect(await labels(LIMA_MIDNIGHT)).toEqual([
      ["del 2", "Retrasada hace 1 día"],
      ["del 3", "Vence hoy"],
    ]);
  });

  test("the DTO: own area, the project with its area, the inbox, the next action", async () => {
    const work = await area("work");
    const home = await area("home");
    const project = await newProject({ name: "Cocina", lifeAreaId: home.id });
    const inArea = await insert({ title: "en área", lifeAreaId: work.id, dueDate: "2026-10-01" });
    const inProject = await insert({
      title: "en proyecto",
      projectId: project.id,
      dueDate: "2026-10-02",
      priority: "high",
      isNextAction: true,
    });
    const inInbox = await insert({ title: "en la bandeja", dueDate: "2026-10-02" });
    const summary = (table: typeof work) => ({
      id: table.id,
      slug: table.slug,
      name: table.name,
      icon: table.icon,
      color: table.color,
    });

    expect(await getTasksTodaySummary(NOW)).toEqual([
      {
        id: inArea.id,
        title: "en área",
        priority: "medium",
        dueDate: "2026-10-01",
        dueTime: null,
        due: { kind: "overdue", days: 1, label: "Retrasada hace 1 día" },
        area: summary(work),
        project: null,
        isNextAction: false,
      },
      {
        id: inProject.id,
        title: "en proyecto",
        priority: "high",
        dueDate: "2026-10-02",
        dueTime: null,
        due: { kind: "today", days: 0, label: "Vence hoy" },
        area: summary(home),
        project: { id: project.id, name: "Cocina" },
        isNextAction: true,
      },
      {
        id: inInbox.id,
        title: "en la bandeja",
        priority: "medium",
        dueDate: "2026-10-02",
        dueTime: null,
        due: { kind: "today", days: 0, label: "Vence hoy" },
        area: null,
        project: null,
        isNextAction: false,
      },
    ]);
  });

  test("the project's area follows the project", async () => {
    const project = await newProject();
    await insert({ title: "x", projectId: project.id, dueDate: "2026-10-02" });
    const health = await area("health");
    await testDb.update(projects).set({ lifeAreaId: health.id }).where(eq(projects.id, project.id));
    const [item] = await getTasksTodaySummary(NOW);
    expect(item.area?.slug).toBe("health");
  });

  test("a closed project: its pending task stays, but isn't a next action (T5's rule)", async () => {
    const project = await newProject();
    await insert({
      title: "marcada",
      projectId: project.id,
      dueDate: "2026-10-02",
      isNextAction: true,
    });
    const flags = async () =>
      (await getTasksTodaySummary(NOW)).map((item) => [item.title, item.isNextAction]);
    // Positive control: while the project is open, it is the next action.
    expect(await flags()).toEqual([["marcada", true]]);
    for (const status of ["done", "canceled"] as const) {
      await testDb
        .update(projects)
        // `completed_at` only for Terminado (projects_completed_at_check).
        .set({ status, completedAt: status === "done" ? NOW : null })
        .where(eq(projects.id, project.id));
      expect(await flags()).toEqual([["marcada", false]]);
    }
    // Reopened, the mark comes back (it stayed in the database).
    await testDb
      .update(projects)
      .set({ status: "active", completedAt: null })
      .where(eq(projects.id, project.id));
    expect(await flags()).toEqual([["marcada", true]]);
  });

  test("empty when nothing is due", async () => {
    await insert({ title: "tranquila", dueDate: "2026-12-01" });
    expect(await getTasksTodaySummary(NOW)).toEqual([]);
  });

  test("one query, whatever the number of tasks (no query per task)", async () => {
    const project = await newProject();
    const work = await area("work");
    for (let index = 0; index < 5; index += 1) {
      await insert({ title: `p${index}`, projectId: project.id, dueDate: "2026-10-02" });
      await insert({ title: `a${index}`, lifeAreaId: work.id, dueDate: "2026-09-30" });
    }
    // The data function (the query alone, without the owner check's session read).
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const items = await selectTasksTodaySummary(testDb, NOW);
    expect(items).toHaveLength(10);
    expect(select).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
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
  ])("with %s it redirects to /login", async (_, headers) => {
    await insert({ title: "hoy", dueDate: "2026-10-02" });
    // Positive control: the owner sees it.
    expect(titles(await getTasksTodaySummary(NOW))).toEqual(["hoy"]);
    request.headers = await headers();
    await expect(getTasksTodaySummary(NOW)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
