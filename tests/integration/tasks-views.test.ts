// T2 of `tasks` against the throwaway database: the views' queries (Hoy, Próximas, Todas,
// Hechas) with their windows by Lima's day, order and `visibleTask` exclusions; a task's notes;
// its milestone (set, clear, another project's refused); and authorization.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import {
  listTaskMilestones,
  readTaskNotes,
  setTaskMilestone,
  updateTaskNotes,
} from "@/modules/tasks/detail-actions";
import { tasks } from "@/modules/tasks/db/schema";
import { TASK_ERRORS } from "@/modules/tasks/task-input";
import { TASK_NOTES_ERRORS } from "@/modules/tasks/detail-input";
import {
  selectDoneTasks,
  selectPendingTasks,
  selectTodayTasks,
  selectUpcomingTasks,
} from "@/modules/tasks/view-data";
import {
  getTaskNotes,
  listDoneTasks,
  listPendingTasks,
  listTodayTasks,
  listUpcomingTasks,
} from "@/modules/tasks/view-queries";
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
const MISSING = "00000000-0000-4000-8000-000000000000";

// Friday 2026-10-02, 10:00 in Lima.
const NOW = new Date("2026-10-02T15:00:00Z");
// 23:59:59 in Lima on the 2nd (already the 3rd in UTC) and Lima's midnight a second later.
const LIMA_LAST_SECOND = new Date("2026-10-03T04:59:59Z");
const LIMA_MIDNIGHT = new Date("2026-10-03T05:00:00Z");

async function areaId(slug: string): Promise<string> {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, slug));
  return area.id;
}

async function newProject(values: Partial<typeof projects.$inferInsert> = {}) {
  const [project] = await testDb
    .insert(projects)
    .values({ name: "Cocina", lifeAreaId: await areaId("home"), status: "active", ...values })
    .returning();
  return project;
}

async function newMilestone(
  projectId: string,
  values: Partial<typeof projectMilestones.$inferInsert> = {},
) {
  const [milestone] = await testDb
    .insert(projectMilestones)
    .values({ projectId, title: "Planos", sortOrder: 0, ...values })
    .returning();
  return milestone;
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
  vi.mocked(revalidatePath).mockClear();
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
  minute = 0;
});

describe("Hoy", () => {
  test("overdue and due today (Lima), pending; oldest first, then priority, then creation", async () => {
    await insert({ title: "mañana", dueDate: "2026-10-03" });
    await insert({ title: "hoy media vieja", dueDate: "2026-10-02" });
    await insert({ title: "hoy baja", dueDate: "2026-10-02", priority: "low" });
    await insert({ title: "hoy alta", dueDate: "2026-10-02", priority: "high" });
    await insert({ title: "hoy media nueva", dueDate: "2026-10-02" });
    await insert({ title: "retrasada", dueDate: "2026-09-20", priority: "low" });
    await insert({ title: "sin fecha" });
    await insert({ title: "hecha", dueDate: "2026-10-01", doneAt: NOW });
    expect(titles(await listTodayTasks(NOW))).toEqual([
      "retrasada",
      "hoy alta",
      "hoy media vieja",
      "hoy media nueva",
      "hoy baja",
    ]);
  });

  test("at Lima's midnight, not UTC's, tomorrow becomes today", async () => {
    await insert({ title: "el 3", dueDate: "2026-10-03" });
    expect(titles(await listTodayTasks(LIMA_LAST_SECOND))).toEqual([]);
    expect(titles(await listTodayTasks(LIMA_MIDNIGHT))).toEqual(["el 3"]);
  });
});

describe("Próximas", () => {
  test("from tomorrow to 7 days ahead, by day; not today, later, undated or done", async () => {
    await insert({ title: "hoy", dueDate: "2026-10-02" });
    await insert({ title: "el 9", dueDate: "2026-10-09" });
    await insert({ title: "mañana", dueDate: "2026-10-03" });
    await insert({ title: "el 10", dueDate: "2026-10-10" });
    await insert({ title: "mañana alta", dueDate: "2026-10-03", priority: "high" });
    await insert({ title: "hecha", dueDate: "2026-10-04", doneAt: NOW });
    await insert({ title: "sin fecha" });
    expect(titles(await listUpcomingTasks(NOW))).toEqual(["mañana alta", "mañana", "el 9"]);
    // A second after Lima's midnight the window moves a day.
    expect(titles(await listUpcomingTasks(LIMA_MIDNIGHT))).toEqual(["el 9", "el 10"]);
  });
});

