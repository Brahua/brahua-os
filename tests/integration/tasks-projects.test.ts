// T5 of `tasks` against the throwaway database: the "Tareas" section's query (grouping by
// milestone), the next action (one per project, under concurrency; cleared on complete, back
// with its undo; refused for a done task or a closed project), the progress source, the batch of
// next actions for the cards, revalidation and authorization.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ensureProgressSources } from "@/lib/progress-sources";
import { ensureProjectExtensions } from "@/lib/project-extensions";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { deleteProject, restoreProject } from "@/modules/projects/actions";
import { contributedProgress, projectNextActions } from "@/modules/projects/contracts";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import {
  completeTask,
  createTask,
  deleteTask,
  editTask,
  reopenTask,
} from "@/modules/tasks/actions";
import { tasks } from "@/modules/tasks/db/schema";
import { NEXT_ACTION_ERRORS } from "@/modules/tasks/next-action-input";
import { tasksNextActionSource } from "@/modules/tasks/next-action-source";
import { tasksProgressSource } from "@/modules/tasks/progress-source";
import { setNextAction, undoCompleteNextAction } from "@/modules/tasks/project-task-actions";
import {
  groupsByMilestone,
  milestoneGroupOf,
  sortByMilestone,
} from "@/modules/tasks/project-task-groups";
import {
  countProjectTasks,
  selectNextActions,
  selectProjectTasks,
} from "@/modules/tasks/project-tasks";
import { TASK_ERRORS } from "@/modules/tasks/task-input";
import { groupRuns } from "@/modules/tasks/task-views";
import { TASKS_ADVISORY_SPACE } from "@/modules/tasks/tasks";
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
// 10:00 in Lima on Friday, Oct 2, 2026.
const NOW = new Date("2026-10-02T15:00:00.000Z");

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

async function insert(values: Partial<typeof tasks.$inferInsert> & { title: string }) {
  const [task] = await testDb.insert(tasks).values(values).returning();
  return task;
}

async function row(id: string) {
  const [found] = await testDb.select().from(tasks).where(eq(tasks.id, id));
  return found;
}

/** The ids of a project's tasks marked as next action. */
async function marked(projectId: string): Promise<string[]> {
  const rows = await testDb
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.isNextAction, true)));
  return rows.map(({ id }) => id);
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

describe("the Tareas section", () => {
  test("pending by milestone (Sin hito last) and the done of the last 30 days, in one query", async () => {
    const project = await newProject();
    const other = await newProject({ name: "Otro" });
    const plans = await newMilestone(project.id, { title: "Planos", sortOrder: 0 });
    const paint = await newMilestone(project.id, { title: "Pintura", sortOrder: 1 });
    const gone = await newMilestone(project.id, {
      title: "Borrado",
      sortOrder: 2,
      deletedAt: new Date(),
    });
    await insert({ title: "lijar", projectId: project.id, milestoneId: paint.id });
    await insert({
      title: "medir",
      projectId: project.id,
      milestoneId: plans.id,
      priority: "high",
    });
    await insert({ title: "dibujar", projectId: project.id, milestoneId: plans.id });
    await insert({ title: "suelta", projectId: project.id, dueDate: "2026-10-05" });
    // A deleted milestone reads as "sin hito".
    await insert({ title: "de un hito borrado", projectId: project.id, milestoneId: gone.id });
    await insert({
      title: "hecha ayer",
      projectId: project.id,
      doneAt: new Date("2026-10-01T15:00:00Z"),
    });
    await insert({
      title: "hecha hace 31 días",
      projectId: project.id,
      doneAt: new Date("2026-09-01T15:00:00Z"),
    });
    await insert({ title: "eliminada", projectId: project.id, deletedAt: new Date() });
    await insert({ title: "de otro", projectId: other.id });

    const spy = vi.spyOn(testDb, "select");
    const { pending, done } = await selectProjectTasks(testDb, project.id, NOW);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    const milestones = [plans, paint].map(({ id, title }) => ({ id, title }));
    expect(groupsByMilestone(pending, milestones)).toBe(true);
    const groups = groupRuns(sortByMilestone(pending, milestones), milestoneGroupOf(milestones));
    expect(
      groups.map(({ group, tasks: items }) => [group.label, items.map((t) => t.title)]),
    ).toEqual([
      ["Planos", ["medir", "dibujar"]],
      ["Pintura", ["lijar"]],
      ["Sin hito", ["suelta", "de un hito borrado"]],
    ]);
    expect(done.map((task) => task.title)).toEqual(["hecha ayer"]);
  });
});

