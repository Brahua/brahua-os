// H6 of `habits` against the throwaway database: the summary for `today` (which habits enter:
// never archived, deleted, paused today, not due today or not started, each with a positive
// control), its order, its DTO and streaks, Lima's midnight, a fixed number of queries and
// authorization; and the week summary for `weekly-review`.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  getHabitsDueToday,
  getHabitsTodaySummary,
  getHabitsWeekSummary,
  selectHabitsDueToday,
  selectHabitsTodaySummary,
  selectHabitsWeekSummary,
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

/** Friday 2026-10-02, 10:00 in Lima. */
const NOW = new Date("2026-10-02T15:00:00Z");
const TODAY = "2026-10-02";
const MONDAY = "2026-09-28";
/** 23:59:59 in Lima on Friday (already Saturday in UTC) and Lima's midnight a second later. */
const LIMA_LAST_SECOND = new Date("2026-10-03T04:59:59Z");
const LIMA_MIDNIGHT = new Date("2026-10-03T05:00:00Z");
const FRIDAY = 5;
const SATURDAY = 6;

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

const pause = (habitId: string, startDate: string, endDate: string) =>
  testDb.insert(habitPauses).values({ habitId, startDate, endDate });

async function area(slug: string) {
  const [row] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, slug));
  return row;
}

const names = (items: { name: string }[]) => items.map((item) => item.name);

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

// The query-count spies on testDb: restored even when an assertion fails first.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getHabitsTodaySummary: which habits enter", () => {
  test("daily, weekly (also met), fixed days of today and avoid; in the manual order", async () => {
    await insertHabit({ name: "a evitar", kind: "avoid" });
    await insertHabit({ name: "viernes", frequency: "weekdays", weekdays: [FRIDAY] });
    const met = await insertHabit({
      name: "semana cumplida",
      frequency: "weekly_count",
      weeklyTarget: 2,
    });
    await log(met, MONDAY);
    await log(met, "2026-09-29");
    await insertHabit({ name: "diario" });
    expect(names(await getHabitsTodaySummary(NOW))).toEqual([
      "a evitar",
      "viernes",
      "semana cumplida",
      "diario",
    ]);
  });

  test("the order follows sort_order, not creation", async () => {
    const first = await insertHabit({ name: "primero" });
    await insertHabit({ name: "segundo" });
    await testDb.update(habits).set({ sortOrder: 99 }).where(eq(habits.id, first));
    expect(names(await getHabitsTodaySummary(NOW))).toEqual(["segundo", "primero"]);
  });

  test("archived: out; positive control: unarchived, back", async () => {
    const id = await insertHabit({ name: "archivado", archivedAt: NOW });
    expect(await getHabitsTodaySummary(NOW)).toEqual([]);
    await testDb.update(habits).set({ archivedAt: null }).where(eq(habits.id, id));
    expect(names(await getHabitsTodaySummary(NOW))).toEqual(["archivado"]);
  });

  test("deleted: out; positive control: restored, back", async () => {
    const id = await insertHabit({ name: "eliminado", deletedAt: NOW });
    expect(await getHabitsTodaySummary(NOW)).toEqual([]);
    await testDb.update(habits).set({ deletedAt: null }).where(eq(habits.id, id));
    expect(names(await getHabitsTodaySummary(NOW))).toEqual(["eliminado"]);
  });

  test("paused today: out; positive control: a pause that ends yesterday or is removed", async () => {
    const id = await insertHabit({ name: "en pausa" });
    await pause(id, "2026-09-30", "2026-10-04");
    expect(await getHabitsTodaySummary(NOW)).toEqual([]);
    await testDb.update(habitPauses).set({ deletedAt: NOW }).where(eq(habitPauses.habitId, id));
    expect(names(await getHabitsTodaySummary(NOW))).toEqual(["en pausa"]);
    await pause(id, "2026-09-25", "2026-10-01");
    expect(names(await getHabitsTodaySummary(NOW))).toEqual(["en pausa"]);
  });

  test("not due today (fixed days of other days): out; positive control: on its day", async () => {
    await insertHabit({ name: "sábado", frequency: "weekdays", weekdays: [SATURDAY] });
    expect(await getHabitsTodaySummary(NOW)).toEqual([]);
    expect(names(await getHabitsTodaySummary(LIMA_MIDNIGHT))).toEqual(["sábado"]);
  });

  test("before its start date: out; positive control: from that day", async () => {
    await insertHabit({ name: "empieza mañana", startDate: "2026-10-03" });
    expect(await getHabitsTodaySummary(NOW)).toEqual([]);
    expect(names(await getHabitsTodaySummary(LIMA_MIDNIGHT))).toEqual(["empieza mañana"]);
  });

  test("Lima's midnight: at 23:59:59 Friday's log still counts; at 00:00 a new day", async () => {
    const id = await insertHabit({ name: "Leer" });
    await log(id, TODAY);
    const read = async (now: Date) =>
      (await getHabitsTodaySummary(now)).map((item) => [item.name, item.done]);
    expect(await read(LIMA_LAST_SECOND)).toEqual([["Leer", true]]);
    expect(await read(LIMA_MIDNIGHT)).toEqual([["Leer", false]]);
  });

  test("empty without habits", async () => {
    expect(await getHabitsTodaySummary(NOW)).toEqual([]);
  });
});

