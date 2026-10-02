// T1 of `tasks` against the throwaway database: capture into the inbox, placement (area or
// project, the area derived from the project, milestones of the same project only), complete and
// undo (idempotent by done_at), soft delete and undo, reads, locks, CHECKs and authorization.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import {
  completeTask,
  createTask,
  deleteTask,
  editTask,
  listTaskTargets,
  reopenTask,
  restoreTask,
} from "@/modules/tasks/actions";
import { tasks, taskTags } from "@/modules/tasks/db/schema";
import { getDeletedTask, getTask, getTaskTargets, listInboxTasks } from "@/modules/tasks/queries";
import { TASK_ERRORS } from "@/modules/tasks/task-input";
import { TASKS_ADVISORY_SPACE } from "@/modules/tasks/tasks";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

// The actions read the request headers (session cookie) and the app database: point both at
// the test, and record revalidations instead of touching Next's cache.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const MISSING = "00000000-0000-4000-8000-000000000000";

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

async function row(id: string) {
  const [found] = await testDb.select().from(tasks).where(eq(tasks.id, id));
  return found;
}

/** Creates a task through the action and returns it (fails the test otherwise). */
async function capture(input: Record<string, unknown>) {
  const result = await createTask(input);
  if (!result.ok) throw new Error(`createTask failed: ${JSON.stringify(result)}`);
  return result.data;
}

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

