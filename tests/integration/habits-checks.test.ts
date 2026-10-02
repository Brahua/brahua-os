// H1 of `habits`: the CHECKs, indexes and foreign keys of the three tables, with raw inserts
// (defense in depth behind Zod: scripts, raw SQL or a bug can't store an invalid habit).
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { testDb } from "./test-db";

let habitId: string;

const BASE = {
  name: "Meditar",
  measure: "check",
  frequency: "daily",
  startDate: "2026-10-02",
  sortOrder: 0,
} as const;

beforeEach(async () => {
  const [habit] = await testDb.insert(habits).values(BASE).returning();
  habitId = habit.id;
});

/** The constraint a raw statement breaks (Postgres error code and constraint name), or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

const habit = (values: Record<string, unknown>) => () =>
  testDb.insert(habits).values({ ...BASE, ...values } as typeof habits.$inferInsert);
const log = (values: Partial<typeof habitLogs.$inferInsert>) => () =>
  testDb
    .insert(habitLogs)
    .values({ habitId, day: "2026-10-02", quantity: 1, target: 1, ...values });
const pause = (values: Partial<typeof habitPauses.$inferInsert>) => () =>
  testDb
    .insert(habitPauses)
    .values({ habitId, startDate: "2026-10-10", endDate: "2026-10-20", ...values });

const check = (constraint: string) => ({ code: "23514", constraint });

describe("habits CHECKs", () => {
  test("valid habits of every measure and frequency pass", async () => {
    expect(await violation(habit({}))).toBeNull();
    expect(
      await violation(habit({ measure: "quantity", goal: 8, unit: "vasos", step: 2 })),
    ).toBeNull();
    expect(await violation(habit({ frequency: "weekly_count", weeklyTarget: 3 }))).toBeNull();
    expect(await violation(habit({ frequency: "weekdays", weekdays: [1, 3, 5] }))).toBeNull();
    expect(await violation(habit({ kind: "avoid" }))).toBeNull();
    expect(
      await violation(habit({ identity: "Soy alguien que medita", cue: "Al despertar" })),
    ).toBeNull();
  });

  test("lengths: name 1–80, identity ≤ 120, cue ≤ 60, unit 1–20", async () => {
    expect(await violation(habit({ name: "" }))).toEqual(check("habits_name_length_check"));
    expect(await violation(habit({ name: "a".repeat(81) }))).toEqual(
      check("habits_name_length_check"),
    );
    expect(await violation(habit({ name: "a".repeat(80) }))).toBeNull();
    expect(await violation(habit({ identity: "a".repeat(121) }))).toEqual(
      check("habits_identity_length_check"),
    );
    expect(await violation(habit({ identity: "" }))).toEqual(check("habits_identity_length_check"));
    expect(await violation(habit({ cue: "a".repeat(61) }))).toEqual(
      check("habits_cue_length_check"),
    );
    expect(await violation(habit({ measure: "quantity", goal: 8, unit: "a".repeat(21) }))).toEqual(
      check("habits_unit_length_check"),
    );
    expect(await violation(habit({ measure: "quantity", goal: 8, unit: "" }))).toEqual(
      check("habits_unit_length_check"),
    );
  });

  test("kind, measure and frequency are known values", async () => {
    expect(await violation(habit({ kind: "quit" }))).toEqual(check("habits_kind_check"));
    expect(await violation(habit({ measure: "time" }))).toEqual(check("habits_measure_check"));
    expect(await violation(habit({ frequency: "monthly" }))).toEqual(
      check("habits_frequency_check"),
    );
  });

  test("a habit to avoid is a daily yes/no", async () => {
    expect(
      await violation(habit({ kind: "avoid", measure: "quantity", goal: 2, unit: "cafés" })),
    ).toEqual(check("habits_avoid_check"));
    expect(
      await violation(habit({ kind: "avoid", frequency: "weekly_count", weeklyTarget: 3 })),
    ).toEqual(check("habits_avoid_check"));
  });

  test("check: goal 1, step 1, no unit; quantity: a unit, goal 1–10 000, step 1–goal", async () => {
    const rule = check("habits_measure_rule_check");
    expect(await violation(habit({ goal: 2 }))).toEqual(rule);
    expect(await violation(habit({ step: 2 }))).toEqual(rule);
    expect(await violation(habit({ unit: "veces" }))).toEqual(rule);
    // A missing unit is NULL, not false: the coalesce makes it fail.
    expect(await violation(habit({ measure: "quantity", goal: 8 }))).toEqual(rule);
    expect(await violation(habit({ measure: "quantity", goal: 0, unit: "min" }))).toEqual(rule);
    expect(await violation(habit({ measure: "quantity", goal: 10_001, unit: "min" }))).toEqual(
      rule,
    );
    expect(await violation(habit({ measure: "quantity", goal: 10_000, unit: "min" }))).toBeNull();
    expect(await violation(habit({ measure: "quantity", goal: 8, unit: "min", step: 9 }))).toEqual(
      rule,
    );
    expect(await violation(habit({ measure: "quantity", goal: 8, unit: "min", step: 0 }))).toEqual(
      rule,
    );
    expect(
      await violation(habit({ measure: "quantity", goal: 8, unit: "min", step: 8 })),
    ).toBeNull();
  });

  test("each frequency with exactly its own field", async () => {
    const rule = check("habits_frequency_rule_check");
    expect(await violation(habit({ weeklyTarget: 3 }))).toEqual(rule);
    expect(await violation(habit({ weekdays: [1] }))).toEqual(rule);
    // weekly_count without X (NULL) fails thanks to the coalesce.
    expect(await violation(habit({ frequency: "weekly_count" }))).toEqual(rule);
    expect(await violation(habit({ frequency: "weekly_count", weeklyTarget: 0 }))).toEqual(rule);
    expect(await violation(habit({ frequency: "weekly_count", weeklyTarget: 7 }))).toEqual(rule);
    expect(
      await violation(habit({ frequency: "weekly_count", weeklyTarget: 3, weekdays: [1] })),
    ).toEqual(rule);
    expect(await violation(habit({ frequency: "weekly_count", weeklyTarget: 6 }))).toBeNull();
  });

  test("weekdays: 1–6 ISO days, strictly ascending, one dimension, no nulls", async () => {
    const rule = check("habits_frequency_rule_check");
    const days = (weekdays: number[] | null) => habit({ frequency: "weekdays", weekdays });
    expect(await violation(days(null))).toEqual(rule);
    expect(await violation(days([]))).toEqual(rule);
    expect(await violation(days([1, 2, 3, 4, 5, 6, 7]))).toEqual(rule);
    expect(await violation(days([2, 3, 4, 5, 6, 7]))).toBeNull();
    expect(await violation(days([0, 1]))).toEqual(rule);
    expect(await violation(days([1, 8]))).toEqual(rule);
    expect(await violation(days([3, 1]))).toEqual(rule);
    expect(await violation(days([1, 1]))).toEqual(rule);
    expect(await violation(days([1, 2, 3, 4, 6, 5]))).toEqual(rule);
    // Raw arrays Drizzle can't build: with a null, two dimensions, or not indexed from 1.
    const raw = (array: string) => () =>
      testDb.execute(
        sql.raw(`insert into habits (name, measure, frequency, weekdays, start_date, sort_order)
                 values ('x', 'check', 'weekdays', ${array}, '2026-10-02', 0)`),
      );
    expect(await violation(raw("array[1, null]::int[]"))).toEqual(rule);
    expect(await violation(raw("'{{1,2},{3,4}}'::int[]"))).toEqual(rule);
    expect(await violation(raw("'[0:1]={1,2}'::int[]"))).toEqual(rule);
    expect(await violation(raw("array[1, 3]::int[]"))).toBeNull();
  });

  test("an area must exist, and an area with habits can't be removed (restrict)", async () => {
    expect(
      await violation(habit({ lifeAreaId: "00000000-0000-4000-8000-000000000000" })),
    ).toMatchObject({ code: "23503" });
    await seed(testDb);
    const [area] = await testDb
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, "health"));
    await testDb.insert(habits).values({ ...BASE, lifeAreaId: area.id });
    expect(
      await violation(() => testDb.delete(lifeAreas).where(eq(lifeAreas.id, area.id))),
    ).toMatchObject({ code: "23001" });
  });
});

describe("habit_logs", () => {
  test("one row per habit and day; quantity 0–99 999, target ≥ 1", async () => {
    expect(await violation(log({}))).toBeNull();
    expect(await violation(log({}))).toMatchObject({
      code: "23505",
      constraint: "habit_logs_habit_id_day_pk",
    });
    expect(await violation(log({ day: "2026-10-01", quantity: 0 }))).toBeNull();
    expect(await violation(log({ day: "2026-09-30", quantity: -1 }))).toEqual(
      check("habit_logs_quantity_check"),
    );
    expect(await violation(log({ day: "2026-09-30", quantity: 100_000 }))).toEqual(
      check("habit_logs_quantity_check"),
    );
    expect(await violation(log({ day: "2026-09-30", quantity: 99_999, target: 8 }))).toBeNull();
    expect(await violation(log({ day: "2026-09-29", target: 0 }))).toEqual(
      check("habit_logs_target_check"),
    );
  });

  test("a log needs its habit, and a habit with logs can't be removed (restrict)", async () => {
    expect(await violation(log({ habitId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject(
      { code: "23503" },
    );
    await log({})();
    expect(
      await violation(() => testDb.delete(habits).where(eq(habits.id, habitId))),
    ).toMatchObject({ code: "23001" });
    // Positive control: a habit without logs or pauses can be removed (only raw SQL does).
    const [other] = await testDb.insert(habits).values(BASE).returning();
    expect(await violation(() => testDb.delete(habits).where(eq(habits.id, other.id)))).toBeNull();
  });
});

describe("habit_pauses", () => {
  test("from start to end (both included), at most 90 days; a reason ≤ 60", async () => {
    expect(await violation(pause({}))).toBeNull();
    expect(await violation(pause({ endDate: "2026-10-10" }))).toBeNull();
    expect(await violation(pause({ endDate: "2026-10-09" }))).toEqual(
      check("habit_pauses_dates_check"),
    );
    // 2026-10-10 + 89 = 2027-01-07 is the 90th day.
    expect(await violation(pause({ endDate: "2027-01-07" }))).toBeNull();
    expect(await violation(pause({ endDate: "2027-01-08" }))).toEqual(
      check("habit_pauses_dates_check"),
    );
    expect(await violation(pause({ reason: "Viaje" }))).toBeNull();
    expect(await violation(pause({ reason: "" }))).toEqual(
      check("habit_pauses_reason_length_check"),
    );
    expect(await violation(pause({ reason: "a".repeat(61) }))).toEqual(
      check("habit_pauses_reason_length_check"),
    );
  });

  test("a pause needs its habit, and a habit with pauses can't be removed (restrict)", async () => {
    expect(
      await violation(pause({ habitId: "00000000-0000-4000-8000-000000000000" })),
    ).toMatchObject({ code: "23503" });
    await pause({})();
    expect(
      await violation(() => testDb.delete(habits).where(eq(habits.id, habitId))),
    ).toMatchObject({ code: "23001" });
  });

  test("the indexes of the spec exist (partial, as written)", async () => {
    const result = await testDb.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where tablename in ('habits', 'habit_logs', 'habit_pauses') order by indexname`,
    );
    const defs = Object.fromEntries(result.rows.map((row) => [row.indexname, row.indexdef]));
    expect(defs.habits_sort_order_idx).toMatch(
      /\(sort_order\) WHERE \(\(deleted_at IS NULL\) AND \(archived_at IS NULL\)\)/,
    );
    expect(defs.habit_pauses_habit_start_idx).toMatch(
      /\(habit_id, start_date\) WHERE \(deleted_at IS NULL\)/,
    );
    expect(defs.habit_logs_habit_id_day_pk).toMatch(/\(habit_id, day\)/);
  });
});
