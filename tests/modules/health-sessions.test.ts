// `health` E2, pure parts: weight, distance and time as typed ↔ stored; the prefill by position and
// «La vez pasada»; the rotation; the 4 h threshold and the proposed end; the rest timer (±15 s,
// zero, storage that throws); the values a set needs; the note.
import { afterEach, describe, expect, test, vi } from "vitest";
import { prefillSets, previousForOccurrence, previousLine } from "@/modules/health/prefill";
import {
  REST_BAR_MAX_SECONDS,
  adjustRest,
  readRest,
  restLeft,
  startRest,
  writeRest,
} from "@/modules/health/rest-timer";
import { nextRoutine } from "@/modules/health/rotation";
import { isLongSession, isValidEnd, proposedEnd } from "@/modules/health/session-end";
import {
  formatElapsed,
  formatMinutes,
  fromLimaInput,
  toLimaInput,
} from "@/modules/health/session-time";
import {
  keepShown,
  missingValue,
  sessionNoteSchema,
  updateTimesInputSchema,
  type SetValues,
} from "@/modules/health/sessions-input";
import {
  formatClock,
  formatDistance,
  formatKg,
  formatWeight,
  parseDistance,
  parseDuration,
  parseReps,
  parseWeight,
} from "@/modules/health/weight";

const values = (weightGrams: number | null, reps: number | null): SetValues => ({
  weightGrams,
  reps,
  seconds: null,
  distanceMeters: null,
});

describe("weight", () => {
  test("kilos as typed, with a comma or a point, to grams", () => {
    expect(parseWeight("82,5")).toEqual({ ok: true, value: 82_500 });
    expect(parseWeight("82.5")).toEqual({ ok: true, value: 82_500 });
    expect(parseWeight(" 82 ")).toEqual({ ok: true, value: 82_000 });
    expect(parseWeight("82,25")).toEqual({ ok: true, value: 82_250 });
    expect(parseWeight("0,75")).toEqual({ ok: true, value: 750 });
    expect(parseWeight(",5")).toEqual({ ok: true, value: 500 });
    expect(parseWeight("0")).toEqual({ ok: true, value: 0 });
    expect(parseWeight("1000")).toEqual({ ok: true, value: 1_000_000 });
    expect(parseWeight("007,5")).toEqual({ ok: true, value: 7_500 });
  });

  test("off the 0.25 kg steps, more than 2 decimals, out of range or not a number: refused", () => {
    for (const text of [
      "0,3",
      "82,1",
      "82,125",
      "1000,25",
      "1001",
      "-5",
      "",
      " ",
      "abc",
      "8,2,5",
      ".",
      "99999999",
    ]) {
      expect(parseWeight(text), text).toEqual({ ok: false });
    }
  });

  test("shown in Spanish, without trailing zeros", () => {
    expect(formatWeight(82_500)).toBe("82,5");
    expect(formatWeight(82_250)).toBe("82,25");
    expect(formatWeight(80_000)).toBe("80");
    expect(formatWeight(0)).toBe("0");
    expect(formatKg(82_500)).toBe("82,5 kg");
    // What is shown reads back the same.
    for (const grams of [0, 250, 82_500, 82_750, 1_000_000]) {
      expect(parseWeight(formatWeight(grams))).toEqual({ ok: true, value: grams });
    }
  });
});

describe("distance, time and reps", () => {
  test("kilometres to meters (3 decimals, up to 1000 km)", () => {
    expect(parseDistance("3,2")).toEqual({ ok: true, value: 3_200 });
    expect(parseDistance("0,005")).toEqual({ ok: true, value: 5 });
    expect(parseDistance("1000")).toEqual({ ok: true, value: 1_000_000 });
    expect(parseDistance("1000,001")).toEqual({ ok: false });
    expect(parseDistance("1,0005")).toEqual({ ok: false });
    expect(formatDistance(3_200)).toBe("3,2");
  });

  test("m:ss, h:mm:ss, or a plain number in seconds (time) or minutes (cardio)", () => {
    expect(parseDuration("1:30", "seconds")).toEqual({ ok: true, value: 90 });
    expect(parseDuration("0:45", "seconds")).toEqual({ ok: true, value: 45 });
    expect(parseDuration("45", "seconds")).toEqual({ ok: true, value: 45 });
    expect(parseDuration("20", "minutes")).toEqual({ ok: true, value: 1_200 });
    expect(parseDuration("1:02:03", "seconds")).toEqual({ ok: true, value: 3_723 });
    expect(parseDuration("10:00:00", "seconds")).toEqual({ ok: true, value: 36_000 });
    for (const text of ["0", "0:00", "1:60", "1:75:00", "10:00:01", "601", "abc", "1:5"]) {
      expect(parseDuration(text, text === "601" ? "minutes" : "seconds"), text).toEqual({
        ok: false,
      });
    }
    expect(formatClock(45)).toBe("0:45");
    expect(formatClock(1_200)).toBe("20:00");
    expect(formatClock(3_723)).toBe("1:02:03");
  });

  test("reps are whole, 1–999", () => {
    expect(parseReps("8")).toEqual({ ok: true, value: 8 });
    expect(parseReps("999")).toEqual({ ok: true, value: 999 });
    for (const text of ["0", "1000", "8,5", "", "-1"])
      expect(parseReps(text), text).toEqual({ ok: false });
  });
});

