// `doneDaysIn` (SPEC-goals "Hábito → avance"): the days a habit was done inside a range, with the
// streaks' rules. Pure: no database.
import { describe, expect, test } from "vitest";
import { doneDaysIn } from "@/modules/habits/done-days";
import type { DayLog, PauseRange, StreakRules } from "@/modules/habits/streak";

const DAILY: StreakRules = {
  kind: "build",
  frequency: "daily",
  weeklyTarget: null,
  weekdays: null,
  startDate: "2026-10-01",
};

function history(done: string[], pauses: PauseRange[] = [], partial: string[] = []) {
  const logs = new Map<string, DayLog>();
  for (const day of done) logs.set(day, { quantity: 1, target: 1 });
  for (const day of partial) logs.set(day, { quantity: 1, target: 3 });
  return { logs, pauses };
}

const RANGE = { from: "2026-10-01", to: "2026-10-31" };

describe("doneDaysIn", () => {
  test("a daily habit: done days over the days elapsed, today only once done", () => {
    const logs = history(["2026-10-01", "2026-10-02", "2026-10-04"]);
    // 1–5 October with today the 5th and not done: 4 days elapsed, 3 done.
    expect(doneDaysIn(DAILY, logs, RANGE, "2026-10-05")).toEqual({ done: 3, expected: 4 });
    // Today done too: it counts on both sides.
    expect(doneDaysIn(DAILY, history(["2026-10-01", "2026-10-05"]), RANGE, "2026-10-05")).toEqual({
      done: 2,
      expected: 5,
    });
  });

  test("the range bounds count: days before its start and after its end are out", () => {
    const logs = history(["2026-09-30", "2026-10-10", "2026-10-11", "2026-10-12", "2026-11-01"]);
    expect(
      doneDaysIn(
        { ...DAILY, startDate: "2026-01-01" },
        logs,
        { from: "2026-10-10", to: "2026-10-11" },
        "2026-12-01",
      ),
    ).toEqual({ done: 2, expected: 2 });
  });

  test("days after today are not counted, even inside the range", () => {
    expect(doneDaysIn(DAILY, history(["2026-10-02"]), RANGE, "2026-10-03")).toEqual({
      done: 1,
      expected: 2,
    });
    expect(
      doneDaysIn(DAILY, history([]), { from: "2026-11-01", to: "2026-11-30" }, "2026-10-03"),
    ).toEqual({
      done: 0,
      expected: 0,
    });
  });

  test("nothing counts before the habit's start date", () => {
    const habit = { ...DAILY, startDate: "2026-10-10" };
    expect(doneDaysIn(habit, history(["2026-10-12"]), RANGE, "2026-10-14")).toEqual({
      done: 1,
      expected: 4,
    });
  });

  test("a paused day is out of the count, even with a log", () => {
    const logs = history(
      ["2026-10-02", "2026-10-03", "2026-10-06"],
      [{ startDate: "2026-10-03", endDate: "2026-10-04" }],
    );
    // 1–6 elapsed minus the 3rd and 4th: 4 days expected; the 3rd's log doesn't count.
    expect(doneDaysIn(DAILY, logs, RANGE, "2026-10-07")).toEqual({ done: 2, expected: 4 });
  });

  test("a fixed-days habit counts only its weekdays (Mon 2026-10-05, Wed 2026-10-07)", () => {
    const habit: StreakRules = { ...DAILY, frequency: "weekdays", weekdays: [1, 3] };
    // Logged Monday, Tuesday (not scheduled) and Wednesday.
    const logs = history(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(doneDaysIn(habit, logs, { from: "2026-10-05", to: "2026-10-11" }, "2026-10-11")).toEqual(
      {
        done: 2,
        expected: 2,
      },
    );
  });

  test("an 'X por semana' habit counts every logged day as done, against the proportional quota", () => {
    const habit: StreakRules = { ...DAILY, frequency: "weekly_count", weeklyTarget: 3 };
    // Four logged days in the week of 5–11 October: 4 done (never "1 week met"), quota ceil(3×7/7).
    const logs = history(["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-10"]);
    expect(doneDaysIn(habit, logs, { from: "2026-10-05", to: "2026-10-11" }, "2026-10-11")).toEqual(
      {
        done: 4,
        expected: 3,
      },
    );
  });

  test("a partial quantity is not a done day", () => {
    const habit: StreakRules = { ...DAILY };
    expect(
      doneDaysIn(habit, history(["2026-10-01"], [], ["2026-10-02"]), RANGE, "2026-10-03"),
    ).toEqual({
      done: 1,
      expected: 2,
    });
  });

  test("a habit to avoid counts its clean days (no relapse logged)", () => {
    const avoid: StreakRules = { ...DAILY, kind: "avoid" };
    const logs = new Map<string, DayLog>([["2026-10-03", { quantity: 1, target: 1 }]]);
    // 1–5 October, a relapse on the 3rd: 4 clean days of 5 (today, clean, counts).
    expect(doneDaysIn(avoid, { logs, pauses: [] }, RANGE, "2026-10-05")).toEqual({
      done: 4,
      expected: 5,
    });
  });
});
