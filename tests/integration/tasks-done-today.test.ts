// D4 of `today` against the throwaway database: `getTasksDoneTodayCount` (the tasks completed on
// Lima's day of `now`: midnight edges, never deleted or of a deleted project), one query, and
// authorization.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { projects } from "@/modules/projects/db/schema";
import { getTasksDoneTodayCount, selectTasksDoneTodayCount } from "@/modules/tasks/contracts";
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

// Friday 2026-10-02, 10:00 in Lima (UTC-5).
const NOW = new Date("2026-10-02T15:00:00Z");
// Lima's day of NOW starts at 05:00 UTC on the 2nd and ends a second before 05:00 UTC on the 3rd.
const LIMA_FIRST_SECOND = new Date("2026-10-02T05:00:00Z");
const LIMA_LAST_SECOND = new Date("2026-10-03T04:59:59Z");
const LIMA_NEXT_MIDNIGHT = new Date("2026-10-03T05:00:00Z");
const LIMA_DAY_BEFORE_LAST_SECOND = new Date("2026-10-02T04:59:59Z");

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

async function insert(values: Partial<typeof tasks.$inferInsert> & { title: string }) {
  const [task] = await testDb.insert(tasks).values(values).returning();
  return task;
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

describe("getTasksDoneTodayCount", () => {
  test("counts the visible tasks completed today, whatever their due date or place", async () => {
    const project = await newProject();
    const work = await area("work");
    await insert({ title: "de hoy", dueDate: "2026-10-02", doneAt: NOW });
    await insert({ title: "sin fecha, en la bandeja", doneAt: NOW });
    await insert({ title: "futura, adelantada", dueDate: "2026-11-01", doneAt: NOW });
    await insert({ title: "del área", lifeAreaId: work.id, doneAt: NOW });
    await insert({ title: "del proyecto", projectId: project.id, doneAt: NOW });
    // Not done, or done another day: never counted.
    await insert({ title: "pendiente", dueDate: "2026-10-02" });
    await insert({ title: "ayer", doneAt: new Date("2026-10-01T15:00:00Z") });
    expect(await getTasksDoneTodayCount(NOW)).toBe(5);
  });

  test("zero on a day without completions", async () => {
    await insert({ title: "pendiente", dueDate: "2026-10-02" });
    await insert({ title: "ayer", doneAt: new Date("2026-10-01T15:00:00Z") });
    expect(await getTasksDoneTodayCount(NOW)).toBe(0);
  });

  test("Lima's midnight: 00:00 and 23:59:59 count for the day; a second outside, the other day", async () => {
    await insert({ title: "primer segundo", doneAt: LIMA_FIRST_SECOND });
    await insert({ title: "último segundo", doneAt: LIMA_LAST_SECOND });
    await insert({ title: "día anterior", doneAt: LIMA_DAY_BEFORE_LAST_SECOND });
    await insert({ title: "día siguiente", doneAt: LIMA_NEXT_MIDNIGHT });
    expect(await getTasksDoneTodayCount(NOW)).toBe(2);
    // The same instants seen from the edges of the day: `now` decides the day, in Lima.
    expect(await getTasksDoneTodayCount(LIMA_LAST_SECOND)).toBe(2);
    expect(await getTasksDoneTodayCount(LIMA_NEXT_MIDNIGHT)).toBe(1);
    expect(await getTasksDoneTodayCount(LIMA_DAY_BEFORE_LAST_SECOND)).toBe(1);
  });

  test("a deleted task and one of a deleted project don't count; restored, they do", async () => {
    const gone = await newProject({ name: "Borrado", deletedAt: NOW });
    const deleted = await insert({ title: "eliminada", doneAt: NOW, deletedAt: NOW });
    await insert({ title: "del proyecto eliminado", projectId: gone.id, doneAt: NOW });
    await insert({ title: "visible", doneAt: NOW });
    expect(await getTasksDoneTodayCount(NOW)).toBe(1);

    // Positive control: restoring them brings them back.
    await testDb.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, deleted.id));
    await testDb.update(projects).set({ deletedAt: null }).where(eq(projects.id, gone.id));
    expect(await getTasksDoneTodayCount(NOW)).toBe(3);
  });

  test("one query, whatever the number of tasks", async () => {
    for (let index = 0; index < 10; index += 1) {
      await insert({ title: `hecha ${index}`, doneAt: NOW });
    }
    // The data function (the query alone, without the owner check's session read).
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    expect(await selectTasksDoneTodayCount(testDb, NOW)).toBe(10);
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
    await insert({ title: "hecha", doneAt: NOW });
    // Positive control: the owner gets the count.
    expect(await getTasksDoneTodayCount(NOW)).toBe(1);
    request.headers = await headers();
    await expect(getTasksDoneTodayCount(NOW)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
