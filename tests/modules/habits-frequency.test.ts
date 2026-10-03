// H2 of `habits`: frequencies (Zod rules, columns, the summary), what is due on a Lima day, the
// week of a "X veces por semana" habit, the live count and the optimistic reorder (pure).
import { describe, expect, test } from "vitest";
import { fail } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { FREQUENCY_ERRORS } from "@/modules/habits/frequency-copy";
import { frequencyColumns, frequencySummary } from "@/modules/habits/frequency-input";
import {
  createHabitInputSchema,
  updateHabitInputSchema,
  type HabitItem,
} from "@/modules/habits/habit-input";
import { applyHabitListChange } from "@/modules/habits/habit-list-optimistic";
import { countsAsDone, dueOn, todayCount } from "@/modules/habits/habit-status";
import {
  isoWeekday,
  isScheduledOn,
  weekStart,
  type HabitSchedule,
} from "@/modules/habits/schedule";
import { isWeekMet, weekProgress, weekQuota } from "@/modules/habits/week-progress";

const ID = "00000000-0000-4000-8000-000000000001";

/** The field errors of a refused parse (as the actions return them). */
function errorsOf(result: { success: boolean; error?: unknown }) {
  if (result.success) return null;
  const failed = fail(result.error as never);
  return failed.ok ? null : failed.fieldErrors;
}

describe("frequency input (Zod)", () => {
  test("a name alone is a daily habit (H1's defaults stay)", () => {
    const parsed = createHabitInputSchema.parse({ name: "Leer" });
    expect(frequencyColumns(parsed)).toEqual({
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
    });
  });

  test("X veces por semana: X from 1 to 6, whole; required", () => {
    const parse = (weeklyTarget: unknown) =>
      createHabitInputSchema.safeParse({ name: "Gym", frequency: "weekly_count", weeklyTarget });
    for (const ok of [1, 3, 6]) expect(parse(ok).success).toBe(true);
    for (const bad of [0, 7, 2.5, "3", -1]) {
      expect(errorsOf(parse(bad))).toEqual({ weeklyTarget: [FREQUENCY_ERRORS.weeklyTarget] });
    }
    for (const missing of [null, undefined]) {
      expect(errorsOf(parse(missing))).toEqual({ weeklyTarget: [FREQUENCY_ERRORS.weeklyTarget] });
    }
  });

  test("días fijos: 1–6 ISO days, stored sorted without repeats; none or all 7 refused", () => {
    const parse = (weekdays: unknown) =>
      createHabitInputSchema.safeParse({ name: "Inglés", frequency: "weekdays", weekdays });
    const parsed = parse([5, 1, 3, 3]);
    expect(parsed.success && frequencyColumns(parsed.data)).toEqual({
      frequency: "weekdays",
      weeklyTarget: null,
      weekdays: [1, 3, 5],
    });
    expect(parse([1, 2, 3, 4, 5, 6]).success).toBe(true);
    expect(errorsOf(parse([]))).toEqual({ weekdays: [FREQUENCY_ERRORS.weekdaysNone] });
    expect(errorsOf(parse(null))).toEqual({ weekdays: [FREQUENCY_ERRORS.weekdaysNone] });
    expect(errorsOf(parse([1, 2, 3, 4, 5, 6, 7]))).toEqual({
      weekdays: [FREQUENCY_ERRORS.weekdaysAll],
    });
    // Repeats collapse first: seven entries of one day are one day.
    expect(parse([2, 2, 2, 2, 2, 2, 2]).success).toBe(true);
    for (const bad of [[0], [8], [1.5], ["1"], [1, 2, 3, 4, 5, 6, 7, 1]]) {
      // On the list or on the day (`weekdays.0`): either way, the days' own message.
      const errors = Object.entries(errorsOf(parse(bad)) ?? {});
      expect(errors).toEqual([
        [expect.stringMatching(/^weekdays/), [FREQUENCY_ERRORS.weekdaysInvalid]],
      ]);
    }
  });

  test("an unknown frequency is refused on its field", () => {
    expect(errorsOf(createHabitInputSchema.safeParse({ name: "x", frequency: "monthly" }))).toEqual(
      { frequency: [FREQUENCY_ERRORS.frequency] },
    );
  });

  test("the other frequencies' fields are ignored, never stored", () => {
    const weekly = createHabitInputSchema.parse({
      name: "Gym",
      frequency: "weekly_count",
      weeklyTarget: 3,
      weekdays: [1, 2],
    });
    expect(frequencyColumns(weekly)).toEqual({
      frequency: "weekly_count",
      weeklyTarget: 3,
      weekdays: null,
    });
    const daily = createHabitInputSchema.parse({ name: "x", weeklyTarget: 3, weekdays: [1] });
    expect(frequencyColumns(daily)).toEqual({
      frequency: "daily",
      weeklyTarget: null,
      weekdays: null,
    });
  });

  test("editing: the id and the frequency are required; the rule is the same", () => {
    expect(
      updateHabitInputSchema.safeParse({ id: ID, name: "Leer", frequency: "daily" }).success,
    ).toBe(true);
    expect(errorsOf(updateHabitInputSchema.safeParse({ id: ID, name: "Leer" }))).toEqual({
      frequency: [FREQUENCY_ERRORS.frequency],
    });
    expect(
      errorsOf(updateHabitInputSchema.safeParse({ id: "x", name: "Leer", frequency: "daily" })),
    ).toHaveProperty("id");
    expect(
      errorsOf(updateHabitInputSchema.safeParse({ id: ID, name: "Leer", frequency: "weekdays" })),
    ).toEqual({ weekdays: [FREQUENCY_ERRORS.weekdaysNone] });
    // An edit never carries the measure (H3's): extra fields are dropped.
    const parsed = updateHabitInputSchema.parse({
      id: ID,
      name: "Leer",
      frequency: "daily",
      measure: "quantity",
    });
    expect(parsed).not.toHaveProperty("measure");
  });
});

