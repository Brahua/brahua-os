// SPEC-today "Pantalla": which sections the board shows, the empty day, and the "X de N" of
// "Hábitos" (habits' own rule, never a copy).
import { describe, expect, test } from "vitest";
import type { HabitItem } from "@/modules/habits/habit-input";
import { habitsProgress, todaySections, type TodayCounts } from "@/modules/today/today-board";

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
      { habits: false, tasks: false, projects: false, empty: true },
    ],
    [
      "slots given with nothing in them: still an empty day",
      { habits: 0, tasks: 0, projects: 0 },
      { habits: false, tasks: false, projects: false, empty: true },
    ],
    [
      "only habits",
      { habits: 3 },
      { habits: true, tasks: false, projects: false, empty: false },
    ],
    [
      "only tasks (D2): habits hidden, not empty",
      { habits: 0, tasks: 2 },
      { habits: false, tasks: true, projects: false, empty: false },
    ],
    [
      "only projects (D3): not empty",
      { habits: 0, tasks: 0, projects: 1 },
      { habits: false, tasks: false, projects: true, empty: false },
    ],
    [
      "everything",
      { habits: 1, tasks: 9, projects: 2 },
      { habits: true, tasks: true, projects: true, empty: false },
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
