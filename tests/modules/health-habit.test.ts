// `health` E4, pure parts: the card Hoy shows («Entreno en curso» / «Empezar Rutina B» / nothing),
// the summary built from the reads, the Lima week of the weekly review (its edges), the linked
// habit of «Ajustes» and the copy.
import { describe, expect, test } from "vitest";
import { linkedHabit } from "@/modules/health/settings-input";
import { SETTINGS_COPY } from "@/modules/health/settings-copy";
import {
  buildTodaySummary,
  limaWeekBounds,
  trainingCard,
  type HealthTodaySummary,
} from "@/modules/health/today-summary";
import { TRAINING_COPY } from "@/modules/health/training-copy";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OPEN = { id: id(1), routineName: "Rutina A", startedAt: "2026-11-04T12:00:00.000Z" };
const NEXT = { routineId: id(2), routineName: "Rutina B" };

describe("trainingCard (SPEC-health «Hoy»)", () => {
  test.each<[string, HealthTodaySummary, ReturnType<typeof trainingCard>]>([
    [
      "an open session: «Entreno en curso», whatever the habit says",
      { running: OPEN, next: NEXT, habitDue: true },
      { kind: "running", ...OPEN },
    ],
    [
      "an open free session",
      { running: { ...OPEN, routineName: null }, next: null, habitDue: false },
      { kind: "running", ...OPEN, routineName: null },
    ],
    [
      "no session, the habit due and a routine: «Empezar Rutina B»",
      { running: null, next: NEXT, habitDue: true },
      { kind: "start", ...NEXT },
    ],
    [
      "the habit due without routines: nothing",
      { running: null, next: null, habitDue: true },
      null,
    ],
    [
      "a routine but the habit not due (or done, or none linked): nothing",
      { running: null, next: NEXT, habitDue: false },
      null,
    ],
  ])("%s", (_, summary, expected) => {
    expect(trainingCard(summary)).toEqual(expected);
  });
});

describe("buildTodaySummary", () => {
  test("the open session, the routine the rotation says (never done first) and the habit", () => {
    const routines = [
      { id: id(10), name: "Rutina A", position: 0, lastDoneAt: "2026-11-01T12:00:00.000Z" },
      { id: id(11), name: "Rutina B", position: 1, lastDoneAt: null },
    ];
    expect(buildTodaySummary(null, routines, true)).toEqual({
      running: null,
      next: { routineId: id(11), routineName: "Rutina B" },
      habitDue: true,
    });
    expect(buildTodaySummary(OPEN, [], false)).toEqual({
      running: OPEN,
      next: null,
      habitDue: false,
    });
  });
});

describe("limaWeekBounds", () => {
  test("any day of the week reads Monday 00:00 Lima to the next Monday, excluded", () => {
    const week = {
      from: new Date("2026-11-02T05:00:00.000Z"),
      to: new Date("2026-11-09T05:00:00.000Z"),
    };
    expect(limaWeekBounds("2026-11-02")).toEqual(week);
    expect(limaWeekBounds("2026-11-04")).toEqual(week);
    expect(limaWeekBounds("2026-11-08")).toEqual(week);
    // Across a month and a year.
    expect(limaWeekBounds("2027-01-01")).toEqual({
      from: new Date("2026-12-28T05:00:00.000Z"),
      to: new Date("2027-01-04T05:00:00.000Z"),
    });
  });

  test.each(["", "2026-11", "2026-02-30", "2026-13-01", "lunes", "2026-11-04T00:00"])(
    "a malformed day «%s» reads nothing",
    (day) => {
      expect(limaWeekBounds(day)).toBeNull();
    },
  );
});

describe("linkedHabit (Ajustes)", () => {
  const options = [{ id: id(20), name: "Gimnasio" }];

  test("none, a habit a session can mark, and one that no longer exists", () => {
    expect(linkedHabit({ habitId: null, options })).toEqual({ name: null, missing: false });
    expect(linkedHabit({ habitId: id(20), options })).toEqual({ name: "Gimnasio", missing: false });
    expect(linkedHabit({ habitId: id(21), options })).toEqual({ name: null, missing: true });
  });
});

describe("the copy", () => {
  test("says what the spec says", () => {
    expect(SETTINGS_COPY.habitLabel).toBe("Al terminar una sesión, marcar el hábito");
    expect(SETTINGS_COPY.missing).toBe("Hábito enlazado (ya no existe)");
    expect(SETTINGS_COPY.habitMarked("Gimnasio")).toBe("Marcaste «Gimnasio».");
    expect(SETTINGS_COPY.linkHelp("Gimnasio", false)).toBe(
      "Al terminar una sesión: marcar «Gimnasio».",
    );
    expect(SETTINGS_COPY.linkHelp(null, true)).toContain("(ya no existe)");
    expect(TRAINING_COPY.runningLine("Rutina A", 23)).toBe("Rutina A · 23 min");
    expect(TRAINING_COPY.runningLine("Rutina A", null)).toBe("Rutina A");
    expect(TRAINING_COPY.start("Rutina B")).toBe("Empezar Rutina B");
  });
});
