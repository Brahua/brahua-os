// W3 of `weekly-review`, «Semanas anteriores» against the throwaway database: the batch
// `getHabitsWeeksOverview` of `habits` gives, for many weeks at once, EXACTLY what the single-week
// contracts give (`getHabitsWeekCompleteDays`, `getHabitsWeekSummary`) in a fixed number of queries,
// and `getPreviousWeeks` lists the closed weeks (12 at most, the latest first) with those numbers
// and their notes. Habit fixtures start BEFORE the logs they count (lesson of goals).
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { seed } from "@/modules/core/seed";
import {
  getHabitsWeekCompleteDays,
  getHabitsWeeksOverview,
  getHabitsWeekSummary,
  selectHabitsWeeksOverview,
} from "@/modules/habits/contracts";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { weeklyReviews } from "@/modules/weekly-review/db/schema";
import { getPreviousWeeks, PREVIOUS_WEEKS_LIMIT } from "@/modules/weekly-review/queries";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

/** Wednesday 2026-10-14, 10:00 in Lima: the week of the 12th is in progress. */
const NOW = new Date("2026-10-14T15:00:00Z");
const WEEKS = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

let order = 0;
async function insertHabit(values: Partial<typeof habits.$inferInsert> & { name: string }) {
  const [row] = await testDb
    .insert(habits)
    .values({
      measure: "check",
      frequency: "daily",
      startDate: "2026-09-01",
      sortOrder: order++,
      ...values,
    })
    .returning({ id: habits.id });
  return row.id;
}

const logDays = async (habitId: string, days: string[]) => {
  for (const day of days)
    await testDb.insert(habitLogs).values({ habitId, day, quantity: 1, target: 1 });
};

const monday = (week: string, offsets: number[]) => offsets.map((offset) => addDays(week, offset));

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
  order = 0;
});

/** What the two single-week contracts say about `week`: the batch has to agree. */
async function single(week: string) {
  const [days, summary] = await Promise.all([
    getHabitsWeekCompleteDays(week, NOW),
    getHabitsWeekSummary(week, NOW),
  ]);
  return {
    weekStart: week,
    completeDays: days.completeDays,
    done: summary.total.done,
    expected: summary.total.expected,
  };
}

