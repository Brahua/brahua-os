// G2 of `goals`, the habits side, against the throwaway database: `getHabitDoneDays` and its
// batch (`selectHabitsDoneDays`): the days done inside a range with pauses and not scheduled days
// out of the count, a "X por semana" habit counting each logged day, the range bounds, today's
// partial state, deleted and archived habits, a fixed number of queries and authorization; and
// the option lists a goal's form uses.
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { seed } from "@/modules/core/seed";
import {
  getHabitDoneDays,
  getHabitOptions,
  selectHabitAvailability,
  selectHabitOptions,
  selectHabitsDoneDays,
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
const MISSING = "00000000-0000-4000-8000-000000000000";
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

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

describe("getHabitDoneDays", () => {
  test("a daily habit: its done days in the range over the days elapsed", async () => {
    const id = await insertHabit({ name: "Correr" });
    await log(id, "2026-10-01");
    await log(id, "2026-10-02");
    await log(id, "2026-09-30"); // before the range
    expect(await getHabitDoneDays(id, OCTOBER.from, OCTOBER.to, NOW)).toEqual({
      done: 2,
      expected: 2,
    });
  });

  test("today counts only once done; a partial quantity is not a done day", async () => {
    const id = await insertHabit({ name: "Agua", measure: "quantity", goal: 8, unit: "vasos" });
    await log(id, "2026-10-01", 8, 8);
    await log(id, "2026-10-02", 3, 8);
    // Today is 3 of 8: not done, so not expected yet either (it isn't over).
    expect(await getHabitDoneDays(id, OCTOBER.from, OCTOBER.to, NOW)).toEqual({
      done: 1,
      expected: 1,
    });
    await testDb.update(habitLogs).set({ quantity: 8 });
    expect(await getHabitDoneDays(id, OCTOBER.from, OCTOBER.to, NOW)).toEqual({
      done: 2,
      expected: 2,
    });
  });

  test("the range's bounds: nothing before its first day, nothing after today", async () => {
    const id = await insertHabit({ name: "Leer" });
    for (const day of ["2026-09-28", "2026-09-29", "2026-10-01", "2026-10-02"]) await log(id, day);
    expect(await getHabitDoneDays(id, "2026-09-29", "2026-09-30", NOW)).toEqual({
      done: 1,
      expected: 2,
    });
    // A range that is all in the future has nothing yet.
    expect(await getHabitDoneDays(id, "2026-11-01", "2026-11-30", NOW)).toEqual({
      done: 0,
      expected: 0,
    });
  });

  test("a paused day is out of the count even with a log (positive control: the same log counts without the pause)", async () => {
    const id = await insertHabit({ name: "Meditar" });
    await log(id, "2026-10-01");
    expect(await getHabitDoneDays(id, OCTOBER.from, OCTOBER.to, NOW)).toEqual({
      done: 1,
      expected: 1,
    });
    await pause(id, "2026-10-01", "2026-10-01");
    expect(await getHabitDoneDays(id, OCTOBER.from, OCTOBER.to, NOW)).toEqual({
      done: 0,
      expected: 0,
    });
  });

  test("a fixed-days habit counts only its weekdays; a log on another day does not count", async () => {
    // Mondays and Wednesdays. 2026-09-28 is a Monday, 09-30 a Wednesday, 10-01 a Thursday.
    const id = await insertHabit({
      name: "Gimnasio",
      frequency: "weekdays",
      weekdays: [1, 3],
    });
    await log(id, "2026-09-28");
    await log(id, "2026-09-30");
    await log(id, "2026-10-01"); // Thursday: not scheduled
    expect(await getHabitDoneDays(id, "2026-09-28", "2026-10-04", NOW)).toEqual({
      done: 2,
      expected: 2,
    });
  });

  test("an 'X por semana' habit counts each logged day as done (days, not weeks)", async () => {
    const id = await insertHabit({ name: "Correr", frequency: "weekly_count", weeklyTarget: 3 });
    for (const day of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]) await log(id, day);
    const reading = await getHabitDoneDays(id, "2026-09-28", "2026-10-04", NOW);
    expect(reading?.done).toBe(4);
  });

  test("a habit that started inside the range counts from its start date", async () => {
    const id = await insertHabit({ name: "Nuevo", startDate: "2026-10-01" });
    await log(id, "2026-10-01");
    expect(await getHabitDoneDays(id, "2026-09-01", "2026-12-31", NOW)).toEqual({
      done: 1,
      expected: 1,
    });
  });

  test("an archived habit still answers; a deleted or missing one is null", async () => {
    const archived = await insertHabit({ name: "Viejo", archivedAt: new Date() });
    await log(archived, "2026-10-01");
    expect(await getHabitDoneDays(archived, OCTOBER.from, OCTOBER.to, NOW)).toMatchObject({
      done: 1,
    });
    const deleted = await insertHabit({ name: "Borrado", deletedAt: new Date() });
    await log(deleted, "2026-10-01");
    expect(await getHabitDoneDays(deleted, OCTOBER.from, OCTOBER.to, NOW)).toBeNull();
    expect(await getHabitDoneDays(MISSING, OCTOBER.from, OCTOBER.to, NOW)).toBeNull();
  });
});

