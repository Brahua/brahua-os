// T3 of `tasks` against the throwaway database: completing a recurring task creates the next
// occurrence in the same transaction (once, even under a double tap from two connections), its
// undo removes it only if untouched, the rule is set and removed through its action, and every
// action checks the owner and visibility.
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { deleteProject } from "@/modules/projects/actions";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import {
  completeTask,
  createTask,
  deleteTask,
  editTask,
  reopenTask,
} from "@/modules/tasks/actions";
import { tasks, taskTags } from "@/modules/tasks/db/schema";
import { getTask, listInboxTasks } from "@/modules/tasks/queries";
import { nextDueDate } from "@/modules/tasks/recurrence";
import {
  completeTaskWithNext,
  reopenTaskWithSpawn,
  setTaskRecurrence,
} from "@/modules/tasks/recurrence-actions";
import { RECURRENCE_ERRORS } from "@/modules/tasks/recurrence-copy";
import { TASK_ERRORS, type TaskItem, type TaskRecurrence } from "@/modules/tasks/task-input";
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
const EVERY_3_DAYS: TaskRecurrence = {
  kind: "every_days",
  interval: 3,
  weekdays: null,
  monthDay: null,
};

async function areaId(slug: string): Promise<string> {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, slug));
  return area.id;
}

async function row(id: string) {
  const [found] = await testDb.select().from(tasks).where(eq(tasks.id, id));
  return found;
}

/** Live (not deleted) occurrences spawned by `id`. */
async function spawnsOf(id: string) {
  return testDb
    .select()
    .from(tasks)
    .where(and(eq(tasks.spawnedFromId, id), isNull(tasks.deletedAt)));
}

async function capture(input: Record<string, unknown>): Promise<TaskItem> {
  const result = await createTask(input);
  if (!result.ok) throw new Error(`createTask failed: ${JSON.stringify(result)}`);
  return result.data;
}

const recurring = (input: Record<string, unknown> = {}) =>
  capture({
    title: "regar las plantas",
    recurrence: { kind: "every_days", interval: 3 },
    ...input,
  });

