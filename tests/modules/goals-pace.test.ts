// G1 of `goals`: periods and pace (pace.ts), pure. The bounds of the year and of each quarter in
// Lima, 31-dec/1-jan, leap years, midnight and the three states of the pace.
import { describe, expect, test } from "vitest";
import { ownerDateKey } from "@/lib/time";
import {
  currentPeriod,
  daysBetween,
  daysElapsed,
  daysLeft,
  expectedProgress,
  paceOf,
  paceTolerance,
  periodBounds,
  periodDays,
  periodLabel,
  periodOf,
  periodPhase,
  quarterOfMonth,
  samePeriod,
  type GoalPeriod,
} from "@/modules/goals/pace";

const year = (value: number): GoalPeriod => ({ kind: "year", year: value });
const quarter = (value: number, q: 1 | 2 | 3 | 4): GoalPeriod => ({
  kind: "quarter",
  year: value,
  quarter: q,
});

describe("periodBounds and periodDays", () => {
  test.each([
    [year(2026), "2026-01-01", "2026-12-31", 365],
    [year(2028), "2028-01-01", "2028-12-31", 366],
    [year(2100), "2100-01-01", "2100-12-31", 365], // 2100 is not a leap year
    [year(2000), "2000-01-01", "2000-12-31", 366], // 2000 is
    [quarter(2026, 1), "2026-01-01", "2026-03-31", 90],
    [quarter(2026, 2), "2026-04-01", "2026-06-30", 91],
    [quarter(2026, 3), "2026-07-01", "2026-09-30", 92],
    [quarter(2026, 4), "2026-10-01", "2026-12-31", 92],
    [quarter(2028, 1), "2028-01-01", "2028-03-31", 91], // leap year: February has 29 days
    [quarter(2028, 2), "2028-04-01", "2028-06-30", 91],
    [quarter(2100, 1), "2100-01-01", "2100-03-31", 90],
  ] as const)("%j", (period, start, end, days) => {
    expect(periodBounds(period)).toEqual({ start, end });
    expect(periodDays(period)).toBe(days);
  });

  test("the four quarters of a year add up to the year", () => {
    for (const value of [2024, 2025, 2026, 2028, 2100]) {
      const quarters = ([1, 2, 3, 4] as const).reduce(
        (sum, q) => sum + periodDays(quarter(value, q)),
        0,
      );
      expect(quarters).toBe(periodDays(year(value)));
    }
  });

  test("the quarters are consecutive: each starts the day after the one before ends", () => {
    for (const q of [1, 2, 3] as const) {
      const end = periodBounds(quarter(2026, q)).end;
      const next = periodBounds(quarter(2026, (q + 1) as 2 | 3 | 4)).start;
      expect(daysBetween(end, next)).toBe(1);
    }
  });
});

describe("quarterOfMonth, currentPeriod, periodOf, samePeriod, periodLabel", () => {
  test.each([
    [1, 1],
    [3, 1],
    [4, 2],
    [6, 2],
    [7, 3],
    [9, 3],
    [10, 4],
    [12, 4],
  ])("month %i is quarter %i", (month, expected) => {
    expect(quarterOfMonth(month)).toBe(expected);
  });

  test.each([
    ["2026-10-12", year(2026), quarter(2026, 4)],
    ["2026-01-01", year(2026), quarter(2026, 1)],
    ["2026-03-31", year(2026), quarter(2026, 1)],
    ["2026-04-01", year(2026), quarter(2026, 2)],
    ["2026-12-31", year(2026), quarter(2026, 4)],
    ["2027-01-01", year(2027), quarter(2027, 1)],
  ])("%s", (today, expectedYear, expectedQuarter) => {
    expect(currentPeriod("year", today)).toEqual(expectedYear);
    expect(currentPeriod("quarter", today)).toEqual(expectedQuarter);
  });

  test("periodOf reads a stored row; quarter is ignored for a year", () => {
    expect(periodOf({ periodKind: "year", year: 2026, quarter: null })).toEqual(year(2026));
    expect(periodOf({ periodKind: "quarter", year: 2026, quarter: 3 })).toEqual(quarter(2026, 3));
  });

  test("samePeriod and the labels", () => {
    expect(samePeriod(year(2026), year(2026))).toBe(true);
    expect(samePeriod(year(2026), year(2027))).toBe(false);
    expect(samePeriod(quarter(2026, 4), quarter(2026, 4))).toBe(true);
    expect(samePeriod(quarter(2026, 4), quarter(2026, 3))).toBe(false);
    expect(samePeriod(year(2026), quarter(2026, 1))).toBe(false);
    expect(periodLabel(year(2026))).toBe("2026");
    expect(periodLabel(quarter(2026, 4))).toBe("T4 2026");
  });
});