describe("selectHabitsDoneDays", () => {
  test("one answer per request, in order: two periods of one habit and a missing one", async () => {
    const id = await insertHabit({ name: "Correr" });
    await log(id, "2026-08-15");
    await log(id, "2026-10-01");
    const answers = await selectHabitsDoneDays(
      testDb,
      [
        { habitId: id, from: "2026-07-01", to: "2026-09-30" },
        { habitId: MISSING, ...OCTOBER },
        { habitId: id, ...OCTOBER },
      ],
      NOW,
    );
    expect(answers[0]).toMatchObject({ name: "Correr", done: 1 });
    expect(answers[1]).toBeNull();
    expect(answers[2]).toMatchObject({ name: "Correr", done: 1 });
  });

  test("three queries whatever the number of goals (no query per habit)", async () => {
    const requests = [];
    for (let index = 0; index < 8; index += 1) {
      const id = await insertHabit({ name: `h${index}` });
      await log(id, "2026-10-01");
      await pause(id, "2026-09-10", "2026-09-12");
      requests.push({ habitId: id, ...OCTOBER });
    }
    const select = vi.spyOn(testDb, "select");
    const answers = await selectHabitsDoneDays(testDb, requests, NOW);
    expect(answers.every((answer) => answer?.done === 1)).toBe(true);
    expect(select).toHaveBeenCalledTimes(3);
    select.mockRestore();
    // No request: nothing is read.
    const idle = vi.spyOn(testDb, "select");
    expect(await selectHabitsDoneDays(testDb, [], NOW)).toEqual([]);
    expect(idle).not.toHaveBeenCalled();
  });
});

describe("the options a goal can follow", () => {
  test("only active habits, in their manual order; availability tells archived from missing", async () => {
    // Inserted out of order: the manual order (`sortOrder`) decides, not the insertion.
    const second = await insertHabit({ name: "Segundo", sortOrder: 5 });
    const first = await insertHabit({ name: "Primero", sortOrder: 2 });
    const archived = await insertHabit({ name: "Archivado", archivedAt: new Date() });
    const deleted = await insertHabit({ name: "Borrado", deletedAt: new Date() });
    expect((await getHabitOptions()).map((option) => option.name)).toEqual(["Primero", "Segundo"]);
    expect(await selectHabitOptions(testDb)).toEqual([
      { id: first, name: "Primero" },
      { id: second, name: "Segundo" },
    ]);
    const availability = await selectHabitAvailability(testDb, [first, archived, deleted, MISSING]);
    expect(Object.fromEntries(availability)).toEqual({ [first]: "active", [archived]: "archived" });
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
  ])("with %s the contracts redirect to /login", async (_, headers) => {
    const id = await insertHabit({ name: "Leer" });
    // Positive control: the owner reads it.
    expect(await getHabitDoneDays(id, OCTOBER.from, OCTOBER.to, NOW)).not.toBeNull();
    expect(await getHabitOptions()).toHaveLength(1);
    request.headers = await headers();
    const toLogin = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getHabitDoneDays(id, OCTOBER.from, OCTOBER.to, NOW)).rejects.toMatchObject(
      toLogin,
    );
    await expect(getHabitOptions()).rejects.toMatchObject(toLogin);
  });
});
