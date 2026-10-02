// H1 of `habits`: Lima days, Monday weeks and the 7-day logging window (pure).
import { describe, expect, test } from "vitest";
import { ownerDateKey } from "@/lib/time";
import {
  addDays,
  isLoggableDay,
  isoWeekday,
  isScheduledOn,
  logWindowStart,
  weekStart,
  type HabitSchedule,
} from "@/modules/habits/schedule";

describe("days", () => {
  test("addDays crosses months, leap days and years", () => {
    expect(addDays("2026-10-02", 1)).toBe("2026-10-03");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-03", -7)).toBe("2026-12-27");
  });

  test("ISO weekdays and Monday weeks (a Sunday belongs to the week before)", () => {
    expect(isoWeekday("2026-10-05")).toBe(1); // Monday
    expect(isoWeekday("2026-10-04")).toBe(7); // Sunday
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });

  test("today in Lima flips at 05:00 UTC, not at UTC midnight", () => {
    expect(ownerDateKey(new Date("2026-10-03T04:59:59Z"))).toBe("2026-10-02");
    expect(ownerDateKey(new Date("2026-10-03T05:00:00Z"))).toBe("2026-10-03");
  });
});

describe("isLoggableDay", () => {
  const today = "2026-10-02";

  test("today and the 7 days before; not the 8th, never the future", () => {
    expect(logWindowStart(today)).toBe("2026-09-25");
    expect(isLoggableDay(today, today, "2026-01-01")).toBe(true);
    expect(isLoggableDay("2026-09-25", today, "2026-01-01")).toBe(true);
    expect(isLoggableDay("2026-09-24", today, "2026-01-01")).toBe(false);
    expect(isLoggableDay("2026-10-03", today, "2026-01-01")).toBe(false);
  });

  test("never before the habit's start date", () => {
    expect(isLoggableDay("2026-09-30", today, "2026-10-01")).toBe(false);
    expect(isLoggableDay("2026-10-01", today, "2026-10-01")).toBe(true);
  });

  test("the window crosses the year", () => {
    expect(isLoggableDay("2026-12-26", "2027-01-02", "2026-01-01")).toBe(true);
    expect(isLoggableDay("2026-12-25", "2027-01-02", "2026-01-01")).toBe(false);
  });
});

describe("isScheduledOn", () => {
  const daily: HabitSchedule = {
    frequency: "daily",
    weeklyTarget: null,
    weekdays: null,
    startDate: "2026-10-02",
  };

  test("a daily habit is due every day from its start date", () => {
    expect(isScheduledOn(daily, "2026-10-01")).toBe(false);
    expect(isScheduledOn(daily, "2026-10-02")).toBe(true);
    expect(isScheduledOn(daily, "2027-03-15")).toBe(true);
  });
});
