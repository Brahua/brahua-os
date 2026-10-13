// W2 of `weekly-review`: the ritual's Server Actions against the throwaway database. They wrap the
// contracts of `tasks` (`moveTasksToDate`, `undoMoveTasks`): authorization first, input validated
// as sets with the contracts' schemas, a move with real rows and its exact undo, a refused past
// day, and /review revalidated.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { WEEK_REVIEW_ERRORS } from "@/modules/tasks/contracts";
import { tasks } from "@/modules/tasks/db/schema";
import { moveReviewTasks, undoReviewMove } from "@/modules/weekly-review/actions";
import { addDays } from "@/modules/weekly-review/week";
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

/** The actions use the real clock: the target days are relative to Lima's today. */
const TODAY = ownerDateKey(new Date());
const IN_A_WEEK = addDays(TODAY, 7);
const LAST_WEEK = addDays(TODAY, -7);

let areaId: string;

async function insertTask(title: string, dueDate: string | null) {
  const [row] = await testDb
    .insert(tasks)
    .values({ title, dueDate, lifeAreaId: areaId })
    .returning({ id: tasks.id });
  return row.id;
}

const dueOf = async (id: string) =>
  (await testDb.select().from(tasks).where(eq(tasks.id, id)))[0].dueDate;

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

describe("moveReviewTasks and undoReviewMove", () => {
  test("moves the tasks, answers what moved with what the undo needs, and the undo puts them back", async () => {
    const one = await insertTask("Una", LAST_WEEK);
    const two = await insertTask("Dos", LAST_WEEK);
    const moved = await moveReviewTasks({
      moves: [
        { id: one, from: LAST_WEEK },
        { id: two, from: LAST_WEEK },
      ],
      to: IN_A_WEEK,
    });
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    expect(moved.data.moved.map((task) => [task.id, task.previousDueDate, task.movedTo])).toEqual([
      [one, LAST_WEEK, IN_A_WEEK],
      [two, LAST_WEEK, IN_A_WEEK],
    ]);
    expect(moved.data.skipped).toEqual([]);
    expect(await dueOf(one)).toBe(IN_A_WEEK);
    expect(await dueOf(two)).toBe(IN_A_WEEK);
    expect(revalidatePath).toHaveBeenCalledWith("/review");

    const undone = await undoReviewMove({
      undo: moved.data.moved.map(({ id, previousDueDate, movedTo }) => ({
        id,
        previousDueDate,
        movedTo,
      })),
    });
    if (!undone.ok) throw new Error(JSON.stringify(undone));
    expect([...undone.data.restored].sort()).toEqual([one, two].sort());
    expect(await dueOf(one)).toBe(LAST_WEEK);
    expect(await dueOf(two)).toBe(LAST_WEEK);
  });

  test("a task edited meanwhile is skipped, and its undo never overwrites a later edit", async () => {
    const edited = await insertTask("Editada", LAST_WEEK);
    const plain = await insertTask("Normal", LAST_WEEK);
    // The owner moved it by hand after the page was read.
    await testDb
      .update(tasks)
      .set({ dueDate: addDays(TODAY, 3) })
      .where(eq(tasks.id, edited));
    const moved = await moveReviewTasks({
      moves: [
        { id: edited, from: LAST_WEEK },
        { id: plain, from: LAST_WEEK },
      ],
      to: IN_A_WEEK,
    });
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    expect(moved.data.moved.map((task) => task.id)).toEqual([plain]);
    expect(moved.data.skipped).toEqual([{ id: edited, reason: "changed" }]);
    expect(await dueOf(edited)).toBe(addDays(TODAY, 3));

    // Edited after the move: «Deshacer» leaves it as it is and says so.
    await testDb
      .update(tasks)
      .set({ dueDate: addDays(TODAY, 10) })
      .where(eq(tasks.id, plain));
    const undone = await undoReviewMove({
      undo: [{ id: plain, previousDueDate: LAST_WEEK, movedTo: IN_A_WEEK }],
    });
    if (!undone.ok) throw new Error(JSON.stringify(undone));
    expect(undone.data.restored).toEqual([]);
    expect(undone.data.kept).toEqual([{ id: plain, dueDate: addDays(TODAY, 10) }]);
    expect(await dueOf(plain)).toBe(addDays(TODAY, 10));
  });

  test("a day before today is refused with its message, nothing moves", async () => {
    const id = await insertTask("Sola", LAST_WEEK);
    const result = await moveReviewTasks({ moves: [{ id, from: LAST_WEEK }], to: LAST_WEEK });
    expect(result).toEqual({ ok: false, error: WEEK_REVIEW_ERRORS.past });
    expect(await dueOf(id)).toBe(LAST_WEEK);
  });

  test("invalid input is rejected with field errors and writes nothing", async () => {
    const id = await insertTask("Sola", LAST_WEEK);
    const invalid: unknown[] = [
      null,
      {},
      { moves: "no", to: IN_A_WEEK },
      { moves: [{ id: "not-a-uuid", from: LAST_WEEK }], to: IN_A_WEEK },
      { moves: [{ id, from: "2026-02-30" }], to: IN_A_WEEK },
      { moves: [{ id, from: LAST_WEEK }], to: "mañana" },
      // The same id twice: a set, not a list.
      {
        moves: [
          { id, from: LAST_WEEK },
          { id, from: LAST_WEEK },
        ],
        to: IN_A_WEEK,
      },
    ];
    for (const input of invalid) {
      const result = await moveReviewTasks(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(INVALID_FIELDS_MESSAGE);
    }
    expect(await dueOf(id)).toBe(LAST_WEEK);

    const badUndo: unknown[] = [
      undefined,
      { undo: [{ id, previousDueDate: LAST_WEEK }] },
      {
        undo: [
          { id, previousDueDate: LAST_WEEK, movedTo: IN_A_WEEK },
          { id, previousDueDate: null, movedTo: IN_A_WEEK },
        ],
      },
    ];
    for (const input of badUndo) {
      const result = await undoReviewMove(input);
      expect(result.ok).toBe(false);
    }
  });

  test("a task that does not exist is skipped as missing and an empty list is a no-op", async () => {
    const result = await moveReviewTasks({
      moves: [{ id: MISSING, from: LAST_WEEK }],
      to: IN_A_WEEK,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.data.moved).toEqual([]);
    expect(result.data.skipped).toEqual([{ id: MISSING, reason: "missing" }]);
    const empty = await moveReviewTasks({ moves: [], to: IN_A_WEEK });
    expect(empty.ok && empty.data.moved).toEqual([]);
  });

  test("two identical batches at once move each task exactly once (positive control: two tasks, two moves)", async () => {
    const [a, b] = [await insertTask("A", LAST_WEEK), await insertTask("B", LAST_WEEK)];
    const batch = {
      moves: [
        { id: a, from: LAST_WEEK },
        { id: b, from: LAST_WEEK },
      ],
      to: IN_A_WEEK,
    };
    const [first, second] = await Promise.all([moveReviewTasks(batch), moveReviewTasks(batch)]);
    if (!first.ok || !second.ok) throw new Error("both batches must answer");
    const movedIds = [...first.data.moved, ...second.data.moved].map((task) => task.id).sort();
    expect(movedIds).toEqual([a, b].sort());
    expect(await dueOf(a)).toBe(IN_A_WEEK);
    expect(await dueOf(b)).toBe(IN_A_WEEK);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("%s: both actions refuse before touching anything", async (_name, headers) => {
    const id = await insertTask("Intocable", LAST_WEEK);
    request.headers = await headers();
    const moved = await moveReviewTasks({ moves: [{ id, from: LAST_WEEK }], to: IN_A_WEEK });
    expect(moved).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    const undone = await undoReviewMove({
      undo: [{ id, previousDueDate: null, movedTo: IN_A_WEEK }],
    });
    expect(undone).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    expect(await dueOf(id)).toBe(LAST_WEEK);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
