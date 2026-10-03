// H6 of `habits`: the summary for `today` (pure): which habits enter and in what order, the DTO,
// Lima's midnight and `done` for each kind and frequency; and the week summary for
// `weekly-review`.
import { describe, expect, test } from "vitest";
import type { HabitAreaSummary, HabitItem } from "@/modules/habits/habit-input";
import {
  buildHabitsTodaySummary,
  habitsDueToday,
  habitTodayItem,
} from "@/modules/habits/today-summary";
import { buildHabitsWeekSummary, type HabitWeekRow } from "@/modules/habits/week-summary";

/** Friday 2026-10-02, 10:00 in Lima. */
const NOW = new Date("2026-10-02T15:00:00Z");
const TODAY = "2026-10-02";
/** 23:59:59 in Lima on Friday (already Saturday in UTC) and Lima's midnight a second later. */
const LIMA_LAST_SECOND = new Date("2026-10-03T04:59:59Z");
const LIMA_MIDNIGHT = new Date("2026-10-03T05:00:00Z");
const FRIDAY = 5;
const SATURDAY = 6;

const HEALTH: HabitAreaSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "health",
  name: "Salud",
  icon: "heart-pulse",
  color: "health",
};

let serial = 0;
function habit(values: Partial<HabitItem> = {}): HabitItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    name: `Hábito ${serial}`,
    kind: "build",
    measure: "check",
    goal: 1,
    unit: null,
    step: 1,
    frequency: "daily",
    weeklyTarget: null,
    weekdays: null,
    startDate: "2026-09-01",
    area: null,
    quantity: 0,
    target: 1,
    hasLogs: false,
    weekDoneBefore: 0,
    weekAvailable: 7,
    streak: { unit: "days", done: 0, notDone: 0 },
    pause: null,
    recentLogs: [],
    recentPaused: [],
    identity: null,
    cue: null,
    ...values,
  };
}

const names = (items: { name: string }[]) => items.map((item) => item.name);

describe("which habits enter, in what order", () => {
  test("daily, weekly (met or not), fixed days that include today and avoid; in the order given", () => {
    const list = [
      habit({ name: "diario" }),
      habit({ name: "otro día", frequency: "weekdays", weekdays: [1, 3] }),
      habit({ name: "semanal", frequency: "weekly_count", weeklyTarget: 3 }),
      habit({ name: "viernes", frequency: "weekdays", weekdays: [FRIDAY] }),
      habit({
        name: "semana cumplida",
        frequency: "weekly_count",
        weeklyTarget: 2,
        weekDoneBefore: 2,
      }),
      habit({ name: "a evitar", kind: "avoid" }),
    ];
    expect(names(buildHabitsTodaySummary(list, NOW))).toEqual([
      "diario",
      "semanal",
      "viernes",
      "semana cumplida",
      "a evitar",
    ]);
    // The order is the one given (the manual one), not alphabetical or by state.
    expect(names(buildHabitsTodaySummary([...list].reverse(), NOW))).toEqual([
      "a evitar",
      "semana cumplida",
      "viernes",
      "semanal",
      "diario",
    ]);
  });

  test("not before its start date (positive control: from that day on)", () => {
    const list = [habit({ name: "mañana", startDate: "2026-10-03" })];
    expect(buildHabitsTodaySummary(list, NOW)).toEqual([]);
    expect(names(buildHabitsTodaySummary(list, LIMA_MIDNIGHT))).toEqual(["mañana"]);
  });

  test("not while paused today; a pause that starts later or ended doesn't hide it", () => {
    const pause = (startDate: string, endDate: string) => ({
      id: "p",
      startDate,
      endDate,
      reason: null,
    });
    const list = [
      habit({ name: "en pausa", pause: pause("2026-10-01", "2026-10-05") }),
      habit({ name: "pausa desde hoy", pause: pause(TODAY, TODAY) }),
      habit({ name: "pausa mañana", pause: pause("2026-10-03", "2026-10-09") }),
      habit({ name: "pausa terminada", pause: pause("2026-09-20", "2026-10-01") }),
    ];
    expect(names(buildHabitsTodaySummary(list, NOW))).toEqual(["pausa mañana", "pausa terminada"]);
    // The pads' list (`getHabitsDueToday`) has the same habits, as full items.
    expect(habitsDueToday(list, NOW)).toEqual([list[2], list[3]]);
  });

  test("Lima's day: at 23:59:59 it is still Friday; at 00:00 it is Saturday", () => {
    const list = [
      habit({ name: "viernes", frequency: "weekdays", weekdays: [FRIDAY] }),
      habit({ name: "sábado", frequency: "weekdays", weekdays: [SATURDAY] }),
    ];
    expect(names(buildHabitsTodaySummary(list, LIMA_LAST_SECOND))).toEqual(["viernes"]);
    expect(names(buildHabitsTodaySummary(list, LIMA_MIDNIGHT))).toEqual(["sábado"]);
  });

  test("empty without habits", () => {
    expect(buildHabitsTodaySummary([], NOW)).toEqual([]);
  });
});

describe("the DTO", () => {
  test("only what `today` needs: the area as { id, name, color }, no rules or history", () => {
    const item = habit({
      name: "Agua",
      area: HEALTH,
      measure: "quantity",
      goal: 8,
      target: 8,
      unit: "vasos",
      step: 2,
      quantity: 4,
      streak: { unit: "days", done: 6, notDone: 5 },
      identity: "Me cuido",
      hasLogs: true,
    });
    expect(habitTodayItem(item)).toEqual({
      id: item.id,
      name: "Agua",
      area: { id: HEALTH.id, name: "Salud", color: "health" },
      kind: "build",
      measure: "quantity",
      goal: 8,
      unit: "vasos",
      step: 2,
      quantity: 4,
      done: false,
      week: null,
      streak: { count: 5, unit: "days" },
    });
  });

  test("without an area, area is null", () => {
    expect(habitTodayItem(habit()).area).toBeNull();
  });
});

