// polish → task-time against the throwaway database: `tasks_due_time_check` with raw inserts, the
// time on create and edit (a time needs a day; taking the day away clears it), the next occurrence
// of a recurring task keeps it, "Mañana"/"Otro día…" and their "Deshacer" never lose it, the
// summary for `today` orders by time (one query), the export carries the column, and authorization.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport, type DataExport } from "@/lib/data-export";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import { createTask, editTask } from "@/modules/tasks/actions";
import { getTasksTodaySummary, selectTasksTodaySummary } from "@/modules/tasks/contracts";
import { tasks } from "@/modules/tasks/db/schema";
import { postponeTask, restoreTaskDueDate } from "@/modules/tasks/postpone-actions";
import { completeTaskWithNext, reopenTaskWithSpawn } from "@/modules/tasks/recurrence-actions";
import { TASK_ERRORS, type TaskItem } from "@/modules/tasks/task-input";
import { addDays } from "@/modules/tasks/task-views";
import { selectTodayTasks, selectUpcomingTasks } from "@/modules/tasks/view-data";
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

/** Lima's day `days` from today, YYYY-MM-DD (the server reads the same clock). */
const day = (days: number) => addDays(ownerDateKey(new Date()), days);

async function row(id: string) {
  const [found] = await testDb.select().from(tasks).where(eq(tasks.id, id));
  return found;
}

async function capture(input: Record<string, unknown>): Promise<TaskItem> {
  const result = await createTask({ title: "dentista", ...input });
  if (!result.ok) throw new Error(`createTask failed: ${JSON.stringify(result)}`);
  return result.data;
}

