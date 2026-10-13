// W1 of `weekly-review`, the habits side, against the throwaway database: `getHabitsWeekCompleteDays`
// (a day is complete when every daily or fixed-days habit that defined it is done; pauses, days
// with no habit, habits that start mid-week, «X por semana» habits, archived and deleted habits,
// the week in progress, a fixed number of queries) and authorization. Habit fixtures start BEFORE
// the logs they count (lesson of goals).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { seed } from "@/modules/core/seed";
import {
  getHabitsWeekCompleteDays,
  getHabitsWeekSummary,
  selectHabitsWeekCompleteDays,
} from "@/modules/habits/contracts";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

/** Monday 2026-10-19, 10:00 in Lima: reviewing the week 2026-10-12 – 2026-10-18 that just ended. */
const NOW = new Date("2026-10-19T15:00:00Z");
/** Wednesday 2026-10-14, 10:00 in Lima: the same week in progress. */
const MIDWEEK = new Date("2026-10-14T15:00:00Z");
const WEEK = "2026-10-12";
const DAYS = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
];

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

const log = (habitId: string, day: string, quantity = 1, target = 1) =>
  testDb.insert(habitLogs).values({ habitId, day, quantity, target });

const logAll = async (habitId: string, days: string[]) => {
  for (const day of days) await log(habitId, day);
};

const pause = (habitId: string, startDate: string, endDate: string) =>
  testDb.insert(habitPauses).values({ habitId, startDate, endDate });

const completeDays = async (now = NOW, week = WEEK) =>
  (await getHabitsWeekCompleteDays(week, now)).days.filter((day) => day.complete).map((d) => d.day);

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

