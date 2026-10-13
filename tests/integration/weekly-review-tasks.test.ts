// W1 of `weekly-review`, the tasks side, against the throwaway database: `getTasksWeekReview`
// (done within the week on Lima's days, the last five, the open ones with overdue before the week,
// recurring and project marks, the inbox, visibility, a fixed number of queries), the batch
// `moveTasksToDate` (the single postponement for each task: recurring tasks move only this
// occurrence; the guard on the day it was read with; a set of ids; the cap) and its exact undo
// (a task edited, completed, moved again or deleted meanwhile is not overwritten), two identical
// batches at once, and authorization.
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { projects } from "@/modules/projects/db/schema";
import {
  getTasksWeekReview,
  MAX_BATCH_MOVES,
  moveTasksToDate,
  selectTasksWeekReview,
  undoMoveTasks,
} from "@/modules/tasks/contracts";
import { tasks } from "@/modules/tasks/db/schema";
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

/** Monday 2026-10-19, 10:00 in Lima: reviewing the week 2026-10-12 – 2026-10-18 that just ended. */
const NOW = new Date("2026-10-19T15:00:00Z");
const WEEK = "2026-10-12";
const MONDAY_NEXT = "2026-10-19";

let areaId: string;

async function insertTask(values: Partial<typeof tasks.$inferInsert> & { title: string }) {
  const [row] = await testDb.insert(tasks).values(values).returning({ id: tasks.id });
  return row.id;
}

async function insertProject(name: string, values: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: areaId, status: "active", ...values })
    .returning({ id: projects.id });
  return row.id;
}

async function row(id: string) {
  const [found] = await testDb.select().from(tasks).where(eq(tasks.id, id));
  return found;
}

const dueOf = async (id: string) => (await row(id)).dueDate;
const moves = (list: { id: string; dueDate: string | null }[]) =>
  list.map(({ id, dueDate }) => ({ id, from: dueDate }));

