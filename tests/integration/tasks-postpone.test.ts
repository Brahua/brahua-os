// polish → postpone-one-tap against the throwaway database: `postponeTask` moves only the due
// date of a pending, visible task (a recurring one moves just this occurrence, no copy), is
// idempotent under a double tap (also from two connections), "Deshacer" (`restoreTaskDueDate`)
// puts back the exact day by task id and never overwrites a newer edit, and every action checks
// the owner, the visibility and the input.
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { lifeAreas } from "@/modules/core/db/schema";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import { deleteProject } from "@/modules/projects/actions";
import { projects } from "@/modules/projects/db/schema";
import { completeTask, createTask, deleteTask, editTask } from "@/modules/tasks/actions";
import { tasks } from "@/modules/tasks/db/schema";
import { postponeTask, restoreTaskDueDate } from "@/modules/tasks/postpone-actions";
import { completeTaskWithNext, reopenTaskWithSpawn } from "@/modules/tasks/recurrence-actions";
import { TASK_ERRORS, type TaskItem } from "@/modules/tasks/task-input";
import { POSTPONE_ERRORS } from "@/modules/tasks/task-postpone";
import { addDays } from "@/modules/tasks/task-views";
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

/** Lima's day `days` from today, YYYY-MM-DD (the server reads the same clock). */
const day = (days: number) => addDays(ownerDateKey(new Date()), days);

async function row(id: string) {
  const [found] = await testDb.select().from(tasks).where(eq(tasks.id, id));
  return found;
}