describe("next action", () => {
  test("marking takes the mark from the previous one; unmarking; revalidates the project screens", async () => {
    const project = await newProject();
    const first = await insert({ title: "uno", projectId: project.id });
    const second = await insert({ title: "dos", projectId: project.id });
    const result = await setNextAction({ id: first.id, next: true });
    expect(result).toMatchObject({ ok: true, data: { id: first.id, isNextAction: true } });
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(await marked(project.id)).toEqual([first.id]);
    expect((await setNextAction({ id: second.id, next: true })).ok).toBe(true);
    expect(await marked(project.id)).toEqual([second.id]);
    // Marking it twice changes nothing.
    expect((await setNextAction({ id: second.id, next: true })).ok).toBe(true);
    expect(await marked(project.id)).toEqual([second.id]);
    expect(await setNextAction({ id: second.id, next: false })).toMatchObject({
      ok: true,
      data: { isNextAction: false },
    });
    expect(await marked(project.id)).toEqual([]);
  });

  test("one per project: other projects keep theirs", async () => {
    const kitchen = await newProject();
    const garden = await newProject({ name: "Jardín" });
    const a = await insert({ title: "a", projectId: kitchen.id });
    const b = await insert({ title: "b", projectId: garden.id });
    await setNextAction({ id: a.id, next: true });
    await setNextAction({ id: b.id, next: true });
    expect(await marked(kitchen.id)).toEqual([a.id]);
    expect(await marked(garden.id)).toEqual([b.id]);
  });

  test("two marks at once in one project: both wait for the project's lock, one mark stays", async () => {
    const project = await newProject();
    const a = await insert({ title: "a", projectId: project.id });
    const b = await insert({ title: "b", projectId: project.id });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1::int, hashtext($2))", [
        TASKS_ADVISORY_SPACE,
        project.id,
      ]);
      const marks = [
        setNextAction({ id: a.id, next: true }),
        setNextAction({ id: b.id, next: true }),
      ];
      // Both are blocked on the lock (not on the unique index): they will run one after another.
      await waitForLockWaiters(project.id, 2);
      await holder.query("commit");
      const results = await Promise.all(marks);
      expect(results.map((result) => result.ok)).toEqual([true, true]);
    } finally {
      holder.release();
    }
    expect(await marked(project.id)).toHaveLength(1);
  });

  test("positive control: without the clear-then-mark under the lock, the unique index refuses a second mark", async () => {
    const project = await newProject();
    const a = await insert({ title: "a", projectId: project.id });
    const b = await insert({ title: "b", projectId: project.id });
    await testDb.update(tasks).set({ isNextAction: true }).where(eq(tasks.id, a.id));
    await expect(
      testDb.update(tasks).set({ isNextAction: true }).where(eq(tasks.id, b.id)),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  test("completing clears it (it doesn't move to another task); reopenTask doesn't bring it back, its undo does", async () => {
    const project = await newProject();
    const next = await insert({ title: "siguiente", projectId: project.id });
    const other = await insert({ title: "otra", projectId: project.id });
    await setNextAction({ id: next.id, next: true });
    expect((await completeTask({ id: next.id })).ok).toBe(true);
    expect(await marked(project.id)).toEqual([]);
    expect((await row(other.id)).isNextAction).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    // The plain undo of a list: pending again, without the mark.
    expect((await reopenTask({ id: next.id })).ok).toBe(true);
    expect(await marked(project.id)).toEqual([]);
    // The undo of the card: pending again and the next action again.
    await setNextAction({ id: next.id, next: true });
    await completeTask({ id: next.id });
    expect(await undoCompleteNextAction({ id: next.id })).toEqual({
      ok: true,
      data: expect.objectContaining({
        task: expect.objectContaining({ id: next.id, doneAt: null, isNextAction: true }),
        mark: "restored",
        restored: true,
        warning: null,
      }),
    });
    expect(await marked(project.id)).toEqual([next.id]);
    // A second undo changes nothing (it wasn't done any more).
    expect(await undoCompleteNextAction({ id: next.id })).toMatchObject({
      ok: true,
      data: { mark: "unchanged", restored: false, warning: null },
    });
    expect(await marked(project.id)).toEqual([next.id]);
  });

  test("T3: undoing a recurring next action removes its untouched next occurrence too", async () => {
    const project = await newProject();
    const water = await insert({
      title: "regar",
      projectId: project.id,
      recurrenceKind: "every_days",
      recurrenceInterval: 3,
    });
    await setNextAction({ id: water.id, next: true });
    expect((await completeTask({ id: water.id })).ok).toBe(true);
    const spawned = await testDb.select().from(tasks).where(eq(tasks.spawnedFromId, water.id));
    expect(spawned).toHaveLength(1);
    // The occurrence never carries the mark.
    expect(spawned[0].isNextAction).toBe(false);
    expect(await undoCompleteNextAction({ id: water.id })).toMatchObject({
      ok: true,
      data: { mark: "restored", spawn: "removed", restored: true },
    });
    expect((await row(spawned[0].id)).deletedAt).toBeInstanceOf(Date);
    expect(await marked(project.id)).toEqual([water.id]);
  });

  test("undo never steals the mark: complete A (next action), mark B, undo A → B keeps it", async () => {
    const project = await newProject();
    const a = await insert({ title: "A", projectId: project.id });
    const b = await insert({ title: "B", projectId: project.id });
    await setNextAction({ id: a.id, next: true });
    await completeTask({ id: a.id });
    await setNextAction({ id: b.id, next: true });
    expect(await undoCompleteNextAction({ id: a.id })).toMatchObject({
      ok: true,
      data: {
        task: { id: a.id, doneAt: null, isNextAction: false },
        mark: "taken",
        restored: false,
        warning: null,
      },
    });
    expect(await marked(project.id)).toEqual([b.id]);
    // Positive control: with nobody marked, the same undo gives the mark back.
    await setNextAction({ id: b.id, next: false });
    await completeTask({ id: a.id });
    expect((await undoCompleteNextAction({ id: a.id })).ok).toBe(true);
    expect(await marked(project.id)).toEqual([a.id]);
  });

  test("the undo is atomic: it waits for the project's lock like any mark", async () => {
    const project = await newProject();
    const a = await insert({ title: "A", projectId: project.id });
    await setNextAction({ id: a.id, next: true });
    await completeTask({ id: a.id });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1::int, hashtext($2))", [
        TASKS_ADVISORY_SPACE,
        project.id,
      ]);
      const pending = undoCompleteNextAction({ id: a.id });
      await waitForLockWaiters(project.id, 1);
      // Nothing reopened while it waits (one transaction, the lock first).
      expect((await row(a.id)).doneAt).toBeInstanceOf(Date);
      await holder.query("commit");
      expect((await pending).ok).toBe(true);
    } finally {
      holder.release();
    }
    expect(await marked(project.id)).toEqual([a.id]);
  });

  test("the undo still reopens when the project closed meanwhile (without the mark)", async () => {
    const project = await newProject();
    const next = await insert({ title: "siguiente", projectId: project.id });
    await setNextAction({ id: next.id, next: true });
    await completeTask({ id: next.id });
    await testDb.update(projects).set({ status: "canceled" }).where(eq(projects.id, project.id));
    expect(await undoCompleteNextAction({ id: next.id })).toMatchObject({
      ok: true,
      data: {
        task: { doneAt: null, isNextAction: false },
        mark: "projectClosed",
        restored: false,
        warning: expect.stringContaining(NEXT_ACTION_ERRORS.projectClosed),
      },
    });
  });

  test("refused for a done task, a closed project, a task without a project; missing or deleted", async () => {
    const project = await newProject();
    const done = await insert({ title: "hecha", projectId: project.id, doneAt: new Date() });
    expect(await setNextAction({ id: done.id, next: true })).toEqual({
      ok: false,
      error: NEXT_ACTION_ERRORS.done,
    });
    for (const status of ["done", "canceled"] as const) {
      const closed = await newProject({
        name: status,
        status,
        completedAt: status === "done" ? new Date() : null,
      });
      const task = await insert({ title: "x", projectId: closed.id });
      expect(await setNextAction({ id: task.id, next: true })).toEqual({
        ok: false,
        error: NEXT_ACTION_ERRORS.projectClosed,
      });
      expect(await marked(closed.id)).toEqual([]);
      // Unmarking always works.
      expect((await setNextAction({ id: task.id, next: false })).ok).toBe(true);
    }
    const loose = await insert({ title: "suelta" });
    expect(await setNextAction({ id: loose.id, next: true })).toEqual({
      ok: false,
      error: NEXT_ACTION_ERRORS.withoutProject,
    });
    expect(await setNextAction({ id: MISSING, next: true })).toEqual({
      ok: false,
      error: TASK_ERRORS.notFound,
    });
    // A deleted project's tasks are out of reach.
    const deleted = await newProject({ name: "Borrado" });
    const hidden = await insert({ title: "oculta", projectId: deleted.id });
    expect((await deleteProject({ id: deleted.id })).ok).toBe(true);
    expect(await setNextAction({ id: hidden.id, next: true })).toEqual({
      ok: false,
      error: TASK_ERRORS.notFound,
    });
    // Positive control: the same task can be marked once its project is restored.
    expect((await restoreProject({ id: deleted.id })).ok).toBe(true);
    expect((await setNextAction({ id: hidden.id, next: true })).ok).toBe(true);
  });

  test("a mark waits for a close in progress, then is refused (FOR SHARE on the project)", async () => {
    const project = await newProject();
    const task = await insert({ title: "x", projectId: project.id });
    const closer = await testDb.$client.connect();
    try {
      await closer.query("begin");
      await closer.query("update projects set status = 'canceled' where id = $1", [project.id]);
      const pending = setNextAction({ id: task.id, next: true });
      await waitForBlockedBackends(1);
      await closer.query("commit");
      expect(await pending).toEqual({ ok: false, error: NEXT_ACTION_ERRORS.projectClosed });
    } finally {
      closer.release();
    }
    expect(await marked(project.id)).toEqual([]);
  });

  test("moving or deleting the task clears its mark", async () => {
    const project = await newProject();
    const other = await newProject({ name: "Otro" });
    const moved = await insert({ title: "movida", projectId: project.id });
    await setNextAction({ id: moved.id, next: true });
    expect((await editTask({ id: moved.id, placement: { projectId: other.id } })).ok).toBe(true);
    expect((await row(moved.id)).isNextAction).toBe(false);
    const deleted = await insert({ title: "eliminada", projectId: project.id });
    await setNextAction({ id: deleted.id, next: true });
    expect((await deleteTask({ id: deleted.id })).ok).toBe(true);
    expect(await marked(project.id)).toEqual([]);
  });
});