async function complete(id: string) {
  const result = await completeTaskWithNext({ id });
  if (!result.ok) throw new Error(`complete failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function reopen(id: string) {
  const result = await reopenTaskWithSpawn({ id });
  if (!result.ok) throw new Error(`reopen failed: ${JSON.stringify(result)}`);
  return result.data;
}

/** Waits until `count` connections wait on a lock (polled, never slept). */
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

describe("creating with a rule", () => {
  test("the capture stores the rule; without one, none", async () => {
    const task = await recurring();
    expect(task.recurrence).toEqual(EVERY_3_DAYS);
    expect(await row(task.id)).toMatchObject({
      recurrenceKind: "every_days",
      recurrenceInterval: 3,
      recurrenceWeekdays: null,
      recurrenceMonthDay: null,
    });
    expect((await capture({ title: "x", recurrence: null })).recurrence).toBeNull();
  });

  test("an invalid rule is refused on its field, and nothing is written", async () => {
    const result = await createTask({ title: "x", recurrence: { kind: "weekdays", weekdays: [] } });
    expect(result).toMatchObject({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { "recurrence.weekdays": [RECURRENCE_ERRORS.weekdays] },
    });
    expect(await testDb.$count(tasks)).toBe(0);
  });
});

describe("completing a recurring task", () => {
  test("creates the next one: same information, the rule's next date, spawned_from_id", async () => {
    const health = await areaId("health");
    const task = await recurring({ lifeAreaId: health, priority: "high", dueDate: "2026-01-01" });
    await testDb
      .update(tasks)
      .set({ notes: "con **agua** de lluvia" })
      .where(eq(tasks.id, task.id));
    const [tag] = await testDb.insert(taskTags).values({ name: "casa" }).returning();
    await testDb.execute(
      sql`insert into task_tag_links (task_id, tag_id) values (${task.id}, ${tag.id})`,
    );

    const { task: done, next } = await complete(task.id);
    const doneAt = (await row(task.id)).doneAt as Date;
    expect(done.doneAt).toEqual(doneAt);
    expect(next).toMatchObject({
      title: "regar las plantas",
      priority: "high",
      lifeAreaId: health,
      area: { id: health },
      dueDate: nextDueDate(EVERY_3_DAYS, doneAt),
      doneAt: null,
      recurrence: EVERY_3_DAYS,
      tags: [{ id: tag.id, name: "casa" }],
    });
    const spawned = await row(next!.id);
    expect(spawned).toMatchObject({ spawnedFromId: task.id, notes: "con **agua** de lluvia" });
    // Untouched: its updated_at is its created_at.
    expect(spawned.updatedAt).toEqual(spawned.createdAt);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  test("the plain completeTask (T1) spawns too; a second completion spawns nothing", async () => {
    const task = await recurring();
    expect(await completeTask({ id: task.id })).toMatchObject({ ok: true });
    expect(await spawnsOf(task.id)).toHaveLength(1);
    expect(await complete(task.id)).toMatchObject({ next: null });
    expect(await completeTask({ id: task.id })).toMatchObject({ ok: true });
    expect(await spawnsOf(task.id)).toHaveLength(1);
    expect(await testDb.$count(tasks)).toBe(2);
  });

  test("a double tap from two connections at once: one completion, one occurrence", async () => {
    const task = await recurring();
    // Holds the task's row so both completions are in flight together.
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from tasks where id = $1 for update", [task.id]);
      const both = Promise.all([
        completeTaskWithNext({ id: task.id }),
        completeTask({ id: task.id }),
      ]);
      await waitForBlockedBackends(2);
      await holder.query("commit");
      const results = await both;
      expect(results.every((result) => result.ok)).toBe(true);
    } finally {
      holder.release();
    }
    expect(await spawnsOf(task.id)).toHaveLength(1);
    expect(await testDb.$count(tasks)).toBe(2);
  });

  test("the occurrence of an occurrence chains (each one spawns its own)", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    const { next: third } = await complete(next!.id);
    expect((await row(third!.id)).spawnedFromId).toBe(next!.id);
    expect(await testDb.$count(tasks)).toBe(3);
  });

  test("in a project and a milestone: the occurrence stays there", async () => {
    const [project] = await testDb
      .insert(projects)
      .values({ name: "Jardín", lifeAreaId: await areaId("home"), status: "active" })
      .returning();
    const [milestone] = await testDb
      .insert(projectMilestones)
      .values({ projectId: project.id, title: "Riego", sortOrder: 0 })
      .returning();
    const task = await recurring({ projectId: project.id, milestoneId: milestone.id });
    await testDb.update(tasks).set({ isNextAction: true }).where(eq(tasks.id, task.id));
    const { next } = await complete(task.id);
    expect(next).toMatchObject({
      projectId: project.id,
      milestoneId: milestone.id,
      lifeAreaId: null,
      area: { id: project.lifeAreaId },
      project: { id: project.id },
      // The next-action mark is never passed on (SPEC-tasks).
      isNextAction: false,
    });
  });

  test("each rule computes its date from the completion", async () => {
    const rules: Record<string, unknown>[] = [
      { kind: "every_weeks", interval: 2 },
      { kind: "every_months", interval: 1 },
      { kind: "weekdays", weekdays: [1, 4] },
      { kind: "month_day", monthDay: 31 },
    ];
    for (const rule of rules) {
      const task = await capture({ title: `x ${rule.kind}`, recurrence: rule });
      const { next } = await complete(task.id);
      const doneAt = (await row(task.id)).doneAt as Date;
      expect(next?.dueDate).toBe(nextDueDate(task.recurrence!, doneAt));
    }
  });

  test("a task without a rule creates nothing", async () => {
    const task = await capture({ title: "x" });
    expect(await complete(task.id)).toMatchObject({ next: null });
    expect(await reopen(task.id)).toMatchObject({ spawn: null });
    expect(await testDb.$count(tasks)).toBe(1);
  });
});

describe("undo (Deshacer)", () => {
  test("removes the untouched occurrence (soft delete) and reopens the original", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    const result = await reopen(task.id);
    expect(result).toMatchObject({ spawn: "removed", task: { id: task.id, doneAt: null } });
    expect((await row(next!.id)).deletedAt).toBeInstanceOf(Date);
    expect((await listInboxTasks()).map((item) => item.id)).toEqual([task.id]);
    // A second undo changes nothing.
    expect(await reopen(task.id)).toMatchObject({ spawn: null });
    // Completing it again creates a fresh occurrence.
    const { next: again } = await complete(task.id);
    expect(again?.id).not.toBe(next!.id);
    expect(await spawnsOf(task.id)).toHaveLength(1);
  });

  test("the plain reopenTask (T1) removes it too", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    expect(await reopenTask({ id: task.id })).toMatchObject({ ok: true });
    expect((await row(next!.id)).deletedAt).toBeInstanceOf(Date);
  });

  test("keeps an occurrence that was edited, and reopens only the original", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    expect(await editTask({ id: next!.id, priority: "high" })).toMatchObject({ ok: true });
    expect(await reopen(task.id)).toMatchObject({ spawn: "kept", task: { doneAt: null } });
    expect(await row(next!.id)).toMatchObject({ deletedAt: null, priority: "high" });
    // Completing the original again doesn't pile up a second one (no accumulated copies).
    expect(await complete(task.id)).toMatchObject({ next: { id: next!.id } });
    expect(await spawnsOf(task.id)).toHaveLength(1);
  });

  test("a kept (edited) occurrence, then completing again: still exactly ONE pending occurrence", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    await editTask({ id: next!.id, title: "regar las plantas del patio" });
    // Several undo / complete cycles (each undo keeps it: it was edited).
    for (let cycle = 0; cycle < 3; cycle++) {
      expect(await reopen(task.id)).toMatchObject({ spawn: "kept" });
      expect(await complete(task.id)).toMatchObject({ next: { id: next!.id } });
    }
    const pending = await testDb
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.spawnedFromId, task.id), isNull(tasks.doneAt), isNull(tasks.deletedAt)));
    expect(pending.map((item) => item.id)).toEqual([next!.id]);
    // Never a deleted extra either: no other occurrence was ever created.
    expect(await testDb.$count(tasks, eq(tasks.spawnedFromId, task.id))).toBe(1);
    expect(await testDb.$count(tasks)).toBe(2);
  });

  test("keeps an occurrence whose rule changed, or that was completed", async () => {
    const a = await recurring();
    const { next: nextA } = await complete(a.id);
    await setTaskRecurrence({ id: nextA!.id, recurrence: null });
    expect(await reopen(a.id)).toMatchObject({ spawn: "kept" });

    const b = await recurring({ title: "b" });
    const { next: nextB } = await complete(b.id);
    await complete(nextB!.id);
    expect(await reopen(b.id)).toMatchObject({ spawn: "kept" });
    expect((await row(nextB!.id)).doneAt).toBeInstanceOf(Date);
  });

  test("an occurrence deleted meanwhile: nothing to remove", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    await deleteTask({ id: next!.id });
    expect(await reopen(task.id)).toMatchObject({ spawn: null, task: { doneAt: null } });
  });
});

describe("tasks_spawned_from_unique", () => {
  test("two live occurrences of one task are refused; a deleted one doesn't count", async () => {
    const task = await recurring();
    const insert = (deletedAt: Date | null) =>
      testDb.insert(tasks).values({ title: "copia", spawnedFromId: task.id, deletedAt });
    await insert(new Date());
    await insert(null);
    // Positive control above; the second live one breaks the unique index.
    await expect(insert(null)).rejects.toMatchObject({
      cause: { code: "23505", constraint: "tasks_spawned_from_unique" },
    });
  });
});

describe("setTaskRecurrence", () => {
  test("sets, changes (clearing the other rule's fields) and removes the rule", async () => {
    const task = await capture({ title: "x" });
    expect(
      await setTaskRecurrence({ id: task.id, recurrence: { kind: "weekdays", weekdays: [4, 1] } }),
    ).toMatchObject({
      ok: true,
      data: { recurrence: { kind: "weekdays", weekdays: [1, 4], interval: null, monthDay: null } },
    });
    await setTaskRecurrence({ id: task.id, recurrence: { kind: "month_day", monthDay: 15 } });
    expect(await row(task.id)).toMatchObject({
      recurrenceKind: "month_day",
      recurrenceMonthDay: 15,
      recurrenceWeekdays: null,
      recurrenceInterval: null,
    });
    expect(await setTaskRecurrence({ id: task.id, recurrence: null })).toMatchObject({
      ok: true,
      data: { recurrence: null },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${task.id}`);
  });

  test("an invalid rule is refused on its field; the rule stays", async () => {
    const task = await recurring();
    expect(
      await setTaskRecurrence({ id: task.id, recurrence: { kind: "every_days", interval: 0 } }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { "recurrence.interval": [RECURRENCE_ERRORS.interval] },
    });
    expect((await getTask(task.id))?.recurrence).toEqual(EVERY_3_DAYS);
    expect(await setTaskRecurrence({ id: "nope", recurrence: null })).toMatchObject({ ok: false });
  });

  test("a missing or deleted task is not found", async () => {
    expect(await setTaskRecurrence({ id: MISSING, recurrence: null })).toEqual({
      ok: false,
      error: TASK_ERRORS.notFound,
    });
    const task = await capture({ title: "x" });
    await deleteTask({ id: task.id });
    expect(
      await setTaskRecurrence({ id: task.id, recurrence: { kind: "every_days", interval: 1 } }),
    ).toEqual({ ok: false, error: TASK_ERRORS.notFound });
    expect((await row(task.id)).recurrenceKind).toBeNull();
  });
});