describe("capture", () => {
  test("a title alone lands in the inbox, Media, without a date; revalidates /tasks", async () => {
    const task = await capture({ title: "  comprar   pilas " });
    expect(task).toMatchObject({
      title: "comprar pilas",
      priority: "medium",
      dueDate: null,
      doneAt: null,
      lifeAreaId: null,
      projectId: null,
      area: null,
      project: null,
      recurrence: null,
      tags: [],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect((await listInboxTasks()).map((item) => item.id)).toEqual([task.id]);
  });

  test("with an area, a date and a priority; it is not in the inbox", async () => {
    const health = await areaId("health");
    const task = await capture({
      title: "pedir cita",
      lifeAreaId: health,
      dueDate: "2026-10-31",
      priority: "high",
    });
    expect(task).toMatchObject({
      lifeAreaId: health,
      area: { id: health, slug: "health" },
      dueDate: "2026-10-31",
      priority: "high",
    });
    expect(await listInboxTasks()).toEqual([]);
  });

  test("in a project: the area is the project's (not stored on the task)", async () => {
    const project = await newProject();
    const task = await capture({ title: "medir paredes", projectId: project.id });
    expect(task).toMatchObject({
      projectId: project.id,
      lifeAreaId: null,
      area: { id: project.lifeAreaId },
      project: { id: project.id, name: "Cocina", status: "active" },
    });
    expect((await row(task.id)).lifeAreaId).toBeNull();
    // Moving the project to another area moves its tasks.
    const work = await areaId("work");
    await testDb.update(projects).set({ lifeAreaId: work }).where(eq(projects.id, project.id));
    expect((await getTask(task.id))?.area?.id).toBe(work);
  });

  test("a milestone of that project is fine; of another project it is refused", async () => {
    const mine = await newProject();
    const other = await newProject({ name: "Otro" });
    const own = await newMilestone(mine.id);
    const theirs = await newMilestone(other.id, { title: "Ajeno" });
    expect(await capture({ title: "a", projectId: mine.id, milestoneId: own.id })).toMatchObject({
      milestoneId: own.id,
    });
    expect(await createTask({ title: "b", projectId: mine.id, milestoneId: theirs.id })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { milestoneId: [TASK_ERRORS.milestoneUnavailable] },
    });
    await testDb
      .update(projectMilestones)
      .set({ deletedAt: sql`now()` })
      .where(eq(projectMilestones.id, own.id));
    expect(await createTask({ title: "c", projectId: mine.id, milestoneId: own.id })).toMatchObject(
      {
        ok: false,
        fieldErrors: { milestoneId: [TASK_ERRORS.milestoneUnavailable] },
      },
    );
    expect(await testDb.$count(tasks)).toBe(1);
  });

  test("an archived or missing area, or a closed or deleted project, is refused", async () => {
    const health = await areaId("health");
    await testDb
      .update(lifeAreas)
      .set({ archivedAt: sql`now()` })
      .where(eq(lifeAreas.id, health));
    expect(await createTask({ title: "x", lifeAreaId: health })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { lifeAreaId: [TASK_ERRORS.areaUnavailable] },
    });
    expect(await createTask({ title: "x", lifeAreaId: MISSING })).toMatchObject({
      fieldErrors: { lifeAreaId: [TASK_ERRORS.areaUnavailable] },
    });
    for (const values of [
      { status: "done" as const, completedAt: new Date() },
      { status: "canceled" as const },
      { deletedAt: new Date() },
    ]) {
      const project = await newProject(values);
      expect(await createTask({ title: "x", projectId: project.id })).toMatchObject({
        fieldErrors: { projectId: [TASK_ERRORS.projectUnavailable] },
      });
    }
    expect(await testDb.$count(tasks)).toBe(0);
    // Revalidated anyway: the page's areas and projects were out of date.
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  test("invalid input is a field error and writes nothing", async () => {
    expect(await createTask({ title: " " })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { title: [TASK_ERRORS.titleRequired] },
    });
    expect(
      await createTask({ title: "x", lifeAreaId: await areaId("health"), projectId: MISSING }),
    ).toMatchObject({ fieldErrors: { projectId: [TASK_ERRORS.areaAndProject] } });
    expect(await testDb.$count(tasks)).toBe(0);
  });
});

describe("editTask", () => {
  test("moves it from the inbox to an area, then to a project (area derived), then back", async () => {
    const task = await capture({ title: "pintar" });
    const health = await areaId("health");
    expect(await editTask({ id: task.id, placement: { lifeAreaId: health } })).toMatchObject({
      ok: true,
      data: { lifeAreaId: health, area: { id: health } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${task.id}`);

    const project = await newProject();
    expect(await editTask({ id: task.id, placement: { projectId: project.id } })).toMatchObject({
      ok: true,
      data: { lifeAreaId: null, projectId: project.id, area: { id: project.lifeAreaId } },
    });
    expect(await row(task.id)).toMatchObject({ lifeAreaId: null, projectId: project.id });

    expect(await editTask({ id: task.id, placement: {} })).toMatchObject({
      ok: true,
      data: { lifeAreaId: null, projectId: null, area: null },
    });
    expect((await listInboxTasks()).map((item) => item.id)).toEqual([task.id]);
  });

  test("a milestone of another project is refused, and nothing changes", async () => {
    const mine = await newProject();
    const other = await newProject({ name: "Otro" });
    const theirs = await newMilestone(other.id);
    const task = await capture({ title: "x", projectId: mine.id });
    expect(
      await editTask({ id: task.id, placement: { projectId: mine.id, milestoneId: theirs.id } }),
    ).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { "placement.milestoneId": [TASK_ERRORS.milestoneUnavailable] },
    });
    expect((await row(task.id)).milestoneId).toBeNull();
  });

  test("its current archived area or closed project stays; an edit of other fields works", async () => {
    const health = await areaId("health");
    const task = await capture({ title: "x", lifeAreaId: health });
    await testDb
      .update(lifeAreas)
      .set({ archivedAt: sql`now()` })
      .where(eq(lifeAreas.id, health));
    expect(
      await editTask({ id: task.id, title: "y", placement: { lifeAreaId: health } }),
    ).toMatchObject({ ok: true, data: { title: "y", lifeAreaId: health } });
    // Moving it to another archived area is refused.
    const work = await areaId("work");
    await testDb
      .update(lifeAreas)
      .set({ archivedAt: sql`now()` })
      .where(eq(lifeAreas.id, work));
    expect(await editTask({ id: task.id, placement: { lifeAreaId: work } })).toMatchObject({
      fieldErrors: { "placement.lifeAreaId": [TASK_ERRORS.areaUnavailable] },
    });
  });

  test("leaving a project clears the next-action mark (it is the project's)", async () => {
    const project = await newProject();
    const task = await capture({ title: "x", projectId: project.id });
    await testDb.update(tasks).set({ isNextAction: true }).where(eq(tasks.id, task.id));
    await editTask({ id: task.id, placement: { lifeAreaId: await areaId("home") } });
    expect(await row(task.id)).toMatchObject({ isNextAction: false, projectId: null });
  });

  test("title, priority and date; missing fields stay; null clears the date", async () => {
    const task = await capture({ title: "x", dueDate: "2026-10-31", priority: "high" });
    expect(await editTask({ id: task.id, title: " y  z " })).toMatchObject({
      ok: true,
      data: { title: "y z", dueDate: "2026-10-31", priority: "high" },
    });
    expect(await editTask({ id: task.id, priority: "low", dueDate: null })).toMatchObject({
      ok: true,
      data: { title: "y z", dueDate: null, priority: "low" },
    });
  });

  test("a missing or deleted task is not found; a malformed id never reaches Postgres", async () => {
    expect(await editTask({ id: MISSING, title: "x" })).toEqual({
      ok: false,
      error: TASK_ERRORS.notFound,
    });
    const task = await capture({ title: "x" });
    await deleteTask({ id: task.id });
    expect(await editTask({ id: task.id, title: "y" })).toEqual({
      ok: false,
      error: TASK_ERRORS.notFound,
    });
    expect((await row(task.id)).title).toBe("x");
    expect(await editTask({ id: "1; drop table tasks", title: "y" })).toMatchObject({
      fieldErrors: { id: [TASK_ERRORS.notFound] },
    });
  });
});

describe("complete and undo", () => {
  test("completing takes it out of the inbox; twice keeps the first date (double tap)", async () => {
    const task = await capture({ title: "x" });
    const first = await completeTask({ id: task.id });
    expect(first).toMatchObject({ ok: true, data: { id: task.id } });
    const doneAt = (await row(task.id)).doneAt;
    expect(doneAt).toBeInstanceOf(Date);
    expect(await listInboxTasks()).toEqual([]);
    expect(await completeTask({ id: task.id })).toMatchObject({ ok: true });
    expect((await row(task.id)).doneAt).toEqual(doneAt);
  });

  test("two completions at once: one wins, both answer ok, one done_at", async () => {
    const task = await capture({ title: "x" });
    const results = await Promise.all([
      completeTask({ id: task.id }),
      completeTask({ id: task.id }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const [a, b] = results.map((result) => (result.ok ? result.data.doneAt : null));
    expect(a).toEqual(b);
    expect(await testDb.$count(tasks)).toBe(1);
  });

  test("completing clears the next-action mark", async () => {
    const project = await newProject();
    const task = await capture({ title: "x", projectId: project.id });
    await testDb.update(tasks).set({ isNextAction: true }).where(eq(tasks.id, task.id));
    await completeTask({ id: task.id });
    expect(await row(task.id)).toMatchObject({ isNextAction: false });
  });

  test("Deshacer reopens it (back in the inbox); twice changes nothing", async () => {
    const task = await capture({ title: "x" });
    await completeTask({ id: task.id });
    expect(await reopenTask({ id: task.id })).toMatchObject({ ok: true, data: { doneAt: null } });
    expect(await reopenTask({ id: task.id })).toMatchObject({ ok: true, data: { doneAt: null } });
    expect((await listInboxTasks()).map((item) => item.id)).toEqual([task.id]);
  });

  test("a missing or deleted task is not found", async () => {
    expect(await completeTask({ id: MISSING })).toEqual({ ok: false, error: TASK_ERRORS.notFound });
    expect(await reopenTask({ id: MISSING })).toEqual({ ok: false, error: TASK_ERRORS.notFound });
    const task = await capture({ title: "x" });
    await deleteTask({ id: task.id });
    expect(await completeTask({ id: task.id })).toEqual({ ok: false, error: TASK_ERRORS.notFound });
    expect((await row(task.id)).doneAt).toBeNull();
  });
});

describe("soft delete and undo", () => {
  test("delete marks deleted_at (out of every read); undo brings it back; never a physical delete", async () => {
    const task = await capture({ title: "x" });
    vi.mocked(revalidatePath).mockClear();
    expect(await deleteTask({ id: task.id })).toEqual({
      ok: true,
      data: { id: task.id, title: "x" },
    });
    // Only the list: the task's page would turn into its 404 before the client leaves it.
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect((await row(task.id)).deletedAt).toBeInstanceOf(Date);
    expect(await listInboxTasks()).toEqual([]);
    expect(await getTask(task.id)).toBeNull();
    expect(await getDeletedTask(task.id)).toEqual({ id: task.id, title: "x" });
    expect(await deleteTask({ id: task.id })).toEqual({ ok: false, error: TASK_ERRORS.notFound });

    expect(await restoreTask({ id: task.id })).toMatchObject({ ok: true, data: { id: task.id } });
    expect(await restoreTask({ id: task.id })).toMatchObject({ ok: true });
    expect((await row(task.id)).deletedAt).toBeNull();
    expect(await getDeletedTask(task.id)).toBeNull();
    expect(await restoreTask({ id: MISSING })).toEqual({ ok: false, error: TASK_ERRORS.notFound });
    expect(await testDb.$count(tasks)).toBe(1);
  });

  test("the list's undo notice is offered only for a delete of the last 10 minutes", async () => {
    const task = await capture({ title: "x" });
    await testDb
      .update(tasks)
      .set({ deletedAt: sql`now() - interval '11 minutes'` })
      .where(eq(tasks.id, task.id));
    expect(await getDeletedTask(task.id)).toBeNull();
    expect(await getDeletedTask("nope")).toBeNull();
  });
});

describe("reads", () => {
  test("the inbox: pending, unclassified, not deleted, the newest first", async () => {
    const old = await capture({ title: "vieja" });
    await testDb
      .update(tasks)
      .set({ createdAt: sql`now() - interval '1 day'` })
      .where(eq(tasks.id, old.id));
    const recent = await capture({ title: "nueva" });
    const done = await capture({ title: "hecha" });
    await completeTask({ id: done.id });
    const gone = await capture({ title: "borrada" });
    await deleteTask({ id: gone.id });
    await capture({ title: "en área", lifeAreaId: await areaId("health") });
    await capture({ title: "en proyecto", projectId: (await newProject()).id });
    expect((await listInboxTasks()).map((item) => item.title)).toEqual([recent.title, old.title]);
  });

  test("tags come with the task, by name", async () => {
    const task = await capture({ title: "x" });
    const [b, a] = await testDb
      .insert(taskTags)
      .values([{ name: "limpieza" }, { name: "compras" }])
      .returning();
    await testDb.execute(
      sql`insert into task_tag_links (task_id, tag_id) values (${task.id}, ${b.id}), (${task.id}, ${a.id})`,
    );
    expect((await getTask(task.id))?.tags).toEqual([
      { id: a.id, name: "compras" },
      { id: b.id, name: "limpieza" },
    ]);
  });

  test("targets: the active areas in order and the open projects by name", async () => {
    await newProject({ name: "Zanahorias" });
    await newProject({ name: "árbol" });
    await newProject({ name: "Hecho", status: "done", completedAt: new Date() });
    await newProject({ name: "Cancelado", status: "canceled" });
    await newProject({ name: "Borrado", deletedAt: new Date() });
    await testDb
      .update(lifeAreas)
      .set({ archivedAt: sql`now()` })
      .where(eq(lifeAreas.slug, "health"));
    const targets = await getTaskTargets();
    expect(targets.areas.map((area) => area.slug)).not.toContain("health");
    expect(targets.areas).toHaveLength(7);
    expect(targets.projects.map((project) => project.name)).toEqual(["árbol", "Zanahorias"]);
    expect(await listTaskTargets({})).toEqual({ ok: true, data: targets });
  });

  test("a malformed id reads nothing", async () => {
    expect(await getTask("not-a-uuid")).toBeNull();
    expect(await getTask(MISSING)).toBeNull();
  });
});

describe("locks", () => {
  test("a write into a project waits for that project's task lock; others don't", async () => {
    const mine = await newProject();
    const other = await newProject({ name: "Otro" });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1::int, hashtext($2))", [
        TASKS_ADVISORY_SPACE,
        mine.id,
      ]);
      // Would hang if the lock were global.
      expect((await createTask({ title: "otro", projectId: other.id })).ok).toBe(true);
      expect((await createTask({ title: "bandeja" })).ok).toBe(true);
      // The same project's write waits for the holder.
      const pending = createTask({ title: "mío", projectId: mine.id });
      await waitForLockWaiters(mine.id, 1);
      await holder.query("commit");
      expect((await pending).ok).toBe(true);
    } finally {
      holder.release();
    }
  });

  test("a task never lands in a project closed meanwhile (FOR SHARE makes the close wait)", async () => {
    const project = await newProject();
    const closer = await testDb.$client.connect();
    try {
      await closer.query("begin");
      await closer.query(
        "update projects set status = 'canceled', updated_at = now() where id = $1",
        [project.id],
      );
      // The create reads the project FOR SHARE: it waits for the close, then sees it closed.
      const pending = createTask({ title: "x", projectId: project.id });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await closer.query("commit");
      expect(await pending).toMatchObject({
        ok: false,
        fieldErrors: { projectId: [TASK_ERRORS.projectUnavailable] },
      });
    } finally {
      closer.release();
    }
    expect(await testDb.$count(tasks)).toBe(0);
  });
});

/** Waits until `count` connections are blocked on this project's task lock. */
async function waitForLockWaiters(projectId: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_locks
       where locktype = 'advisory' and not granted and objsubid = 2
         and classid::bigint = $1::bigint
         and objid::bigint = (hashtext($2)::bigint & 4294967295)`,
      [TASKS_ADVISORY_SPACE, projectId],
    );
    if (result.rows[0].waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} lock waiters`);
}

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every action is refused and nothing changes", async (_, headers) => {
    const task = await capture({ title: "x" });
    const before = await row(task.id);
    request.headers = await headers();
    for (const call of [
      () => createTask({ title: "y" }),
      () => editTask({ id: task.id, title: "y" }),
      () => completeTask({ id: task.id }),
      () => reopenTask({ id: task.id }),
      () => deleteTask({ id: task.id }),
      () => restoreTask({ id: task.id }),
      () => listTaskTargets({}),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await row(task.id)).toEqual(before);
    expect(await testDb.$count(tasks)).toBe(1);
  });
});