describe("getHabitsTodaySummary: the DTO", () => {
  test("each kind with today's state, its week and its streak", async () => {
    const health = await area("health");
    const leer = await insertHabit({ name: "Leer", lifeAreaId: health.id });
    // Done Wednesday and Thursday (and today): a 3-day streak.
    await log(leer, "2026-09-30");
    await log(leer, "2026-10-01");
    await log(leer, TODAY);
    const agua = await insertHabit({
      name: "Agua",
      measure: "quantity",
      goal: 8,
      unit: "vasos",
      step: 2,
    });
    await log(agua, "2026-10-01", 8, 8);
    await log(agua, TODAY, 4, 8);
    const correr = await insertHabit({
      name: "Correr",
      frequency: "weekly_count",
      weeklyTarget: 3,
    });
    await log(correr, MONDAY);
    await log(correr, "2026-09-23");
    await log(correr, "2026-09-24");
    await log(correr, "2026-09-25");
    const fumar = await insertHabit({ name: "Fumar", kind: "avoid", startDate: "2026-09-26" });

    expect(await getHabitsTodaySummary(NOW)).toEqual([
      {
        id: leer,
        name: "Leer",
        area: { id: health.id, name: health.name, color: health.color },
        kind: "build",
        measure: "check",
        goal: 1,
        unit: null,
        step: 1,
        quantity: 1,
        done: true,
        week: null,
        streak: { count: 3, unit: "days" },
      },
      {
        id: agua,
        name: "Agua",
        area: null,
        kind: "build",
        measure: "quantity",
        goal: 8,
        unit: "vasos",
        step: 2,
        quantity: 4,
        done: false,
        week: null,
        // Today isn't met yet and doesn't break it: yesterday's 1.
        streak: { count: 1, unit: "days" },
      },
      {
        id: correr,
        name: "Correr",
        area: null,
        kind: "build",
        measure: "check",
        goal: 1,
        unit: null,
        step: 1,
        quantity: 0,
        done: false,
        week: { done: 1, quota: 3 },
        // Last week was met (3 of 3); this one is still open.
        streak: { count: 1, unit: "weeks" },
      },
      {
        id: fumar,
        name: "Fumar",
        area: null,
        kind: "avoid",
        measure: "check",
        goal: 1,
        unit: null,
        step: 1,
        quantity: 0,
        done: true,
        week: null,
        // Clean from Saturday 26 to today: 7 days.
        streak: { count: 7, unit: "days" },
      },
    ]);
  });

  test("a relapse today: the avoid habit isn't done and its streak is 0", async () => {
    const id = await insertHabit({ name: "Fumar", kind: "avoid", startDate: "2026-09-26" });
    await log(id, TODAY, 1, 1);
    const [item] = await getHabitsTodaySummary(NOW);
    expect(item).toMatchObject({ quantity: 1, done: false, streak: { count: 0, unit: "days" } });
  });

  test("X por semana with the week met: done without today's log", async () => {
    const id = await insertHabit({ name: "Correr", frequency: "weekly_count", weeklyTarget: 2 });
    await log(id, MONDAY);
    // Positive control: one of two is not done yet.
    expect((await getHabitsTodaySummary(NOW))[0]).toMatchObject({
      done: false,
      week: { done: 1, quota: 2 },
    });
    await log(id, "2026-09-29");
    expect((await getHabitsTodaySummary(NOW))[0]).toMatchObject({
      done: true,
      week: { done: 2, quota: 2 },
    });
  });

  test("a paused day in the middle doesn't break the streak", async () => {
    const id = await insertHabit({ name: "Leer" });
    await log(id, "2026-09-29");
    await pause(id, "2026-09-30", "2026-09-30");
    await log(id, "2026-10-01");
    const [item] = await getHabitsTodaySummary(NOW);
    expect(item.streak).toEqual({ count: 2, unit: "days" });
  });

  test("three queries, whatever the number of habits (no query per habit)", async () => {
    for (let index = 0; index < 10; index += 1) {
      const id = await insertHabit({
        name: `h${index}`,
        ...(index % 3 === 0 ? { frequency: "weekly_count" as const, weeklyTarget: 3 } : {}),
        ...(index % 4 === 0 ? { measure: "quantity" as const, goal: 8, unit: "vasos" } : {}),
      });
      await log(id, "2026-10-01", 8, 8);
      await log(id, TODAY, 1, 1);
      await pause(id, "2026-09-10", "2026-09-12");
    }
    // The data function (the queries alone, without the owner check's session read).
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const items = await selectHabitsTodaySummary(testDb, NOW);
    expect(items).toHaveLength(10);
    expect(select).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
  });

  test("one query without habits", async () => {
    const select = vi.spyOn(testDb, "select");
    expect(await selectHabitsTodaySummary(testDb, NOW)).toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("getHabitsDueToday (today's pads)", () => {
  test("the same habits as the summary, as full HabitItems, in three queries", async () => {
    const leer = await insertHabit({ name: "Leer" });
    await log(leer, TODAY);
    await insertHabit({ name: "sábado", frequency: "weekdays", weekdays: [SATURDAY] });
    const agua = await insertHabit({ name: "Agua", measure: "quantity", goal: 8, unit: "vasos" });
    const items = await getHabitsDueToday(NOW);
    expect(items.map((item) => item.id)).toEqual(
      (await getHabitsTodaySummary(NOW)).map((item) => item.id),
    );
    expect(items.map((item) => item.id)).toEqual([leer, agua]);
    // What the pad and the logging hooks need (not in the summary's DTO).
    expect(items[0]).toMatchObject({ quantity: 1, target: 1, weekAvailable: 7, pause: null });
    expect(items[0].streak).toEqual({ unit: "days", done: 1, notDone: 0 });

    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    await selectHabitsDueToday(testDb, NOW);
    expect(select).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("getHabitsWeekSummary (weekly-review)", () => {
  test("each active habit's compliance and the total, by the rules of Semana", async () => {
    const health = await area("health");
    const leer = await insertHabit({ name: "Leer", lifeAreaId: health.id });
    for (const day of ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-26", "2026-09-27"]) {
      await log(leer, day);
    }
    const correr = await insertHabit({
      name: "Correr",
      frequency: "weekly_count",
      weeklyTarget: 3,
    });
    await log(correr, "2026-09-21");
    await log(correr, "2026-09-24");
    // Leer's area: { id, name, color }, like the today summary.
    const leerArea = { id: health.id, name: health.name, color: health.color };
    // Any day of the week names it (Thursday → its Monday).
    const summary = await getHabitsWeekSummary("2026-09-24", NOW);
    expect(summary).toEqual({
      weekStart: "2026-09-21",
      habits: [
        { id: leer, name: "Leer", area: leerArea, compliance: { done: 5, expected: 7 } },
        { id: correr, name: "Correr", area: null, compliance: { done: 2, expected: 3 } },
      ],
      total: { done: 7, expected: 10 },
    });
  });

  test("archived, deleted or not started by that Sunday: out (positive controls)", async () => {
    const archived = await insertHabit({ name: "archivado", archivedAt: NOW });
    const deleted = await insertHabit({ name: "eliminado", deletedAt: NOW });
    await insertHabit({ name: "después", startDate: "2026-09-28" });
    await insertHabit({ name: "base" });
    const week = async (day: string) => names((await getHabitsWeekSummary(day, NOW)).habits);
    expect(await week("2026-09-21")).toEqual(["base"]);
    // The habit that started on the 28th is in its own week.
    expect(await week(MONDAY)).toEqual(["después", "base"]);
    await testDb.update(habits).set({ archivedAt: null }).where(eq(habits.id, archived));
    await testDb.update(habits).set({ deletedAt: null }).where(eq(habits.id, deleted));
    expect(await week("2026-09-21")).toEqual(["archivado", "eliminado", "base"]);
  });

  test("the current week counts up to today", async () => {
    const id = await insertHabit({ name: "Leer" });
    await log(id, MONDAY);
    await log(id, TODAY);
    const summary = await getHabitsWeekSummary(MONDAY, NOW);
    expect(summary.total).toEqual({ done: 2, expected: 5 });
  });

  test("a future week or one before every start is empty, never another week", async () => {
    const id = await insertHabit({ name: "Leer", startDate: "2026-09-21" });
    await log(id, TODAY);
    const empty = (weekStart: string) => ({
      weekStart,
      habits: [],
      total: { done: 0, expected: 0 },
    });
    expect(await getHabitsWeekSummary("2026-10-05", NOW)).toEqual(empty("2026-10-05"));
    expect(await getHabitsWeekSummary("2026-09-14", NOW)).toEqual(empty("2026-09-14"));
    // Positive control: the first week there is.
    expect((await getHabitsWeekSummary("2026-09-21", NOW)).habits).toHaveLength(1);
  });

  test("a malformed day is refused before any query", async () => {
    const select = vi.spyOn(testDb, "select");
    await expect(selectHabitsWeekSummary(testDb, "2026-13-01", NOW)).rejects.toThrow(RangeError);
    await expect(selectHabitsWeekSummary(testDb, "ayer", NOW)).rejects.toThrow(RangeError);
    expect(select).not.toHaveBeenCalled();
  });

  test("a future week reads nothing", async () => {
    await insertHabit({ name: "Leer" });
    const select = vi.spyOn(testDb, "select");
    expect((await selectHabitsWeekSummary(testDb, "2026-10-08", NOW)).habits).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  test("three queries with 10 habits", async () => {
    for (let index = 0; index < 10; index += 1) {
      const id = await insertHabit({ name: `h${index}` });
      await log(id, MONDAY);
      await pause(id, "2026-09-10", "2026-09-12");
    }
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const summary = await selectHabitsWeekSummary(testDb, MONDAY, NOW);
    expect(summary.habits).toHaveLength(10);
    expect(select).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
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
  ])("with %s every contract redirects to /login", async (_, headers) => {
    await insertHabit({ name: "Leer" });
    // Positive control: the owner sees it.
    expect(names(await getHabitsTodaySummary(NOW))).toEqual(["Leer"]);
    expect(names(await getHabitsDueToday(NOW))).toEqual(["Leer"]);
    expect((await getHabitsWeekSummary(MONDAY, NOW)).habits).toHaveLength(1);
    request.headers = await headers();
    const toLogin = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getHabitsTodaySummary(NOW)).rejects.toMatchObject(toLogin);
    await expect(getHabitsDueToday(NOW)).rejects.toMatchObject(toLogin);
    await expect(getHabitsWeekSummary(MONDAY, NOW)).rejects.toMatchObject(toLogin);
  });
});
