// W1 of `weekly-review`: «Días completos» (SPEC-weekly-review "Decisiones"), the pure rule over
// the habits' histories. The week of 2026-10-12 (Monday) to 2026-10-18 (Sunday).
import { describe, expect, test } from "vitest";
import { completeDaysOf, definesDay, type CompleteDaysHabit } from "@/modules/habits/complete-days";
import type { StreakRules } from "@/modules/habits/streak";

const MONDAY = "2026-10-12";
const DAYS = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
];

type Spec = {
  rules?: Partial<StreakRules>;
  /** Days with a log that meets the target (build) or a relapse (avoid). */
  done?: string[];
  pauses?: [string, string][];
  logs?: Record<string, { quantity: number; target: number }>;
};

function habit(spec: Spec = {}): CompleteDaysHabit {
  const rules: StreakRules = {
    kind: "build",
    frequency: "daily",
    weeklyTarget: null,
    weekdays: null,
    startDate: "2026-09-01",
    ...spec.rules,
  };
  const logs = new Map(Object.entries(spec.logs ?? {}));
  for (const day of spec.done ?? []) logs.set(day, { quantity: 1, target: 1 });
  return {
    rules,
    history: {
      logs,
      pauses: (spec.pauses ?? []).map(([startDate, endDate]) => ({ startDate, endDate })),
    },
  };
}

const complete = (result: ReturnType<typeof completeDaysOf>) =>
  result.days.filter((day) => day.complete).map((day) => day.day);

describe("a finished week", () => {
  const today = "2026-10-20";

  test("no habits: no complete days and nothing scheduled", () => {
    const result = completeDaysOf(MONDAY, [], today);
    expect(result.completeDays).toBe(0);
    expect(result.days).toHaveLength(7);
    expect(result.days.map((day) => day.day)).toEqual(DAYS);
    expect(result.days.every((day) => day.scheduled === 0 && !day.complete)).toBe(true);
  });

  test("one daily habit done on four days: four complete days", () => {
    const run = habit({ done: [DAYS[0], DAYS[1], DAYS[3], DAYS[6]] });
    const result = completeDaysOf(MONDAY, [run], today);
    expect(result.completeDays).toBe(4);
    expect(complete(result)).toEqual([DAYS[0], DAYS[1], DAYS[3], DAYS[6]]);
    expect(result.days[2]).toEqual({ day: DAYS[2], scheduled: 1, done: 0, complete: false });
  });

  test("a day needs EVERY habit of that day", () => {
    const a = habit({ done: DAYS });
    const b = habit({ done: [DAYS[0], DAYS[2], DAYS[4]] });
    const result = completeDaysOf(MONDAY, [a, b], today);
    expect(complete(result)).toEqual([DAYS[0], DAYS[2], DAYS[4]]);
    expect(result.days[1]).toMatchObject({ scheduled: 2, done: 1, complete: false });
  });

  test("a partial quantity does not complete the day", () => {
    const water = habit({
      rules: { measure: undefined } as Partial<StreakRules>,
      logs: {
        [DAYS[0]]: { quantity: 8, target: 8 },
        [DAYS[1]]: { quantity: 5, target: 8 },
      },
    });
    expect(complete(completeDaysOf(MONDAY, [water], today))).toEqual([DAYS[0]]);
  });

  test("fixed-days habits define only their weekdays", () => {
    // Monday, Wednesday and Friday (ISO 1, 3, 5).
    const gym = habit({
      rules: { frequency: "weekdays", weekdays: [1, 3, 5] },
      done: [DAYS[0], DAYS[2]],
    });
    const result = completeDaysOf(MONDAY, [gym], today);
    expect(complete(result)).toEqual([DAYS[0], DAYS[2]]);
    expect(result.days.map((day) => day.scheduled)).toEqual([1, 0, 1, 0, 1, 0, 0]);
    // Tuesday defined nothing: neither complete nor missed.
    expect(result.days[1]).toEqual({ day: DAYS[1], scheduled: 0, done: 0, complete: false });
  });

  test("a day with no habit defined is not complete even when a daily habit is paused", () => {
    const run = habit({ done: [DAYS[0]], pauses: [[DAYS[1], DAYS[2]]] });
    const result = completeDaysOf(MONDAY, [run], today);
    expect(result.days[1]).toEqual({ day: DAYS[1], scheduled: 0, done: 0, complete: false });
    expect(result.days[2].complete).toBe(false);
    expect(complete(result)).toEqual([DAYS[0]]);
  });

  test("a paused habit leaves the other habits to decide the day", () => {
    const run = habit({ pauses: [[DAYS[1], DAYS[1]]] });
    const read = habit({ done: [DAYS[1]] });
    const result = completeDaysOf(MONDAY, [run, read], today);
    expect(result.days[1]).toEqual({ day: DAYS[1], scheduled: 1, done: 1, complete: true });
    // The other days the paused one is back and not done.
    expect(result.days[0]).toMatchObject({ scheduled: 2, done: 0, complete: false });
  });

  test("a log on a paused day does not count it", () => {
    const run = habit({ done: [DAYS[1]], pauses: [[DAYS[1], DAYS[1]]] });
    expect(completeDaysOf(MONDAY, [run], today).days[1].scheduled).toBe(0);
  });

  test("a habit that starts mid-week defines only the days from its start", () => {
    const newHabit = habit({ rules: { startDate: DAYS[3] }, done: [DAYS[4]] });
    const result = completeDaysOf(MONDAY, [newHabit], today);
    expect(result.days.map((day) => day.scheduled)).toEqual([0, 0, 0, 1, 1, 1, 1]);
    expect(complete(result)).toEqual([DAYS[4]]);
    // Before its start, with another habit: only that one decides.
    const old = habit({ done: DAYS });
    expect(completeDaysOf(MONDAY, [old, newHabit], today).completeDays).toBe(1 + 3);
  });

  test("a habit that starts after the week has no days in it", () => {
    const later = habit({ rules: { startDate: "2026-10-19" }, done: ["2026-10-19"] });
    expect(completeDaysOf(MONDAY, [later], today).completeDays).toBe(0);
  });

  test("«X por semana» habits define no day: they neither complete nor break a day", () => {
    const weekly = habit({ rules: { frequency: "weekly_count", weeklyTarget: 3 } });
    expect(definesDay(weekly, DAYS[0])).toBe(false);
    // Alone: no day is defined.
    expect(completeDaysOf(MONDAY, [weekly], today).completeDays).toBe(0);
    // Next to a daily one done on two days: only the daily one decides.
    const daily = habit({ done: [DAYS[0], DAYS[1]] });
    const result = completeDaysOf(MONDAY, [daily, weekly], today);
    expect(complete(result)).toEqual([DAYS[0], DAYS[1]]);
    expect(result.days[0].scheduled).toBe(1);
  });

  test("a habit to avoid is done on a clean day and not on a relapse", () => {
    const avoid = habit({
      rules: { kind: "avoid" },
      // A relapse on Wednesday: quantity above 0.
      logs: { [DAYS[2]]: { quantity: 2, target: 1 } },
    });
    const result = completeDaysOf(MONDAY, [avoid], today);
    expect(complete(result)).toEqual([DAYS[0], DAYS[1], DAYS[3], DAYS[4], DAYS[5], DAYS[6]]);
    expect(result.completeDays).toBe(6);
  });

  test("seven out of seven", () => {
    expect(completeDaysOf(MONDAY, [habit({ done: DAYS })], today).completeDays).toBe(7);
  });
});

