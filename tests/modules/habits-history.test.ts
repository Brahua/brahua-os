// H5 of `habits` (pure): the month of the calendar (`?mes=`, the grid Monday first, its keyboard
// navigation), the month's compliance and the days done in total, the week view (`?semana=`, each
// habit's row, the week's total, the dots of a day), "Más detalles" (Zod, the start date's
// window) and how a day reads.
import { describe, expect, test } from "vitest";
import {
  addMonths,
  monthEnd,
  monthGrid,
  monthLinks,
  monthOf,
  moveInMonth,
  parseMonthParam,
} from "@/modules/habits/calendar";
import { detailsColumns, startDateError } from "@/modules/habits/details-input";
import { createHabitInputSchema, updateHabitInputSchema } from "@/modules/habits/habit-input";
import { dayStateText, DETAILS_ERRORS, HISTORY_COPY } from "@/modules/habits/history-copy";
import {
  monthCompliance,
  monthDays,
  totalDone,
  type DayLog,
  type StreakHistory,
  type StreakRules,
} from "@/modules/habits/streak";
import {
  dayDots,
  habitWeekRow,
  parseWeekParam,
  weekLinks,
  weekTotal,
  type HabitWeekHabit,
} from "@/modules/habits/week-summary";
import { detailsDraftOf, detailsValues } from "@/modules/habits/components/details-fields";

// Friday 2026-10-02 in Lima; its week starts on Monday 2026-09-28.
const TODAY = "2026-10-02";

const daily = (startDate = "2026-01-01"): StreakRules => ({
  kind: "build",
  frequency: "daily",
  weeklyTarget: null,
  weekdays: null,
  startDate,
});

function history(
  marked: string[] = [],
  pauses: [string, string][] = [],
  logs: Record<string, DayLog> = {},
): StreakHistory {
  const map = new Map<string, DayLog>(marked.map((day) => [day, { quantity: 1, target: 1 }]));
  for (const [day, log] of Object.entries(logs)) map.set(day, log);
  return {
    logs: map,
    pauses: pauses.map(([startDate, endDate]) => ({ startDate, endDate })),
  };
}