async function capture(input: Record<string, unknown>): Promise<TaskItem> {
  const result = await createTask({ title: "pagar la luz", ...input });
  if (!result.ok) throw new Error(`createTask failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function postpone(id: string, to: string) {
  const result = await postponeTask({ id, to });
  if (!result.ok) throw new Error(`postponeTask failed: ${JSON.stringify(result)}`);
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

describe("postponeTask", () => {
  test("'tomorrow' moves the due date and says what it had; the rest of the task stays", async () => {
    const [area] = await testDb.select({ id: lifeAreas.id }).from(lifeAreas).limit(1);
    const task = await capture({ dueDate: day(0), priority: "high", lifeAreaId: area.id });

    const moved = await postpone(task.id, "tomorrow");
    expect(moved).toEqual({
      id: task.id,
      title: "pagar la luz",
      dueDate: day(1),
      previousDueDate: day(0),
      changed: true,
    });
    expect(await row(task.id)).toMatchObject({
      dueDate: day(1),
      priority: "high",
      lifeAreaId: area.id,
      title: "pagar la luz",
      doneAt: null,
      deletedAt: null,
    });
    // The list, the task's page and the home page (today's "Tareas") read it again.
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${task.id}`);
  });

  test("a day (from today on) moves it there; an overdue task can come to today", async () => {
    const late = await capture({ dueDate: day(-3) });
    expect((await postpone(late.id, day(0))).dueDate).toBe(day(0));
    const next = await capture({ title: "otra" });
    expect(await postpone(next.id, day(9))).toMatchObject({
      dueDate: day(9),
      previousDueDate: null,
      changed: true,
    });
  });

  test("a day before today is refused and nothing changes", async () => {
    const task = await capture({ dueDate: day(0) });
    expect(await postponeTask({ id: task.id, to: day(-1) })).toMatchObject({
      ok: false,
      error: POSTPONE_ERRORS.pastDay,
      fieldErrors: { to: [POSTPONE_ERRORS.pastDay] },
    });
    expect((await row(task.id)).dueDate).toBe(day(0));
  });

  test("invalid input is refused before touching anything", async () => {
    const task = await capture({ dueDate: day(0) });
    for (const input of [
      { id: task.id, to: "mañana" },
      { id: task.id, to: "2026-02-31" },
      { id: task.id },
      { id: "nope", to: "tomorrow" },
      {},
      null,
    ]) {
      expect(await postponeTask(input), JSON.stringify(input)).toMatchObject({ ok: false });
    }
    expect((await row(task.id)).dueDate).toBe(day(0));
  });

  test("a double tap is idempotent: the second finds it already there and changes nothing", async () => {
    const task = await capture({ dueDate: day(0) });
    const first = await postpone(task.id, "tomorrow");
    const stamp = (await row(task.id)).updatedAt;
    const second = await postpone(task.id, "tomorrow");
    expect(first.changed).toBe(true);
    // Positive control: the first one did change it; the second reports no change and no write.
    expect(second).toMatchObject({ changed: false, dueDate: day(1), previousDueDate: day(1) });
    expect((await row(task.id)).updatedAt).toEqual(stamp);
    expect((await row(task.id)).dueDate).toBe(day(1));
  });

  test("two taps at once (two connections): one moves it, the other waits and changes nothing", async () => {
    const task = await capture({ dueDate: day(0) });
    const results = await Promise.all([
      postpone(task.id, "tomorrow"),
      postpone(task.id, "tomorrow"),
    ]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(results.filter((result) => !result.changed)).toHaveLength(1);
    expect((await row(task.id)).dueDate).toBe(day(1));
  });

  test("a recurring task moves only this occurrence: no copy, the rule stays, and completing it still makes one next", async () => {
    const task = await capture({
      dueDate: day(0),
      recurrence: { kind: "every_days", interval: 3 },
    });
    const before = await row(task.id);

    await postpone(task.id, "tomorrow");
    const after = await row(task.id);
    expect(await testDb.$count(tasks)).toBe(1);
    expect(after).toMatchObject({
      dueDate: day(1),
      recurrenceKind: before.recurrenceKind,
      recurrenceInterval: before.recurrenceInterval,
      spawnedFromId: null,
      doneAt: null,
    });

    // Completing the moved occurrence creates exactly one next one (the rule is intact).
    const completed = await completeTaskWithNext({ id: task.id });
    expect(completed).toMatchObject({ ok: true, data: { next: { recurrence: { interval: 3 } } } });
    expect(await testDb.$count(tasks)).toBe(2);
  });

  test("a spawned occurrence that was postponed counts as edited: undoing its completion keeps it", async () => {
    const task = await capture({
      dueDate: day(0),
      recurrence: { kind: "every_days", interval: 3 },
    });
    const completed = await completeTaskWithNext({ id: task.id });
    if (!completed.ok || !completed.data.next) throw new Error("no next occurrence");
    await postpone(completed.data.next.id, "tomorrow");

    expect(await reopenTaskWithSpawn({ id: task.id })).toMatchObject({
      ok: true,
      data: { spawn: "kept" },
    });
    expect(
      await testDb
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.spawnedFromId, task.id), isNull(tasks.deletedAt))),
    ).toHaveLength(1);
  });

  test("a done task is refused (nothing to move)", async () => {
    const task = await capture({ dueDate: day(0) });
    await completeTask({ id: task.id });
    expect(await postponeTask({ id: task.id, to: "tomorrow" })).toEqual({
      ok: false,
      error: POSTPONE_ERRORS.notPending,
    });
    expect((await row(task.id)).dueDate).toBe(day(0));
  });

  test("a deleted or missing task is not found", async () => {
    const task = await capture({ dueDate: day(0) });
    await deleteTask({ id: task.id });
    const notFound = { ok: false, error: TASK_ERRORS.notFound };
    expect(await postponeTask({ id: task.id, to: "tomorrow" })).toEqual(notFound);
    expect(await postponeTask({ id: MISSING, to: "tomorrow" })).toEqual(notFound);
    expect((await row(task.id)).dueDate).toBe(day(0));
  });

  test("a task of a deleted project is not found either (visibleTask)", async () => {
    const [area] = await testDb.select({ id: lifeAreas.id }).from(lifeAreas).limit(1);
    const [project] = await testDb
      .insert(projects)
      .values({ name: "Jardín", lifeAreaId: area.id, status: "active" })
      .returning();
    const task = await capture({ dueDate: day(0), projectId: project.id });
    // Positive control: while the project lives, it moves.
    expect((await postpone(task.id, "tomorrow")).changed).toBe(true);
    await restoreTaskDueDate({ id: task.id, dueDate: day(0), expected: day(1) });

    expect((await deleteProject({ id: project.id })).ok).toBe(true);
    const notFound = { ok: false, error: TASK_ERRORS.notFound };
    expect(await postponeTask({ id: task.id, to: "tomorrow" })).toEqual(notFound);
    expect(await restoreTaskDueDate({ id: task.id, dueDate: day(5), expected: day(0) })).toEqual(
      notFound,
    );
    expect((await row(task.id)).dueDate).toBe(day(0));
  });
});

