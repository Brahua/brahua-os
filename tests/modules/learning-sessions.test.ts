// L2 of `learning`: Lima's week (a session counts in the week it started: Monday 00:00, Sunday
// 23:59 and one that crosses into Monday), the week's minutes against the target, the timer's
// duration and its 4 h threshold, «Anotar tiempo» (days and where the session sits), the sessions
// grouped by week, the schemas, and the copy's sentences (SPEC-learning "Estrategia de pruebas").
import { describe, expect, test } from "vitest";
import { ownerDateKey } from "@/lib/time";
import {
  addDays,
  formatElapsed,
  isManualDay,
  limaDayStart,
  manualDays,
  manualSpan,
  maxConfirmMinutes,
  mondayOf,
  needsConfirmation,
  sessionsSince,
  sessionWeek,
  timerMinutes,
  weekBounds,
  weekGoal,
} from "@/modules/learning/pace";
import { SESSION_ERRORS, SESSIONS_COPY } from "@/modules/learning/sessions-copy";
import {
  logSessionInputSchema,
  parseMinutesField,
  startSessionInputSchema,
  stopSessionInputSchema,
  undoStartInputSchema,
  type SessionItem,
} from "@/modules/learning/sessions-input";
import { clockTime, dayLabel, groupByWeek, relativeDay } from "@/modules/learning/sessions-view";