describe("the cards' next actions", () => {
  test("one query for every project; pending, visible and of an open project only", async () => {
    const kitchen = await newProject();
    const garden = await newProject({ name: "Jardín" });
    const closed = await newProject({ name: "Cerrado" });
    const deleted = await newProject({ name: "Borrado" });
    const none = await newProject({ name: "Sin marca" });
    const a = await insert({ title: "medir", projectId: kitchen.id });
    const b = await insert({ title: "regar", projectId: garden.id });
    const c = await insert({ title: "c", projectId: closed.id });
    const d = await insert({ title: "d", projectId: deleted.id });
    await insert({ title: "nada", projectId: none.id });
    for (const id of [a.id, b.id, c.id, d.id]) await setNextAction({ id, next: true });
    // Closed and deleted after being marked: the mark stays in the row but no card shows it.
    await testDb.update(projects).set({ status: "canceled" }).where(eq(projects.id, closed.id));
    await testDb.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, deleted.id));

    const ids = [kitchen.id, garden.id, closed.id, deleted.id, none.id];
    const spy = vi.spyOn(testDb, "select");
    const result = await selectNextActions(testDb, ids);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(Object.fromEntries(result)).toEqual({
      [kitchen.id]: { id: a.id, title: "medir" },
      [garden.id]: { id: b.id, title: "regar" },
    });
    // Only the ids asked for.
    expect([...(await selectNextActions(testDb, [garden.id])).keys()]).toEqual([garden.id]);
    expect(await selectNextActions(testDb, [])).toEqual(new Map());
    // Reopening the closed project brings its card's next action back.
    await testDb.update(projects).set({ status: "active" }).where(eq(projects.id, closed.id));
    expect((await selectNextActions(testDb, [closed.id])).get(closed.id)?.id).toBe(c.id);
  });

  test("through the registered source (the list's path), with the source's calls", async () => {
    const project = await newProject();
    const task = await insert({ title: "medir", projectId: project.id });
    await setNextAction({ id: task.id, next: true });
    ensureProjectExtensions();
    const result = await projectNextActions([project.id]);
    expect(result.get(project.id)).toEqual({
      id: task.id,
      title: "medir",
      complete: tasksNextActionSource.complete,
      undoComplete: tasksNextActionSource.undoComplete,
    });
    // The card's check: done, and the mark is gone.
    expect((await tasksNextActionSource.complete({ id: task.id })).ok).toBe(true);
    expect((await projectNextActions([project.id])).has(project.id)).toBe(false);
    expect((await tasksNextActionSource.undoComplete({ id: task.id })).ok).toBe(true);
    expect((await projectNextActions([project.id])).get(project.id)?.id).toBe(task.id);
  });
});

