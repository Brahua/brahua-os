// H5 of `habits` against the throwaway database: the "Semana" view (rows, total, the range of logs
// with partial quantities, pauses, which habits enter, `?semana=` kept in range), a habit's page
// (the month's logs with partial ones, archived habits, 404 for a deleted or malformed id), both
// in a fixed number of queries; "Más detalles" (identity, cue, start date) when creating and
// editing; the deleted habit for the list's "Deshacer"; and authorization.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import { createHabit } from "@/modules/habits/actions";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { DETAILS_ERRORS } from "@/modules/habits/history-copy";
import { selectHabitDetail, selectHabitsWeek } from "@/modules/habits/history";
import { updateHabit } from "@/modules/habits/organize-actions";
import { getDeletedHabit, getHabitDetail, getHabitsWeek } from "@/modules/habits/queries";
import { addDays, weekStart } from "@/modules/habits/schedule";
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
/** Friday 2026-10-02 (Lima) for the reads that take `today`. */
const TODAY = "2026-10-02";
const MONDAY = "2026-09-28";
/** The actions use Lima's today by the real clock: so do their tests. */
const realToday = () => ownerDateKey(new Date());

let order = 0;
async function insertHabit(values: Partial<typeof habits.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(habits)
    .values({
      name: "Leer",
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
  order = 0;
});

describe("Semana", () => {
  test("each active habit's days and compliance, and the total, in the manual order", async () => {
    const leer = await insertHabit({ name: "Leer" });
    const agua = await insertHabit({
      name: "Agua",
      measure: "quantity",
      goal: 8,
      unit: "vasos",
    });
    const gym = await insertHabit({ name: "Gimnasio", frequency: "weekly_count", weeklyTarget: 3 });
    await log(leer, "2026-09-28");
    await log(leer, "2026-09-29");
    // A partial quantity, and one done under an older (lower) target.
    await log(agua, "2026-09-28", 6, 8);
    await log(agua, "2026-09-29", 6, 6);
    await log(gym, "2026-09-30");
    // Outside the week: not read.
    await log(leer, "2026-09-27");
    await testDb
      .insert(habitPauses)
      .values({ habitId: leer, startDate: "2026-09-30", endDate: "2026-09-30" });

    const week = await selectHabitsWeek(testDb, TODAY);
    expect(week.monday).toBe(MONDAY);
    expect(week.earliestStart).toBe("2026-09-01");
    expect(week.rows.map((row) => row.name)).toEqual(["Leer", "Agua", "Gimnasio"]);
    const [rowLeer, rowAgua, rowGym] = week.rows;
    expect(rowLeer.days.map((day) => day.status)).toEqual([
      "done",
      "done",
      "paused",
      "empty",
      "empty",
      "future",
      "future",
    ]);
    // Monday and Tuesday done; Thursday open; Wednesday paused; today not done yet.
    expect(rowLeer.compliance).toEqual({ done: 2, expected: 3 });
    expect(rowAgua.days[0]).toMatchObject({ status: "partial", quantity: 6, target: 8 });
    expect(rowAgua.days[1]).toMatchObject({ status: "done", quantity: 6, target: 6 });
    expect(rowAgua.compliance).toEqual({ done: 1, expected: 4 });
    expect(rowGym.compliance).toEqual({ done: 1, expected: 3 });
    expect(week.total).toEqual({ done: 4, expected: 10 });
  });

  test("archived, deleted and later habits stay out; ?semana= is kept within the habits' weeks", async () => {
    await insertHabit({ name: "Leer", startDate: "2026-09-15" });
    await insertHabit({ name: "Archivado", archivedAt: new Date() });
    await insertHabit({ name: "Eliminado", deletedAt: new Date() });
    await insertHabit({ name: "Nuevo", startDate: "2026-10-01" });
    const previous = await selectHabitsWeek(testDb, TODAY, "2026-09-23");
    expect(previous.monday).toBe("2026-09-21");
    // "Nuevo" started after that Sunday.
    expect(previous.rows.map((row) => row.name)).toEqual(["Leer"]);
    // Before the first week: the first week (of the earliest start, the 15th).
    expect((await selectHabitsWeek(testDb, TODAY, "2026-01-01")).monday).toBe("2026-09-14");
    expect((await selectHabitsWeek(testDb, TODAY, "2027-01-01")).monday).toBe(MONDAY);
    expect((await selectHabitsWeek(testDb, TODAY, "no")).monday).toBe(MONDAY);
    const current = await selectHabitsWeek(testDb, TODAY);
    expect(current.rows.map((row) => row.name)).toEqual(["Leer", "Nuevo"]);
  });

  test("three queries, whatever the number of habits (one without any)", async () => {
    for (let index = 0; index < 6; index += 1) {
      const id = await insertHabit({ name: `H${index}` });
      await log(id, "2026-09-29");
      await testDb
        .insert(habitPauses)
        .values({ habitId: id, startDate: "2026-10-01", endDate: "2026-10-01" });
    }
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const week = await selectHabitsWeek(testDb, TODAY);
    expect(week.rows).toHaveLength(6);
    expect(week.rows.every((row) => row.days[3].status === "paused")).toBe(true);
    expect(select).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
    select.mockRestore();
    execute.mockRestore();
    await testDb.update(habits).set({ archivedAt: new Date() });
    const empty = vi.spyOn(testDb, "select");
    expect((await selectHabitsWeek(testDb, TODAY)).rows).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
    empty.mockRestore();
  });
});

describe("a habit's page", () => {
  test("the month's logs, partial ones too, plus the marked days the stats need", async () => {
    const id = await insertHabit({
      measure: "quantity",
      goal: 8,
      unit: "vasos",
      startDate: "2026-08-01",
      identity: "Soy alguien que se hidrata",
      cue: "Al despertar",
    });
    await log(id, "2026-08-31", 8, 8); // before the month: marked, read
    await log(id, "2026-08-30", 3, 8); // before the month and the 7 days: partial, not read
    await log(id, "2026-09-10", 3, 8); // in the month: partial, read
    await log(id, "2026-09-11", 8, 8);
    await log(id, "2026-10-01", 2, 8); // the last 7 days: read
    await testDb.insert(habitPauses).values([
      { habitId: id, startDate: "2026-09-01", endDate: "2026-09-03", reason: "Viaje" },
      { habitId: id, startDate: "2026-09-05", endDate: "2026-09-06", deletedAt: new Date() },
    ]);
    const loaded = await selectHabitDetail(testDb, id, "2026-09", TODAY);
    expect(loaded?.item).toMatchObject({
      id,
      identity: "Soy alguien que se hidrata",
      cue: "Al despertar",
      unit: "vasos",
    });
    expect(loaded?.archived).toBe(false);
    expect(loaded?.logs.map((entry) => entry.day)).toEqual([
      "2026-08-31",
      "2026-09-10",
      "2026-09-11",
      "2026-10-01",
    ]);
    expect(loaded?.pauses).toEqual([
      { id: expect.any(String), startDate: "2026-09-01", endDate: "2026-09-03", reason: "Viaje" },
    ]);
  });

  test("three queries; archived habits have a page; deleted or missing ones don't", async () => {
    const id = await insertHabit();
    await log(id, "2026-09-10");
    const select = vi.spyOn(testDb, "select");
    expect(await selectHabitDetail(testDb, id, "2026-09", TODAY)).not.toBeNull();
    expect(select).toHaveBeenCalledTimes(3);
    select.mockRestore();
    await testDb.update(habits).set({ archivedAt: new Date() }).where(eq(habits.id, id));
    expect((await selectHabitDetail(testDb, id, "2026-09", TODAY))?.archived).toBe(true);
    await testDb.update(habits).set({ deletedAt: new Date() }).where(eq(habits.id, id));
    expect(await selectHabitDetail(testDb, id, "2026-09", TODAY)).toBeNull();
    expect(await getHabitDetail(id, "2026-09", TODAY)).toBeNull();
    expect(await getHabitDetail(MISSING, "2026-09", TODAY)).toBeNull();
  });

  test("a malformed id is a 404 without reading habits (only the owner check)", async () => {
    const select = vi.spyOn(testDb, "select");
    expect(await getHabitDetail("not-a-uuid", "2026-09", TODAY)).toBeNull();
    const malformed = select.mock.calls.length;
    select.mockClear();
    // Positive control: a well-formed id reads the habit (its three queries).
    expect(await getHabitDetail(MISSING, "2026-09", TODAY)).toBeNull();
    expect(select.mock.calls.length - malformed).toBe(1);
    select.mockRestore();
  });

  test("the deleted habit for the list's Deshacer: only while it is deleted", async () => {
    const id = await insertHabit({ name: "Correr" });
    expect(await getDeletedHabit(id)).toBeNull();
    await testDb.update(habits).set({ deletedAt: new Date() }).where(eq(habits.id, id));
    expect(await getDeletedHabit(id)).toEqual({ id, name: "Correr" });
    expect(await getDeletedHabit("nope")).toBeNull();
  });
});

describe("Más detalles", () => {
  const stored = async (id: string) => {
    const [row] = await testDb
      .select({ identity: habits.identity, cue: habits.cue, startDate: habits.startDate })
      .from(habits)
      .where(eq(habits.id, id));
    return row;
  };

  test("creating: identity, cue and a start date up to 7 days back", async () => {
    const startDate = addDays(realToday(), -7);
    const result = await createHabit({
      name: "Leer",
      identity: " Soy  alguien que lee ",
      cue: "Antes de dormir",
      startDate,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toMatchObject({
      identity: "Soy alguien que lee",
      cue: "Antes de dormir",
      startDate,
    });
    expect(await stored(result.data.id)).toEqual({
      identity: "Soy alguien que lee",
      cue: "Antes de dormir",
      startDate,
    });
    // Without them: none, and today.
    const plain = await createHabit({ name: "Meditar" });
    if (!plain.ok) throw new Error(plain.error);
    expect(await stored(plain.data.id)).toEqual({
      identity: null,
      cue: null,
      startDate: realToday(),
    });
  });

  test.each([
    ["8 days back", -8],
    ["tomorrow", 1],
  ])("a start date %s is refused on its field, nothing created", async (_, offset) => {
    const result = await createHabit({ name: "Leer", startDate: addDays(realToday(), offset) });
    expect(result).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { startDate: [DETAILS_ERRORS.startDateOutOfWindow] },
    });
    expect(await testDb.$count(habits)).toBe(0);
  });

  test("editing: identity and cue change or clear; missing keeps them; the start date stays", async () => {
    const id = await insertHabit({ identity: "Soy alguien que lee", cue: "Antes de dormir" });
    const base = { id, name: "Leer", lifeAreaId: null, frequency: "daily" };
    expect(await updateHabit(base)).toMatchObject({ ok: true });
    expect(await stored(id)).toEqual({
      identity: "Soy alguien que lee",
      cue: "Antes de dormir",
      startDate: "2026-09-01",
    });
    expect(
      await updateHabit({ ...base, identity: "", cue: "Al despertar", startDate: realToday() }),
    ).toMatchObject({
      ok: true,
      data: { identity: null, cue: "Al despertar" },
    });
    expect(await stored(id)).toEqual({
      identity: null,
      cue: "Al despertar",
      startDate: "2026-09-01",
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
  ])("with %s the reads redirect to /login and the writes are refused", async (_, headers) => {
    const id = await insertHabit();
    // Positive control: the owner reads them.
    expect((await getHabitsWeek(new Date())).rows).toHaveLength(1);
    expect(await getHabitDetail(id, "2026-09", TODAY)).not.toBeNull();
    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getHabitsWeek(new Date())).rejects.toMatchObject(redirect);
    // Another month (not cached for this request): the check runs again.
    await expect(getHabitDetail(id, "2026-08", TODAY)).rejects.toMatchObject(redirect);
    await expect(getDeletedHabit(id)).rejects.toMatchObject(redirect);
    expect(await createHabit({ name: "Intruso", identity: "x" })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect(
      await updateHabit({ id, name: "Leer", lifeAreaId: null, frequency: "daily", identity: "x" }),
    ).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    expect(await testDb.select({ identity: habits.identity }).from(habits)).toEqual([
      { identity: null },
    ]);
  });
});

/** The week helpers this file relies on (a guard against a moved Monday). */
test("TODAY is a Friday of the week of MONDAY", () => {
  expect(weekStart(TODAY)).toBe(MONDAY);
});