describe("the month", () => {
  test("days, end (leap years) and months across years", () => {
    expect(monthDays("2026-09")).toHaveLength(30);
    expect(monthDays("2026-02").at(-1)).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-03", -14)).toBe("2025-01");
    expect(monthOf("2026-10-02")).toBe("2026-10");
  });

  test("the grid is Monday first, padded with empty cells", () => {
    // September 2026 starts on a Tuesday.
    const september = monthGrid("2026-09");
    expect(september[0]).toEqual([
      null,
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
    expect(september.at(-1)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      null,
      null,
      null,
      null,
    ]);
    expect(september.every((week) => week.length === 7)).toBe(true);
    // February 2026 starts on a Sunday: six blanks, then five more weeks.
    const february = monthGrid("2026-02");
    expect(february[0].filter((day) => day === null)).toHaveLength(6);
    expect(february).toHaveLength(5);
    expect(february.flat().filter(Boolean)).toHaveLength(28);
  });

  test.each([
    ["missing", undefined, "2026-10"],
    ["not a month", "2026-13", "2026-10"],
    ["a list", ["2026-09"], "2026-10"],
    ["in range", "2026-08", "2026-08"],
    ["before the start", "2025-12", "2026-01"],
    ["after today", "2027-01", "2026-10"],
  ])("?mes= %s", (_, value, month) => {
    expect(parseMonthParam(value, TODAY, "2026-01-15")).toBe(month);
  });

  test("links: back to the start's month, forward to today's", () => {
    expect(monthLinks("2026-10", TODAY, "2026-01-15")).toEqual({ previous: "2026-09", next: null });
    expect(monthLinks("2026-01", TODAY, "2026-01-15")).toEqual({ previous: null, next: "2026-02" });
    expect(monthLinks("2026-10", TODAY, "2026-10-01")).toEqual({ previous: null, next: null });
  });
});

describe("keyboard navigation of the calendar grid", () => {
  const move = (
    day: string,
    key: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
  ) => moveInMonth(day, "2026-09", { key, ...modifiers });

  test.each([
    ["ArrowRight", "2026-09-15", "2026-09-16"],
    ["ArrowLeft", "2026-09-15", "2026-09-14"],
    ["ArrowDown", "2026-09-15", "2026-09-22"],
    ["ArrowUp", "2026-09-15", "2026-09-08"],
    // Tuesday the 15th: its week runs Monday 14 to Sunday 20.
    ["Home", "2026-09-15", "2026-09-14"],
    ["End", "2026-09-15", "2026-09-20"],
    // Edges: an arrow past the month stays put.
    ["ArrowLeft", "2026-09-01", "2026-09-01"],
    ["ArrowUp", "2026-09-03", "2026-09-03"],
    ["ArrowRight", "2026-09-30", "2026-09-30"],
    ["ArrowDown", "2026-09-28", "2026-09-28"],
    // Home/End stop at the month's ends (the first week starts on Tuesday the 1st).
    ["Home", "2026-09-03", "2026-09-01"],
    ["End", "2026-09-29", "2026-09-30"],
  ])("%s from %s goes to %s", (key, from, to) => {
    expect(move(from, key)).toBe(to);
  });

  test("Ctrl or ⌘ + Home/End: the month's first and last day; other keys are left alone", () => {
    expect(move("2026-09-17", "Home", { ctrlKey: true })).toBe("2026-09-01");
    expect(move("2026-09-17", "End", { metaKey: true })).toBe("2026-09-30");
    expect(move("2026-09-17", "Enter")).toBeNull();
    expect(move("2026-09-17", "Tab")).toBeNull();
    expect(move("2026-09-17", "a")).toBeNull();
  });
});

describe("the month's compliance and the total", () => {
  test("daily: scheduled and available days elapsed; today only once done; pauses don't count", () => {
    const habit = daily("2026-09-01");
    const marked = ["2026-10-01"];
    expect(monthCompliance(habit, history(marked), "2026-10", TODAY)).toEqual({
      done: 1,
      expected: 1,
    });
    expect(monthCompliance(habit, history([...marked, TODAY]), "2026-10", TODAY)).toEqual({
      done: 2,
      expected: 2,
    });
    // September: 30 days, 10 of them paused (one logged, still neutral).
    const september = history(["2026-09-02", "2026-09-12"], [["2026-09-11", "2026-09-20"]]);
    expect(monthCompliance(habit, september, "2026-09", TODAY)).toEqual({ done: 1, expected: 20 });
  });

  test("a month before the start counts only from it; a future part never counts", () => {
    expect(monthCompliance(daily("2026-09-29"), history(), "2026-09", TODAY)).toEqual({
      done: 0,
      expected: 2,
    });
  });

  test("fixed days: only their weekdays", () => {
    // Mondays and Thursdays of September 2026: 1, 3... Monday 7, 14, 21, 28; Thursday 3, 10, 17, 24.
    const habit: StreakRules = { ...daily("2026-09-01"), frequency: "weekdays", weekdays: [1, 4] };
    const result = monthCompliance(habit, history(["2026-09-07", "2026-09-08"]), "2026-09", TODAY);
    expect(result).toEqual({ done: 1, expected: 8 });
  });

  test("X por semana: done days over the month's proportional quota", () => {
    const habit: StreakRules = {
      ...daily("2026-09-01"),
      frequency: "weekly_count",
      weeklyTarget: 3,
    };
    // 30 available days: ceil(3 × 30 / 7) = 13.
    expect(monthCompliance(habit, history(["2026-09-01", "2026-09-02"]), "2026-09", TODAY)).toEqual(
      {
        done: 2,
        expected: 13,
      },
    );
    // A whole month paused: nothing expected.
    expect(
      monthCompliance(habit, history([], [["2026-09-01", "2026-09-30"]]), "2026-09", TODAY),
    ).toEqual({ done: 0, expected: 0 });
  });

  test("a habit to avoid: clean days over available days, today included while clean", () => {
    const habit: StreakRules = { ...daily("2026-10-01"), kind: "avoid" };
    expect(monthCompliance(habit, history(), "2026-10", TODAY)).toEqual({ done: 2, expected: 2 });
    expect(monthCompliance(habit, history([TODAY]), "2026-10", TODAY)).toEqual({
      done: 1,
      expected: 1,
    });
  });

  test("the total: done days that count, since the start", () => {
    const habit = daily("2026-09-25");
    const logs = history(
      ["2026-09-25", "2026-09-26", "2026-09-30", TODAY],
      [["2026-09-30", "2026-09-30"]],
      // A quantity under its target isn't done.
      { "2026-09-27": { quantity: 3, target: 8 } },
    );
    expect(totalDone(habit, logs, TODAY)).toBe(3);
    // A log on a day that isn't scheduled doesn't count.
    const fixed: StreakRules = { ...habit, frequency: "weekdays", weekdays: [5] };
    expect(totalDone(fixed, logs, TODAY)).toBe(2);
    // A habit to avoid: its clean days (8 since the 25th, today included), minus one relapse.
    expect(totalDone({ ...habit, kind: "avoid" }, history(["2026-09-28"]), TODAY)).toBe(7);
  });
});

describe("the week view", () => {
  const habit = (values: Partial<HabitWeekHabit> = {}): HabitWeekHabit => ({
    ...daily("2026-09-01"),
    id: "h",
    name: "Leer",
    measure: "check",
    goal: 1,
    unit: null,
    area: null,
    ...values,
  });

  test("a row: each day's state and log, and the compliance", () => {
    const row = habitWeekRow(
      habit({ measure: "quantity", goal: 8, unit: "vasos" }),
      history([], [["2026-09-30", "2026-09-30"]], {
        "2026-09-28": { quantity: 8, target: 8 },
        "2026-09-29": { quantity: 6, target: 8 },
      }),
      "2026-09-28",
      TODAY,
    );
    expect(row.days.map((day) => day.status)).toEqual([
      "done",
      "partial",
      "paused",
      "empty",
      "empty",
      "future",
      "future",
    ]);
    expect(row.days[1]).toMatchObject({ day: "2026-09-29", quantity: 6, target: 8 });
    // A day without a log uses the habit's goal.
    expect(row.days[3]).toMatchObject({ quantity: 0, target: 8 });
    // Today (Friday) isn't done yet: it doesn't count.
    expect(row.compliance).toEqual({ done: 1, expected: 3 });
  });

  test("the total sums the rows: '18 de 24'", () => {
    expect(
      weekTotal([
        { compliance: { done: 5, expected: 7 } },
        { compliance: { done: 2, expected: 3 } },
        { compliance: { done: 11, expected: 14 } },
      ]),
    ).toEqual({ done: 18, expected: 24 });
    expect(weekTotal([])).toEqual({ done: 0, expected: 0 });
  });

  test.each([
    ["missing", undefined, "2026-09-28"],
    ["not a day", "2026-09-31", "2026-09-28"],
    ["not a date", "lunes", "2026-09-28"],
    ["a Wednesday: its Monday", "2026-09-16", "2026-09-14"],
    ["later than this week", "2026-10-12", "2026-09-28"],
    ["before the first week", "2026-01-05", "2026-08-31"],
  ])("?semana= %s", (_, value, monday) => {
    expect(parseWeekParam(value, TODAY, "2026-09-01")).toBe(monday);
  });

  test("the week links: back to the first week, forward and to this week", () => {
    expect(weekLinks("2026-09-21", TODAY, "2026-09-01")).toEqual({
      previous: "2026-09-14",
      next: "2026-09-28",
      current: "2026-09-28",
    });
    expect(weekLinks("2026-08-31", TODAY, "2026-09-01")).toMatchObject({ previous: null });
    expect(weekLinks("2026-09-28", TODAY, "2026-09-01")).toMatchObject({
      next: null,
      current: null,
    });
    expect(weekLinks("2026-09-28", TODAY, null)).toEqual({
      previous: null,
      next: null,
      current: null,
    });
  });

  test("the range: one month or two, across years too", () => {
    expect(HISTORY_COPY.weekRange("2026-09-21", "2026-09-27")).toBe("Del 21 al 27 de setiembre");
    expect(HISTORY_COPY.weekRange("2026-09-28", "2026-10-04")).toBe(
      "Del 28 de setiembre al 4 de octubre",
    );
    expect(HISTORY_COPY.weekRange("2026-12-28", "2027-01-03")).toBe(
      "Del 28 de diciembre al 3 de enero",
    );
  });

  test.each([
    ["Monday, nothing done yet: nothing counts", "2026-09-28", [], { done: 0, expected: 0 }],
    ["Monday, done", "2026-09-28", ["2026-09-28"], { done: 1, expected: 1 }],
    [
      "Sunday, the whole week",
      "2026-10-04",
      ["2026-09-28", "2026-10-04"],
      { done: 2, expected: 7 },
    ],
  ])("today on the week's edges: %s", (_, today, marked, compliance) => {
    expect(habitWeekRow(habit(), history(marked), "2026-09-28", today).compliance).toEqual(
      compliance,
    );
  });

  test("rows of the other kinds: fixed days, X por semana, a habit to avoid", () => {
    const marked = history(["2026-09-28", "2026-09-30"]);
    const fixed = habitWeekRow(
      habit({ frequency: "weekdays", weekdays: [1, 3, 5] }),
      marked,
      "2026-09-28",
      TODAY,
    );
    expect(fixed.days.map((day) => day.status)).toEqual([
      "done",
      "notScheduled",
      "done",
      "notScheduled",
      "empty",
      "future",
      "future",
    ]);
    // Friday is today and not done: it doesn't count yet.
    expect(fixed.compliance).toEqual({ done: 2, expected: 2 });
    const weekly = habitWeekRow(
      habit({ frequency: "weekly_count", weeklyTarget: 3 }),
      marked,
      "2026-09-28",
      TODAY,
    );
    expect(weekly.compliance).toEqual({ done: 2, expected: 3 });
    // A habit to avoid: the marked days are relapses (empty, never red); today is clean.
    const avoid = habitWeekRow(habit({ kind: "avoid" }), marked, "2026-09-28", TODAY);
    expect(avoid.days.map((day) => day.status).slice(0, 5)).toEqual([
      "empty",
      "done",
      "empty",
      "done",
      "done",
    ]);
    expect(avoid.compliance).toEqual({ done: 3, expected: 5 });
  });

  test("without habits, only the current week", () => {
    expect(parseWeekParam("2026-09-14", TODAY, null)).toBe("2026-09-28");
  });

  test.each([
    [
      "a yes/no done",
      "check",
      { status: "done", quantity: 1, target: 1 },
      { total: 1, done: 1, complete: true },
    ],
    [
      "a yes/no not met",
      "check",
      { status: "empty", quantity: 0, target: 1 },
      { total: 1, done: 0, complete: false },
    ],
    [
      "8 vasos, 6 logged",
      "quantity",
      { status: "partial", quantity: 6, target: 8 },
      { total: 8, done: 6, complete: false },
    ],
    [
      "30 min, 15 logged: 9 dots in proportion",
      "quantity",
      { status: "partial", quantity: 15, target: 30 },
      { total: 9, done: 4, complete: false },
    ],
    [
      "30 min, 1 logged: one dot lit",
      "quantity",
      { status: "partial", quantity: 1, target: 30 },
      { total: 9, done: 1, complete: false },
    ],
    [
      "30 min, 29 logged: never all lit",
      "quantity",
      { status: "partial", quantity: 29, target: 30 },
      { total: 9, done: 8, complete: false },
    ],
    [
      "over the goal",
      "quantity",
      { status: "done", quantity: 40, target: 30 },
      { total: 9, done: 9, complete: true },
    ],
    [
      "paused: no dots",
      "check",
      { status: "paused", quantity: 1, target: 1 },
      { total: 0, done: 0, complete: false },
    ],
    [
      "not scheduled: no dots",
      "check",
      { status: "notScheduled", quantity: 0, target: 1 },
      { total: 0, done: 0, complete: false },
    ],
    [
      "still to come: unlit dots",
      "quantity",
      { status: "future", quantity: 0, target: 3 },
      { total: 3, done: 0, complete: false },
    ],
  ] as const)("dots: %s", (_, measure, day, dots) => {
    expect(dayDots({ kind: "build", measure }, day)).toEqual(dots);
  });
});

describe("Más detalles", () => {
  const base = { name: "Leer" };

  test("identity and cue: optional, normalized, blank is none", () => {
    const parsed = createHabitInputSchema.parse({
      ...base,
      identity: "  Soy   alguien que lee ",
      cue: "",
    });
    expect(parsed.identity).toBe("Soy alguien que lee");
    expect(parsed.cue).toBeUndefined();
    expect(parsed.startDate).toBeUndefined();
    expect(detailsColumns(parsed, TODAY)).toEqual({
      identity: "Soy alguien que lee",
      cue: null,
      startDate: TODAY,
    });
  });

  test("their limits: 120 and 60 characters, no invisible characters", () => {
    const tooLong = createHabitInputSchema.safeParse({ ...base, identity: "x".repeat(121) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]).toMatchObject({
      path: ["identity"],
      message: DETAILS_ERRORS.identityTooLong,
    });
    expect(createHabitInputSchema.safeParse({ ...base, identity: "x".repeat(120) }).success).toBe(
      true,
    );
    const cue = createHabitInputSchema.safeParse({ ...base, cue: "x".repeat(61) });
    expect(cue.error?.issues[0]).toMatchObject({
      path: ["cue"],
      message: DETAILS_ERRORS.cueTooLong,
    });
    const invisible = createHabitInputSchema.safeParse({ ...base, cue: "Después​" });
    expect(invisible.error?.issues[0]).toMatchObject({
      path: ["cue"],
      message: DETAILS_ERRORS.cueInvisible,
    });
  });

  test("the start date: a real day; its window is today or up to 7 days back", () => {
    expect(createHabitInputSchema.safeParse({ ...base, startDate: "2026-02-30" }).success).toBe(
      false,
    );
    expect(startDateError(TODAY, TODAY)).toBeNull();
    expect(startDateError("2026-09-25", TODAY)).toBeNull();
    expect(startDateError("2026-09-24", TODAY)).toBe(DETAILS_ERRORS.startDateTooEarly);
    expect(startDateError("2026-10-03", TODAY)).toBe(DETAILS_ERRORS.startDateFuture);
  });

  test("editing: missing keeps them, blank clears them; the start date never changes", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const kept = updateHabitInputSchema.parse({ id, ...base, frequency: "daily" });
    expect(kept.identity).toBeUndefined();
    expect(kept.cue).toBeUndefined();
    const cleared = updateHabitInputSchema.parse({ id, ...base, frequency: "daily", identity: "" });
    expect(cleared.identity).toBeNull();
    expect(
      "startDate" in
        updateHabitInputSchema.parse({ id, ...base, frequency: "daily", startDate: TODAY }),
    ).toBe(false);
  });

  test("the form sends only what changed", () => {
    const habit = { identity: "Soy alguien que lee", cue: null };
    const draft = detailsDraftOf(habit, TODAY);
    expect(detailsValues(draft, habit, TODAY)).toEqual({ identity: undefined, cue: undefined });
    expect(detailsValues({ ...draft, identity: "", cue: "Al despertar" }, habit, TODAY)).toEqual({
      identity: "",
      cue: "Al despertar",
    });
    const fresh = detailsDraftOf(null, TODAY);
    expect(detailsValues(fresh, null, TODAY)).toEqual({
      identity: undefined,
      cue: undefined,
      startDate: undefined,
    });
    expect(detailsValues({ ...fresh, startDate: "2026-09-30" }, null, TODAY).startDate).toBe(
      "2026-09-30",
    );
  });
});

describe("how a day reads", () => {
  test.each([
    ["done", "build", null, 1, null, "hecho"],
    ["done", "build", 8, 8, "vasos", "hecho, 8 de 8 vasos"],
    ["partial", "build", 6, 8, "vasos", "6 de 8 vasos"],
    ["empty", "build", null, 1, null, "sin marcar"],
    ["empty", "build", 0, 8, "vasos", "0 de 8 vasos"],
    ["empty", "avoid", null, 1, null, "con recaída"],
    ["done", "avoid", null, 1, null, "sin recaídas"],
    ["paused", "build", null, 1, null, "descanso (en pausa)"],
    ["notScheduled", "build", null, 1, null, "no toca ese día"],
    ["future", "build", null, 1, null, "por venir"],
    ["beforeStart", "build", null, 1, null, "antes de empezar"],
  ] as const)("%s (%s, %s of %s %s): «%s»", (status, kind, quantity, target, unit, text) => {
    expect(dayStateText({ status, kind, quantity, target, unit })).toBe(text);
  });
});