describe("frequencySummary", () => {
  test("every frequency in words", () => {
    expect(frequencySummary({})).toBe("Cada día");
    expect(frequencySummary({ frequency: "daily", weekdays: [1] })).toBe("Cada día");
    expect(frequencySummary({ frequency: "weekly_count", weeklyTarget: 1 })).toBe(
      "1 vez por semana",
    );
    expect(frequencySummary({ frequency: "weekly_count", weeklyTarget: 3 })).toBe(
      "3 veces por semana",
    );
    expect(frequencySummary({ frequency: "weekly_count", weeklyTarget: null })).toBe(
      "Elige cuántas veces",
    );
    expect(frequencySummary({ frequency: "weekdays", weekdays: [5, 1, 3] })).toBe(
      "Lunes, miércoles y viernes",
    );
    expect(frequencySummary({ frequency: "weekdays", weekdays: [6, 7] })).toBe("Sábado y domingo");
    expect(frequencySummary({ frequency: "weekdays", weekdays: [2] })).toBe("Martes");
    expect(frequencySummary({ frequency: "weekdays", weekdays: [] })).toBe("Elige los días");
  });
});

describe("isScheduledOn", () => {
  const base = { weeklyTarget: null, weekdays: null, startDate: "2026-01-01" };
  const mwf: HabitSchedule = { ...base, frequency: "weekdays", weekdays: [1, 3, 5] };
  const weekly: HabitSchedule = { ...base, frequency: "weekly_count", weeklyTarget: 3 };

  test("fixed days only on their ISO weekdays (Monday 1 … Sunday 7)", () => {
    // 2026-10-05 is a Monday.
    const week = ["05", "06", "07", "08", "09", "10", "11"].map((d) => `2026-10-${d}`);
    expect(week.map((day) => isScheduledOn(mwf, day))).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
    const weekend: HabitSchedule = { ...base, frequency: "weekdays", weekdays: [6, 7] };
    expect(week.map((day) => isScheduledOn(weekend, day))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  test("X veces por semana: every day (any day counts)", () => {
    for (let d = 5; d <= 11; d++) {
      expect(isScheduledOn(weekly, `2026-10-${String(d).padStart(2, "0")}`)).toBe(true);
    }
  });

  test("Sunday → Monday, month and year changes", () => {
    const sunday: HabitSchedule = { ...base, frequency: "weekdays", weekdays: [7] };
    const monday: HabitSchedule = { ...base, frequency: "weekdays", weekdays: [1] };
    // Sun 2026-10-04 → Mon 2026-10-05.
    expect([isScheduledOn(sunday, "2026-10-04"), isScheduledOn(sunday, "2026-10-05")]).toEqual([
      true,
      false,
    ]);
    expect([isScheduledOn(monday, "2026-10-04"), isScheduledOn(monday, "2026-10-05")]).toEqual([
      false,
      true,
    ]);
    // Wed 2026-09-30 → Thu 2026-10-01.
    expect(isScheduledOn(mwf, "2026-09-30")).toBe(true);
    expect(isScheduledOn(mwf, "2026-10-01")).toBe(false);
    // Thu 2026-12-31 → Fri 2027-01-01.
    expect(isScheduledOn(mwf, "2026-12-31")).toBe(false);
    expect(isScheduledOn(mwf, "2027-01-01")).toBe(true);
    // Leap day 2028-02-29 is a Tuesday.
    expect(isScheduledOn({ ...base, frequency: "weekdays", weekdays: [2] }, "2028-02-29")).toBe(
      true,
    );
  });

  test("Lima's day, not UTC's: Monday 23:30 in Lima is still Monday", () => {
    // 2026-10-06T04:30Z is Monday 2026-10-05 23:30 in Lima (UTC is already Tuesday).
    const late = ownerDateKey(new Date("2026-10-06T04:30:00Z"));
    expect(late).toBe("2026-10-05");
    expect(isScheduledOn(monday(), late)).toBe(true);
    // At 05:00 UTC Lima reaches Tuesday.
    const next = ownerDateKey(new Date("2026-10-06T05:00:00Z"));
    expect(next).toBe("2026-10-06");
    expect(isScheduledOn(monday(), next)).toBe(false);

    function monday(): HabitSchedule {
      return { ...base, frequency: "weekdays", weekdays: [1] };
    }
  });

  test("Sunday 23:59 in Lima is still Sunday and last week (UTC is already Monday)", () => {
    const sundayOnly: HabitSchedule = { ...base, frequency: "weekdays", weekdays: [7] };
    const mondayOnly: HabitSchedule = { ...base, frequency: "weekdays", weekdays: [1] };
    const late = ownerDateKey(new Date("2026-10-05T04:59:59Z"));
    expect(late).toBe("2026-10-04");
    expect(isoWeekday(late)).toBe(7);
    expect(weekStart(late)).toBe("2026-09-28");
    expect([isScheduledOn(sundayOnly, late), isScheduledOn(mondayOnly, late)]).toEqual([
      true,
      false,
    ]);
    const monday = ownerDateKey(new Date("2026-10-05T05:00:00Z"));
    expect(monday).toBe("2026-10-05");
    expect(isoWeekday(monday)).toBe(1);
    expect(weekStart(monday)).toBe("2026-10-05");
    expect([isScheduledOn(sundayOnly, monday), isScheduledOn(mondayOnly, monday)]).toEqual([
      false,
      true,
    ]);
    // Weeks across a month and a year.
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekStart("2027-01-03")).toBe("2026-12-28");
  });

  test("daily is always due; fixed days without days never are", () => {
    expect(isScheduledOn({ ...base, frequency: "daily" }, "2026-10-04")).toBe(true);
    expect(isScheduledOn({ ...base, frequency: "weekdays", weekdays: null }, "2026-10-05")).toBe(
      false,
    );
  });

  test("never before the start date, whatever the frequency", () => {
    expect(isScheduledOn({ ...mwf, startDate: "2026-10-06" }, "2026-10-05")).toBe(false);
    expect(isScheduledOn({ ...weekly, startDate: "2026-10-06" }, "2026-10-05")).toBe(false);
    expect(isScheduledOn({ ...weekly, startDate: "2026-10-06" }, "2026-10-06")).toBe(true);
  });
});

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

describe("the week of a weekly habit", () => {
  const gym = (values: Partial<HabitItem> = {}) =>
    habit({ frequency: "weekly_count", weeklyTarget: 3, ...values });

  test("the quota: X with the whole week; proportional when fewer days are available (H4)", () => {
    expect(weekQuota(3)).toBe(3);
    expect(weekQuota(6, 7)).toBe(6);
    expect(weekQuota(3, 3)).toBe(2); // ceil(9 / 7)
    expect(weekQuota(1, 1)).toBe(1);
    expect(weekQuota(3, 0)).toBe(0);
    // Clamped to the week.
    expect(weekQuota(3, 10)).toBe(3);
    expect(weekQuota(3, -2)).toBe(0);
  });

  test("done = days before today + today when done; null for other frequencies", () => {
    expect(weekProgress(gym(), false)).toEqual({ done: 0, quota: 3 });
    expect(weekProgress(gym({ weekDoneBefore: 2 }), true)).toEqual({ done: 3, quota: 3 });
    expect(weekProgress(gym({ weekDoneBefore: 4 }), false)).toEqual({ done: 4, quota: 3 });
    expect(weekProgress(habit(), true)).toBeNull();
    expect(weekProgress(habit({ frequency: "weekdays", weekdays: [1] }), true)).toBeNull();
  });

  test("met once done reaches the quota; a neutral week (quota 0) never is", () => {
    expect(isWeekMet(gym({ weekDoneBefore: 2 }), false)).toBe(false);
    expect(isWeekMet(gym({ weekDoneBefore: 2 }), true)).toBe(true);
    expect(isWeekMet(gym({ weekDoneBefore: 3 }), false)).toBe(true);
    expect(isWeekMet(habit(), true)).toBe(false);
  });

  test("the live count: a weekly habit whose week is met counts as done today", () => {
    const met = gym({ weekDoneBefore: 3 });
    const notYet = gym({ weekDoneBefore: 1 });
    expect(countsAsDone(met)).toBe(true);
    expect(countsAsDone(notYet)).toBe(false);
    expect(todayCount([met, notYet, habit({ quantity: 1 })], "2026-10-07")).toEqual({
      done: 2,
      total: 3,
    });
  });

  test("not-due fixed days are neither due nor counted", () => {
    // 2026-10-06 is a Tuesday.
    const mwf = habit({ frequency: "weekdays", weekdays: [1, 3, 5], quantity: 1 });
    expect(dueOn([mwf, habit()], "2026-10-06")).toHaveLength(1);
    expect(todayCount([mwf], "2026-10-06")).toEqual({ done: 0, total: 0 });
    expect(todayCount([mwf], "2026-10-07")).toEqual({ done: 1, total: 1 });
  });
});

describe("the optimistic reorder", () => {
  test("puts the list in the order of the ids; unknown ones are ignored, missing ones go last", () => {
    const [a, b, c] = [habit(), habit(), habit()];
    expect(applyHabitListChange([a, b, c], { type: "reorder", ids: [c.id, a.id, b.id] })).toEqual([
      c,
      a,
      b,
    ]);
    expect(applyHabitListChange([a, b, c], { type: "reorder", ids: [b.id, "x"] })).toEqual([
      b,
      a,
      c,
    ]);
  });
});
