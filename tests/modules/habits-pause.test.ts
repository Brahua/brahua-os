// H4 of `habits`: the pause's validation (Zod, the start's window), the earlier days that can be
// logged, "paused today" and the proportional quota of the pad's week (pure).
import { describe, expect, test } from "vitest";
import type { HabitItem } from "@/modules/habits/habit-input";
import { isPausedToday } from "@/modules/habits/habit-status";
import { PAUSE_ERRORS } from "@/modules/habits/pause-copy";
import { pauseHabitInputSchema, pauseLength, pauseStartError } from "@/modules/habits/pause-input";
import { daysBetween, otherLoggableDays } from "@/modules/habits/schedule";
import { weekProgress } from "@/modules/habits/week-progress";

const ID = "00000000-0000-4000-8000-000000000001";
const TODAY = "2026-10-02";

describe("pause input (Zod)", () => {
  const parse = (values: Record<string, unknown>) =>
    pauseHabitInputSchema.safeParse({ id: ID, startDate: TODAY, endDate: TODAY, ...values });

  test("a range of real days, both included; one day is fine", () => {
    expect(parse({}).success).toBe(true);
    expect(pauseLength(TODAY, TODAY)).toBe(1);
    expect(pauseLength("2026-12-30", "2027-01-02")).toBe(4);
  });

  test("at most 90 days; never ending before it starts", () => {
    expect(parse({ endDate: "2026-12-30" }).success).toBe(true); // 90 days
    const tooLong = parse({ endDate: "2026-12-31" });
    expect(tooLong.success ? null : tooLong.error.issues[0]?.message).toBe(PAUSE_ERRORS.tooLong);
    const before = parse({ endDate: "2026-10-01" });
    expect(before.success ? null : before.error.issues[0]?.message).toBe(
      PAUSE_ERRORS.endBeforeStart,
    );
  });

  test("dates must be real days", () => {
    for (const bad of ["2026-02-30", "02/10/2026", "", null, 20261002]) {
      expect(parse({ startDate: bad }).success).toBe(false);
      expect(parse({ endDate: bad }).success).toBe(false);
    }
  });

  test("the reason: optional, normalized, up to 60, no invisible characters", () => {
    for (const none of [undefined, null, "", "   "]) {
      const parsed = parse({ reason: none });
      expect(parsed.success && parsed.data.reason).toBeNull();
    }
    const parsed = parse({ reason: "  Viaje\n a Cusco " });
    expect(parsed.success && parsed.data.reason).toBe("Viaje a Cusco");
    expect(parse({ reason: "x".repeat(60) }).success).toBe(true);
    expect(parse({ reason: "x".repeat(61) }).success).toBe(false);
    expect(parse({ reason: "Vi​aje" }).success).toBe(false);
  });

  test("the start: from 7 days back to a year ahead (Lima days)", () => {
    expect(pauseStartError("2026-09-25", TODAY)).toBeNull();
    expect(pauseStartError("2026-09-24", TODAY)).toBe(PAUSE_ERRORS.startTooEarly);
    expect(pauseStartError("2027-10-02", TODAY)).toBeNull();
    expect(pauseStartError("2027-10-03", TODAY)).toBe(PAUSE_ERRORS.startTooLate);
    // Across a year change.
    expect(pauseStartError("2026-12-25", "2027-01-01")).toBeNull();
    expect(pauseStartError("2026-12-24", "2027-01-01")).toBe(PAUSE_ERRORS.startTooEarly);
  });
});

describe("the earlier days that can be logged", () => {
  test("the 7 before today, yesterday first, never before the start date", () => {
    expect(otherLoggableDays("2026-01-01", TODAY)).toEqual([
      "2026-10-01",
      "2026-09-30",
      "2026-09-29",
      "2026-09-28",
      "2026-09-27",
      "2026-09-26",
      "2026-09-25",
    ]);
    expect(otherLoggableDays("2026-09-30", TODAY)).toEqual(["2026-10-01", "2026-09-30"]);
    expect(otherLoggableDays(TODAY, TODAY)).toEqual([]);
    // Across a month and a year.
    expect(otherLoggableDays("2026-12-31", "2027-01-02")).toEqual(["2027-01-01", "2026-12-31"]);
    expect(daysBetween("2026-12-31", "2027-01-02")).toBe(2);
  });
});

describe("paused today and the pad's week", () => {
  const pause = (startDate: string, endDate: string) => ({
    pause: { id: ID, startDate, endDate, reason: null },
  });

  test("a pause covers today from its first to its last day; a later one doesn't", () => {
    expect(isPausedToday(pause(TODAY, TODAY), TODAY)).toBe(true);
    expect(isPausedToday(pause("2026-09-28", TODAY), TODAY)).toBe(true);
    expect(isPausedToday(pause("2026-10-03", "2026-10-05"), TODAY)).toBe(false);
    expect(isPausedToday(pause("2026-09-28", "2026-10-01"), TODAY)).toBe(false);
    expect(isPausedToday({ pause: null }, TODAY)).toBe(false);
  });

  test("the week's quota follows its available days: 3x with 3 available asks for 2", () => {
    const week = (weekAvailable: number, weekDoneBefore = 0) =>
      ({
        frequency: "weekly_count",
        weeklyTarget: 3,
        weekDoneBefore,
        weekAvailable,
      }) as Pick<HabitItem, "frequency" | "weeklyTarget" | "weekDoneBefore" | "weekAvailable">;
    expect(weekProgress(week(7), false)).toEqual({ done: 0, quota: 3 });
    expect(weekProgress(week(3, 1), true)).toEqual({ done: 2, quota: 2 });
    expect(weekProgress(week(1), false)).toEqual({ done: 0, quota: 1 });
    expect(weekProgress(week(0), false)).toEqual({ done: 0, quota: 0 });
  });
});