describe("done, by kind and frequency", () => {
  test("yes/no: done with today's log", () => {
    expect(habitTodayItem(habit()).done).toBe(false);
    expect(habitTodayItem(habit({ quantity: 1 })).done).toBe(true);
  });

  test("quantity: done at today's target (its own, not the goal), also past it", () => {
    const water = { measure: "quantity", goal: 8, unit: "vasos" } as const;
    expect(habitTodayItem(habit({ ...water, target: 8, quantity: 7 })).done).toBe(false);
    expect(habitTodayItem(habit({ ...water, target: 8, quantity: 8 })).done).toBe(true);
    expect(habitTodayItem(habit({ ...water, target: 8, quantity: 10 })).done).toBe(true);
    // Goal raised today to 10, the day's target is the old 6: done.
    expect(habitTodayItem(habit({ ...water, goal: 10, target: 6, quantity: 6 })).done).toBe(true);
  });

  test("avoid: done while there is no relapse today", () => {
    expect(habitTodayItem(habit({ kind: "avoid" })).done).toBe(true);
    expect(habitTodayItem(habit({ kind: "avoid", quantity: 1 })).done).toBe(false);
  });

  test("X por semana: done today, or once the week is met; the week counts today when done", () => {
    const weekly = { frequency: "weekly_count", weeklyTarget: 3 } as const;
    const notYet = habitTodayItem(habit({ ...weekly, weekDoneBefore: 1 }));
    expect(notYet).toMatchObject({ done: false, week: { done: 1, quota: 3 } });
    const today = habitTodayItem(habit({ ...weekly, weekDoneBefore: 1, quantity: 1 }));
    expect(today).toMatchObject({ done: true, week: { done: 2, quota: 3 } });
    const met = habitTodayItem(habit({ ...weekly, weekDoneBefore: 3 }));
    expect(met).toMatchObject({ done: true, week: { done: 3, quota: 3 } });
    // A proportional quota (a pause, a mid-week start): 3 × 4 / 7 → 2.
    const short = habitTodayItem(habit({ ...weekly, weekDoneBefore: 2, weekAvailable: 4 }));
    expect(short).toMatchObject({ done: true, week: { done: 2, quota: 2 } });
  });

  test("fixed days: done with today's log; no week", () => {
    const fixed: Partial<HabitItem> = { frequency: "weekdays", weekdays: [FRIDAY] };
    expect(habitTodayItem(habit({ ...fixed }))).toMatchObject({ done: false, week: null });
    expect(habitTodayItem(habit({ ...fixed, quantity: 1 }))).toMatchObject({ done: true });
  });
});

describe("the streak", () => {
  test("as the pad shows it: with today done, or not", () => {
    const streak = { unit: "days", done: 8, notDone: 7 } as const;
    expect(habitTodayItem(habit({ streak })).streak).toEqual({ count: 7, unit: "days" });
    expect(habitTodayItem(habit({ streak, quantity: 1 })).streak).toEqual({
      count: 8,
      unit: "days",
    });
  });

  test("weeks for X por semana; a relapse today takes an avoid habit's to 0", () => {
    const weekly = habit({
      frequency: "weekly_count",
      weeklyTarget: 2,
      streak: { unit: "weeks", done: 4, notDone: 3 },
    });
    expect(habitTodayItem(weekly).streak).toEqual({ count: 3, unit: "weeks" });
    const avoid = { kind: "avoid", streak: { unit: "days", done: 12, notDone: 0 } } as const;
    expect(habitTodayItem(habit(avoid)).streak).toEqual({ count: 12, unit: "days" });
    expect(habitTodayItem(habit({ ...avoid, quantity: 1 })).streak).toEqual({
      count: 0,
      unit: "days",
    });
  });
});

describe("buildHabitsWeekSummary (weekly-review)", () => {
  const row = (name: string, done: number, expected: number, area: HabitAreaSummary | null) =>
    ({
      id: `id-${name}`,
      name,
      kind: "build",
      measure: "check",
      unit: null,
      area,
      compliance: { done, expected },
      days: [],
    }) satisfies HabitWeekRow;

  test('each habit\'s compliance in order and the total ("18 de 24")', () => {
    const summary = buildHabitsWeekSummary("2026-09-28", [
      row("Leer", 5, 7, HEALTH),
      row("Correr", 2, 3, null),
      row("Agua", 11, 14, null),
    ]);
    expect(summary).toEqual({
      weekStart: "2026-09-28",
      habits: [
        {
          id: "id-Leer",
          name: "Leer",
          area: { id: HEALTH.id, name: "Salud", color: "health" },
          compliance: { done: 5, expected: 7 },
        },
        { id: "id-Correr", name: "Correr", area: null, compliance: { done: 2, expected: 3 } },
        { id: "id-Agua", name: "Agua", area: null, compliance: { done: 11, expected: 14 } },
      ],
      total: { done: 18, expected: 24 },
    });
  });

  test("an empty week is 0 de 0", () => {
    expect(buildHabitsWeekSummary("2026-09-28", [])).toEqual({
      weekStart: "2026-09-28",
      habits: [],
      total: { done: 0, expected: 0 },
    });
  });
});