describe("midnight in Lima", () => {
  // Lima is UTC-5 all year: 23:59 Lima on 31 Dec is 04:59 UTC on 1 Jan.
  test.each([
    ["2026-12-31T23:59:00-05:00", "2026-12-31"],
    ["2027-01-01T00:00:00-05:00", "2027-01-01"],
    ["2026-09-30T23:59:00-05:00", "2026-09-30"],
    ["2026-10-01T00:00:00-05:00", "2026-10-01"],
  ])("%s is the Lima day %s", (instant, key) => {
    expect(ownerDateKey(new Date(instant))).toBe(key);
  });

  test("the year and the quarter turn over at Lima's midnight, not UTC's", () => {
    // 23:59 Lima on 31 Dec is already 1 Jan in UTC: the day is still the last of 2026.
    const lastMinute = new Date("2027-01-01T04:59:00Z");
    expect(ownerDateKey(lastMinute)).toBe("2026-12-31");
    expect(periodPhase(year(2026), ownerDateKey(lastMinute))).toBe("current");
    expect(periodPhase(quarter(2026, 4), ownerDateKey(lastMinute))).toBe("current");
    expect(daysLeft(year(2026), ownerDateKey(lastMinute))).toBe(1);
    // One minute later it is 2027.
    const midnight = new Date("2027-01-01T05:00:00Z");
    expect(ownerDateKey(midnight)).toBe("2027-01-01");
    expect(periodPhase(year(2026), ownerDateKey(midnight))).toBe("past");
    expect(periodPhase(quarter(2026, 4), ownerDateKey(midnight))).toBe("past");
    expect(periodPhase(year(2027), ownerDateKey(midnight))).toBe("current");
    expect(periodPhase(quarter(2027, 1), ownerDateKey(midnight))).toBe("current");
    // And the same at a quarter's edge.
    expect(periodPhase(quarter(2026, 3), ownerDateKey(new Date("2026-10-01T04:59:00Z")))).toBe(
      "current",
    );
    expect(periodPhase(quarter(2026, 3), ownerDateKey(new Date("2026-10-01T05:00:00Z")))).toBe(
      "past",
    );
  });
});

