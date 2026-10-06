// schedule.ts (F2): due dates of the four cycles, month-end clamping, leap years, the start date,
// the pending window (60 days back, 7 ahead) and settled periods. Table cases first, then an
// exhaustive comparison against a day-by-day reference (mismatches collected, asserted once).
import { describe, expect, test } from "vitest";
import {
  addDays,
  daysBetween,
  dueDatesBetween,
  isDueDate,
  isoWeekday,
  monthRange,
  nextDueDate,
  nextDueDates,
  pendingPeriods,
  pendingWindow,
  type Schedule,
} from "@/modules/finance/schedule";

const base = { weekday: null, dayOfMonth: null, intervalMonths: null, anchorMonth: null };
const weekly = (weekday: number, startDate = "2000-01-01"): Schedule => ({
  ...base,
  cycle: "weekly",
  weekday,
  startDate,
});
const monthly = (dayOfMonth: number, startDate = "2000-01-01"): Schedule => ({
  ...base,
  cycle: "monthly",
  dayOfMonth,
  startDate,
});
const everyN = (
  intervalMonths: number,
  dayOfMonth: number,
  anchorMonth: number,
  startDate = "2026-01-01",
): Schedule => ({
  ...base,
  cycle: "every_n_months",
  dayOfMonth,
  intervalMonths,
  anchorMonth,
  startDate,
});
const yearly = (dayOfMonth: number, anchorMonth: number, startDate = "2000-01-01"): Schedule => ({
  ...base,
  cycle: "yearly",
  dayOfMonth,
  anchorMonth,
  startDate,
});