describe("progress source", () => {
  test("every visible task counts (done = with done_at); deleted ones and a deleted project's don't", async () => {
    const kitchen = await newProject();
    const garden = await newProject({ name: "Jardín" });
    const empty = await newProject({ name: "Vacío" });
    await insert({ title: "hecha", projectId: kitchen.id, doneAt: new Date() });
    await insert({
      title: "hecha hace un año",
      projectId: kitchen.id,
      doneAt: new Date("2025-10-01"),
    });
    await insert({ title: "pendiente", projectId: kitchen.id });
    await insert({ title: "eliminada", projectId: kitchen.id, deletedAt: new Date() });
    await insert({
      title: "eliminada hecha",
      projectId: kitchen.id,
      doneAt: new Date(),
      deletedAt: new Date(),
    });
    await insert({ title: "del jardín", projectId: garden.id });
    await insert({ title: "suelta" });

    const spy = vi.spyOn(testDb, "select");
    const counts = await countProjectTasks(testDb, [kitchen.id, garden.id, empty.id]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(Object.fromEntries(counts)).toEqual({
      [kitchen.id]: { done: 2, total: 3 },
      [garden.id]: { done: 0, total: 1 },
    });
    expect(await countProjectTasks(testDb, [])).toEqual(new Map());

    // A deleted project's tasks don't count; restoring it brings them back.
    expect((await deleteProject({ id: garden.id })).ok).toBe(true);
    expect((await tasksProgressSource.countsFor([garden.id])).has(garden.id)).toBe(false);
    expect((await restoreProject({ id: garden.id })).ok).toBe(true);
    expect((await tasksProgressSource.countsFor([garden.id])).get(garden.id)).toEqual({
      done: 0,
      total: 1,
    });
  });

  test("registered by the composition root: contributedProgress adds the tasks", async () => {
    const project = await newProject();
    await insert({ title: "uno", projectId: project.id, doneAt: new Date() });
    await insert({ title: "dos", projectId: project.id });
    ensureProgressSources();
    expect((await contributedProgress([project.id])).get(project.id)).toEqual({
      done: 1,
      total: 2,
    });
  });

  test("a task created inline in a project (and a milestone) counts at once", async () => {
    const project = await newProject();
    const plans = await newMilestone(project.id);
    const created = await createTask({
      title: "medir",
      projectId: project.id,
      milestoneId: plans.id,
    });
    expect(created).toMatchObject({
      ok: true,
      data: { projectId: project.id, milestoneId: plans.id },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect((await countProjectTasks(testDb, [project.id])).get(project.id)).toEqual({
      done: 0,
      total: 1,
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
  ])("with %s the actions are refused and nothing changes", async (_, headers) => {
    const project = await newProject();
    const task = await insert({ title: "x", projectId: project.id, doneAt: new Date() });
    const before = await row(task.id);
    request.headers = await headers();
    for (const call of [
      () => setNextAction({ id: task.id, next: true }),
      () => undoCompleteNextAction({ id: task.id }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await row(task.id)).toEqual(before);
  });
});

/** Waits until `count` backends of this database are blocked on a lock (any kind). */
async function waitForBlockedBackends(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ blocked: number }>(
      `select count(*)::int as blocked from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (result.rows[0].blocked >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} blocked backends`);
}

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