describe("Todas", () => {
  test("every pending task (inbox too) by date, undated last; area and project come along", async () => {
    const home = await areaId("home");
    const project = await newProject();
    await insert({ title: "sin fecha vieja" });
    await insert({ title: "en Hogar", lifeAreaId: home, dueDate: "2026-10-20" });
    await insert({ title: "en Cocina", projectId: project.id, dueDate: "2026-09-01" });
    await insert({ title: "sin fecha alta", priority: "high" });
    await insert({ title: "hecha", doneAt: NOW });
    const all = await listPendingTasks();
    expect(titles(all)).toEqual(["en Cocina", "en Hogar", "sin fecha alta", "sin fecha vieja"]);
    // The project's area is the task's (one source of truth): the area filter matches it.
    expect(all[0]).toMatchObject({ area: { slug: "home" }, project: { name: "Cocina" } });
  });
});

describe("Hechas", () => {
  test("done in the last 30 days, the most recent first", async () => {
    await insert({ title: "ayer", doneAt: new Date("2026-10-01T15:00:00Z") });
    await insert({ title: "hace 30 días justos", doneAt: new Date("2026-09-02T15:00:00Z") });
    await insert({ title: "hace 31 días", doneAt: new Date("2026-09-01T15:00:00Z") });
    await insert({ title: "hoy", doneAt: new Date("2026-10-02T14:00:00Z") });
    await insert({ title: "pendiente" });
    expect(titles(await listDoneTasks(NOW))).toEqual(["hoy", "ayer", "hace 30 días justos"]);
  });
});

describe("every view hides what isn't visible", () => {
  test("a deleted task and the tasks of a deleted project; they come back with it", async () => {
    const project = await newProject();
    const due = "2026-10-02";
    await insert({ title: "borrada", dueDate: due, deletedAt: NOW });
    await insert({ title: "borrada hecha", doneAt: NOW, deletedAt: NOW });
    await insert({ title: "del proyecto", projectId: project.id, dueDate: due });
    await insert({ title: "del proyecto mañana", projectId: project.id, dueDate: "2026-10-03" });
    await insert({ title: "del proyecto hecha", projectId: project.id, doneAt: NOW });
    await insert({ title: "visible", dueDate: due });
    await testDb.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, project.id));
    expect(titles(await listTodayTasks(NOW))).toEqual(["visible"]);
    expect(titles(await listUpcomingTasks(NOW))).toEqual([]);
    expect(titles(await listPendingTasks())).toEqual(["visible"]);
    expect(titles(await listDoneTasks(NOW))).toEqual([]);
    // Positive control: restoring the project brings its tasks back to every view.
    await testDb.update(projects).set({ deletedAt: null }).where(eq(projects.id, project.id));
    expect(titles(await listTodayTasks(NOW))).toEqual(["del proyecto", "visible"]);
    expect(titles(await listUpcomingTasks(NOW))).toEqual(["del proyecto mañana"]);
    expect(titles(await listDoneTasks(NOW))).toEqual(["del proyecto hecha"]);
  });

  test("each view is one query, whatever the number of tasks (no query per task)", async () => {
    const project = await newProject();
    for (let index = 0; index < 5; index += 1) {
      await insert({ title: `t${index}`, projectId: project.id, dueDate: "2026-10-02" });
    }
    // The data function (the query alone, without the owner check's session read).
    const spy = vi.spyOn(testDb, "select");
    for (const read of [
      () => selectTodayTasks(testDb, NOW),
      () => selectUpcomingTasks(testDb, NOW),
      () => selectPendingTasks(testDb),
      () => selectDoneTasks(testDb, NOW),
    ]) {
      spy.mockClear();
      await read();
      expect(spy).toHaveBeenCalledTimes(1);
    }
    spy.mockRestore();
  });
});