const MIN = 60_000;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("Lima's week", () => {
  // 2026-11-02 is a Monday; Lima's midnight is 05:00 UTC.
  test.each([
    ["Monday 00:00 Lima", "2026-11-02T05:00:00.000Z", "2026-11-02"],
    ["Sunday 23:59 Lima (Monday 04:59 UTC)", "2026-11-09T04:59:59.999Z", "2026-11-02"],
    ["Monday 00:00 of the next week", "2026-11-09T05:00:00.000Z", "2026-11-09"],
    ["Sunday 23:59 of the week before", "2026-11-02T04:59:00.000Z", "2026-10-26"],
    ["across a year", "2027-01-01T15:00:00.000Z", "2026-12-28"],
  ])("%s", (_, instant, monday) => {
    expect(sessionWeek(instant)).toBe(monday);
    expect(weekBounds(new Date(instant)).weekStart).toBe(monday);
  });

  test("the week's bounds are Lima's Mondays at 00:00, the next one excluded", () => {
    const { from, to } = weekBounds(new Date("2026-11-04T20:00:00Z"));
    expect(from.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(limaDayStart("2026-11-02").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  test("a session that starts on Sunday night and ends on Monday counts in Sunday's week", () => {
    const started = "2026-11-09T04:30:00.000Z"; // Sunday 23:30 Lima
    expect(sessionWeek(started)).toBe("2026-11-02");
    const sessions: SessionItem[] = [
      session(1, "2026-11-09T05:10:00.000Z", 20), // Monday 00:10
      session(2, started, 60),
    ];
    expect(groupByWeek(sessions).map((week) => [week.weekStart, week.minutes])).toEqual([
      ["2026-11-09", 20],
      ["2026-11-02", 60],
    ]);
  });

  test("days and Mondays across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
  });

  test("a track's page lists from the Monday 7 weeks before this one", () => {
    expect(sessionsSince(new Date("2026-11-04T20:00:00Z"), 8).toISOString()).toBe(
      "2026-09-14T05:00:00.000Z",
    );
  });
});

describe("the weekly target", () => {
  test.each([
    [0, null, null],
    [80, null, { kind: "free", minutes: 80 }],
    [0, 180, { kind: "progress", minutes: 0, target: 180, left: 180 }],
    [80, 180, { kind: "progress", minutes: 80, target: 180, left: 100 }],
    [180, 180, { kind: "met", minutes: 180, target: 180 }],
    [200, 180, { kind: "met", minutes: 200, target: 180 }],
  ] as const)("%s min against %s", (minutes, target, expected) => {
    expect(weekGoal(minutes, target)).toEqual(expected);
  });

  test("the sentences: what is studied and what is left, never a debt", () => {
    expect(SESSIONS_COPY.weekProgress(80, 180)).toBe("1 h 20 de 3 h esta semana");
    expect(SESSIONS_COPY.weekLeft(100)).toBe("Te faltan 1 h 40");
    expect(SESSIONS_COPY.weekMet(200, 180)).toBe("Semana cumplida: 3 h 20 de 3 h");
    expect(SESSIONS_COPY.weekFree(45)).toBe("45 min esta semana");
  });
});

describe("the timer", () => {
  test("more than 4 h asks to confirm; exactly 4 h doesn't", () => {
    expect(needsConfirmation(240 * MIN)).toBe(false);
    expect(needsConfirmation(240 * MIN + 1)).toBe(true);
  });

  test("minutes: rounded, at least 1, and a confirmation up to what it ran (600 at most)", () => {
    expect(timerMinutes(10_000)).toBe(1);
    expect(timerMinutes(42 * MIN + 20_000)).toBe(42);
    expect(timerMinutes(42 * MIN + 40_000)).toBe(43);
    expect(maxConfirmMinutes(312 * MIN + 1)).toBe(313);
    expect(maxConfirmMinutes(15 * 60 * MIN)).toBe(600);
  });

  test("the running clock", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(4 * MIN + 5_000)).toBe("4:05");
    expect(formatElapsed(62 * MIN + 3_999)).toBe("1:02:03");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("«Anotar tiempo»", () => {
  test("today and 30 days back, nothing in the future", () => {
    const days = manualDays("2026-11-02");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-11-02");
    expect(days[30]).toBe("2026-10-03");
    expect(isManualDay("2026-10-03", "2026-11-02")).toBe(true);
    expect(isManualDay("2026-10-02", "2026-11-02")).toBe(false);
    expect(isManualDay("2026-11-03", "2026-11-02")).toBe(false);
  });

  test("today it ends now, never starting before today's 00:00", () => {
    const now = new Date("2026-11-02T05:20:00Z"); // Monday 00:20 Lima
    const span = manualSpan("2026-11-02", 60, now);
    expect(span.startedAt.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(span.endedAt.toISOString()).toBe(now.toISOString());
    // So it counts in today's week, not in last week (Sunday).
    expect(sessionWeek(span.startedAt)).toBe("2026-11-02");
    const later = manualSpan("2026-11-02", 30, new Date("2026-11-02T20:00:00Z"));
    expect(later.startedAt.toISOString()).toBe("2026-11-02T19:30:00.000Z");
  });

  test("another day sits at its noon and ends that same day, in that day's week", () => {
    const now = new Date("2026-11-02T15:00:00Z");
    const span = manualSpan("2026-11-01", 600, now); // Sunday
    expect(span.startedAt.toISOString()).toBe("2026-11-01T17:00:00.000Z");
    expect(ownerDateKey(span.endedAt)).toBe("2026-11-01");
    expect(sessionWeek(span.startedAt)).toBe("2026-10-26");
  });

  test("days as the sheet names them", () => {
    expect(relativeDay("2026-11-02", "2026-11-02")).toBe("Hoy");
    expect(relativeDay("2026-11-01", "2026-11-02")).toBe("Ayer");
    expect(relativeDay("2026-10-31", "2026-11-02")).toBe("sáb 31 oct");
    expect(dayLabel("2026-12-28", "2027-01-02")).toBe("lun 28 dic 2026");
    expect(clockTime("2026-11-02T00:05:00.000Z")).toBe("19:05");
  });
});

describe("the schemas", () => {
  test("minutes: whole numbers from 1 to 600", () => {
    expect(parseMinutesField(" 30 ")).toBe(30);
    expect(Number.isNaN(parseMinutesField("1.5"))).toBe(true);
    expect(Number.isNaN(parseMinutesField(""))).toBe(true);
    const log = (minutes: number) =>
      logSessionInputSchema.safeParse({ trackId: id(1), minutes, day: "2026-11-01" }).success;
    expect([log(1), log(600), log(0), log(601), log(Number.NaN)]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    const refused = logSessionInputSchema.safeParse({ trackId: id(1), minutes: 0, day: "x" });
    expect(refused.success ? [] : refused.error.issues.map((issue) => issue.message)).toEqual([
      SESSION_ERRORS.minutes,
      SESSION_ERRORS.day,
    ]);
  });

  test("start and stop take minutes only when given", () => {
    expect(startSessionInputSchema.parse({ trackId: id(1) })).toEqual({
      trackId: id(1),
      stopMinutes: null,
    });
    expect(stopSessionInputSchema.parse({ id: id(2), minutes: 300 })).toEqual({
      id: id(2),
      minutes: 300,
    });
    expect(stopSessionInputSchema.safeParse({ id: id(2), minutes: 601 }).success).toBe(false);
  });

  test("the start's «Deshacer» can't name the same session twice", () => {
    const stopped = { id: id(2), endedAt: "2026-11-02T15:00:00.000Z", minutes: 42 };
    expect(undoStartInputSchema.safeParse({ id: id(1), stopped }).success).toBe(true);
    expect(undoStartInputSchema.safeParse({ id: id(2), stopped }).success).toBe(false);
    expect(undoStartInputSchema.parse({ id: id(1) }).stopped).toBeNull();
  });
});

function session(n: number, startedAt: string, minutes: number): SessionItem {
  const endedAt = new Date(Date.parse(startedAt) + minutes * MIN).toISOString();
  return { id: id(n), source: "timer", startedAt, endedAt, minutes };
}
