// `goals`: progress by source (progress.ts) and the rule that achieves or reopens a goal.
import { describe, expect, test } from "vitest";
import { achievementChange, progressOf } from "@/modules/goals/progress";

describe("progressOf", () => {
  test.each([
    [0, 12, 0, false],
    [5, 12, 5 / 12, false],
    [11, 12, 11 / 12, false],
    [12, 12, 1, true],
    [15, 12, 1, true], // over the target: the bar stays full, the value is kept
    [-3, 12, 0, false], // a correction below zero never shows a negative value
  ])("manual: sum %d of %d", (sum, target, ratio, reached) => {
    const progress = progressOf({ sourceKind: "manual", target }, { sourceKind: "manual", sum });
    expect(progress).toEqual({
      kind: "ok",
      value: Math.max(0, sum),
      target,
      ratio,
      reached,
    });
  });

  test.each([
    [0, 40, 0, false],
    [34, 40, 34 / 40, false],
    [40, 40, 1, true],
    [45, 40, 1, true], // more days than asked: the bar stays full
  ])("habit: %d days done of %d", (done, target, ratio, reached) => {
    expect(progressOf({ sourceKind: "habit", target }, { sourceKind: "habit", done })).toEqual({
      kind: "ok",
      value: done,
      target,
      ratio,
      reached,
    });
  });

  test.each([
    // percent, finished, value shown, reached
    [0, false, 0, false],
    [62, false, 62, false],
    [100, false, 100, false], // all milestones done but the project is still open: not reached
    [40, true, 100, true], // «terminado» achieves it, whatever the percentage was
  ])("project: %d %% (finished %s)", (percent, finished, value, reached) => {
    expect(
      progressOf(
        { sourceKind: "project", target: 100 },
        { sourceKind: "project", percent, finished },
      ),
    ).toEqual({ kind: "ok", value, target: 100, ratio: value / 100, reached });
  });

  test("a habit or project goal without its reading (the source is gone) is unavailable, never a wrong number", () => {
    const unavailable = { kind: "unavailable", reason: "source-not-available" };
    expect(progressOf({ sourceKind: "habit", target: 40 }, null)).toEqual(unavailable);
    expect(progressOf({ sourceKind: "project", target: 100 }, null)).toEqual(unavailable);
    // Even with another source's reading handed over by mistake.
    expect(
      progressOf({ sourceKind: "habit", target: 40 }, { sourceKind: "manual", sum: 40 }),
    ).toEqual(unavailable);
    expect(
      progressOf({ sourceKind: "project", target: 100 }, { sourceKind: "habit", done: 100 }),
    ).toEqual(unavailable);
  });

  test("a manual goal without its reading is unavailable too", () => {
    expect(progressOf({ sourceKind: "manual", target: 5 }, null)).toEqual({
      kind: "unavailable",
      reason: "source-not-available",
    });
  });
});

describe("achievementChange", () => {
  test.each([
    // status, wasReached, nowReached, expected
    ["active", false, true, "achieve"],
    ["active", true, true, "achieve"], // already at the target but still active: achieve
    ["active", false, false, null],
    ["active", true, false, null],
    ["achieved", true, false, "reopen"], // a correction or an undo drops it below the target
    ["achieved", true, true, null], // another entry past the target: nothing changes (idempotent)
    ["achieved", false, true, null], // marked by hand, then reaches it: still achieved
    ["achieved", false, false, null], // marked by hand below the target: only "Reabrir" changes it
    ["archived", false, true, null],
    ["archived", true, false, null],
  ] as const)("%s, was %s, now %s → %s", (status, wasReached, nowReached, expected) => {
    expect(achievementChange({ status, wasReached, nowReached })).toBe(expected);
  });
});
