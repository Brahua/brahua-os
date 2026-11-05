// `health` E3: the records, pure (SPEC-health "Récords"). Epley at 1, 12 and 13 reps, exact ties,
// the first value is not new, «earlier» is by start, each kind's metrics, a same-family kind switch,
// the line and the copy of the values. The data layer filters warmups and deleted rows (the
// integration test proves it on real rows); here the inputs are what it passes.
import { describe, expect, test } from "vitest";
import type { ExerciseKind } from "@/modules/health/health-constants";
import {
  bestLine,
  displayValue,
  estimatedOneRepMax,
  exerciseRecords,
  lineMetric,
  newRecordCounts,
  newRecords,
  scoreOf,
  type RecordSet,
} from "@/modules/health/records";
import { RECORDS_COPY, recordValue } from "@/modules/health/records-copy";
import { lineWindowStart } from "@/modules/health/session-time";

const SQUAT = "squat";
const PLANK = "plank";
const RUN = "run";
const DIPS = "dips";

/** A done set of session `session` (started on day `day` of Nov 2026, 18:00 Lima). */
function set(
  session: string,
  day: number,
  values: Partial<RecordSet> & { exerciseId?: string } = {},
): RecordSet {
  return {
    sessionId: session,
    startedAt: new Date(Date.UTC(2026, 10, day, 23, 0)).toISOString(),
    exerciseId: SQUAT,
    weightGrams: null,
    reps: null,
    seconds: null,
    distanceMeters: null,
    ...values,
  };
}

const kinds = (entries: [string, ExerciseKind][] = [[SQUAT, "weight_reps"]]) => new Map(entries);
const lift = (session: string, day: number, kg: number, reps: number) =>
  set(session, day, { weightGrams: kg * 1000, reps });

describe("scores", () => {
  test("Epley: 1 rep is the weight, 12 reps counts, 13 doesn't", () => {
    expect(estimatedOneRepMax(100_000, 1)).toBe(100_000);
    expect(estimatedOneRepMax(80_000, 12)).toBe(112_000);
    expect(estimatedOneRepMax(80_000, 13)).toBeNull();
    expect(estimatedOneRepMax(80_000, 8)).toBeCloseTo(101_333.33, 1);
    expect(estimatedOneRepMax(0, 5)).toBeNull();
  });

  test("the 1RM is shown rounded to 0,5 kg; other metrics as they are", () => {
    // 70 × (1 + 4/30) = 79,33 kg → 79,5 (the nearest half kilo).
    expect(
      displayValue(
        "e1rm",
        scoreOf("e1rm", { weightGrams: 70_000, reps: 4, seconds: null, distanceMeters: null })!,
      ),
    ).toBe(79_500);
    // 72,5 × (1 + 3/30) = 79,75 → 80 kg; 71 × 1,1 = 78,1 → 78 kg.
    expect(displayValue("e1rm", 72_500 * 33)).toBe(80_000);
    expect(displayValue("e1rm", 71_000 * 33)).toBe(78_000);
    expect(displayValue("maxWeight", 82_500)).toBe(82_500);
  });

  test("each metric needs its fields; a weight of 0 sets no weight record", () => {
    const empty = { weightGrams: null, reps: null, seconds: null, distanceMeters: null };
    expect(scoreOf("maxWeight", { ...empty, weightGrams: 0, reps: 10 })).toBeNull();
    expect(scoreOf("maxWeight", { ...empty, weightGrams: 50_000, reps: 20 })).toBe(50_000);
    expect(scoreOf("maxWeight", { ...empty, weightGrams: 50_000 })).toBeNull();
    expect(scoreOf("maxReps", { ...empty, reps: 15 })).toBe(15);
    expect(scoreOf("maxSeconds", { ...empty, seconds: 90 })).toBe(90);
    expect(scoreOf("maxDistance", { ...empty, distanceMeters: 0 })).toBeNull();
    expect(scoreOf("maxDistance", { ...empty, distanceMeters: 5_200 })).toBe(5_200);
  });
});

