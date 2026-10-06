// SPEC-today "Pantalla": which sections the board shows, the empty day, and the "X de N" of
// "Hábitos" (habits' own rule, never a copy).
import { describe, expect, test } from "vitest";
import type { HabitItem } from "@/modules/habits/habit-input";
import {
  applyTodayTaskChange,
  focusAfterTaskLeaves,
  habitsProgress,
  habitsTally,
  isDayComplete,
  paymentsTally,
  taskFold,
  todaySections,
  TODAY_TASKS_VISIBLE,
  type TaskFold,
  type TaskFocusTarget,
  type TodayCounts,
  type TodayTaskChange,
  variantForDay,
} from "@/modules/today/today-board";

const TODAY = "2026-10-02"; // A Friday.

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
    startDate: "2026-01-01",
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

describe("todaySections", () => {
  test.each<[string, TodayCounts, ReturnType<typeof todaySections>]>([
    [
      "nothing at all: an empty day",
      { habits: 0 },
      { habits: false, tasks: false, payments: false, projects: false, empty: true },
    ],
    [
      "slots given with nothing in them: still an empty day",
      { habits: 0, tasks: 0, projects: 0 },
      { habits: false, tasks: false, payments: false, projects: false, empty: true },
    ],
    [
      "only habits",
      { habits: 3 },
      { habits: true, tasks: false, payments: false, projects: false, empty: false },
    ],
    [
      "only tasks (D2): habits hidden, not empty",
      { habits: 0, tasks: 2 },
      { habits: false, tasks: true, payments: false, projects: false, empty: false },
    ],
    [
      "only projects (D3): not empty",
      { habits: 0, tasks: 0, projects: 1 },
      { habits: false, tasks: false, payments: false, projects: true, empty: false },
    ],
    [
      "only Día completo (D4, e.g. every task done and gone): not the empty day too",
      { habits: 0, tasks: 0, projects: 0, dayComplete: true },
      { habits: false, tasks: false, payments: false, projects: false, empty: false },
    ],
    [
      "everything",
      { habits: 1, tasks: 9, payments: 2, projects: 2 },
      { habits: true, tasks: true, payments: true, projects: true, empty: false },
    ],
    [
      "only payments (F4): not empty",
      { habits: 0, tasks: 0, payments: 1, projects: 0 },
      { habits: false, tasks: false, payments: true, projects: false, empty: false },
    ],
    [
      "payments slot with no rows: still an empty day",
      { habits: 0, tasks: 0, payments: 0, projects: 0 },
      { habits: false, tasks: false, payments: false, projects: false, empty: true },
    ],
    [
      "only upcoming payments (none due yet): the section shows, so the day isn't empty",
      { habits: 0, payments: 2, dayComplete: false },
      { habits: false, tasks: false, payments: true, projects: false, empty: false },
    ],
  ])("%s", (_, counts, expected) => {
    expect(todaySections(counts)).toEqual(expected);
  });
});

describe("habitsProgress", () => {
  test("no habits: 0 de 0", () => {
    expect(habitsProgress([], TODAY)).toEqual({ done: 0, total: 0 });
  });

  test("counts with habits' rule: a done day, a met week and an avoid without a relapse", () => {
    const habits = [
      habit({ quantity: 1 }), // yes/no, done
      habit(), // yes/no, pending
      habit({ measure: "quantity", goal: 8, target: 8, quantity: 6 }), // 6/8: pending
      habit({ measure: "quantity", goal: 8, target: 8, quantity: 10 }), // past the goal: done
      habit({ kind: "avoid" }), // clean today: done
      habit({ kind: "avoid", quantity: 1 }), // a relapse today: not done
      // 3 per week, already 3 before today: the week is met.
      habit({ frequency: "weekly_count", weeklyTarget: 3, weekDoneBefore: 3 }),
    ];
    expect(habitsProgress(habits, TODAY)).toEqual({ done: 4, total: 7 });
  });
});

describe("taskFold (Tareas: 3 shown, the rest behind “Ver N más”)", () => {
  test("the cap is 3", () => {
    expect(TODAY_TASKS_VISIBLE).toBe(3);
  });

  test.each<[string, number, boolean, TaskFold]>([
    ["none", 0, false, { shown: 0, hidden: 0, toggle: null }],
    ["one", 1, false, { shown: 1, hidden: 0, toggle: null }],
    ["exactly 3: no toggle", 3, false, { shown: 3, hidden: 0, toggle: null }],
    ["exactly 3, expanded: still no toggle", 3, true, { shown: 3, hidden: 0, toggle: null }],
    ["4 folded: Ver 1 más", 4, false, { shown: 3, hidden: 1, toggle: "more" }],
    ["9 folded: Ver 6 más", 9, false, { shown: 3, hidden: 6, toggle: "more" }],
    ["9 expanded: all, Ver menos", 9, true, { shown: 9, hidden: 0, toggle: "less" }],
    ["4 expanded", 4, true, { shown: 4, hidden: 0, toggle: "less" }],
    ["a negative total is none", -1, false, { shown: 0, hidden: 0, toggle: null }],
  ])("%s", (_, total, expanded, fold) => {
    expect(taskFold(total, expanded)).toEqual(fold);
  });
});

