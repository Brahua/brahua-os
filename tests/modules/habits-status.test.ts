// H1 of `habits`: a day's state, the live "N de M hoy" and the optimistic list (pure).
import { describe, expect, test } from "vitest";
import type { HabitItem } from "@/modules/habits/habit-input";
import {
  applyHabitListChange,
  donePatch,
  neighborOf,
} from "@/modules/habits/habit-list-optimistic";
import { dueOn, isDayDone, todayCount } from "@/modules/habits/habit-status";

const TODAY = "2026-10-02";

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
    ...values,
  };
}

describe("isDayDone", () => {
  test("done when the quantity reaches the day's target", () => {
    expect(isDayDone(habit())).toBe(false);
    expect(isDayDone(habit({ quantity: 1 }))).toBe(true);
    // The day's own target, not the habit's goal (SPEC-habits "Meta en el historial").
    expect(isDayDone(habit({ quantity: 3, target: 4, goal: 2 }))).toBe(false);
    expect(isDayDone(habit({ quantity: 10, target: 8 }))).toBe(true);
  });
});

describe("todayCount", () => {
  test("counts the habits due today, done or not", () => {
    const habits = [habit({ quantity: 1 }), habit(), habit({ quantity: 1 })];
    expect(todayCount(habits, TODAY)).toEqual({ done: 2, total: 3 });
    expect(todayCount([], TODAY)).toEqual({ done: 0, total: 0 });
  });

  test("a habit that starts tomorrow isn't due (nor counted) yet", () => {
    const later = habit({ startDate: "2026-10-03" });
    expect(dueOn([habit(), later], TODAY)).toHaveLength(1);
    expect(todayCount([later], TODAY)).toEqual({ done: 0, total: 0 });
  });
});

describe("the optimistic list", () => {
  const [a, b, c] = [habit(), habit(), habit()];

  test("a tap patches the day; marked or unmarked, it has a log row now (like the server)", () => {
    expect(donePatch(true)).toEqual({ quantity: 1, hasLogs: true });
    expect(donePatch(false)).toEqual({ quantity: 0, hasLogs: true });
    const list = applyHabitListChange([a, b], { type: "update", id: b.id, patch: { quantity: 1 } });
    expect(list.map((item) => item.quantity)).toEqual([0, 1]);
    // An unknown id changes nothing.
    expect(applyHabitListChange([a], { type: "update", id: "x", patch: { quantity: 1 } })).toEqual([
      a,
    ]);
  });

  test("restore with a negative index goes first", () => {
    expect(applyHabitListChange([a, c], { type: "restore", habit: b, index: -3 })).toEqual([
      b,
      a,
      c,
    ]);
  });

  test("remove, and restore at its old place (or in place when it is back already)", () => {
    const removed = applyHabitListChange([a, b, c], { type: "remove", id: b.id });
    expect(removed).toEqual([a, c]);
    expect(applyHabitListChange(removed, { type: "restore", habit: b, index: 1 })).toEqual([
      a,
      b,
      c,
    ]);
    expect(applyHabitListChange(removed, { type: "restore", habit: b, index: 9 })).toEqual([
      a,
      c,
      b,
    ]);
    const renamed = { ...a, name: "Otro" };
    expect(applyHabitListChange([a, c], { type: "restore", habit: renamed, index: 1 })).toEqual([
      renamed,
      c,
    ]);
  });

  test("the neighbor to focus: the next one, else the previous, else none", () => {
    expect(neighborOf([a, b, c], b.id)).toBe(c);
    expect(neighborOf([a, b, c], c.id)).toBe(b);
    expect(neighborOf([a], a.id)).toBeNull();
    expect(neighborOf([a], "missing")).toBeNull();
  });
});
