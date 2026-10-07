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
import { pauseHabit, resumeHabit } from "@/modules/habits/pause-actions";
import { addDays, isoWeekday } from "@/modules/habits/schedule";
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
      data: { removed: false, reason: "changed", habit: { pause: { endDate: day(3) } } },
    });
    expect(await livePauses(id)).toEqual([expect.objectContaining({ id: pauseId })]);
  });

  test("a pause whose reason was edited is left too; positive control: untouched is removed", async () => {
    const edited = await skipped();
    await testDb
      .update(habitPauses)
      .set({ reason: "Viaje" })
      .where(eq(habitPauses.id, edited.pauseId));
    expect(await undoSkipHabit(edited)).toMatchObject({
      ok: true,
      data: { removed: false, reason: "changed" },
    });
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
      data: { removed: false, reason: "gone" },
    });
    expect(await pausesOf(id)).toHaveLength(1);
  });

  test("another habit's pause id never touches it", async () => {
    const mine = await skipped();
    const other = await skipped(await insertHabit({ name: "Otro" }));
    expect(await undoSkipHabit({ id: mine.id, pauseId: other.pauseId })).toMatchObject({
      ok: true,
      data: { removed: false, reason: "gone" },
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

describe("the streak across a rested day (the rest must change the answer)", () => {
  test("done day -2, -1 and +1 with today rested: 3 on day +1; without the rest only 1", async () => {
    const id = await insertHabit();
    await mark(id, [day(-2), day(-1), day(1)]);
    // Positive control: the open day today breaks it, so day +1 counts alone.
    expect(await streakOf(id, day(1))).toEqual({ count: 1, unit: "days" });
    expect(await skipHabitToday({ id })).toMatchObject({ ok: true });
    expect(await streakOf(id, day(1))).toEqual({ count: 3, unit: "days" });
  });

  test("a partial quantity (3 of 8) stays stored, the streak doesn't move and Deshacer gives it back", async () => {
    const id = await insertHabit({ measure: "quantity", goal: 8, unit: "vasos" });
    await mark(id, [day(-1)], 8, 8);
    await mark(id, [today()], 3, 8);
    const before = await streakOf(id, today());
    const skipped = await skipHabitToday({ id });
    if (!skipped.ok) throw new Error("skip failed");
    expect(
      await testDb
        .select({ quantity: habitLogs.quantity })
        .from(habitLogs)
        .where(and(eq(habitLogs.habitId, id), eq(habitLogs.day, today()))),
    ).toEqual([{ quantity: 3 }]);
    expect(await streakOf(id, today())).toEqual(before);
    await undoSkipHabit({ id, pauseId: skipped.data.pause.id });
    const item = (await selectActiveHabits(testDb, today())).find((entry) => entry.id === id);
    expect(item).toMatchObject({ quantity: 3, target: 8, pause: null });
    expect(await streakOf(id, today())).toEqual(before);
  });

  test("an 'X por semana' habit resting a day loses that available day, nothing done", async () => {
    const id = await insertHabit({ frequency: "weekly_count", weeklyTarget: 3 });
    const before = (await selectActiveHabits(testDb, today())).find((entry) => entry.id === id)!;
    expect(await skipHabitToday({ id })).toMatchObject({ ok: true, data: { changed: true } });
    const after = (await selectActiveHabits(testDb, today())).find((entry) => entry.id === id)!;
    expect(after.weekAvailable).toBe(before.weekAvailable - 1);
    expect(after.weekDoneBefore).toBe(before.weekDoneBefore);
  });
});

describe("which habits can rest today", () => {
  test("fixed days: only on a day it is due; 'X por semana' is due every day (also met)", async () => {
    const tomorrowOnly = await insertHabit({
      name: "Mañana",
      frequency: "weekdays",
      weekdays: [isoWeekday(day(1))],
    });
    expect(await skipHabitToday({ id: tomorrowOnly })).toEqual({
      ok: false,
      error: SKIP_COPY.notScheduled,
    });
    expect(await testDb.$count(habitPauses)).toBe(0);
    // Positive controls: due today, and weekly even with its week met.
    const todayOnly = await insertHabit({
      name: "Hoy",
      frequency: "weekdays",
      weekdays: [isoWeekday(today())],
    });
    expect(await skipHabitToday({ id: todayOnly })).toMatchObject({ ok: true });
    const weekly = await insertHabit({
      name: "Semanal",
      frequency: "weekly_count",
      weeklyTarget: 1,
    });
    await mark(weekly, [addDays(today(), 1 - isoWeekday(today()))]);
    expect(await skipHabitToday({ id: weekly })).toMatchObject({ ok: true });
  });

  test("a habit that started today can rest", async () => {
    const id = await insertHabit({}, 0);
    expect(await skipHabitToday({ id })).toMatchObject({ ok: true, data: { changed: true } });
  });
});

describe("skip and the other pause paths", () => {
  test("a manual pause that overlaps today's rest is refused: one live pause", async () => {
    const id = await insertHabit();
    await skipHabitToday({ id });
    expect(await pauseHabit({ id, startDate: today(), endDate: day(3) })).toMatchObject({
      ok: false,
      fieldErrors: { startDate: [PAUSE_ERRORS.overlap] },
    });
    expect(await livePauses(id)).toHaveLength(1);
    // Positive control: tomorrow onwards doesn't overlap.
    expect(await pauseHabit({ id, startDate: day(1), endDate: day(3) })).toMatchObject({
      ok: true,
    });
  });

  test("«Descanso» is reserved: the manual form refuses it in any spelling, other reasons go in", async () => {
    const id = await insertHabit();
    for (const reason of ["Descanso", "  descanso ", "DESCANSÓ"]) {
      expect(await pauseHabit({ id, startDate: day(1), endDate: day(2), reason })).toMatchObject({
        ok: false,
        fieldErrors: { reason: [PAUSE_ERRORS.reasonReserved] },
      });
    }
    expect(await testDb.$count(habitPauses)).toBe(0);
    expect(
      await pauseHabit({ id, startDate: day(1), endDate: day(2), reason: "Descanso largo" }),
    ).toMatchObject({ ok: true });
  });

  test("a stale Deshacer after the rest was resumed and a new pause made: it stays", async () => {
    const id = await insertHabit();
    const skipped = await skipHabitToday({ id });
    if (!skipped.ok) throw new Error("skip failed");
    await resumeHabit({ id, pauseId: skipped.data.pause.id });
    await pauseHabit({ id, startDate: today(), endDate: day(3), reason: "Viaje" });
    expect(await undoSkipHabit({ id, pauseId: skipped.data.pause.id })).toMatchObject({
      ok: true,
      data: { removed: false, reason: "gone", habit: { pause: { reason: "Viaje" } } },
    });
    expect((await livePauses(id)).map((pause) => pause.reason)).toEqual(["Viaje"]);
  });

  test("skip and Reanudar at the same time end coherent: 0 or 1 live pauses, no errors", async () => {
    const id = await insertHabit();
    const first = await skipHabitToday({ id });
    if (!first.ok) throw new Error("skip failed");
    const results = await Promise.all([
      skipHabitToday({ id }),
      resumeHabit({ id, pauseId: first.data.pause.id }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect((await livePauses(id)).length).toBeLessThanOrEqual(1);
  });
});

describe("the window of Deshacer (7 days back)", () => {
  async function rested(offset: number) {
    const id = await insertHabit({ name: `h${offset}`, startDate: day(-30) });
    const [row] = await testDb
      .insert(habitPauses)
      .values({ habitId: id, startDate: day(offset), endDate: day(offset), reason: "Descanso" })
      .returning({ id: habitPauses.id });
    return { id, pauseId: row.id };
  }

  test("yesterday's and the edge day (-7) can be undone; 8 days ago is too old", async () => {
    for (const offset of [-1, -7]) {
      const target = await rested(offset);
      expect(await undoSkipHabit(target), String(offset)).toMatchObject({
        ok: true,
        data: { removed: true },
      });
      expect(await livePauses(target.id)).toEqual([]);
    }
    const old = await rested(-8);
    expect(await undoSkipHabit(old)).toMatchObject({
      ok: true,
      data: { removed: false, reason: "old" },
    });
    expect(await livePauses(old.id)).toHaveLength(1);
  });
});

describe("Lima's midnight through the action (the real clock's day)", () => {
  test("04:59:59Z rests Friday, 05:00:00Z rests Saturday", async () => {
    const id = await insertHabit({ startDate: "2026-09-01" });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-10T04:59:59Z"));
      expect(await skipHabitToday({ id })).toMatchObject({
        ok: true,
        data: { pause: { startDate: "2026-10-09" }, changed: true },
      });
      vi.setSystemTime(new Date("2026-10-10T05:00:00Z"));
      expect(await skipHabitToday({ id })).toMatchObject({
        ok: true,
        data: { pause: { startDate: "2026-10-10" }, changed: true },
      });
    } finally {
      vi.useRealTimers();
    }
    expect((await livePauses(id)).map((pause) => pause.startDate)).toEqual([
      "2026-10-09",
      "2026-10-10",
    ]);
  });
});