describe("getHabitsWeekCompleteDays", () => {
  test("without habits: seven days, none complete", async () => {
    const result = await getHabitsWeekCompleteDays(WEEK, NOW);
    expect(result.weekStart).toBe(WEEK);
    expect(result.completeDays).toBe(0);
    expect(result.days.map((day) => day.day)).toEqual(DAYS);
    expect(result.days.every((day) => day.scheduled === 0 && !day.complete)).toBe(true);
  });

  test("a daily habit done on four days: four complete days", async () => {
    const id = await insertHabit({ name: "Correr" });
    await logAll(id, [DAYS[0], DAYS[1], DAYS[3], DAYS[6]]);
    const result = await getHabitsWeekCompleteDays(WEEK, NOW);
    expect(result.completeDays).toBe(4);
    expect(await completeDays()).toEqual([DAYS[0], DAYS[1], DAYS[3], DAYS[6]]);
    expect(result.days[2]).toEqual({ day: DAYS[2], scheduled: 1, done: 0, complete: false });
  });

  test("any day of the week names the same Monday", async () => {
    const id = await insertHabit({ name: "Correr" });
    await logAll(id, DAYS);
    for (const day of [DAYS[0], DAYS[3], DAYS[6]]) {
      const result = await getHabitsWeekCompleteDays(day, NOW);
      expect(result.weekStart).toBe(WEEK);
      expect(result.completeDays).toBe(7);
    }
  });

  test("a day needs every habit that defined it, including a quantity habit at its goal", async () => {
    const run = await insertHabit({ name: "Correr" });
    const water = await insertHabit({ name: "Agua", measure: "quantity", goal: 8, unit: "vasos" });
    await logAll(run, DAYS);
    await log(water, DAYS[0], 8, 8);
    await log(water, DAYS[1], 5, 8); // partial: not done
    await log(water, DAYS[2], 9, 8);
    expect(await completeDays()).toEqual([DAYS[0], DAYS[2]]);
  });

  test("fixed-days habits define only their weekdays; the other days are neither complete nor missed", async () => {
    const gym = await insertHabit({ name: "Gimnasio", frequency: "weekdays", weekdays: [1, 3, 5] });
    await logAll(gym, [DAYS[0], DAYS[2]]);
    const result = await getHabitsWeekCompleteDays(WEEK, NOW);
    expect(result.days.map((day) => day.scheduled)).toEqual([1, 0, 1, 0, 1, 0, 0]);
    expect(result.days.filter((day) => day.complete).map((day) => day.day)).toEqual([
      DAYS[0],
      DAYS[2],
    ]);
  });

  test("pauses take the habit out of that day; a paused logged day does not count", async () => {
    const run = await insertHabit({ name: "Correr" });
    const read = await insertHabit({ name: "Leer" });
    await logAll(run, [DAYS[0], DAYS[1], DAYS[2]]);
    await logAll(read, [DAYS[0], DAYS[1], DAYS[2]]);
    // Running rests on Tuesday and Wednesday; reading still defines them.
    await pause(run, DAYS[1], DAYS[2]);
    const result = await getHabitsWeekCompleteDays(WEEK, NOW);
    expect(result.days[1]).toEqual({ day: DAYS[1], scheduled: 1, done: 1, complete: true });
    expect(result.days[3]).toMatchObject({ scheduled: 2, done: 0, complete: false });
    expect(result.completeDays).toBe(3);
    // Both paused on Tuesday: no habit defines it any more.
    await pause(read, DAYS[1], DAYS[1]);
    expect((await getHabitsWeekCompleteDays(WEEK, NOW)).days[1]).toEqual({
      day: DAYS[1],
      scheduled: 0,
      done: 0,
      complete: false,
    });
  });

  test("a habit that starts mid-week defines only the days from its start", async () => {
    const old = await insertHabit({ name: "Correr" });
    const fresh = await insertHabit({ name: "Meditar", startDate: DAYS[3] });
    await logAll(old, DAYS);
    await logAll(fresh, [DAYS[3], DAYS[4]]);
    const result = await getHabitsWeekCompleteDays(WEEK, NOW);
    expect(result.days.map((day) => day.scheduled)).toEqual([1, 1, 1, 2, 2, 2, 2]);
    expect(await completeDays()).toEqual([DAYS[0], DAYS[1], DAYS[2], DAYS[3], DAYS[4]]);
  });

  test("a habit that starts after the week is not in it", async () => {
    await insertHabit({ name: "Después", startDate: "2026-10-19" });
    expect((await getHabitsWeekCompleteDays(WEEK, NOW)).days.every((d) => d.scheduled === 0)).toBe(
      true,
    );
  });

  test("«X por semana» habits define no day (decisión autónoma): they neither complete nor break one", async () => {
    const weekly = await insertHabit({ name: "Nadar", frequency: "weekly_count", weeklyTarget: 3 });
    const daily = await insertHabit({ name: "Correr" });
    await logAll(weekly, [DAYS[0]]);
    await logAll(daily, [DAYS[0], DAYS[1]]);
    const result = await getHabitsWeekCompleteDays(WEEK, NOW);
    expect(result.days[0].scheduled).toBe(1);
    expect(result.completeDays).toBe(2);
    // Alone, a weekly habit leaves every day undefined.
    await testDb.delete(habitLogs);
    await testDb.delete(habits).where(eq(habits.id, daily));
    expect((await getHabitsWeekCompleteDays(WEEK, NOW)).completeDays).toBe(0);
  });

  test("archived and deleted habits do not define days (the same set as «N de M hábitos»)", async () => {
    const live = await insertHabit({ name: "Correr" });
    const archived = await insertHabit({ name: "Viejo", archivedAt: new Date() });
    const deleted = await insertHabit({ name: "Borrado", deletedAt: new Date() });
    await logAll(live, [DAYS[0]]);
    expect(archived).toBeTruthy();
    expect(deleted).toBeTruthy();
    // The archived and the deleted habit have no logs: if they counted, no day would be complete.
    const result = await getHabitsWeekCompleteDays(WEEK, NOW);
    expect(result.days[0]).toEqual({ day: DAYS[0], scheduled: 1, done: 1, complete: true });
    expect(result.completeDays).toBe(1);
    // The summary the ritual shows next to it agrees on the habits (one active habit).
    expect((await getHabitsWeekSummary(WEEK, NOW)).habits).toHaveLength(1);
  });

  test("a habit to avoid is done on a clean day and not on a relapse", async () => {
    const avoid = await insertHabit({ name: "Sin azúcar", kind: "avoid" });
    await log(avoid, DAYS[2], 1, 1); // a relapse
    const result = await getHabitsWeekCompleteDays(WEEK, NOW);
    expect(result.completeDays).toBe(6);
    expect(result.days[2].complete).toBe(false);
  });

  test("the week in progress counts only elapsed days, and today only once complete", async () => {
    const run = await insertHabit({ name: "Correr" });
    await logAll(run, [DAYS[0], DAYS[1]]);
    // Wednesday, not done yet: Monday and Tuesday only.
    const before = await getHabitsWeekCompleteDays(WEEK, MIDWEEK);
    expect(before.completeDays).toBe(2);
    expect(before.days[2]).toEqual({ day: DAYS[2], scheduled: 1, done: 0, complete: false });
    expect(before.days.slice(3).every((day) => day.scheduled === 0)).toBe(true);
    // Done during the day: it counts.
    await log(run, DAYS[2]);
    expect((await getHabitsWeekCompleteDays(WEEK, MIDWEEK)).completeDays).toBe(3);
  });

  test("a week that has not started is empty", async () => {
    const run = await insertHabit({ name: "Correr" });
    await logAll(run, DAYS);
    const result = await getHabitsWeekCompleteDays("2026-10-19", MIDWEEK);
    expect(result.weekStart).toBe("2026-10-19");
    expect(result.completeDays).toBe(0);
  });

  test("a week before any habit started is empty", async () => {
    await insertHabit({ name: "Correr", startDate: "2026-10-05" });
    expect((await getHabitsWeekCompleteDays("2026-09-14", NOW)).completeDays).toBe(0);
  });

  test("a malformed week is a RangeError, never a query", async () => {
    await expect(selectHabitsWeekCompleteDays(testDb, "2026-10-1", NOW)).rejects.toThrow(
      RangeError,
    );
    await expect(selectHabitsWeekCompleteDays(testDb, "mañana", NOW)).rejects.toThrow(RangeError);
  });

  test("a fixed number of queries whatever the number of habits", async () => {
    const one = await insertHabit({ name: "Uno" });
    await logAll(one, DAYS);
    const select = vi.spyOn(testDb, "select");
    await selectHabitsWeekCompleteDays(testDb, WEEK, NOW);
    const forOne = select.mock.calls.length;
    for (let index = 0; index < 6; index += 1) {
      const id = await insertHabit({ name: `H${index}` });
      await logAll(id, DAYS.slice(0, index));
      await pause(id, DAYS[6], DAYS[6]);
    }
    select.mockClear();
    const result = await selectHabitsWeekCompleteDays(testDb, WEEK, NOW);
    expect(select.mock.calls.length).toBe(forOne);
    expect(forOne).toBe(3);
    expect(result.days[6].scheduled).toBe(1); // the first habit; the rest are paused that day
    select.mockRestore();
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
  ])("with %s the contract redirects to /login", async (_, headers) => {
    const id = await insertHabit({ name: "Leer" });
    await log(id, DAYS[0]);
    // Positive control: the owner reads it.
    expect((await getHabitsWeekCompleteDays(WEEK, NOW)).completeDays).toBe(1);
    request.headers = await headers();
    await expect(getHabitsWeekCompleteDays(WEEK, NOW)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