describe("new records", () => {
  test("the first value is not new; beating every earlier session is", () => {
    const sets = [lift("a", 1, 80, 8), lift("b", 3, 82.5, 7), lift("c", 5, 82.5, 8)];
    const found = newRecords(sets, kinds());
    expect(found.filter((r) => r.sessionId === "a")).toEqual([]);
    // b: heavier (82,5 > 80) and a better 1RM (82,5 × 37 > 80 × 38).
    expect(found.filter((r) => r.sessionId === "b").map((r) => r.metric)).toEqual([
      "maxWeight",
      "e1rm",
    ]);
    // c: the same weight is a tie (not new); one more rep beats b's 1RM.
    expect(found.filter((r) => r.sessionId === "c").map((r) => r.metric)).toEqual(["e1rm"]);
  });

  test("an exact tie is not new (1 rep at 100 vs Epley's exact equal)", () => {
    // 100 × 30 = 3000 and 93,75 × 32 = 3000: the same 1RM.
    const sets = [lift("a", 1, 100, 1), set("b", 2, { weightGrams: 93_750, reps: 2 })];
    expect(newRecords(sets, kinds()).map((r) => r.metric)).toEqual([]);
  });

  test("13 reps don't count for the 1RM, but the weight still does", () => {
    const sets = [lift("a", 1, 60, 10), lift("b", 2, 70, 13)];
    expect(newRecords(sets, kinds())).toEqual([
      { sessionId: "b", exerciseId: SQUAT, metric: "maxWeight", score: 70_000 },
    ]);
  });

  test("«earlier» is by start, not by input order; an older session never takes it back", () => {
    const sets = [lift("late", 9, 90, 5), lift("early", 2, 100, 5), lift("mid", 5, 95, 5)];
    // early: first. mid: 95 < 100, nothing. late: 90, nothing.
    expect(newRecords(sets, kinds())).toEqual([]);
    const counts = newRecordCounts([lift("a", 1, 80, 5), lift("b", 2, 85, 5)], kinds());
    expect([...counts]).toEqual([["b", 2]]);
  });

  test("two sessions with the same start compare against the same «before»", () => {
    const sets = [lift("a", 1, 80, 5), lift("b", 2, 85, 5), lift("c", 2, 90, 5)];
    const ids = newRecords(sets, kinds())
      .filter((r) => r.metric === "maxWeight")
      .map((r) => r.sessionId);
    expect(ids.toSorted()).toEqual(["b", "c"]);
  });

  test("the best set of the session counts, whatever block or order it is in", () => {
    const sets = [
      lift("a", 1, 80, 8),
      lift("b", 2, 70, 10),
      lift("b", 2, 85, 3),
      lift("b", 2, 60, 12),
    ];
    expect(
      newRecords(sets, kinds())
        .filter((r) => r.sessionId === "b")
        .map((r) => [r.metric, r.score]),
    ).toEqual([["maxWeight", 85_000]]);
  });

  test("per kind: reps, time, cardio (distance and time apart)", () => {
    const sets = [
      set("a", 1, { exerciseId: DIPS, reps: 10, weightGrams: 20_000 }),
      set("b", 2, { exerciseId: DIPS, reps: 12 }),
      set("a", 1, { exerciseId: PLANK, seconds: 60 }),
      set("b", 2, { exerciseId: PLANK, seconds: 60 }),
      set("a", 1, { exerciseId: RUN, seconds: 1_800, distanceMeters: 5_000 }),
      set("b", 2, { exerciseId: RUN, seconds: 1_500, distanceMeters: 5_200 }),
      set("c", 3, { exerciseId: RUN, seconds: 2_000 }),
    ];
    const found = newRecords(
      sets,
      kinds([
        [DIPS, "reps"],
        [PLANK, "time"],
        [RUN, "cardio"],
      ]),
    );
    expect(found.map((r) => [r.sessionId, r.exerciseId, r.metric, r.score])).toEqual([
      ["b", DIPS, "maxReps", 12],
      ["b", RUN, "maxDistance", 5_200],
      ["c", RUN, "maxSeconds", 2_000],
    ]);
  });

  test("a metric's first value is not new, even with earlier sessions of the exercise", () => {
    // a only has 15-rep sets (no 1RM); b's 1RM is the first one.
    const sets = [lift("a", 1, 50, 15), lift("b", 2, 50, 10)];
    expect(newRecords(sets, kinds())).toEqual([]);
  });

  test("after a same-family switch, the current kind decides with the fields present", () => {
    // Done as reps (no weight), now weight_reps: the old sets count for nothing weighed.
    const sets = [
      set("a", 1, { exerciseId: DIPS, reps: 15 }),
      set("b", 2, { exerciseId: DIPS, reps: 8, weightGrams: 10_000 }),
      set("c", 3, { exerciseId: DIPS, reps: 8, weightGrams: 12_500 }),
    ];
    expect(
      newRecords(sets, kinds([[DIPS, "weight_reps"]])).map((r) => [r.sessionId, r.metric]),
    ).toEqual([
      ["c", "maxWeight"],
      ["c", "e1rm"],
    ]);
    // The other way: weight_reps → reps, only the reps count.
    expect(newRecords(sets, kinds([[DIPS, "reps"]]))).toEqual([]);
  });

  test("an exercise without a kind is skipped", () => {
    expect(newRecords([lift("a", 1, 80, 5), lift("b", 2, 90, 5)], new Map())).toEqual([]);
  });
});