describe("day helpers", () => {
  test.each([
    ["2026-10-05", 1, "2026-10-06"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-10-05", -60, "2026-08-06"],
  ])("addDays(%s, %i) = %s", (day, n, expected) => {
    expect(addDays(day, n)).toBe(expected);
    expect(daysBetween(day, expected)).toBe(n);
  });

  test("ISO weekdays and month ranges", () => {
    expect(isoWeekday("2026-10-05")).toBe(1); // Monday
    expect(isoWeekday("2026-10-11")).toBe(7); // Sunday
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("due dates by cycle", () => {
  test.each<[string, Schedule, string, string, string[]]>([
    [
      "weekly on Mondays",
      weekly(1),
      "2026-10-01",
      "2026-10-31",
      ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"],
    ],
    ["weekly on Sundays", weekly(7), "2026-10-01", "2026-10-11", ["2026-10-04", "2026-10-11"]],
    [
      "monthly on the 15th",
      monthly(15),
      "2026-09-01",
      "2026-11-30",
      ["2026-09-15", "2026-10-15", "2026-11-15"],
    ],
    [
      "monthly on the 31st clamps to the month's end",
      monthly(31),
      "2026-01-01",
      "2026-05-31",
      ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
    ],
    [
      "monthly on the 30th in February of a leap year",
      monthly(30),
      "2024-02-01",
      "2024-03-31",
      ["2024-02-29", "2024-03-30"],
    ],
    [
      "monthly on the 29th in a non-leap February",
      monthly(29),
      "2026-02-01",
      "2026-02-28",
      ["2026-02-28"],
    ],
    [
      "every 3 months from March, crossing the year",
      everyN(3, 5, 3, "2026-01-01"),
      "2026-01-01",
      "2027-06-30",
      ["2026-03-05", "2026-06-05", "2026-09-05", "2026-12-05", "2027-03-05", "2027-06-05"],
    ],
    [
      "every 2 months from November (anchor in the start's year)",
      everyN(2, 31, 11, "2026-01-01"),
      "2026-01-01",
      "2026-12-31",
      ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-09-30", "2026-11-30"],
    ],
    [
      "every 5 months from January 2026",
      everyN(5, 10, 1, "2026-01-01"),
      "2026-01-01",
      "2027-12-31",
      ["2026-01-10", "2026-06-10", "2026-11-10", "2027-04-10", "2027-09-10"],
    ],
    [
      "every 12 months is yearly",
      everyN(12, 1, 4, "2026-01-01"),
      "2026-01-01",
      "2028-12-31",
      ["2026-04-01", "2027-04-01", "2028-04-01"],
    ],
    [
      "yearly on March 23",
      yearly(23, 3),
      "2026-01-01",
      "2028-12-31",
      ["2026-03-23", "2027-03-23", "2028-03-23"],
    ],
    [
      "yearly on Feb 29: Feb 28 in non-leap years",
      yearly(29, 2),
      "2023-01-01",
      "2028-12-31",
      ["2023-02-28", "2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
    ],
    [
      "yearly on Feb 30 is the month's last day",
      yearly(30, 2),
      "2024-01-01",
      "2025-12-31",
      ["2024-02-29", "2025-02-28"],
    ],
  ])("%s", (_, schedule, from, to, expected) => {
    expect(dueDatesBetween(schedule, from, to)).toEqual(expected);
  });

  test("nothing before the start date, even in the same period", () => {
    expect(dueDatesBetween(monthly(15, "2026-10-16"), "2026-10-01", "2026-12-31")).toEqual([
      "2026-11-15",
      "2026-12-15",
    ]);
    expect(dueDatesBetween(monthly(15, "2026-10-15"), "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-15",
    ]);
    expect(dueDatesBetween(weekly(1, "2026-10-06"), "2026-10-01", "2026-10-14")).toEqual([
      "2026-10-12",
    ]);
    expect(dueDatesBetween(yearly(23, 3, "2026-03-24"), "2026-01-01", "2027-12-31")).toEqual([
      "2027-03-23",
    ]);
    expect(dueDatesBetween(monthly(1), "2026-10-10", "2026-10-01")).toEqual([]);
  });

  test("isDueDate", () => {
    expect(isDueDate(monthly(31), "2026-02-28")).toBe(true);
    expect(isDueDate(monthly(31), "2026-02-27")).toBe(false);
    expect(isDueDate(monthly(31, "2026-03-01"), "2026-02-28")).toBe(false);
    expect(isDueDate(weekly(3), "2026-10-07")).toBe(true);
    expect(isDueDate(everyN(3, 5, 3), "2026-04-05")).toBe(false);
  });

  test("the next due dates (the payment page shows 3)", () => {
    expect(nextDueDates(monthly(31), "2026-01-31", 3)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    expect(nextDueDates(yearly(23, 3), "2026-10-05", 3)).toEqual([
      "2027-03-23",
      "2028-03-23",
      "2029-03-23",
    ]);
    expect(nextDueDates(weekly(5), "2026-10-05", 3)).toEqual([
      "2026-10-09",
      "2026-10-16",
      "2026-10-23",
    ]);
    expect(nextDueDate(monthly(15, "2027-01-01"), "2026-10-05")).toBe("2027-01-15");
  });
});

describe("pending periods", () => {
  const today = "2026-10-05";

  test("the window: 60 days back, 7 ahead", () => {
    expect(pendingWindow(today)).toEqual({ from: "2026-08-06", to: "2026-10-12" });
  });

  test("monthly: the overdue ones of the last 60 days and the next within 7, oldest first", () => {
    expect(pendingPeriods(monthly(5), new Set(), today)).toEqual(["2026-09-05", "2026-10-05"]);
    // Day 6 of August is exactly 60 days back; day 5 is 61.
    expect(pendingPeriods(monthly(6), new Set(), today)).toEqual([
      "2026-08-06",
      "2026-09-06",
      "2026-10-06",
    ]);
    expect(pendingPeriods(monthly(12), new Set(), today)).toEqual([
      "2026-08-12",
      "2026-09-12",
      "2026-10-12",
    ]);
    expect(pendingPeriods(monthly(13), new Set(), today)).toEqual(["2026-08-13", "2026-09-13"]);
  });

  test("paid and skipped periods are out", () => {
    expect(pendingPeriods(monthly(5), new Set(["2026-09-05"]), today)).toEqual(["2026-10-05"]);
    expect(pendingPeriods(monthly(5), new Set(["2026-09-05", "2026-10-05"]), today)).toEqual([]);
  });

  test("a payment that starts today has nothing overdue (imports start clean)", () => {
    expect(pendingPeriods(monthly(5, "2026-10-06"), new Set(), today)).toEqual([]);
    expect(pendingPeriods(monthly(8, "2026-10-05"), new Set(), today)).toEqual(["2026-10-08"]);
  });

  test("yearly far away: nothing pending", () => {
    expect(pendingPeriods(yearly(23, 3), new Set(), today)).toEqual([]);
  });

  test("weekly: every week of the window", () => {
    const periods = pendingPeriods(weekly(1), new Set(), today);
    expect(periods[0]).toBe("2026-08-10");
    expect(periods.at(-1)).toBe("2026-10-12");
    expect(periods).toHaveLength(10);
  });
});

// ── Exhaustive comparison against a day-by-day reference ─────────────────────────────────────

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whether `day` is a due date by the definition itself (no shortcuts). */
function referenceIsDue(schedule: Schedule, day: string): boolean {
  if (day < schedule.startDate) return false;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  if (schedule.cycle === "weekly") return isoWeekday(day) === schedule.weekday;
  const target = Math.min(schedule.dayOfMonth!, daysIn(year, month));
  if (date !== target) return false;
  if (schedule.cycle === "monthly") return true;
  if (schedule.cycle === "yearly") return month === schedule.anchorMonth;
  const startYear = Number(schedule.startDate.slice(0, 4));
  const diff = year * 12 + (month - 1) - (startYear * 12 + (schedule.anchorMonth! - 1));
  return (
    ((diff % schedule.intervalMonths!) + schedule.intervalMonths!) % schedule.intervalMonths! === 0
  );
}

function allSchedules(): Schedule[] {
  const schedules: Schedule[] = [];
  const starts = ["2023-01-01", "2024-02-29", "2025-07-15", "2026-10-31"];
  for (const start of starts) {
    for (let weekday = 1; weekday <= 7; weekday++) schedules.push(weekly(weekday, start));
    for (let day = 1; day <= 31; day++) {
      schedules.push(monthly(day, start));
      for (let month = 1; month <= 12; month++) schedules.push(yearly(day, month, start));
    }
    for (let interval = 2; interval <= 12; interval++) {
      for (const day of [1, 15, 28, 29, 30, 31]) {
        for (const anchor of [1, 2, 6, 11, 12])
          schedules.push(everyN(interval, day, anchor, start));
      }
    }
  }
  return schedules;
}

test("every cycle matches the day-by-day reference from 2022 to 2029", () => {
  const from = "2022-11-01";
  const to = "2029-03-31";
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  const mismatches: string[] = [];
  for (const schedule of allSchedules()) {
    const expected = days.filter((day) => referenceIsDue(schedule, day));
    const actual = dueDatesBetween(schedule, from, to);
    if (expected.join() !== actual.join()) {
      mismatches.push(`${JSON.stringify(schedule)}: ${actual.length} vs ${expected.length}`);
    }
    // nextDueDates agrees with the reference too (from a few points).
    for (const point of ["2023-02-27", "2024-12-31", "2026-10-05"]) {
      const want = expected.filter((day) => day >= point).slice(0, 3);
      if (want.length === 3 && nextDueDates(schedule, point, 3).join() !== want.join()) {
        mismatches.push(`next ${point} ${JSON.stringify(schedule)}`);
      }
    }
  }
  expect(mismatches).toEqual([]);
}, 60_000);
