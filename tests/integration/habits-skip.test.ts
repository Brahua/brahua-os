// "Saltar hoy" (polish) of `habits` against the throwaway database: a one-day pause "Descanso"
// for today (Lima), idempotent, no overlaps (with positive controls), its exact "Deshacer" (it
// never overwrites a pause the owner extended), refusals (archived, deleted, to avoid), the
// streak kept, a fixed number of queries and authorization.
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import { selectHabitsDueToday } from "@/modules/habits/contracts";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { HABIT_ERRORS } from "@/modules/habits/habit-input";
import { selectActiveHabits } from "@/modules/habits/habits";
import { pauseHabit } from "@/modules/habits/pause-actions";
import { addDays } from "@/modules/habits/schedule";
import { skipHabitToday, undoSkipHabit } from "@/modules/habits/skip-actions";
import { skipHabitDay } from "@/modules/habits/skip";
import { SKIP_COPY } from "@/modules/habits/skip-copy";
import {
  currentStreak,
  type DayLog,
  type PauseRange,
  type StreakHistory,
} from "@/modules/habits/streak";
import { PAUSE_ERRORS } from "@/modules/habits/pause-copy";
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
/** The actions use Lima's today by the real clock: so do the tests. */
const today = () => ownerDateKey(new Date());
const day = (offset: number) => addDays(today(), offset);

let order = 0;
async function insertHabit(values: Partial<typeof habits.$inferInsert> = {}, startedDaysAgo = 30) {
  const [row] = await testDb
    .insert(habits)
    .values({
      name: "Gimnasio",
      measure: "check",
      frequency: "daily",
      startDate: day(-startedDaysAgo),
      sortOrder: order++,
      ...values,
    })
    .returning({ id: habits.id });
  return row.id;
}

const mark = (habitId: string, days: string[], quantity = 1, target = 1) =>
  testDb.insert(habitLogs).values(days.map((d) => ({ habitId, day: d, quantity, target })));

async function pausesOf(habitId: string) {
  return testDb
    .select({
      id: habitPauses.id,
      startDate: habitPauses.startDate,
      endDate: habitPauses.endDate,
      reason: habitPauses.reason,
      deleted: habitPauses.deletedAt,
    })
    .from(habitPauses)
    .where(eq(habitPauses.habitId, habitId))
    .orderBy(habitPauses.startDate);
}

const livePauses = async (habitId: string) =>
  (await pausesOf(habitId)).filter((pause) => pause.deleted === null);