describe("focusAfterTaskLeaves (never <body>)", () => {
  test.each<[string, string[], string, TaskFocusTarget]>([
    ["first of three: the next", ["a", "b", "c"], "a", { kind: "row", id: "b" }],
    ["middle: the next", ["a", "b", "c"], "b", { kind: "row", id: "c" }],
    ["last: the previous", ["a", "b", "c"], "c", { kind: "row", id: "b" }],
    [
      "the 3rd shown of 5 (folded): the 4th, which rises",
      ["a", "b", "c", "d", "e"],
      "c",
      { kind: "row", id: "d" },
    ],
    ["the only one: the board's heading", ["a"], "a", { kind: "board" }],
    ["not in the list: the first row", ["a", "b"], "z", { kind: "row", id: "a" }],
    ["an empty list: the board's heading", [], "a", { kind: "board" }],
  ])("%s", (_, ids, id, target) => {
    expect(focusAfterTaskLeaves(ids, id)).toEqual(target);
  });
});

describe("applyTodayTaskChange", () => {
  type Item = { id: string };
  const a: Item = { id: "a" };
  const b: Item = { id: "b" };
  const c: Item = { id: "c" };

  test.each<[string, Item[], TodayTaskChange<Item>, string[]]>([
    ["remove", [a, b, c], { type: "remove", id: "b" }, ["a", "c"]],
    ["remove an absent one: unchanged", [a, c], { type: "remove", id: "b" }, ["a", "c"]],
    ["restore in its place", [a, c], { type: "restore", task: b, index: 1 }, ["a", "b", "c"]],
    ["restore first", [b, c], { type: "restore", task: a, index: 0 }, ["a", "b", "c"]],
    ["restore past the end: last", [a], { type: "restore", task: c, index: 5 }, ["a", "c"]],
    ["restore a negative index: first", [b], { type: "restore", task: a, index: -2 }, ["a", "b"]],
    [
      "restore one already there: never doubled",
      [a, b],
      { type: "restore", task: b, index: 0 },
      ["a", "b"],
    ],
  ])("%s", (_, list, change, ids) => {
    const before = list.map((task) => task.id);
    expect(applyTodayTaskChange(list, change).map((task) => task.id)).toEqual(ids);
    // Pure: the input list is never mutated.
    expect(list.map((task) => task.id)).toEqual(before);
  });
});

describe("habitsTally (Día completo: the “X de N” and what was actually done today)", () => {
  test("active: a day done today counts; a clean avoid and a week met before today don't", () => {
    const habits = [
      habit({ quantity: 1 }), // yes/no, done today: active
      habit({ measure: "quantity", goal: 8, target: 8, quantity: 10 }), // past the goal: active
      habit({ measure: "quantity", goal: 8, target: 8, quantity: 6 }), // 6/8: neither
      habit({ kind: "avoid" }), // clean: done, not active
      habit({ kind: "avoid", quantity: 1 }), // a relapse: neither
      // 3 per week, already met before today: done, not active.
      habit({ frequency: "weekly_count", weeklyTarget: 3, weekDoneBefore: 3 }),
    ];
    expect(habitsTally(habits, TODAY)).toEqual({ done: 4, total: 6, active: 2 });
  });

  test("not due today (another weekday, paused) counts for nothing", () => {
    const habits = [
      habit({ quantity: 1, frequency: "weekdays", weekdays: [1] }), // Mondays only
      habit({ quantity: 1, pause: { id: "p", startDate: TODAY, endDate: TODAY, reason: null } }),
    ];
    expect(habitsTally(habits, TODAY)).toEqual({ done: 0, total: 0, active: 0 });
  });
});

