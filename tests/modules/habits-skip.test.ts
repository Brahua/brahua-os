// "Saltar hoy" (polish): the pure rules (what a skip is, the month's count, when it is offered),
// the copy and the pause the optimistic view shows.
import { describe, expect, test } from "vitest";
import { ownerDateKey } from "@/lib/time";
import { HABIT_SKIP_REASON } from "@/modules/habits/habit-constants";
import type { HabitItem } from "@/modules/habits/habit-input";
import { skipHabitInputSchema } from "@/modules/habits/pause-input";
import { SKIP_COPY } from "@/modules/habits/skip-copy";
import {
  canSkipToday,
  isSkipPause,
  pendingSkip,
  PENDING_SKIP_PREFIX,
  skippedDaysInMonth,
} from "@/modules/habits/skip-day";

const TODAY = "2026-10-02";
const pause = (startDate: string, endDate = startDate, reason: string | null = "Descanso") => ({
  startDate,
  endDate,
  reason,
});

function habit(values: Partial<HabitItem> = {}): HabitItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Gimnasio",
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

describe("isSkipPause", () => {
  test("a one-day pause with the reason Descanso", () => {
    expect(isSkipPause(pause(TODAY))).toBe(true);
    expect(HABIT_SKIP_REASON).toBe("Descanso");
  });

  test("not: another reason, no reason, more than a day (positive control above)", () => {
    expect(isSkipPause(pause(TODAY, TODAY, "Viaje"))).toBe(false);
    expect(isSkipPause(pause(TODAY, TODAY, null))).toBe(false);
    expect(isSkipPause(pause(TODAY, "2026-10-03"))).toBe(false);
  });
});

describe("skippedDaysInMonth", () => {
  test("counts the skips of the month, not other months, reasons or lengths", () => {
    const pauses = [
      pause("2026-09-30"),
      pause("2026-10-01"),
      pause("2026-10-02"),
      pause("2026-10-31"),
      pause("2026-11-01"),
      pause("2026-10-05", "2026-10-06"),
      pause("2026-10-07", "2026-10-07", "Viaje"),
    ];
    expect(skippedDaysInMonth(pauses, "2026-10")).toBe(3);
    expect(skippedDaysInMonth(pauses, "2026-09")).toBe(1);
    expect(skippedDaysInMonth(pauses, "2026-11")).toBe(1);
    expect(skippedDaysInMonth(pauses, "2026-08")).toBe(0);
    expect(skippedDaysInMonth([], "2026-10")).toBe(0);
  });

  test("a month prefix never matches another (2026-1 isn't 2026-10)", () => {
    expect(skippedDaysInMonth([pause("2026-10-01")], "2026-1")).toBe(0);
  });
});

describe("canSkipToday", () => {
  test("a habit to keep with no pause today", () => {
    expect(canSkipToday(habit(), TODAY)).toBe(true);
    expect(canSkipToday(habit({ measure: "quantity", goal: 8, target: 8 }), TODAY)).toBe(true);
  });

  test("not a habit to avoid, not one already resting today", () => {
    expect(canSkipToday(habit({ kind: "avoid" }), TODAY)).toBe(false);
    expect(
      canSkipToday(
        habit({ pause: { id: "p", startDate: "2026-09-30", endDate: TODAY, reason: null } }),
        TODAY,
      ),
    ).toBe(false);
  });

  test("a pause that starts tomorrow or ended yesterday doesn't block it (positive controls)", () => {
    const later = { id: "p", startDate: "2026-10-03", endDate: "2026-10-05", reason: null };
    const earlier = { id: "p", startDate: "2026-09-28", endDate: "2026-10-01", reason: null };
    expect(canSkipToday(habit({ pause: later }), TODAY)).toBe(true);
    expect(canSkipToday(habit({ pause: earlier }), TODAY)).toBe(true);
  });
});

describe("pendingSkip and Lima's day", () => {
  test("the optimistic pause is today's, a skip, with an id that isn't a real one", () => {
    const shown = pendingSkip("abc", TODAY);
    expect(shown).toEqual({
      id: `${PENDING_SKIP_PREFIX}abc`,
      startDate: TODAY,
      endDate: TODAY,
      reason: "Descanso",
    });
    expect(isSkipPause(shown)).toBe(true);
    // "pending-" is what the pause flow reads as "not saved yet" (its Reanudar waits).
    expect(shown.id.startsWith("pending-")).toBe(true);
  });

  test("Lima's midnight decides the day: 04:59:59Z is still yesterday, 05:00:00Z is today", () => {
    expect(ownerDateKey(new Date("2026-10-03T04:59:59Z"))).toBe("2026-10-02");
    expect(ownerDateKey(new Date("2026-10-03T05:00:00Z"))).toBe("2026-10-03");
    expect(pendingSkip("a", ownerDateKey(new Date("2026-10-03T05:00:00Z"))).startDate).toBe(
      "2026-10-03",
    );
  });
});

describe("input and copy", () => {
  test("only a habit id: today and the reason are never the client's", () => {
    expect(
      skipHabitInputSchema.safeParse({ id: "00000000-0000-4000-8000-000000000001" }).success,
    ).toBe(true);
    expect(skipHabitInputSchema.safeParse({ id: "x" }).success).toBe(false);
    const parsed = skipHabitInputSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      startDate: "2020-01-01",
      reason: "hack",
    });
    expect(parsed).toEqual({ id: "00000000-0000-4000-8000-000000000001" });
  });

  test("the notice, the month's count and the refusals read calm, without guilt", () => {
    expect(SKIP_COPY.skipToday).toBe("Saltar hoy");
    expect(SKIP_COPY.rests("Gimnasio")).toBe("«Gimnasio» descansa hoy.");
    expect(SKIP_COPY.monthCount(1, null)).toBe("1 día saltado este mes");
    expect(SKIP_COPY.monthCount(3, null)).toBe("3 días saltados este mes");
    expect(SKIP_COPY.monthCount(2, "septiembre de 2026")).toBe(
      "2 días saltados en septiembre de 2026",
    );
    const all = [
      SKIP_COPY.skipHelp,
      SKIP_COPY.rests("X"),
      SKIP_COPY.back("X"),
      SKIP_COPY.kept("X"),
      SKIP_COPY.notSkipped,
      SKIP_COPY.avoidRefused,
    ].join(" ");
    expect(all).not.toMatch(/fall|perdi|culpa|pereza|rendi/i);
  });
});