describe("the week in progress", () => {
  test("only the days that already went by count, and today only once complete", () => {
    const run = habit({ done: [DAYS[0], DAYS[1], DAYS[2], DAYS[3], DAYS[5], DAYS[6]] });
    // Thursday 2026-10-15 is today and done: Monday–Thursday complete; Saturday and Sunday are
    // not elapsed even with logs (they can't exist, but the rule doesn't read the future).
    const result = completeDaysOf(MONDAY, [run], DAYS[3]);
    expect(complete(result)).toEqual([DAYS[0], DAYS[1], DAYS[2], DAYS[3]]);
    expect(result.days.slice(4).every((day) => day.scheduled === 0 && !day.complete)).toBe(true);
  });

  test("today not done yet is not complete (and not counted as missed)", () => {
    const run = habit({ done: [DAYS[0], DAYS[1]] });
    const result = completeDaysOf(MONDAY, [run], DAYS[2]);
    expect(result.completeDays).toBe(2);
    expect(result.days[2]).toEqual({ day: DAYS[2], scheduled: 1, done: 0, complete: false });
    // Done later the same day: it counts.
    const later = completeDaysOf(MONDAY, [habit({ done: [DAYS[0], DAYS[1], DAYS[2]] })], DAYS[2]);
    expect(later.completeDays).toBe(3);
  });

  test("Monday morning of the week: nothing is complete yet", () => {
    expect(completeDaysOf(MONDAY, [habit()], MONDAY).completeDays).toBe(0);
    expect(completeDaysOf(MONDAY, [habit({ done: [MONDAY] })], MONDAY).completeDays).toBe(1);
  });

  test("a week that has not started has no days at all", () => {
    const result = completeDaysOf("2026-10-19", [habit({ done: ["2026-10-19"] })], DAYS[3]);
    expect(result.completeDays).toBe(0);
    expect(result.days.every((day) => day.scheduled === 0)).toBe(true);
  });
});

describe("a week across a month and a year", () => {
  test("2026-12-28 to 2027-01-03", () => {
    const run = habit({ done: ["2026-12-28", "2026-12-31", "2027-01-01", "2027-01-03"] });
    const result = completeDaysOf("2026-12-28", [run], "2027-01-10");
    expect(result.days.map((day) => day.day)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(result.completeDays).toBe(4);
  });

  test("a leap week (2028-02-28 to 2028-03-05) has its 29th", () => {
    const run = habit({ done: ["2028-02-29"] });
    const result = completeDaysOf("2028-02-28", [run], "2028-03-10");
    expect(result.days[1].day).toBe("2028-02-29");
    expect(complete(result)).toEqual(["2028-02-29"]);
  });
});