describe("getHabitsWeeksOverview", () => {
  test("without habits every week is zeros, in the order asked", async () => {
    const result = await getHabitsWeeksOverview([WEEKS[3], WEEKS[1]], NOW);
    expect(result).toEqual([
      { weekStart: WEEKS[3], completeDays: 0, done: 0, expected: 0 },
      { weekStart: WEEKS[1], completeDays: 0, done: 0, expected: 0 },
    ]);
    expect(await getHabitsWeeksOverview([], NOW)).toEqual([]);
  });

  test("agrees with the single-week contracts for every week (daily, fixed days, weekly quota, pauses, starts mid-range, the week in progress, a week to come)", async () => {
    const daily = await insertHabit({ name: "Correr" });
    await logDays(daily, [
      ...monday(WEEKS[1], [0, 1, 2, 3]),
      ...monday(WEEKS[2], [0, 1, 2, 3, 4, 5, 6]),
      ...monday(WEEKS[3], [0, 2, 4]),
      ...monday(WEEKS[4], [0, 1]),
    ]);
    const fixed = await insertHabit({
      name: "Gimnasio",
      frequency: "weekdays",
      weekdays: [1, 3, 5],
    });
    await logDays(fixed, [...monday(WEEKS[2], [0, 2]), ...monday(WEEKS[3], [0, 2, 4])]);
    const quota = await insertHabit({ name: "Leer", frequency: "weekly_count", weeklyTarget: 3 });
    await logDays(quota, [...monday(WEEKS[3], [1, 3]), ...monday(WEEKS[4], [0])]);
    const late = await insertHabit({ name: "Meditar", startDate: "2026-10-01" });
    await logDays(late, monday(WEEKS[3], [3, 4, 5, 6]));
    const paused = await insertHabit({ name: "Estirar" });
    await logDays(paused, monday(WEEKS[3], [0, 1]));
    await testDb
      .insert(habitPauses)
      .values({ habitId: paused, startDate: addDays(WEEKS[3], 2), endDate: addDays(WEEKS[3], 6) });

    const asked = [...WEEKS, "2026-10-19", "2026-10-26"];
    const batch = await getHabitsWeeksOverview(asked, NOW);
    expect(batch).toEqual(await Promise.all(asked.map(single)));
    // Not all zeros: the control that the comparison can fail.
    expect(batch.some((week) => week.completeDays > 0)).toBe(true);
    expect(batch.some((week) => week.done > 0 && week.expected > 0)).toBe(true);
    // The weeks to come are zeros.
    expect(batch.slice(-2)).toEqual([
      { weekStart: "2026-10-19", completeDays: 0, done: 0, expected: 0 },
      { weekStart: "2026-10-26", completeDays: 0, done: 0, expected: 0 },
    ]);
  });

  test("any day of a week names its Monday; archived and deleted habits do not count", async () => {
    const live = await insertHabit({ name: "Correr" });
    await logDays(live, monday(WEEKS[3], [0, 1, 2, 3, 4, 5, 6]));
    const gone = await insertHabit({
      name: "Antiguo",
      deletedAt: new Date("2026-10-01T00:00:00Z"),
    });
    await logDays(gone, monday(WEEKS[3], [0, 1, 2, 3, 4, 5, 6]));
    const [week] = await getHabitsWeeksOverview(["2026-10-08"], NOW);
    expect(week).toEqual(await single(WEEKS[3]));
    expect(week).toMatchObject({ weekStart: WEEKS[3], completeDays: 7, done: 7, expected: 7 });
  });

  test("a fixed number of queries whatever the number of weeks and habits", async () => {
    const one = await insertHabit({ name: "Uno" });
    await logDays(one, monday(WEEKS[3], [0, 1, 2]));
    const select = vi.spyOn(testDb, "select");
    await selectHabitsWeeksOverview(testDb, [WEEKS[3]], NOW);
    const forOne = select.mock.calls.length;
    for (let index = 0; index < 5; index += 1) {
      const id = await insertHabit({ name: `H${index}` });
      await logDays(id, monday(WEEKS[2], [0, 1]));
    }
    select.mockClear();
    await selectHabitsWeeksOverview(testDb, WEEKS, NOW);
    expect(select.mock.calls.length).toBe(forOne);
    expect(forOne).toBe(3);
    select.mockRestore();
  });

  test("a malformed week is a RangeError, never a query", async () => {
    await expect(selectHabitsWeeksOverview(testDb, [WEEKS[0], "mañana"], NOW)).rejects.toThrow(
      RangeError,
    );
  });

  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s it redirects to /login", async (_name, headers) => {
    // Positive control: the owner reads it.
    expect(await getHabitsWeeksOverview([WEEKS[3]], NOW)).toHaveLength(1);
    request.headers = await headers();
    await expect(getHabitsWeeksOverview([WEEKS[3]], NOW)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});

describe("getPreviousWeeks", () => {
  const close = (week: string, note: string | null = null) =>
    testDb.insert(weeklyReviews).values({ weekStart: week, completedAt: NOW, note });

  test("nothing closed: nothing listed", async () => {
    expect(await getPreviousWeeks(NOW)).toEqual([]);
  });

  test("lists the closed weeks, the latest first, with their live numbers and notes", async () => {
    const id = await insertHabit({ name: "Correr" });
    await logDays(id, [...monday(WEEKS[2], [0, 1, 2, 3]), ...monday(WEEKS[3], [0, 1])]);
    await close(WEEKS[2], "Aprendí a descansar");
    await close(WEEKS[3]);
    // A week that was not closed stays out, whatever its numbers.
    const result = await getPreviousWeeks(NOW);
    expect(result.map((week) => week.weekStart)).toEqual([WEEKS[3], WEEKS[2]]);
    expect(result[1]).toEqual({
      weekStart: WEEKS[2],
      note: "Aprendí a descansar",
      completeDays: 4,
      habitsDone: 4,
      habitsExpected: 7,
    });
    expect(result[0]).toMatchObject({ note: null, completeDays: 2 });
    // The live figure: correcting a past log changes it.
    await logDays(id, monday(WEEKS[2], [4]));
    expect((await getPreviousWeeks(NOW))[1].completeDays).toBe(5);
  });

  test("at most 12 weeks, a fixed number of queries", async () => {
    const id = await insertHabit({ name: "Correr", startDate: "2026-01-01" });
    for (let index = 0; index < 15; index += 1) {
      const week = addDays("2026-06-01", 7 * index);
      await logDays(id, monday(week, [0]));
      await close(week);
    }
    const result = await getPreviousWeeks(NOW);
    expect(result).toHaveLength(PREVIOUS_WEEKS_LIMIT);
    expect(result[0].weekStart).toBe(addDays("2026-06-01", 7 * 14));
    expect(result.every((week) => week.habitsDone === 1)).toBe(true);
  });
});
