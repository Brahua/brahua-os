// polish → postpone-one-tap: the pure rules: tomorrow in Lima's calendar (23:59 and midnight), the
// refusal of past days, the input schemas, the notice's phrase, and what "Día completo" counts when
// a row left by postponement.
import { describe, expect, test } from "vitest";
import { dayPhrase } from "@/modules/tasks/postpone-copy";
import {
  postponeDay,
  postponeTaskInputSchema,
  restoreDueDateInputSchema,
  tomorrowOf,
} from "@/modules/tasks/task-postpone";
import { completionsDelta } from "@/modules/today/today-board";

const ID = "00000000-0000-4000-8000-000000000001";

// Lima is UTC-5 all year (no daylight saving).
const LIMA_2359 = new Date("2026-10-03T04:59:00.000Z"); // Fri 2 Oct, 23:59 in Lima
const LIMA_MIDNIGHT = new Date("2026-10-03T05:00:00.000Z"); // Sat 3 Oct, 00:00 in Lima
const UTC_EVENING = new Date("2026-10-02T23:30:00.000Z"); // Fri 2 Oct, 18:30 in Lima (already Sat in UTC)

describe("tomorrowOf (Lima's calendar day)", () => {
  test("23:59 in Lima is still the same day: tomorrow is the next one", () => {
    expect(tomorrowOf(LIMA_2359)).toBe("2026-10-03");
  });

  test("at midnight in Lima the day has turned: tomorrow is one more", () => {
    expect(tomorrowOf(LIMA_MIDNIGHT)).toBe("2026-10-04");
  });

  test("it never follows UTC's day", () => {
    expect(tomorrowOf(UTC_EVENING)).toBe("2026-10-03");
  });

  test("crosses the end of a month and of a year", () => {
    expect(tomorrowOf(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(tomorrowOf(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(tomorrowOf(new Date("2028-02-28T15:00:00Z"))).toBe("2028-02-29");
  });
});

describe("postponeDay", () => {
  test("'tomorrow' resolves by Lima's day", () => {
    expect(postponeDay("tomorrow", LIMA_2359)).toBe("2026-10-03");
    expect(postponeDay("tomorrow", LIMA_MIDNIGHT)).toBe("2026-10-04");
  });

  test("a day from today on is accepted as is", () => {
    expect(postponeDay("2026-10-02", LIMA_2359)).toBe("2026-10-02");
    expect(postponeDay("2026-10-09", LIMA_2359)).toBe("2026-10-09");
  });

  test("a day before today in Lima is refused (null), also right after Lima's midnight", () => {
    expect(postponeDay("2026-10-01", LIMA_2359)).toBeNull();
    expect(postponeDay("2026-10-02", LIMA_MIDNIGHT)).toBeNull();
    expect(postponeDay("2026-10-03", LIMA_MIDNIGHT)).toBe("2026-10-03");
  });
});

describe("input schemas", () => {
  test("postponeTask takes an id and 'tomorrow' or a real calendar day", () => {
    expect(postponeTaskInputSchema.safeParse({ id: ID, to: "tomorrow" }).success).toBe(true);
    expect(postponeTaskInputSchema.safeParse({ id: ID, to: "2026-10-09" }).success).toBe(true);
    for (const to of ["", "mañana", "2026-02-31", "2026-13-01", "09/10/2026", null, 5, undefined]) {
      expect(postponeTaskInputSchema.safeParse({ id: ID, to }).success, String(to)).toBe(false);
    }
    expect(postponeTaskInputSchema.safeParse({ id: "x", to: "tomorrow" }).success).toBe(false);
    expect(postponeTaskInputSchema.safeParse({ to: "tomorrow" }).success).toBe(false);
  });

  test("the undo takes the day to put back (or none) and the day it expects", () => {
    expect(
      restoreDueDateInputSchema.safeParse({ id: ID, dueDate: "2026-09-30", expected: "2026-10-03" })
        .success,
    ).toBe(true);
    expect(
      restoreDueDateInputSchema.safeParse({ id: ID, dueDate: null, expected: "2026-10-03" })
        .success,
    ).toBe(true);
    expect(restoreDueDateInputSchema.safeParse({ id: ID, dueDate: null }).success).toBe(false);
    expect(
      restoreDueDateInputSchema.safeParse({ id: ID, dueDate: "ayer", expected: "2026-10-03" })
        .success,
    ).toBe(false);
  });
});

describe("dayPhrase", () => {
  test("where the task goes, by Lima's days", () => {
    const today = "2026-10-02";
    const tomorrow = "2026-10-03";
    expect(dayPhrase("2026-10-03", today, tomorrow)).toBe("a mañana");
    expect(dayPhrase("2026-10-02", today, tomorrow)).toBe("a hoy");
    expect(dayPhrase("2026-10-09", today, tomorrow)).toBe("al 9 oct. 2026");
  });
});

describe("completionsDelta (what 'Día completo' counts as completed)", () => {
  const none = new Set<string>();

  test("a completed row is one more; an undone completion is one less (as before)", () => {
    expect(completionsDelta(["a", "b"], ["b"], none)).toBe(1);
    expect(completionsDelta(["b"], ["a", "b"], none)).toBe(-1);
    expect(completionsDelta(["a"], ["a"], none)).toBe(0);
  });

  test("a postponed row that left is not a completion; its undo is not a reopening", () => {
    expect(completionsDelta(["a", "b"], ["b"], new Set(["a"]))).toBe(0);
    expect(completionsDelta(["b"], ["a", "b"], new Set(["a"]))).toBe(0);
  });

  test("positive control: a completion next to a postponement still counts", () => {
    expect(completionsDelta(["a", "b", "c"], ["c"], new Set(["a"]))).toBe(1);
  });
});