describe("visibility (visibleTask)", () => {
  test("a task of a deleted project can't be completed, reopened or edited; no occurrence", async () => {
    const [project] = await testDb
      .insert(projects)
      .values({ name: "Jardín", lifeAreaId: await areaId("home"), status: "active" })
      .returning();
    const task = await recurring({ projectId: project.id });
    const done = await recurring({ title: "hecha", projectId: project.id });
    await complete(done.id);
    expect((await deleteProject({ id: project.id })).ok).toBe(true);
    const notFound = { ok: false, error: TASK_ERRORS.notFound };
    expect(await completeTaskWithNext({ id: task.id })).toEqual(notFound);
    expect(await reopenTaskWithSpawn({ id: done.id })).toEqual(notFound);
    expect(await setTaskRecurrence({ id: task.id, recurrence: null })).toEqual(notFound);
    expect(await spawnsOf(task.id)).toHaveLength(0);
    expect((await row(done.id)).doneAt).toBeInstanceOf(Date);
    expect((await row(task.id)).recurrenceKind).toBe("every_days");
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
    const task = await recurring();
    const before = await row(task.id);
    request.headers = await headers();
    for (const call of [
      () => setTaskRecurrence({ id: task.id, recurrence: null }),
      () => completeTaskWithNext({ id: task.id }),
      () => reopenTaskWithSpawn({ id: task.id }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await row(task.id)).toEqual(before);
    expect(await testDb.$count(tasks)).toBe(1);
  });
});