describe("what a set needs", () => {
  test("the required values by kind, and the shown ones kept", () => {
    expect(missingValue("weight_reps", values(null, 8))).toBe("weightGrams");
    expect(missingValue("weight_reps", values(0, 8))).toBeNull();
    expect(missingValue("reps", values(null, 8))).toBeNull();
    expect(missingValue("reps", values(10_000, null))).toBe("reps");
    expect(missingValue("time", values(null, null))).toBe("seconds");
    expect(missingValue("cardio", { ...values(null, null), seconds: 60 })).toBeNull();
    expect(keepShown("time", { weightGrams: 1, reps: 2, seconds: 3, distanceMeters: 4 })).toEqual({
      weightGrams: null,
      reps: null,
      seconds: 3,
      distanceMeters: null,
    });
  });

  test("the note: trimmed, line breaks kept, empty is none, ≤ 500, no control characters", () => {
    expect(sessionNoteSchema.parse("  Buen día\r\nSueño bien ")).toBe("Buen día\nSueño bien");
    expect(sessionNoteSchema.parse("   ")).toBeNull();
    expect(sessionNoteSchema.safeParse("x".repeat(500)).success).toBe(true);
    expect(sessionNoteSchema.safeParse("x".repeat(501)).success).toBe(false);
    expect(sessionNoteSchema.safeParse("a\u0000b").success).toBe(false);
    // The line break is the only control character allowed: a tab is refused.
    expect(sessionNoteSchema.safeParse("a\tb").success).toBe(false);
  });

  test("corrected times: within the last year (never before 2000), at most 24 h, end after start", () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const now = Date.now();
    const at = (ms: number) => new Date(ms).toISOString();
    const issues = (startedAt: string, endedAt: string) => {
      const parsed = updateTimesInputSchema.safeParse({ sessionId, startedAt, endedAt });
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
    };
    expect(issues(at(now - 3_600_000), at(now - 600_000))).toEqual([]);
    expect(issues(at(now - 3_600_000), at(now - 3_700_000))).toEqual(["endedAt"]);
    expect(issues(at(now - 30 * 3_600_000), at(now - 3_600_000))).toEqual(["endedAt"]);
    expect(issues(at(now - 400 * 86_400_000), at(now - 400 * 86_400_000 + 3_600_000))).toEqual([
      "startedAt",
    ]);
    expect(issues("1999-12-31T23:00:00.000Z", "2000-01-01T00:00:00.000Z")).toEqual(["startedAt"]);
  });
});

describe("prefill and «La vez pasada»", () => {
  const last = [values(80_000, 8), values(80_000, 8), values(82_500, 7)];

  test("same position; past the end the last done set; never done: empty", () => {
    expect(prefillSets(last, 4)).toEqual([...last, values(82_500, 7)]);
    expect(prefillSets(last, 2)).toEqual(last.slice(0, 2));
    expect(prefillSets([], 2)).toEqual([values(null, null), values(null, null)]);
    // Copies, never the same objects.
    expect(prefillSets(last, 1)[0]).not.toBe(last[0]);
  });

  test("a repeated exercise: the n-th block takes the n-th previous block, then the last", () => {
    const first = [values(100_000, 5)];
    const second = [values(60_000, 12), values(60_000, 12)];
    expect(previousForOccurrence([first, second], 0)).toBe(first);
    expect(previousForOccurrence([first, second], 1)).toBe(second);
    expect(previousForOccurrence([first, second], 2)).toBe(second);
    expect(previousForOccurrence([], 0)).toEqual([]);
  });

  test("the line names the unit once", () => {
    expect(previousLine("weight_reps", last)).toBe("80 kg × 8 · 80 × 8 · 82,5 × 7");
    expect(previousLine("weight_reps", [])).toBeNull();
    expect(previousLine("reps", [values(null, 12), values(null, 10)])).toBe("12 reps · 10");
    expect(previousLine("reps", [values(10_000, 8)])).toBe("8 reps (+10 kg)");
    expect(previousLine("time", [{ ...values(null, null), seconds: 45 }])).toBe("0:45");
    expect(
      previousLine("cardio", [{ ...values(null, null), seconds: 1_200, distanceMeters: 3_200 }]),
    ).toBe("20:00 · 3,2 km");
  });
});