describe("periodPhase, daysElapsed and daysLeft", () => {
  test.each([
    [year(2026), "2025-12-31", "upcoming", 0, 365],
    [year(2026), "2026-01-01", "current", 1, 365],
    [year(2026), "2026-01-02", "current", 2, 364],
    [year(2026), "2026-07-02", "current", 183, 183], // day 183 of 365
    [year(2026), "2026-12-30", "current", 364, 2],
    [year(2026), "2026-12-31", "current", 365, 1],
    [year(2026), "2027-01-01", "past", 365, 0],
    [year(2028), "2028-02-29", "current", 60, 307], // the leap day
    [year(2028), "2028-12-31", "current", 366, 1],
    [quarter(2026, 4), "2026-09-30", "upcoming", 0, 92],
    [quarter(2026, 4), "2026-10-01", "current", 1, 92],
    [quarter(2026, 4), "2026-10-12", "current", 12, 81],
    [quarter(2026, 4), "2026-12-31", "current", 92, 1],
    [quarter(2026, 4), "2027-01-01", "past", 92, 0],
    [quarter(2026, 1), "2026-03-31", "current", 90, 1],
    [quarter(2026, 1), "2026-04-01", "past", 90, 0],
    [quarter(2028, 1), "2028-03-01", "current", 61, 31],
  ] as const)("%j on %s is %s (%i elapsed, %i left)", (period, today, phase, elapsed, left) => {
    expect(periodPhase(period, today)).toBe(phase);
    expect(daysElapsed(period, today)).toBe(elapsed);
    expect(daysLeft(period, today)).toBe(left);
  });

  test("elapsed + left - 1 is the whole period on every day of it", () => {
    const period = quarter(2026, 4);
    const { start } = periodBounds(period);
    const failures: string[] = [];
    for (let offset = 0; offset < periodDays(period); offset++) {
      const day = new Date(Date.parse(`${start}T00:00:00Z`) + offset * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (daysElapsed(period, day) + daysLeft(period, day) - 1 !== periodDays(period)) {
        failures.push(day);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("expectedProgress", () => {
  test.each([
    [12, year(2026), "2026-01-01", 12 / 365],
    [12, year(2026), "2026-07-02", (12 * 183) / 365],
    [12, year(2026), "2026-12-31", 12],
    [12, year(2026), "2025-12-31", 0],
    [12, year(2026), "2027-03-01", 12],
    [92, quarter(2026, 4), "2026-10-12", 12],
    [200, quarter(2026, 1), "2026-02-14", (200 * 45) / 90],
  ] as const)("target %i, %j on %s", (target, period, today, expected) => {
    expect(expectedProgress(target, period, today)).toBeCloseTo(expected, 10);
  });
});

describe("paceTolerance", () => {
  test.each([
    [1, 1],
    [12, 1],
    [20, 1],
    [21, 1.05],
    [200, 10],
    [100_000, 5000],
  ])("target %i is %f", (target, expected) => {
    expect(paceTolerance(target)).toBeCloseTo(expected, 10);
  });
});

describe("paceOf: ahead, on pace and the next step (never a reproach)", () => {
  const Q4 = quarter(2026, 4); // 92 days; "2026-10-12" is day 12
  // Expected at day 12 of a target of 92 is exactly 12; the tolerance is 4.6 (5 % of 92).
  test.each([
    // value, today, expected state
    [0, "2026-10-12", { kind: "next-step", remaining: 92 }],
    [7, "2026-10-12", { kind: "next-step", remaining: 85 }],
    [7.3, "2026-10-12", { kind: "next-step" }],
    [8, "2026-10-12", { kind: "on" }], // 12 - 4.6 = 7.4 → 8 is within
    [12, "2026-10-12", { kind: "on" }],
    [16, "2026-10-12", { kind: "on" }], // 12 + 4.6 = 16.6 → still on pace
    [17, "2026-10-12", { kind: "ahead", by: 5 }],
    [30, "2026-10-12", { kind: "ahead", by: 18 }],
    [92, "2026-10-12", { kind: "done" }],
    [100, "2026-10-12", { kind: "done" }],
  ] as const)("target 92, value %d on %s", (value, today, expected) => {
    expect(paceOf({ value, target: 92, period: Q4, today })).toMatchObject(expected);
  });

  test("a goal of 12 in a year: one unit is the tolerance around the expected progress", () => {
    const period = year(2026);
    // On 2026-07-02 expected = 12 × 183/365 ≈ 6.016: on pace from 5.016 to 7.016.
    const pace = (value: number) => paceOf({ value, target: 12, period, today: "2026-07-02" });
    expect(pace(5)).toMatchObject({ kind: "next-step", remaining: 7 });
    expect(pace(6)).toEqual({ kind: "on" });
    expect(pace(7)).toEqual({ kind: "on" });
    expect(pace(8)).toEqual({ kind: "ahead", by: 1 });
    expect(pace(9)).toEqual({ kind: "ahead", by: 2 });
  });

  test("the first day: one unit is still on pace, two are ahead", () => {
    const pace = (value: number) =>
      paceOf({ value, target: 12, period: year(2026), today: "2026-01-01" });
    expect(pace(0)).toEqual({ kind: "on" });
    expect(pace(1)).toEqual({ kind: "on" });
    expect(pace(2)).toEqual({ kind: "ahead", by: 1 });
  });

  test("the last day: below the target it asks for what is left, as a next step", () => {
    const pace = paceOf({ value: 7, target: 10, period: year(2026), today: "2026-12-31" });
    expect(pace).toEqual({ kind: "next-step", perWeekNeeded: 3, remaining: 3 });
  });

  test("perWeekNeeded: remaining over the weeks left (at least one week), rounded up", () => {
    // Q4 on 2026-10-12: 81 days left = 11.57 weeks.
    expect(paceOf({ value: 0, target: 92, period: Q4, today: "2026-10-12" })).toEqual({
      kind: "next-step",
      remaining: 92,
      perWeekNeeded: 8, // ceil(92 / 11.57) = 8
    });
    // 3 days left: the week's worth, not a daily rate scaled up.
    expect(paceOf({ value: 6, target: 10, period: year(2026), today: "2026-12-29" })).toEqual({
      kind: "next-step",
      remaining: 4,
      perWeekNeeded: 4,
    });
    // Always at least 1.
    const small = paceOf({ value: 0, target: 1000, period: year(2026), today: "2026-01-20" });
    expect(small).toMatchObject({ kind: "next-step", remaining: 1000 });
    expect((small as { perWeekNeeded: number }).perWeekNeeded).toBeGreaterThanOrEqual(1);
  });

  test("before the period it is 'upcoming'; after it, 'past' (no pace, no judgement)", () => {
    expect(paceOf({ value: 0, target: 12, period: year(2027), today: "2026-10-12" })).toEqual({
      kind: "upcoming",
    });
    expect(paceOf({ value: 7, target: 10, period: quarter(2026, 3), today: "2026-10-01" })).toEqual(
      {
        kind: "past",
      },
    );
    // Reaching the target always wins, in any phase.
    expect(
      paceOf({ value: 10, target: 10, period: quarter(2026, 3), today: "2026-10-01" }),
    ).toEqual({ kind: "done" });
    expect(paceOf({ value: 10, target: 10, period: year(2027), today: "2026-10-12" })).toEqual({
      kind: "done",
    });
  });

  test("a big target: 5 % of it is the tolerance, not one unit", () => {
    // 200 days in a year; on day 183 expected = 100.27; tolerance 10.
    const base = { target: 200, period: year(2026), today: "2026-07-02" } as const;
    expect(paceOf({ ...base, value: 95 })).toEqual({ kind: "on" });
    expect(paceOf({ ...base, value: 111 })).toMatchObject({ kind: "ahead", by: 10 });
    expect(paceOf({ ...base, value: 89 })).toMatchObject({ kind: "next-step" });
  });

  test("never says anything that is not one of the six states", () => {
    const kinds = new Set<string>();
    for (const value of [0, 1, 5, 6, 7, 11, 12]) {
      for (const today of ["2025-12-31", "2026-01-01", "2026-07-02", "2026-12-31", "2027-01-01"]) {
        kinds.add(paceOf({ value, target: 12, period: year(2026), today }).kind);
      }
    }
    expect([...kinds].sort()).toEqual(["ahead", "done", "next-step", "on", "past", "upcoming"]);
  });
});