/** `count` open tasks due on `dueDate`, each as the read gives it back. */
async function openTasks(count: number, dueDate: string | null, prefix = "Tarea") {
  const out: { id: string; dueDate: string | null }[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push({
      id: await insertTask({ title: `${prefix} ${index}`, dueDate, lifeAreaId: areaId }),
      dueDate,
    });
  }
  return out;
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
  const [area] = await testDb.select({ id: lifeAreas.id }).from(lifeAreas).limit(1);
  areaId = area.id;
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

describe("getTasksWeekReview: done", () => {
  test("counts what was completed on the week's Lima days, bounds included", async () => {
    // Lima is UTC-5: Monday 00:00 Lima = 05:00Z; Sunday 23:59 Lima = 04:59Z of the next Monday.
    const inside = [
      "2026-10-12T05:00:00Z",
      "2026-10-14T20:00:00Z",
      "2026-10-19T04:59:00Z", // Sunday 23:59 Lima
    ];
    const outside = [
      "2026-10-12T04:59:00Z", // Sunday 23:59 Lima, the week before
      "2026-10-19T05:00:00Z", // Monday 00:00 Lima, the week after
    ];
    for (const [index, at] of [...inside, ...outside].entries()) {
      await insertTask({ title: `Hecha ${index}`, doneAt: new Date(at) });
    }
    const review = await getTasksWeekReview(WEEK);
    expect(review.weekStart).toBe(WEEK);
    expect(review.doneCount).toBe(3);
  });

  test("a deleted task, or one of a deleted project, is not a task done", async () => {
    const at = new Date("2026-10-14T20:00:00Z");
    await insertTask({ title: "Visible", doneAt: at });
    await insertTask({ title: "Borrada", doneAt: at, deletedAt: new Date() });
    const hidden = await insertProject("Oculto", { deletedAt: new Date() });
    await insertTask({ title: "De proyecto oculto", doneAt: at, projectId: hidden });
    const live = await insertProject("Visible");
    await insertTask({ title: "De proyecto", doneAt: at, projectId: live });
    expect((await getTasksWeekReview(WEEK)).doneCount).toBe(2);
  });

  test("the last five, the most recent first", async () => {
    for (let index = 0; index < 8; index += 1) {
      await insertTask({
        title: `Hecha ${index}`,
        doneAt: new Date(Date.UTC(2026, 9, 12, 15 + index)),
      });
    }
    const review = await getTasksWeekReview(WEEK);
    expect(review.doneCount).toBe(8);
    expect(review.recentDone.map((task) => task.title)).toEqual([
      "Hecha 7",
      "Hecha 6",
      "Hecha 5",
      "Hecha 4",
      "Hecha 3",
    ]);
    expect(review.recentDone[0].doneAt).toEqual(new Date(Date.UTC(2026, 9, 12, 22)));
  });

  test("a week with nothing done reads zero", async () => {
    const review = await getTasksWeekReview(WEEK);
    expect(review).toMatchObject({ doneCount: 0, recentDone: [], open: [], openCount: 0 });
  });
});

describe("getTasksWeekReview: open", () => {
  test("pending, visible tasks due by the week's Sunday, overdue ones before the week included", async () => {
    const overdue = await insertTask({ title: "Vieja", dueDate: "2026-09-20" });
    const monday = await insertTask({ title: "Lunes", dueDate: "2026-10-12" });
    const sunday = await insertTask({ title: "Domingo", dueDate: "2026-10-18" });
    await insertTask({ title: "Siguiente semana", dueDate: "2026-10-19" });
    await insertTask({ title: "Sin fecha" });
    await insertTask({
      title: "Hecha",
      dueDate: "2026-10-13",
      doneAt: new Date("2026-10-13T20:00:00Z"),
    });
    await insertTask({ title: "Borrada", dueDate: "2026-10-13", deletedAt: new Date() });
    const hidden = await insertProject("Oculto", { deletedAt: new Date() });
    await insertTask({ title: "De proyecto oculto", dueDate: "2026-10-13", projectId: hidden });

    const review = await getTasksWeekReview(WEEK);
    expect(review.open.map((task) => task.id)).toEqual([overdue, monday, sunday]);
    expect(review.openCount).toBe(3);
    expect(review.open[0]).toEqual({
      id: overdue,
      title: "Vieja",
      dueDate: "2026-09-20",
      projectName: null,
      recurring: false,
    });
  });

  test("names the project and marks the recurring ones", async () => {
    const project = await insertProject("Lanzar v1");
    const inProject = await insertTask({
      title: "En proyecto",
      dueDate: "2026-10-13",
      projectId: project,
    });
    const recurring = await insertTask({
      title: "Regar",
      dueDate: "2026-10-14",
      recurrenceKind: "every_days",
      recurrenceInterval: 3,
    });
    const review = await getTasksWeekReview(WEEK);
    expect(review.open.find((task) => task.id === inProject)).toMatchObject({
      projectName: "Lanzar v1",
      recurring: false,
    });
    expect(review.open.find((task) => task.id === recurring)).toMatchObject({
      projectName: null,
      recurring: true,
    });
  });

  test("the same day orders by creation: the read is stable", async () => {
    const a = await insertTask({ title: "A", dueDate: "2026-10-13" });
    const b = await insertTask({ title: "B", dueDate: "2026-10-13" });
    const c = await insertTask({ title: "C", dueDate: "2026-10-12" });
    expect((await getTasksWeekReview(WEEK)).open.map((task) => task.id)).toEqual([c, a, b]);
  });

  test("lists at most 200 and still says how many there are", async () => {
    await testDb.insert(tasks).values(
      Array.from({ length: MAX_BATCH_MOVES + 5 }, (_, index) => ({
        title: `Abierta ${index}`,
        dueDate: "2026-10-13",
      })),
    );
    const review = await getTasksWeekReview(WEEK);
    expect(review.open).toHaveLength(MAX_BATCH_MOVES);
    expect(review.openCount).toBe(MAX_BATCH_MOVES + 5);
  });

  test("the inbox: pending tasks with neither area nor project, with or without a day", async () => {
    await insertTask({ title: "Bandeja" });
    await insertTask({ title: "Bandeja con día", dueDate: "2026-10-13" });
    await insertTask({ title: "Con área", lifeAreaId: areaId });
    await insertTask({ title: "Hecha", doneAt: new Date() });
    await insertTask({ title: "Borrada", deletedAt: new Date() });
    const project = await insertProject("P");
    await insertTask({ title: "Con proyecto", projectId: project });
    expect((await getTasksWeekReview(WEEK)).inboxCount).toBe(2);
  });

  test("any day of the week names the same Monday; a malformed day is a RangeError", async () => {
    await insertTask({ title: "Lunes", dueDate: "2026-10-12" });
    for (const day of ["2026-10-12", "2026-10-15", "2026-10-18"]) {
      const review = await getTasksWeekReview(day);
      expect(review.weekStart).toBe(WEEK);
      expect(review.openCount).toBe(1);
    }
    await expect(selectTasksWeekReview(testDb, "12/10/2026")).rejects.toThrow(RangeError);
  });

  test("a fixed number of queries whatever the number of tasks", async () => {
    await openTasks(1, "2026-10-13");
    const select = vi.spyOn(testDb, "select");
    await selectTasksWeekReview(testDb, WEEK);
    const forOne = select.mock.calls.length;
    await openTasks(8, "2026-10-14");
    select.mockClear();
    await selectTasksWeekReview(testDb, WEEK);
    expect(select.mock.calls.length).toBe(forOne);
    select.mockRestore();
  });
});

describe("moveTasksToDate", () => {
  test("moves each task to the day, saying the day it had; the rest of the task stays", async () => {
    const list = await openTasks(3, "2026-10-14");
    const withoutDay = await insertTask({ title: "Sin día", lifeAreaId: areaId });
    const result = await moveTasksToDate(
      [...moves(list), { id: withoutDay, from: null }],
      MONDAY_NEXT,
      NOW,
    );
    expect(result.to).toBe(MONDAY_NEXT);
    expect(result.skipped).toEqual([]);
    expect(result.moved.map((task) => task.id)).toEqual([...list.map((t) => t.id), withoutDay]);
    expect(result.moved[0]).toMatchObject({
      title: "Tarea 0",
      previousDueDate: "2026-10-14",
      movedTo: MONDAY_NEXT,
    });
    expect(result.moved[3]).toMatchObject({ previousDueDate: null, movedTo: MONDAY_NEXT });
    for (const task of list) {
      expect(await row(task.id)).toMatchObject({
        dueDate: MONDAY_NEXT,
        doneAt: null,
        deletedAt: null,
        lifeAreaId: areaId,
      });
    }
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  test("answers in the order asked, whatever the order the ids are taken in", async () => {
    const list = await openTasks(5, "2026-10-14");
    const asked = [...list].reverse();
    const result = await moveTasksToDate(moves(asked), MONDAY_NEXT, NOW);
    expect(result.moved.map((task) => task.id)).toEqual(asked.map((task) => task.id));
  });

  test("a recurring task moves only this occurrence: its rule stays and no copy appears", async () => {
    const id = await insertTask({
      title: "Regar",
      dueDate: "2026-10-14",
      recurrenceKind: "every_weeks",
      recurrenceInterval: 2,
    });
    const before = (await testDb.select({ id: tasks.id }).from(tasks)).length;
    const result = await moveTasksToDate([{ id, from: "2026-10-14" }], MONDAY_NEXT, NOW);
    expect(result.moved).toHaveLength(1);
    expect(await row(id)).toMatchObject({
      dueDate: MONDAY_NEXT,
      recurrenceKind: "every_weeks",
      recurrenceInterval: 2,
      doneAt: null,
    });
    expect((await testDb.select({ id: tasks.id }).from(tasks)).length).toBe(before);
  });

  test("a task that is done, deleted, missing or edited meanwhile is skipped, never overwritten", async () => {
    const [fine, edited] = await openTasks(2, "2026-10-14");
    const done = await insertTask({ title: "Hecha", dueDate: "2026-10-14", doneAt: new Date() });
    const deleted = await insertTask({
      title: "Borrada",
      dueDate: "2026-10-14",
      deletedAt: new Date(),
    });
    // The ritual read 14 for `edited`; meanwhile the owner changed it to the 16th.
    await testDb.update(tasks).set({ dueDate: "2026-10-16" }).where(eq(tasks.id, edited.id));
    const result = await moveTasksToDate(
      [
        ...moves([fine]),
        { id: edited.id, from: "2026-10-14" },
        { id: done, from: "2026-10-14" },
        { id: deleted, from: "2026-10-14" },
        { id: MISSING, from: "2026-10-14" },
      ],
      MONDAY_NEXT,
      NOW,
    );
    expect(result.moved.map((task) => task.id)).toEqual([fine.id]);
    expect(result.skipped).toEqual([
      { id: edited.id, reason: "changed" },
      { id: done, reason: "done" },
      { id: deleted, reason: "missing" },
      { id: MISSING, reason: "missing" },
    ]);
    expect(await dueOf(edited.id)).toBe("2026-10-16");
    expect(await dueOf(done)).toBe("2026-10-14");
    expect(await dueOf(fine.id)).toBe(MONDAY_NEXT);
  });

  test("a task already on the day is «already», not moved, and carries no undo", async () => {
    const [task] = await openTasks(1, MONDAY_NEXT);
    const result = await moveTasksToDate([{ id: task.id, from: "2026-10-14" }], MONDAY_NEXT, NOW);
    expect(result.moved).toEqual([]);
    expect(result.skipped).toEqual([{ id: task.id, reason: "already" }]);
  });

  test("the list is a set of at most 200 ids (empty does nothing), and the day is today or later", async () => {
    const [a] = await openTasks(1, "2026-10-14");
    const move = { id: a.id, from: a.dueDate };
    expect(await moveTasksToDate([], MONDAY_NEXT, NOW)).toEqual({
      to: MONDAY_NEXT,
      moved: [],
      skipped: [],
    });
    await expect(moveTasksToDate([move, move], MONDAY_NEXT, NOW)).rejects.toThrow(/repetidas/);
    const tooMany = Array.from({ length: MAX_BATCH_MOVES + 1 }, () => ({
      id: crypto.randomUUID(),
      from: null,
    }));
    await expect(moveTasksToDate(tooMany, MONDAY_NEXT, NOW)).rejects.toThrow(/demasiadas/);
    await expect(
      moveTasksToDate([{ id: "no-es-uuid", from: null }], MONDAY_NEXT, NOW),
    ).rejects.toThrow(RangeError);
    await expect(moveTasksToDate([move], "2026-10-18", NOW)).rejects.toThrow(/hoy o un día/);
    await expect(moveTasksToDate([move], "mañana", NOW)).rejects.toThrow(RangeError);
    await expect(moveTasksToDate([move], "2026-02-30", NOW)).rejects.toThrow(RangeError);
    // Nothing changed, and exactly 200 is fine.
    expect(await dueOf(a.id)).toBe("2026-10-14");
    const exactly = Array.from({ length: MAX_BATCH_MOVES }, () => ({
      id: crypto.randomUUID(),
      from: null,
    }));
    const result = await moveTasksToDate(exactly, MONDAY_NEXT, NOW);
    expect(result.skipped).toHaveLength(MAX_BATCH_MOVES);
    expect(result.moved).toEqual([]);
    // Today itself is allowed (Lima's today at NOW is the 19th).
    expect((await moveTasksToDate([move], "2026-10-19", NOW)).moved).toHaveLength(1);
  });
});

describe("undoMoveTasks", () => {
  const undoOf = (result: Awaited<ReturnType<typeof moveTasksToDate>>) =>
    result.moved.map(({ id, previousDueDate, movedTo }) => ({ id, previousDueDate, movedTo }));

  test("puts every task back on the day it had", async () => {
    const list = await openTasks(3, "2026-10-14");
    const noDay = await insertTask({ title: "Sin día", lifeAreaId: areaId });
    const moved = await moveTasksToDate(
      [...moves(list), { id: noDay, from: null }],
      MONDAY_NEXT,
      NOW,
    );
    const undone = await undoMoveTasks(undoOf(moved));
    expect(undone.restored.sort()).toEqual([...list.map((t) => t.id), noDay].sort());
    expect(undone.kept).toEqual([]);
    expect(undone.missing).toEqual([]);
    for (const task of list) expect(await dueOf(task.id)).toBe("2026-10-14");
    expect(await dueOf(noDay)).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  test("a task edited, completed, moved again or deleted meanwhile is not overwritten", async () => {
    const [plain, edited, completed, again, deleted] = await openTasks(5, "2026-10-14");
    const moved = await moveTasksToDate(
      moves([plain, edited, completed, again, deleted]),
      MONDAY_NEXT,
      NOW,
    );
    expect(moved.moved).toHaveLength(5);
    // Meanwhile: the owner gives `edited` another day and a new title, completes one, postpones
    // `again`, and deletes the last one.
    await testDb
      .update(tasks)
      .set({ dueDate: "2026-10-23", title: "Editada a mano" })
      .where(eq(tasks.id, edited.id));
    await testDb.update(tasks).set({ doneAt: new Date() }).where(eq(tasks.id, completed.id));
    await testDb.update(tasks).set({ dueDate: "2026-10-21" }).where(eq(tasks.id, again.id));
    await testDb.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, deleted.id));

    const undone = await undoMoveTasks(undoOf(moved));
    expect(undone.restored).toEqual([plain.id]);
    expect(undone.missing).toEqual([deleted.id]);
    expect(undone.kept.sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      [
        { id: edited.id, dueDate: "2026-10-23" },
        { id: completed.id, dueDate: MONDAY_NEXT },
        { id: again.id, dueDate: "2026-10-21" },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect(await row(edited.id)).toMatchObject({ dueDate: "2026-10-23", title: "Editada a mano" });
    expect(await dueOf(completed.id)).toBe(MONDAY_NEXT);
    expect(await dueOf(again.id)).toBe("2026-10-21");
    expect(await dueOf(plain.id)).toBe("2026-10-14");
  });

  test("undoing twice restores nothing the second time, and a newer edit survives", async () => {
    const [task] = await openTasks(1, "2026-10-14");
    const moved = await moveTasksToDate(moves([task]), MONDAY_NEXT, NOW);
    expect((await undoMoveTasks(undoOf(moved))).restored).toEqual([task.id]);
    // The owner moves it again by hand before the second (stale) undo arrives.
    await testDb.update(tasks).set({ dueDate: "2026-10-22" }).where(eq(tasks.id, task.id));
    const second = await undoMoveTasks(undoOf(moved));
    expect(second.restored).toEqual([]);
    expect(second.kept).toEqual([{ id: task.id, dueDate: "2026-10-22" }]);
    expect(await dueOf(task.id)).toBe("2026-10-22");
  });

  test("a recurring task goes back to its day with its rule untouched", async () => {
    const id = await insertTask({
      title: "Regar",
      dueDate: "2026-10-14",
      recurrenceKind: "weekdays",
      recurrenceWeekdays: [1, 3],
    });
    const moved = await moveTasksToDate([{ id, from: "2026-10-14" }], MONDAY_NEXT, NOW);
    await undoMoveTasks(undoOf(moved));
    expect(await row(id)).toMatchObject({
      dueDate: "2026-10-14",
      recurrenceKind: "weekdays",
      recurrenceWeekdays: [1, 3],
    });
  });

  test("the list is a set of at most 200 entries", async () => {
    const entry = { id: crypto.randomUUID(), previousDueDate: null, movedTo: MONDAY_NEXT };
    expect(await undoMoveTasks([])).toEqual({ restored: [], kept: [], missing: [] });
    await expect(undoMoveTasks([entry, entry])).rejects.toThrow(/repetidas/);
    await expect(
      undoMoveTasks(
        Array.from({ length: MAX_BATCH_MOVES + 1 }, () => ({ ...entry, id: crypto.randomUUID() })),
      ),
    ).rejects.toThrow(/demasiadas/);
    await expect(undoMoveTasks([{ ...entry, movedTo: "no" }])).rejects.toThrow(RangeError);
  });
});

describe("two batches at once", () => {
  test("two identical batches end consistent: every task moved once, the other batch finds it there", async () => {
    const list = await openTasks(12, "2026-10-14");
    // Positive control: a lone batch does move them (and a different one afterwards finds them
    // on another day than it read, so the guard leaves them).
    const control = await openTasks(3, "2026-10-14", "Control");
    const lone = await moveTasksToDate(moves(control), MONDAY_NEXT, NOW);
    expect(lone.moved).toHaveLength(3);

    const [one, two] = await Promise.all([
      moveTasksToDate(moves(list), MONDAY_NEXT, NOW),
      moveTasksToDate(moves(list), MONDAY_NEXT, NOW),
    ]);
    const movedByOne = new Set(one.moved.map((task) => task.id));
    const movedByTwo = new Set(two.moved.map((task) => task.id));
    // Each task was moved by exactly one of the two, and the other one reported it «already».
    expect(movedByOne.size + movedByTwo.size).toBe(list.length);
    for (const task of list) expect(movedByOne.has(task.id) !== movedByTwo.has(task.id)).toBe(true);
    for (const result of [one, two]) {
      expect(result.skipped.every((skip) => skip.reason === "already")).toBe(true);
      expect(result.moved.length + result.skipped.length).toBe(list.length);
    }
    for (const task of list) expect(await dueOf(task.id)).toBe(MONDAY_NEXT);
    // Each undo, with the data of the batch that did the moving, restores its own tasks.
    const undone = await Promise.all([
      undoMoveTasks(
        one.moved.map(({ id, previousDueDate, movedTo }) => ({ id, previousDueDate, movedTo })),
      ),
      undoMoveTasks(
        two.moved.map(({ id, previousDueDate, movedTo }) => ({ id, previousDueDate, movedTo })),
      ),
    ]);
    expect(undone[0].restored.length + undone[1].restored.length).toBe(list.length);
    for (const task of list) expect(await dueOf(task.id)).toBe("2026-10-14");
  });

  test("two batches to different days: each task ends on exactly one of the two days", async () => {
    const list = await openTasks(12, "2026-10-14");
    const [one, two] = await Promise.all([
      moveTasksToDate(moves(list), MONDAY_NEXT, NOW),
      moveTasksToDate(moves(list), "2026-10-26", NOW),
    ]);
    // The guard (the day the task was read with) lets only the first batch to reach a task move it.
    expect(one.moved.length + two.moved.length).toBe(list.length);
    const days = await testDb
      .select({ id: tasks.id, dueDate: tasks.dueDate })
      .from(tasks)
      .where(
        inArray(
          tasks.id,
          list.map((task) => task.id),
        ),
      );
    for (const { id, dueDate } of days) {
      const byOne = one.moved.some((task) => task.id === id);
      expect(dueDate).toBe(byOne ? MONDAY_NEXT : "2026-10-26");
    }
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
  ])("with %s every contract redirects to /login and nothing changes", async (_, headers) => {
    const [task] = await openTasks(1, "2026-10-14");
    // Positive control: the owner reads and moves.
    expect((await getTasksWeekReview(WEEK)).openCount).toBe(1);
    const moved = await moveTasksToDate(moves([task]), MONDAY_NEXT, NOW);
    expect(moved.moved).toHaveLength(1);

    request.headers = await headers();
    const toLogin = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getTasksWeekReview(WEEK)).rejects.toMatchObject(toLogin);
    await expect(
      moveTasksToDate([{ id: task.id, from: MONDAY_NEXT }], "2026-10-26", NOW),
    ).rejects.toMatchObject(toLogin);
    await expect(
      undoMoveTasks([{ id: task.id, previousDueDate: "2026-10-14", movedTo: MONDAY_NEXT }]),
    ).rejects.toMatchObject(toLogin);
    expect(await dueOf(task.id)).toBe(MONDAY_NEXT);
  });
});