describe("restoreTaskDueDate (Deshacer)", () => {
  test("puts back exactly the day it had, even an overdue one, by task id", async () => {
    const late = await capture({ dueDate: day(-4) });
    const other = await capture({ title: "otra", dueDate: day(0) });
    const moved = await postpone(late.id, "tomorrow");
    await postpone(other.id, "tomorrow");

    const undone = await restoreTaskDueDate({
      id: late.id,
      dueDate: moved.previousDueDate,
      expected: moved.dueDate,
    });
    expect(undone).toEqual({ ok: true, data: { id: late.id, dueDate: day(-4), restored: true } });
    expect((await row(late.id)).dueDate).toBe(day(-4));
    // Only that task: the other one stays where it went.
    expect((await row(other.id)).dueDate).toBe(day(1));
  });

  test("a task without a date goes back to none", async () => {
    const task = await capture({ title: "sin fecha" });
    const moved = await postpone(task.id, day(2));
    expect(moved.previousDueDate).toBeNull();
    expect(
      await restoreTaskDueDate({ id: task.id, dueDate: null, expected: moved.dueDate }),
    ).toMatchObject({ ok: true, data: { restored: true, dueDate: null } });
    expect((await row(task.id)).dueDate).toBeNull();
  });

  test("it never overwrites a newer edit: the day edited meanwhile stays", async () => {
    const task = await capture({ dueDate: day(0) });
    const moved = await postpone(task.id, "tomorrow");
    expect((await editTask({ id: task.id, dueDate: day(6) })).ok).toBe(true);

    expect(
      await restoreTaskDueDate({
        id: task.id,
        dueDate: moved.previousDueDate,
        expected: moved.dueDate,
      }),
    ).toEqual({ ok: true, data: { id: task.id, dueDate: day(6), restored: false } });
    expect((await row(task.id)).dueDate).toBe(day(6));
  });

  test("undoing twice is not an error: the second changes nothing", async () => {
    const task = await capture({ dueDate: day(0) });
    const moved = await postpone(task.id, "tomorrow");
    const input = { id: task.id, dueDate: moved.previousDueDate, expected: moved.dueDate };
    expect(await restoreTaskDueDate(input)).toMatchObject({ ok: true, data: { restored: true } });
    expect(await restoreTaskDueDate(input)).toEqual({
      ok: true,
      data: { id: task.id, dueDate: day(0), restored: false },
    });
  });

  test("invalid input is refused", async () => {
    const task = await capture({ dueDate: day(0) });
    for (const input of [
      { id: task.id, dueDate: "ayer", expected: day(1) },
      { id: task.id, dueDate: day(0) },
      { id: "nope", dueDate: day(0), expected: day(1) },
    ]) {
      expect(await restoreTaskDueDate(input), JSON.stringify(input)).toMatchObject({ ok: false });
    }
    expect((await row(task.id)).dueDate).toBe(day(0));
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
  ])("with %s both actions are refused and nothing changes", async (_, headers) => {
    const task = await capture({ dueDate: day(0) });
    const before = await row(task.id);
    request.headers = await headers();
    for (const call of [
      () => postponeTask({ id: task.id, to: "tomorrow" }),
      () => restoreTaskDueDate({ id: task.id, dueDate: day(5), expected: day(0) }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await row(task.id)).toEqual(before);
  });
});