describe("an exercise's records and line", () => {
  test("the best per metric with the first session that reached it", () => {
    const sets = [lift("a", 1, 80, 8), lift("b", 3, 82.5, 7), lift("c", 5, 82.5, 8)];
    expect(exerciseRecords(sets, "weight_reps")).toEqual([
      { metric: "maxWeight", score: 82_500, sessionId: "b", startedAt: sets[1].startedAt },
      { metric: "e1rm", score: 82_500 * 38, sessionId: "c", startedAt: sets[2].startedAt },
    ]);
    expect(exerciseRecords([], "weight_reps")).toEqual([]);
  });

  test("the line: best per session in the window, oldest first, in display units", () => {
    const sets = [
      lift("old", 1, 60, 5),
      lift("b", 5, 80, 5),
      lift("b", 5, 85, 2),
      lift("a", 3, 82.5, 5),
    ];
    const from = new Date(Date.UTC(2026, 10, 2)).toISOString();
    expect(bestLine(sets, "maxWeight", from).map((p) => [p.sessionId, p.value])).toEqual([
      ["a", 82_500],
      ["b", 85_000],
    ]);
  });

  test("what the line draws by kind (cardio: distance when there is any, else time)", () => {
    expect(lineMetric("weight_reps", [])).toBe("maxWeight");
    expect(lineMetric("reps", [])).toBe("maxReps");
    expect(lineMetric("time", [])).toBe("maxSeconds");
    expect(lineMetric("cardio", [set("a", 1, { seconds: 600 })])).toBe("maxSeconds");
    expect(lineMetric("cardio", [set("a", 1, { seconds: 600, distanceMeters: 2_000 })])).toBe(
      "maxDistance",
    );
  });
});

describe("the line's window", () => {
  test("00:00 in Lima of the same day 12 months back, by Lima's day", () => {
    expect(lineWindowStart(new Date("2026-11-04T18:00:00Z"))).toBe("2025-11-04T05:00:00.000Z");
    // 23:30 in Lima on Nov 4 is already Nov 5 in UTC: the window still starts on Nov 4.
    expect(lineWindowStart(new Date("2026-11-05T04:30:00Z"))).toBe("2025-11-04T05:00:00.000Z");
    // 00:30 in Lima on Nov 5.
    expect(lineWindowStart(new Date("2026-11-05T05:30:00Z"))).toBe("2025-11-05T05:00:00.000Z");
    // 29 Feb has no twin the year before: 28 Feb.
    expect(lineWindowStart(new Date("2028-02-29T15:00:00Z"))).toBe("2027-02-28T05:00:00.000Z");
  });

  test("a session at 00:00 Lima of that day is in; one a second before is out", () => {
    const from = lineWindowStart(new Date("2026-11-04T18:00:00Z"));
    const at = (iso: string) => ({ ...lift("x", 1, 80, 5), sessionId: iso, startedAt: iso });
    const sets = [at("2025-11-04T04:59:59.000Z"), at("2025-11-04T05:00:00.000Z")];
    expect(bestLine(sets, "maxWeight", from).map((point) => point.startedAt)).toEqual([
      "2025-11-04T05:00:00.000Z",
    ]);
  });
});

describe("the copy of the values", () => {
  test("each metric reads naturally", () => {
    expect(RECORDS_COPY.newRecord("Sentadilla con barra", "maxWeight", 82_500)).toBe(
      "Sentadilla con barra: 82,5 kg",
    );
    expect(RECORDS_COPY.newRecord("Press de banca", "e1rm", 79_000)).toBe(
      "Press de banca: 1RM estimado 79 kg",
    );
    expect(recordValue("maxReps", 1)).toBe("1 repetición");
    expect(recordValue("maxReps", 15)).toBe("15 repeticiones");
    expect(recordValue("maxSeconds", 90)).toBe("1 min 30 s");
    expect(recordValue("maxDistance", 5_200)).toBe("5,2 km");
    expect(RECORDS_COPY.newCount(1)).toBe("1 récord nuevo");
    expect(RECORDS_COPY.newCount(2)).toBe("2 récords nuevos");
    expect(RECORDS_COPY.rowCount(2)).toBe("2 récords");
  });
});