/** The streak with the pure rules of streak.ts, over the logs and live pauses in the database. */
async function streakOf(habitId: string, onDay: string) {
  const [habit] = await testDb.select().from(habits).where(eq(habits.id, habitId));
  const logs = await testDb.select().from(habitLogs).where(eq(habitLogs.habitId, habitId));
  const pauses: PauseRange[] = await livePauses(habitId);
  const history: StreakHistory = {
    logs: new Map<string, DayLog>(
      logs.map((log) => [log.day, { quantity: log.quantity, target: log.target }]),
    ),
    pauses,
  };
  return currentStreak(habit, history, onDay);
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
  order = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skipHabitToday", () => {
  test("creates a one-day pause today with the reason Descanso and the habit shows it", async () => {
    const id = await insertHabit();
    const result = await skipHabitToday({ id });
    expect(result).toMatchObject({
      ok: true,
      data: {
        changed: true,
        pause: { startDate: today(), endDate: today(), reason: "Descanso" },
        habit: { id, pause: { startDate: today(), endDate: today(), reason: "Descanso" } },
      },
    });
    expect(await livePauses(id)).toEqual([
      expect.objectContaining({ startDate: today(), endDate: today(), reason: "Descanso" }),
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/habits", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  test("is idempotent: the second call creates nothing and answers the same pause", async () => {
    const id = await insertHabit();
    const first = await skipHabitToday({ id });
    const second = await skipHabitToday({ id });
    if (!first.ok || !second.ok) throw new Error("skip failed");
    expect(first.data.changed).toBe(true);
    expect(second.data.changed).toBe(false);
    expect(second.data.pause.id).toBe(first.data.pause.id);
    expect(await pausesOf(id)).toHaveLength(1);
  });

  test("two at the same time (the habit's lock): one pause, one `changed`", async () => {
    const id = await insertHabit();
    const results = await Promise.all([skipHabitToday({ id }), skipHabitToday({ id })]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.flatMap((result) => (result.ok ? [result.data.changed] : [])).sort()).toEqual([
      false,
      true,
    ]);
    expect(await pausesOf(id)).toHaveLength(1);
  });

  test("no overlap: a pause that covers today is respected (even a longer one)", async () => {
    const id = await insertHabit();
    const trip = await pauseHabit({ id, startDate: day(-2), endDate: day(3), reason: "Viaje" });
    if (!trip.ok) throw new Error("pause failed");
    const result = await skipHabitToday({ id });
    expect(result).toMatchObject({
      ok: true,
      data: { changed: false, pause: { id: trip.data.pause.id, reason: "Viaje" } },
    });
    expect(await livePauses(id)).toHaveLength(1);
  });

  test("positive controls: pauses that end yesterday, start tomorrow or were removed don't block", async () => {
    const before = await insertHabit({ name: "A" });
    await pauseHabit({ id: before, startDate: day(-4), endDate: day(-1) });
    const after = await insertHabit({ name: "B" });
    await pauseHabit({ id: after, startDate: day(1), endDate: day(5) });
    const removed = await insertHabit({ name: "C" });
    const old = await pauseHabit({ id: removed, startDate: day(-1), endDate: day(2) });
    if (!old.ok) throw new Error("pause failed");
    await testDb
      .update(habitPauses)
      .set({ deletedAt: new Date() })
      .where(eq(habitPauses.id, old.data.pause.id));
    for (const id of [before, after, removed]) {
      expect(await skipHabitToday({ id })).toMatchObject({ ok: true, data: { changed: true } });
    }
    expect(await livePauses(before)).toHaveLength(2);
    expect(await livePauses(after)).toHaveLength(2);
    expect(await livePauses(removed)).toHaveLength(1);
  });

  test("Lima's day, midnight included: 23:59:59 skips Friday, 00:00 skips Saturday", async () => {
    const id = await insertHabit({ startDate: "2026-09-01" });
    const lastSecond = new Date("2026-10-10T04:59:59Z"); // Fri 2026-10-09 23:59:59 in Lima
    const midnight = new Date("2026-10-10T05:00:00Z");
    const friday = ownerDateKey(lastSecond);
    const saturday = ownerDateKey(midnight);
    expect([friday, saturday]).toEqual(["2026-10-09", "2026-10-10"]);
    // Both days are inside the window of "today" being the real clock? Use the data function
    // with the Lima day each instant gives.
    expect(await skipHabitDay(testDb, { id }, friday)).toMatchObject({
      changed: true,
      pause: { startDate: "2026-10-09", endDate: "2026-10-09" },
    });
    expect(await skipHabitDay(testDb, { id }, saturday)).toMatchObject({
      changed: true,
      pause: { startDate: "2026-10-10", endDate: "2026-10-10" },
    });
    expect((await livePauses(id)).map((pause) => pause.startDate)).toEqual([
      "2026-10-09",
      "2026-10-10",
    ]);
  });

  test("refuses archived, deleted, missing and habits to avoid; nothing is stored", async () => {
    const archived = await insertHabit({ name: "Arch", archivedAt: new Date() });
    const deleted = await insertHabit({ name: "Del", deletedAt: new Date() });
    const avoid = await insertHabit({ name: "No fumar", kind: "avoid" });
    expect(await skipHabitToday({ id: archived })).toEqual({
      ok: false,
      error: HABIT_ERRORS.archived,
    });
    for (const id of [deleted, MISSING]) {
      expect(await skipHabitToday({ id })).toEqual({ ok: false, error: HABIT_ERRORS.notFound });
    }
    expect(await skipHabitToday({ id: avoid })).toEqual({
      ok: false,
      error: SKIP_COPY.avoidRefused,
    });
    expect(await skipHabitToday({ id: "not-a-uuid" })).toMatchObject({ ok: false });
    expect(await testDb.$count(habitPauses)).toBe(0);
    // Positive control: a habit to keep goes in.
    const keep = await insertHabit({ name: "Leer" });
    expect(await skipHabitToday({ id: keep })).toMatchObject({ ok: true });
  });

  test("a habit that starts tomorrow can't rest today", async () => {
    const id = await insertHabit({ startDate: day(1) });
    expect(await skipHabitToday({ id })).toMatchObject({ ok: false });
    expect(await testDb.$count(habitPauses)).toBe(0);
  });
});

describe("undoSkipHabit", () => {
  async function skipped(habitId?: string) {
    const id = habitId ?? (await insertHabit());
    const result = await skipHabitToday({ id });
    if (!result.ok) throw new Error("skip failed");
    return { id, pauseId: result.data.pause.id };
  }

  test("removes (soft) exactly that pause and the habit comes back", async () => {
    const { id, pauseId } = await skipped();
    // Another pause of the same habit, later: it stays.
    await pauseHabit({ id, startDate: day(2), endDate: day(4), reason: "Viaje" });
    expect(await undoSkipHabit({ id, pauseId })).toMatchObject({
      ok: true,
      data: { removed: true, habit: { id, pause: { startDate: day(2) } } },
    });
    const live = await livePauses(id);
    expect(live.map((pause) => pause.reason)).toEqual(["Viaje"]);
    // Soft: the row stays for the export.
    expect(await pausesOf(id)).toHaveLength(2);
  });

  test("a pause the owner extended is left as they made it", async () => {
    const { id, pauseId } = await skipped();
    await testDb
      .update(habitPauses)
      .set({ endDate: day(3) })
      .where(eq(habitPauses.id, pauseId));
    expect(await undoSkipHabit({ id, pauseId })).toMatchObject({
      ok: true,
      data: { removed: false, habit: { pause: { endDate: day(3) } } },
    });
    expect(await livePauses(id)).toEqual([expect.objectContaining({ id: pauseId })]);
  });

  test("a pause whose reason was edited is left too; positive control: untouched is removed", async () => {
    const edited = await skipped();
    await testDb
      .update(habitPauses)
      .set({ reason: "Viaje" })
      .where(eq(habitPauses.id, edited.pauseId));
    expect(await undoSkipHabit(edited)).toMatchObject({ ok: true, data: { removed: false } });
    expect(await livePauses(edited.id)).toHaveLength(1);

    const plain = await skipped(await insertHabit({ name: "Otro" }));
    expect(await undoSkipHabit(plain)).toMatchObject({ ok: true, data: { removed: true } });
    expect(await livePauses(plain.id)).toEqual([]);
  });

  test("twice, or after the pause was removed another way: idempotent, nothing else changes", async () => {
    const { id, pauseId } = await skipped();
    expect(await undoSkipHabit({ id, pauseId })).toMatchObject({
      ok: true,
      data: { removed: true },
    });
    expect(await undoSkipHabit({ id, pauseId })).toMatchObject({
      ok: true,
      data: { removed: false },
    });
    expect(await pausesOf(id)).toHaveLength(1);
  });

  test("another habit's pause id never touches it", async () => {
    const mine = await skipped();
    const other = await skipped(await insertHabit({ name: "Otro" }));
    expect(await undoSkipHabit({ id: mine.id, pauseId: other.pauseId })).toMatchObject({
      ok: true,
      data: { removed: false },
    });
    expect(await livePauses(other.id)).toHaveLength(1);
    expect(await livePauses(mine.id)).toHaveLength(1);
  });

  test("archived, deleted, malformed ids are refused", async () => {
    const { id, pauseId } = await skipped();
    await testDb.update(habits).set({ archivedAt: new Date() }).where(eq(habits.id, id));
    expect(await undoSkipHabit({ id, pauseId })).toEqual({
      ok: false,
      error: HABIT_ERRORS.archived,
    });
    await testDb.update(habits).set({ deletedAt: new Date() }).where(eq(habits.id, id));
    expect(await undoSkipHabit({ id, pauseId })).toEqual({
      ok: false,
      error: HABIT_ERRORS.notFound,
    });
    expect(await undoSkipHabit({ id, pauseId: "x" })).toEqual({
      ok: false,
      error: expect.any(String),
      fieldErrors: expect.anything(),
    });
    expect(PAUSE_ERRORS.notFound).toBeTruthy();
  });
});

describe("the streak and today's log", () => {
  test("yesterday's streak is kept: the rested day is neutral, done or not", async () => {
    const id = await insertHabit();
    await mark(id, [day(-3), day(-2), day(-1)]);
    expect(await streakOf(id, today())).toEqual({ count: 3, unit: "days" });
    await skipHabitToday({ id });
    expect(await streakOf(id, today())).toEqual({ count: 3, unit: "days" });
    // Control: without the rest, an open day today still doesn't break it, and the day after
    // tomorrow (another open day, no rest) does.
    expect(await streakOf(id, day(2))).toEqual({ count: 0, unit: "days" });
  });

  test("a day already logged done today stays neutral under the rest, and comes back on undo", async () => {
    const id = await insertHabit();
    await mark(id, [day(-2), day(-1), today()]);
    expect(await streakOf(id, today())).toEqual({ count: 3, unit: "days" });
    const result = await skipHabitToday({ id });
    if (!result.ok) throw new Error("skip failed");
    // The log is kept in the database, but the rested day doesn't count.
    expect(
      await testDb.$count(habitLogs, and(eq(habitLogs.habitId, id), eq(habitLogs.day, today()))),
    ).toBe(1);
    expect(await streakOf(id, today())).toEqual({ count: 2, unit: "days" });
    await undoSkipHabit({ id, pauseId: result.data.pause.id });
    expect(await streakOf(id, today())).toEqual({ count: 3, unit: "days" });
  });
});

describe("reads", () => {
  test("a rested habit leaves getHabitsDueToday; the read keeps its fixed number of queries", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) ids.push(await insertHabit({ name: `h${index}` }));
    await skipHabitToday({ id: ids[1] });
    await skipHabitToday({ id: ids[4] });
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const due = await selectHabitsDueToday(testDb, new Date());
    expect(due.map((item) => item.id)).toEqual([ids[0], ids[2], ids[3], ids[5]]);
    expect(select).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
    // The habit's own item (Hábitos) does show it, with its pause.
    const items = await selectActiveHabits(testDb, today());
    expect(items.find((item) => item.id === ids[1])?.pause).toMatchObject({
      startDate: today(),
      endDate: today(),
      reason: "Descanso",
    });
    expect(await testDb.$count(habitPauses, isNull(habitPauses.deletedAt))).toBe(2);
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
    const id = await insertHabit();
    const result = await skipHabitToday({ id });
    if (!result.ok) throw new Error("skip failed");
    const before = await pausesOf(id);
    const other = await insertHabit({ name: "Otro" });
    request.headers = await headers();
    expect(await skipHabitToday({ id: other })).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    expect(await undoSkipHabit({ id, pauseId: result.data.pause.id })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect(await pausesOf(id)).toEqual(before);
    expect(await livePauses(other)).toEqual([]);
    // Positive control: the owner's session works again.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect(await skipHabitToday({ id: other })).toMatchObject({ ok: true });
  });
});