describe("notes", () => {
  test("saved normalized (NFC, \\n, no blank start or trailing space); empty clears", async () => {
    const task = await insert({ title: "x" });
    const result = await updateTaskNotes({ id: task.id, notes: "\n\n  code\r\nCafé  \n" });
    expect(result).toEqual({ ok: true, data: { notes: "  code\nCafé" } });
    expect(await getTaskNotes(task.id)).toBe("  code\nCafé");
    expect(await readTaskNotes({ id: task.id })).toEqual({
      ok: true,
      data: { notes: "  code\nCafé" },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${task.id}`);
    expect(await updateTaskNotes({ id: task.id, notes: "   " })).toEqual({
      ok: true,
      data: { notes: null },
    });
    expect(await getTaskNotes(task.id)).toBeNull();
  });

  test("over 20 000 characters, control or bidi characters are refused (nothing saved)", async () => {
    const task = await insert({ title: "x", notes: "antes" });
    const refused = async (notes: string, message: string) =>
      expect(await updateTaskNotes({ id: task.id, notes })).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { notes: [message] },
      });
    await refused("a".repeat(20_001), TASK_NOTES_ERRORS.tooLong);
    await refused("a\u0000b", TASK_NOTES_ERRORS.control);
    await refused("a\u001Bb", TASK_NOTES_ERRORS.control);
    await refused("abc‮def", TASK_NOTES_ERRORS.bidi);
    await refused("abc⁦def", TASK_NOTES_ERRORS.bidi);
    expect(await getTaskNotes(task.id)).toBe("antes");
    // Positive control: exactly 20 000, tabs and the plain marks are fine.
    expect((await updateTaskNotes({ id: task.id, notes: "a".repeat(20_000) })).ok).toBe(true);
    expect((await updateTaskNotes({ id: task.id, notes: "a\tb‎c" })).ok).toBe(true);
  });

  test("a deleted task, one of a deleted project, or a missing one: not found", async () => {
    const project = await newProject({ deletedAt: NOW });
    const ofDeleted = await insert({ title: "x", projectId: project.id, notes: "n" });
    const deleted = await insert({ title: "y", deletedAt: NOW, notes: "n" });
    for (const id of [ofDeleted.id, deleted.id, MISSING]) {
      expect(await updateTaskNotes({ id, notes: "z" })).toEqual({
        ok: false,
        error: TASK_ERRORS.notFound,
      });
      expect(await readTaskNotes({ id })).toEqual({ ok: false, error: TASK_ERRORS.notFound });
      expect(await getTaskNotes(id)).toBeNull();
    }
    const [stored] = await testDb
      .select({ notes: tasks.notes })
      .from(tasks)
      .where(eq(tasks.id, deleted.id));
    expect(stored.notes).toBe("n");
  });
});

describe("milestone", () => {
  test("its project's live milestones are offered, in order (not deleted ones)", async () => {
    const project = await newProject();
    await newMilestone(project.id, { title: "Pintura", sortOrder: 1 });
    await newMilestone(project.id, { title: "Planos", sortOrder: 0, doneAt: NOW });
    await newMilestone(project.id, { title: "Borrado", sortOrder: 2, deletedAt: NOW });
    const result = await listTaskMilestones({ projectId: project.id });
    expect(result.ok && result.data.map((item) => [item.title, item.done])).toEqual([
      ["Planos", true],
      ["Pintura", false],
    ]);
    await testDb.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, project.id));
    expect(await listTaskMilestones({ projectId: project.id })).toEqual({ ok: true, data: [] });
  });

  test("set and clear; revalidates the list and the page", async () => {
    const project = await newProject();
    const milestone = await newMilestone(project.id);
    const task = await insert({ title: "x", projectId: project.id });
    const set = await setTaskMilestone({ id: task.id, milestoneId: milestone.id });
    expect(set.ok && set.data.milestoneId).toBe(milestone.id);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${task.id}`);
    const cleared = await setTaskMilestone({ id: task.id, milestoneId: "" });
    expect(cleared.ok && cleared.data.milestoneId).toBeNull();
    const [stored] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(stored.milestoneId).toBeNull();
  });

  test("another project's milestone, a deleted one, or a task without a project: refused", async () => {
    const project = await newProject();
    const other = await newProject({ name: "Ático" });
    const theirs = await newMilestone(other.id);
    const deleted = await newMilestone(project.id, { deletedAt: NOW });
    const task = await insert({ title: "x", projectId: project.id });
    const inArea = await insert({ title: "y", lifeAreaId: await areaId("home") });
    const refusal = (message: string) => ({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { milestoneId: [message] },
    });
    expect(await setTaskMilestone({ id: task.id, milestoneId: theirs.id })).toEqual(
      refusal(TASK_ERRORS.milestoneUnavailable),
    );
    expect(await setTaskMilestone({ id: task.id, milestoneId: deleted.id })).toEqual(
      refusal(TASK_ERRORS.milestoneUnavailable),
    );
    expect(await setTaskMilestone({ id: task.id, milestoneId: MISSING })).toEqual(
      refusal(TASK_ERRORS.milestoneUnavailable),
    );
    expect(await setTaskMilestone({ id: inArea.id, milestoneId: theirs.id })).toEqual(
      refusal(TASK_ERRORS.milestoneWithoutProject),
    );
    expect(await setTaskMilestone({ id: task.id, milestoneId: "nope" })).toMatchObject({
      ok: false,
      fieldErrors: { milestoneId: [TASK_ERRORS.milestone] },
    });
    const [stored] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(stored.milestoneId).toBeNull();
    // Positive control: its own project's milestone is accepted.
    const own = await newMilestone(project.id, { sortOrder: 1 });
    expect((await setTaskMilestone({ id: task.id, milestoneId: own.id })).ok).toBe(true);
  });

  test("a task of a deleted project, or a deleted task: not found", async () => {
    const project = await newProject();
    const milestone = await newMilestone(project.id);
    const task = await insert({ title: "x", projectId: project.id });
    const deleted = await insert({ title: "y", projectId: project.id, deletedAt: NOW });
    await testDb.update(projects).set({ deletedAt: NOW }).where(eq(projects.id, project.id));
    for (const id of [task.id, deleted.id, MISSING]) {
      expect(await setTaskMilestone({ id, milestoneId: milestone.id })).toEqual({
        ok: false,
        error: TASK_ERRORS.notFound,
      });
    }
  });

  test("a milestone deleted while it is being set waits for it (FOR SHARE), then is refused", async () => {
    const project = await newProject();
    const milestone = await newMilestone(project.id);
    const task = await insert({ title: "x", projectId: project.id });
    // Another connection deletes the milestone and holds its transaction open.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => {};
    const deleted = new Promise<void>((resolve) => (locked = resolve));
    const deleting = testDb.transaction(async (tx) => {
      await tx
        .update(projectMilestones)
        .set({ deletedAt: sql`now()` })
        .where(eq(projectMilestones.id, milestone.id));
      locked();
      await held;
    });
    await deleted;
    const setting = setTaskMilestone({ id: task.id, milestoneId: milestone.id });
    // The set must be blocked on the milestone's row lock before the delete commits.
    let waited = false;
    for (let tries = 0; tries < 250 && !waited; tries += 1) {
      const [{ waiting }] = (
        await testDb.execute<{ waiting: number }>(
          sql`select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock'`,
        )
      ).rows;
      waited = waiting > 0;
      if (!waited) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waited).toBe(true);
    release();
    await deleting;
    expect(await setting).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { milestoneId: [TASK_ERRORS.milestoneUnavailable] },
    });
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
  ])("with %s every action is refused and nothing changes", async (_, headers) => {
    const project = await newProject();
    const milestone = await newMilestone(project.id);
    const task = await insert({ title: "x", projectId: project.id, notes: "n" });
    const [before] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    request.headers = await headers();
    for (const call of [
      () => updateTaskNotes({ id: task.id, notes: "z" }),
      () => readTaskNotes({ id: task.id }),
      () => listTaskMilestones({ projectId: project.id }),
      () => setTaskMilestone({ id: task.id, milestoneId: milestone.id }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    const [after] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after).toEqual(before);
  });
});