/** The constraint a raw insert breaks (Postgres error code and constraint name). */
async function violation(values: Partial<typeof tasks.$inferInsert>) {
  try {
    await testDb.insert(tasks).values({ title: "x", ...values });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
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

describe("tasks_due_time_check", () => {
  const check = { code: "23514", constraint: "tasks_due_time_check" };

  test("a time with a day passes; none passes; a time without a day is refused", async () => {
    expect(await violation({ dueDate: "2026-10-05", dueTime: "10:00" })).toBeNull();
    expect(await violation({ dueDate: "2026-10-05", dueTime: "00:00" })).toBeNull();
    expect(await violation({ dueDate: "2026-10-05", dueTime: "23:59" })).toBeNull();
    expect(await violation({ dueDate: "2026-10-05" })).toBeNull();
    expect(await violation({})).toBeNull();
    expect(await violation({ dueTime: "10:00" })).toEqual(check);
  });

  test("minute precision only, and never 24:00", async () => {
    expect(await violation({ dueDate: "2026-10-05", dueTime: "10:00:30" })).toEqual(check);
    expect(await violation({ dueDate: "2026-10-05", dueTime: "24:00" })).toEqual(check);
  });

  test("a malformed time never reaches the check (Postgres refuses it as a time)", async () => {
    expect(await violation({ dueDate: "2026-10-05", dueTime: "25:00" })).toMatchObject({
      code: "22008",
    });
    expect(await violation({ dueDate: "2026-10-05", dueTime: "mañana" })).toMatchObject({
      code: "22007",
    });
  });

  test("existing rows without a time are untouched by the new column", async () => {
    await testDb.insert(tasks).values({ title: "vieja", dueDate: "2026-10-05" });
    const [old] = await testDb.select().from(tasks);
    expect(old.dueTime).toBeNull();
  });
});

describe("createTask and editTask", () => {
  test("creates with a time (returned as HH:MM); a time without a date is refused", async () => {
    const task = await capture({ dueDate: day(1), dueTime: "10:30" });
    expect(task.dueTime).toBe("10:30");
    expect((await row(task.id)).dueTime).toBe("10:30:00");

    expect(await capture({ dueDate: day(1) })).toMatchObject({ dueTime: null });

    const refused = await createTask({ title: "x", dueTime: "10:30" });
    expect(refused).toMatchObject({
      ok: false,
      fieldErrors: { dueTime: [TASK_ERRORS.timeWithoutDate] },
    });
    const malformed = await createTask({ title: "x", dueDate: day(1), dueTime: "25:00" });
    expect(malformed).toMatchObject({
      ok: false,
      fieldErrors: { dueTime: [TASK_ERRORS.timeInvalid] },
    });
  });

  test("edits and clears the time; a title edit leaves it; the stored day counts", async () => {
    const task = await capture({ dueDate: day(1) });
    const set = await editTask({ id: task.id, dueTime: "09:15" });
    expect(set).toMatchObject({ ok: true, data: { dueTime: "09:15", dueDate: day(1) } });

    const renamed = await editTask({ id: task.id, title: "dentista 2" });
    expect(renamed).toMatchObject({ ok: true, data: { dueTime: "09:15" } });

    const moved = await editTask({ id: task.id, dueDate: day(3) });
    expect(moved).toMatchObject({ ok: true, data: { dueTime: "09:15", dueDate: day(3) } });

    const cleared = await editTask({ id: task.id, dueTime: null });
    expect(cleared).toMatchObject({ ok: true, data: { dueTime: null, dueDate: day(3) } });
    expect((await row(task.id)).dueTime).toBeNull();
  });

  test("taking the day away clears the time", async () => {
    const task = await capture({ dueDate: day(1), dueTime: "18:00" });
    const result = await editTask({ id: task.id, dueDate: null });
    expect(result).toMatchObject({ ok: true, data: { dueDate: null, dueTime: null } });
    expect(await row(task.id)).toMatchObject({ dueDate: null, dueTime: null });
  });

  test("a time for a task without a day is refused and writes nothing", async () => {
    const task = await capture({});
    const inputOnly = await editTask({ id: task.id, dueTime: "10:00" });
    expect(inputOnly).toMatchObject({
      ok: false,
      fieldErrors: { dueTime: [TASK_ERRORS.timeWithoutDate] },
    });
    const withNullDay = await editTask({ id: task.id, dueDate: null, dueTime: "10:00" });
    expect(withNullDay).toMatchObject({ ok: false });
    expect(await row(task.id)).toMatchObject({ dueDate: null, dueTime: null });
  });

  test("a day and a time together", async () => {
    const task = await capture({});
    const result = await editTask({ id: task.id, dueDate: day(2), dueTime: "07:45" });
    expect(result).toMatchObject({ ok: true, data: { dueDate: day(2), dueTime: "07:45" } });
  });
});

describe("recurrence", () => {
  test("the next occurrence keeps the time, and undoing the completion removes it", async () => {
    const task = await capture({
      dueDate: day(0),
      dueTime: "08:30",
      recurrence: { kind: "every_days", interval: 3 },
    });
    const done = await completeTaskWithNext({ id: task.id });
    if (!done.ok) throw new Error(JSON.stringify(done));
    const next = done.data.next;
    expect(next).not.toBeNull();
    expect(next?.dueTime).toBe("08:30");
    expect(next?.dueDate).not.toBe(day(0));
    expect((await row(next!.id)).dueTime).toBe("08:30:00");

    const reopened = await reopenTaskWithSpawn({ id: task.id });
    expect(reopened.ok).toBe(true);
    expect(await row(task.id)).toMatchObject({ dueTime: "08:30:00", doneAt: null });
  });

  test("a recurring task without a time spawns one without a time (positive control)", async () => {
    const task = await capture({
      dueDate: day(0),
      recurrence: { kind: "every_days", interval: 1 },
    });
    const done = await completeTaskWithNext({ id: task.id });
    if (!done.ok) throw new Error(JSON.stringify(done));
    expect(done.data.next?.dueTime).toBeNull();
  });
});

describe("postponeTask and its Deshacer", () => {
  test("moving the day keeps the time; the undo puts the day back and keeps the time", async () => {
    const task = await capture({ dueDate: day(0), dueTime: "16:00" });
    const moved = await postponeTask({ id: task.id, to: "tomorrow" });
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    expect(moved.data.dueDate).toBe(day(1));
    expect(await row(task.id)).toMatchObject({ dueDate: day(1), dueTime: "16:00:00" });

    const undone = await restoreTaskDueDate({
      id: task.id,
      dueDate: moved.data.previousDueDate,
      expected: moved.data.dueDate,
    });
    expect(undone).toMatchObject({ ok: true, data: { restored: true, dueDate: day(0) } });
    expect(await row(task.id)).toMatchObject({ dueDate: day(0), dueTime: "16:00:00" });
  });

  test("a task with a time and an exact day moved to another day keeps the time ('Otro día…')", async () => {
    const task = await capture({ dueDate: day(1), dueTime: "11:11" });
    const moved = await postponeTask({ id: task.id, to: day(5) });
    expect(moved.ok).toBe(true);
    expect(await row(task.id)).toMatchObject({ dueDate: day(5), dueTime: "11:11:00" });
  });

  test("undoing back to no day (the task had none) never breaks the check", async () => {
    const task = await capture({});
    const moved = await postponeTask({ id: task.id, to: "tomorrow" });
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    // Meanwhile it got a time on the day the postponement set.
    expect((await editTask({ id: task.id, dueTime: "12:00" })).ok).toBe(true);
    const undone = await restoreTaskDueDate({
      id: task.id,
      dueDate: null,
      expected: moved.data.dueDate,
    });
    expect(undone).toMatchObject({ ok: true, data: { restored: true, dueDate: null } });
    expect(await row(task.id)).toMatchObject({ dueDate: null, dueTime: null });
  });
});

describe("order", () => {
  const NOW = new Date("2026-10-02T15:00:00Z"); // Friday 10:00 in Lima

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

  test("the summary: overdue days first; within a day, the ones with a time by time, then the rest", async () => {
    await insert({ title: "hoy sin hora", dueDate: "2026-10-02", priority: "high" });
    await insert({ title: "hoy 15:00", dueDate: "2026-10-02", dueTime: "15:00" });
    await insert({ title: "hoy 09:00", dueDate: "2026-10-02", dueTime: "09:00", priority: "low" });
    await insert({ title: "ayer sin hora", dueDate: "2026-10-01" });
    await insert({ title: "ayer 23:00", dueDate: "2026-10-01", dueTime: "23:00" });
    await insert({ title: "anteayer sin hora", dueDate: "2026-09-30" });

    const items = await selectTasksTodaySummary(testDb, NOW);
    expect(titles(items)).toEqual([
      "anteayer sin hora",
      "ayer 23:00",
      "ayer sin hora",
      "hoy 09:00",
      "hoy 15:00",
      "hoy sin hora",
    ]);
    expect(items.find((item) => item.title === "hoy 09:00")?.dueTime).toBe("09:00");
    expect(items.find((item) => item.title === "hoy sin hora")?.dueTime).toBeNull();
  });

  test("still one query, with times in the rows", async () => {
    for (let index = 0; index < 5; index += 1) {
      await insert({ title: `t${index}`, dueDate: "2026-10-02", dueTime: `1${index}:00` });
    }
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const items = await selectTasksTodaySummary(testDb, NOW);
    expect(items).toHaveLength(5);
    expect(select).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    select.mockRestore();
    execute.mockRestore();
  });

  test("the views 'Hoy' and 'Próximas' order the same way", async () => {
    await insert({ title: "hoy sin hora", dueDate: "2026-10-02" });
    await insert({ title: "hoy 08:00", dueDate: "2026-10-02", dueTime: "08:00" });
    await insert({ title: "mañana sin hora", dueDate: "2026-10-03" });
    await insert({ title: "mañana 07:30", dueDate: "2026-10-03", dueTime: "07:30" });
    await insert({ title: "mañana 13:00", dueDate: "2026-10-03", dueTime: "13:00" });

    expect(titles(await selectTodayTasks(testDb, NOW))).toEqual(["hoy 08:00", "hoy sin hora"]);
    expect(titles(await selectUpcomingTasks(testDb, NOW))).toEqual([
      "mañana 07:30",
      "mañana 13:00",
      "mañana sin hora",
    ]);
  });
});

describe("export", () => {
  test("carries the due_time column", async () => {
    await testDb.insert(tasks).values([
      {
        title: "con hora",
        dueDate: "2026-10-05",
        dueTime: "10:00",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
      { title: "sin hora", dueDate: "2026-10-05", createdAt: new Date("2026-09-02T00:00:00Z") },
    ]);
    const data = JSON.parse(JSON.stringify(await buildExport(testDb, new Date()))) as DataExport;
    expect(data.tables.tasks.rows.map((item) => [item.title, item.due_time])).toEqual([
      ["con hora", "10:00:00"],
      ["sin hora", null],
    ]);
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
  ])("with %s the time can't be written or read", async (_, headers) => {
    const task = await capture({ dueDate: day(1), dueTime: "10:00" });
    // Positive control: the owner reads it.
    expect(await getTasksTodaySummary(new Date())).toEqual([]);
    request.headers = await headers();
    expect(await createTask({ title: "x", dueDate: day(1), dueTime: "10:00" })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect(await editTask({ id: task.id, dueTime: "11:00" })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect((await row(task.id)).dueTime).toBe("10:00:00");
    await expect(getTasksTodaySummary(new Date())).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