describe("isDayComplete", () => {
  const habits = (values: { done: number; total: number; active: number }) => values;
  const tasks = (pending: number, doneToday: number) => ({ pending, doneToday });

  test.each<[string, Parameters<typeof isDayComplete>[0], boolean]>([
    [
      "everything done, with habits and tasks done today",
      { habits: habits({ done: 5, total: 5, active: 5 }), tasks: tasks(0, 4) },
      true,
    ],
    [
      "everything done, only habits today",
      { habits: habits({ done: 2, total: 2, active: 2 }), tasks: tasks(0, 0) },
      true,
    ],
    [
      "no habits today, only tasks completed",
      { habits: habits({ done: 0, total: 0, active: 0 }), tasks: tasks(0, 1) },
      true,
    ],
    [
      "an empty day (nothing due, nothing done): never celebrated",
      { habits: habits({ done: 0, total: 0, active: 0 }), tasks: tasks(0, 0) },
      false,
    ],
    [
      "a habit pending",
      { habits: habits({ done: 2, total: 3, active: 2 }), tasks: tasks(0, 4) },
      false,
    ],
    [
      "a task pending (overdue or due today)",
      { habits: habits({ done: 3, total: 3, active: 3 }), tasks: tasks(1, 4) },
      false,
    ],
    [
      "only projects on the board (they never count): nothing done, not complete",
      { habits: habits({ done: 0, total: 0, active: 0 }), tasks: tasks(0, 0) },
      false,
    ],
    [
      "only habits to avoid, all clean, nothing else done: not complete (no activity)",
      { habits: habits({ done: 2, total: 2, active: 0 }), tasks: tasks(0, 0) },
      false,
    ],
    [
      "habits to avoid clean and a task completed today: complete",
      { habits: habits({ done: 2, total: 2, active: 0 }), tasks: tasks(0, 1) },
      true,
    ],
    [
      "everything done and a payment overdue (F4): not complete",
      {
        habits: habits({ done: 2, total: 2, active: 2 }),
        tasks: tasks(0, 1),
        payments: { blocking: 1 },
      },
      false,
    ],
    [
      "everything done, no payment overdue or due today (upcoming ones don't count): complete",
      {
        habits: habits({ done: 2, total: 2, active: 2 }),
        tasks: tasks(0, 1),
        payments: { blocking: 0 },
      },
      true,
    ],
    [
      "no payment pending is not activity: nothing done, not complete",
      {
        habits: habits({ done: 0, total: 0, active: 0 }),
        tasks: tasks(0, 0),
        payments: { blocking: 0 },
      },
      false,
    ],
  ])("%s", (_, tally, expected) => {
    expect(isDayComplete(tally)).toBe(expected);
  });

  test("from real habits: a clean avoid alone isn't activity; a done one is", () => {
    const avoid = habit({ kind: "avoid" });
    expect(isDayComplete({ habits: habitsTally([avoid], TODAY), tasks: tasks(0, 0) })).toBe(false);
    // Positive control: the same day with a yes/no habit done today.
    const done = habit({ quantity: 1 });
    expect(isDayComplete({ habits: habitsTally([avoid, done], TODAY), tasks: tasks(0, 0) })).toBe(
      true,
    );
  });
});

describe("variantForDay (the closing line: stable all day, varied across days)", () => {
  test("the same day always picks the same variant, within range", () => {
    for (const day of ["2026-10-02", "2026-12-31", "2027-01-01"]) {
      const pick = variantForDay(day, 6);
      expect(pick).toBe(variantForDay(day, 6));
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(6);
    }
  });

  test("a month of days uses several variants", () => {
    const picks = new Set(
      Array.from({ length: 30 }, (_, index) =>
        variantForDay(`2026-10-${String(index + 1).padStart(2, "0")}`, 6),
      ),
    );
    expect(picks.size).toBeGreaterThan(3);
  });

  test("no variants: 0", () => {
    expect(variantForDay("2026-10-02", 0)).toBe(0);
  });
});

describe("paymentsTally (F4: which payments keep the day open)", () => {
  test.each<[string, string[], number]>([
    ["no payments", [], 0],
    ["due today", [TODAY], 1],
    ["overdue yesterday and 60 days ago", ["2026-10-01", "2026-08-03"], 2],
    ["due tomorrow and in 7 days: upcoming, never blocking", ["2026-10-03", "2026-10-09"], 0],
    ["a mix: only overdue and today count", ["2026-09-30", TODAY, "2026-10-03"], 2],
  ])("%s", (_, dues, blocking) => {
    expect(
      paymentsTally(
        dues.map((dueOn) => ({ dueOn })),
        TODAY,
      ),
    ).toEqual({ blocking });
  });

  test("a board with an overdue payment is not complete; paid (gone), it is (positive control)", () => {
    const done = { habits: { done: 1, total: 1, active: 1 }, tasks: { pending: 0, doneToday: 0 } };
    expect(
      isDayComplete({ ...done, payments: paymentsTally([{ dueOn: "2026-09-28" }], TODAY) }),
    ).toBe(false);
    expect(isDayComplete({ ...done, payments: paymentsTally([], TODAY) })).toBe(true);
  });
});