describe("rotation", () => {
  const routine = (id: string, position: number, lastDoneAt: string | null) => ({
    id,
    name: id,
    position,
    lastDoneAt,
  });

  test("never-done first by order, then the oldest last session, ties by order", () => {
    expect(nextRoutine([])).toBeNull();
    expect(
      nextRoutine([
        routine("A", 0, "2026-11-01T18:00:00Z"),
        routine("C", 2, null),
        routine("B", 1, null),
      ])?.id,
    ).toBe("B");
    expect(
      nextRoutine([
        routine("A", 0, "2026-11-03T18:00:00Z"),
        routine("B", 1, "2026-11-01T18:00:00Z"),
        routine("C", 2, "2026-11-02T18:00:00Z"),
      ])?.id,
    ).toBe("B");
    expect(
      nextRoutine([
        routine("B", 1, "2026-11-01T18:00:00Z"),
        routine("A", 0, "2026-11-01T18:00:00Z"),
      ])?.id,
    ).toBe("A");
  });
});

describe("the 4 h threshold and the proposed end", () => {
  const start = "2026-11-04T18:00:00.000Z";
  const at = (minutes: number) => Date.parse(start) + minutes * 60_000;

  test("up to 4 h the end is now", () => {
    expect(isLongSession(start, at(240))).toBe(false);
    expect(proposedEnd(start, [new Date(at(30)).toISOString()], at(240))).toBe(at(240));
  });

  test("past 4 h: the last marked set + 5 min, within the start and now", () => {
    expect(isLongSession(start, at(241))).toBe(true);
    const sets = [new Date(at(50)).toISOString(), new Date(at(20)).toISOString()];
    expect(proposedEnd(start, sets, at(600))).toBe(at(55));
    expect(proposedEnd(start, [], at(600))).toBe(at(5));
    // A set marked a moment ago: never after now.
    expect(proposedEnd(start, [new Date(at(599)).toISOString()], at(600))).toBe(at(600));
    expect(isValidEnd(start, at(55), at(600))).toBe(true);
    expect(isValidEnd(start, at(-1), at(600))).toBe(false);
    expect(isValidEnd(start, at(601), at(600))).toBe(false);
    expect(isValidEnd(start, Number.NaN, at(600))).toBe(false);
  });

  test("times in Lima for the inputs, and as the screens say them", () => {
    expect(toLimaInput(start)).toBe("2026-11-04T13:00");
    expect(fromLimaInput("2026-11-04T13:00")).toBe(Date.parse(start));
    expect(fromLimaInput("ayer")).toBeNaN();
    expect(formatMinutes(52)).toBe("52 min");
    expect(formatMinutes(65)).toBe("1 h 5 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatElapsed(125_000)).toBe("2:05");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });
});

describe("rest timer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  test("counts down from its end, ±15 s, and −15 s to zero stops it", () => {
    const rest = startRest(120, 1_000);
    expect(restLeft(rest, 1_000)).toBe(120);
    expect(restLeft(rest, 1_500)).toBe(120);
    expect(restLeft(rest, 61_000)).toBe(60);
    expect(restLeft(rest, 200_000)).toBe(0);
    expect(adjustRest(rest, 1, 1_000)).toEqual({ endAt: 136_000, total: 135 });
    expect(adjustRest(rest, -1, 1_000)).toEqual({ endAt: 106_000, total: 120 });
    expect(adjustRest(startRest(10, 0), -1, 0)).toBeNull();
    // «+15 s» stops at the longest rest.
    expect(adjustRest(startRest(REST_BAR_MAX_SECONDS, 0), 1, 0)?.endAt).toBe(
      REST_BAR_MAX_SECONDS * 1000,
    );
  });

  test("kept in sessionStorage per session; over, malformed or unreadable: none", () => {
    writeRest("s1", { endAt: 50_000, total: 90 });
    expect(readRest("s1", 10_000)).toEqual({ endAt: 50_000, total: 90 });
    expect(readRest("s2", 10_000)).toBeNull();
    expect(readRest("s1", 60_000)).toBeNull();
    writeRest("s1", null);
    expect(readRest("s1", 10_000)).toBeNull();
    window.sessionStorage.setItem("health:rest:s3", "{nope");
    expect(readRest("s3", 0)).toBeNull();
    window.sessionStorage.setItem("health:rest:s3", JSON.stringify({ endAt: "x", total: 1 }));
    expect(readRest("s3", 0)).toBeNull();
    // Beyond the longest rest, or without a length: ignored.
    const far = REST_BAR_MAX_SECONDS * 1000 + 1;
    window.sessionStorage.setItem("health:rest:s3", JSON.stringify({ endAt: far, total: 90 }));
    expect(readRest("s3", 0)).toBeNull();
    window.sessionStorage.setItem("health:rest:s3", JSON.stringify({ endAt: 5_000, total: 0 }));
    expect(readRest("s3", 0)).toBeNull();
  });

  test("a storage that throws never breaks it", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeRest("s1", { endAt: 1, total: 1 })).not.toThrow();
    expect(readRest("s1", 0)).toBeNull();
  });
});
