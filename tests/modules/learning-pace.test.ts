// L1 of `learning`: the pace to the target date and the weekly target's figures (SPEC-learning
// "Ritmo a la fecha", "Meta semanal"). Never a debt: a date that passed only asks for another.
import { describe, expect, test } from "vitest";
import { LEARNING_COPY } from "@/modules/learning/learning-copy";
import {
  daysBetween,
  formatMinutes,
  joinMinutes,
  paceToDate,
  splitMinutes,
} from "@/modules/learning/pace";

const TODAY = "2026-11-02"; // a Monday

describe("paceToDate", () => {
  test("nothing without a date, without a syllabus or with every step done", () => {
    expect(paceToDate({ targetDate: null, today: TODAY, done: 3, total: 40 })).toBeNull();
    expect(paceToDate({ targetDate: "2026-12-15", today: TODAY, done: 0, total: 0 })).toBeNull();
    expect(paceToDate({ targetDate: "2026-12-15", today: TODAY, done: 40, total: 40 })).toBeNull();
  });

  test("the steps left over the weeks left, both rounded up", () => {
    // 2 nov → 15 dic: 44 days ahead, 45 counting today = 7 weeks; 27 left → 4 per week.
    expect(paceToDate({ targetDate: "2026-12-15", today: TODAY, done: 13, total: 40 })).toEqual({
      kind: "perWeek",
      perWeek: 4,
      targetDate: "2026-12-15",
    });
    // Exactly one week (today and the next six days): everything left this week.
    expect(paceToDate({ targetDate: "2026-11-08", today: TODAY, done: 0, total: 5 })).toEqual({
      kind: "perWeek",
      perWeek: 5,
      targetDate: "2026-11-08",
    });
    // Eight days: two weeks.
    expect(paceToDate({ targetDate: "2026-11-09", today: TODAY, done: 0, total: 5 })).toMatchObject(
      {
        perWeek: 3,
      },
    );
  });

  test("a date of today is one week: everything left", () => {
    expect(paceToDate({ targetDate: TODAY, today: TODAY, done: 1, total: 4 })).toMatchObject({
      kind: "perWeek",
      perWeek: 3,
    });
  });

  test("a date before today has passed (no debt, no count of what is missing)", () => {
    expect(paceToDate({ targetDate: "2026-11-01", today: TODAY, done: 1, total: 4 })).toEqual({
      kind: "passed",
      targetDate: "2026-11-01",
    });
  });

  test("its sentences", () => {
    expect(
      LEARNING_COPY.pace({ kind: "perWeek", perWeek: 4, targetDate: "2026-12-15" }, TODAY),
    ).toBe("Para llegar al 15 dic: ~4 pasos por semana");
    expect(
      LEARNING_COPY.pace({ kind: "perWeek", perWeek: 1, targetDate: "2027-01-10" }, TODAY),
    ).toBe("Para llegar al 10 ene 2027: ~1 paso por semana");
    expect(LEARNING_COPY.pace({ kind: "passed", targetDate: "2026-11-01" }, TODAY)).toBe(
      "La fecha pasó: ponle otra o quítala",
    );
  });
});

describe("days and minutes", () => {
  test("daysBetween counts calendar days, across months and backwards", () => {
    expect(daysBetween("2026-11-02", "2026-11-02")).toBe(0);
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-11-02", "2026-11-01")).toBe(-1);
  });

  test("formatMinutes says «45 min», «3 h» and «1 h 20»", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(180)).toBe("3 h");
    expect(formatMinutes(80)).toBe("1 h 20");
    expect(LEARNING_COPY.weeklyTarget(180)).toBe("Meta: 3 h por semana");
  });

  test("the form's hours and minutes go and come back", () => {
    expect(splitMinutes(null)).toEqual({ hours: "", minutes: "" });
    expect(splitMinutes(200)).toEqual({ hours: "3", minutes: "20" });
    expect(joinMinutes("", "")).toBeNull();
    expect(joinMinutes(" 3 ", "")).toBe(180);
    expect(joinMinutes("", "45")).toBe(45);
    expect(joinMinutes("1", "30")).toBe(90);
    expect(joinMinutes("1.5", "")).toBeNaN();
    expect(joinMinutes("-1", "")).toBeNaN();
  });
});
