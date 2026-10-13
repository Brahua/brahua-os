// G1 of `goals`: the sections of /goals, the optimistic list and what a row says.
import { describe, expect, test } from "vitest";
import type { GoalItem } from "@/modules/goals/goal-input";
import { applyGoalListChange, entryPatch, neighborOf } from "@/modules/goals/goal-list-optimistic";
import { groupGoals, sectionOf } from "@/modules/goals/goal-sections";
import { readGoal, unitOf } from "@/modules/goals/goal-text";

let serial = 0;
function goal(values: Partial<GoalItem> = {}): GoalItem {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    title: `Meta ${serial}`,
    notes: null,
    periodKind: "year",
    year: 2026,
    quarter: null,
    sourceKind: "manual",
    habitId: null,
    projectId: null,
    target: 12,
    unit: "libros",
    status: "active",
    achievedAt: null,
    position: serial,
    area: null,
    sum: 0,
    ...values,
  };
}

const TODAY = "2026-10-12"; // T4 2026

describe("sections", () => {
  test("a goal sits in its period's section while the period is current", () => {
    expect(sectionOf(goal({ periodKind: "year", year: 2026 }), TODAY)).toBe("year");
    expect(sectionOf(goal({ periodKind: "quarter", year: 2026, quarter: 4 }), TODAY)).toBe(
      "quarter",
    );
  });

  test("a past period moves to 'Anteriores' with its status untouched", () => {
    const past = goal({ periodKind: "quarter", year: 2026, quarter: 3, sum: 7, target: 10 });
    expect(sectionOf(past, TODAY)).toBe("previous");
    expect(past.status).toBe("active");
    expect(sectionOf(goal({ periodKind: "year", year: 2025 }), TODAY)).toBe("previous");
    expect(sectionOf(goal({ periodKind: "quarter", year: 2026, quarter: 4 }), "2027-01-01")).toBe(
      "previous",
    );
  });

  test("archived goals are in 'Anteriores' whatever their period", () => {
    expect(sectionOf(goal({ status: "archived" }), TODAY)).toBe("previous");
  });

  test("an achieved goal stays in its section while its period is current", () => {
    expect(sectionOf(goal({ status: "achieved" }), TODAY)).toBe("year");
  });

  test("a future period stays with its kind (it says when it starts)", () => {
    expect(sectionOf(goal({ periodKind: "year", year: 2027 }), TODAY)).toBe("year");
  });

  test("groupGoals keeps the given order; 'Anteriores' shows the most recent period first", () => {
    const a = goal({ periodKind: "year", year: 2026 });
    const b = goal({ periodKind: "quarter", year: 2026, quarter: 4 });
    const c = goal({ periodKind: "year", year: 2026 });
    const old = goal({ periodKind: "quarter", year: 2026, quarter: 2 });
    const older = goal({ periodKind: "year", year: 2025 });
    const recent = goal({ periodKind: "quarter", year: 2026, quarter: 3 });
    const archived = goal({ status: "archived" });
    const sections = groupGoals([old, c, older, a, b, recent, archived], TODAY);
    expect(sections.year.map((item) => item.id)).toEqual([c.id, a.id]);
    expect(sections.quarter.map((item) => item.id)).toEqual([b.id]);
    // 2026-12-31 (the archived year goal) → 2026-09-30 → 2026-06-30 → 2025-12-31
    expect(sections.previous.map((item) => item.id)).toEqual([
      archived.id,
      recent.id,
      old.id,
      older.id,
    ]);
  });
});

describe("applyGoalListChange", () => {
  const first = goal();
  const second = goal();
  const third = goal();
  const list = [first, second, third];

  test("remove, restore at its place, restore of one already there, update, reorder", () => {
    expect(applyGoalListChange(list, { type: "remove", id: second.id }).map((g) => g.id)).toEqual([
      first.id,
      third.id,
    ]);
    expect(
      applyGoalListChange([first, third], { type: "restore", goal: second, index: 1 }).map(
        (g) => g.id,
      ),
    ).toEqual([first.id, second.id, third.id]);
    expect(
      applyGoalListChange(list, {
        type: "restore",
        goal: { ...second, title: "Otra" },
        index: 0,
      }).map((g) => g.title),
    ).toEqual([first.title, "Otra", third.title]);
    expect(
      applyGoalListChange(list, { type: "update", id: first.id, patch: { sum: 3 } })[0].sum,
    ).toBe(3);
    expect(
      applyGoalListChange(list, { type: "reorder", ids: [third.id, first.id, second.id] }).map(
        (g) => g.id,
      ),
    ).toEqual([third.id, first.id, second.id]);
  });

  test("neighborOf: the next, else the previous, else none", () => {
    expect(neighborOf(list, first.id)?.id).toBe(second.id);
    expect(neighborOf(list, third.id)?.id).toBe(second.id);
    expect(neighborOf([first], first.id)).toBeNull();
    expect(neighborOf(list, "nope")).toBeNull();
  });
});

describe("entryPatch", () => {
  const NOW = new Date("2026-10-12T15:00:00.000Z");
  test("an entry adds to the shown sum (absolute, never relative)", () => {
    expect(entryPatch(goal({ sum: 4 }), 1, NOW)).toEqual({ sum: 5 });
    expect(entryPatch(goal({ sum: 4 }), 3, NOW)).toEqual({ sum: 7 });
    expect(entryPatch(goal({ sum: 4 }), -2, NOW)).toEqual({ sum: 2 });
  });
  test("reaching the target achieves it (once), at the same time as the server", () => {
    expect(entryPatch(goal({ sum: 11 }), 1, NOW)).toEqual({
      sum: 12,
      status: "achieved",
      achievedAt: NOW.toISOString(),
    });
    // Already achieved: another entry only changes the sum.
    expect(
      entryPatch(
        goal({ sum: 12, status: "achieved", achievedAt: "2026-10-01T00:00:00.000Z" }),
        1,
        NOW,
      ),
    ).toEqual({
      sum: 13,
    });
  });
  test("a correction below the target reopens it", () => {
    expect(
      entryPatch(
        goal({ sum: 12, status: "achieved", achievedAt: "2026-10-01T00:00:00.000Z" }),
        -1,
        NOW,
      ),
    ).toEqual({ sum: 11, status: "active", achievedAt: null });
  });
  test("marked by hand below the target, an entry does not reopen or change it", () => {
    expect(
      entryPatch(
        goal({ sum: 3, status: "achieved", achievedAt: "2026-10-01T00:00:00.000Z" }),
        1,
        NOW,
      ),
    ).toEqual({
      sum: 4,
    });
  });
});

describe("readGoal", () => {
  test("'5 de 12 libros', the bar's ratio and a pace line", () => {
    const reading = readGoal(goal({ sum: 5 }), "2026-07-02");
    expect(reading).toMatchObject({ kind: "ok", count: "5 de 12 libros", value: 5, target: 12 });
    expect(reading.kind === "ok" && reading.ratio).toBeCloseTo(5 / 12, 10);
    // Expected ≈ 6.016: 5 is a hair below the tolerance → only a next step.
    expect(reading.kind === "ok" && reading.line).toMatch(/^Para llegar: ~\d+ libros por semana$/);
  });
  test("achieved: 'Meta lograda', whatever the pace", () => {
    expect(readGoal(goal({ sum: 12, status: "achieved" }), TODAY)).toMatchObject({
      line: "Meta lograda",
    });
    expect(readGoal(goal({ sum: 2, status: "achieved" }), TODAY)).toMatchObject({
      line: "Meta lograda",
    });
  });
  test("a past goal that was not reached keeps its status and shows its final value, as a fact", () => {
    const past = goal({ periodKind: "quarter", year: 2026, quarter: 3, sum: 7, target: 10 });
    const reading = readGoal(past, TODAY);
    expect(past.status).toBe("active");
    expect(reading).toMatchObject({
      kind: "ok",
      count: "7 de 10 libros",
      line: "Terminó con 7 de 10 libros.",
    });
  });
  test("an archived goal has no pace line", () => {
    expect(readGoal(goal({ status: "archived", sum: 3 }), TODAY)).toMatchObject({ line: null });
  });
  test("a habit or project goal is 'not available yet'", () => {
    expect(readGoal(goal({ sourceKind: "habit", unit: null, habitId: "x" }), TODAY)).toMatchObject({
      kind: "unavailable",
    });
    expect(unitOf(goal({ sourceKind: "habit", unit: null }))).toBe("días");
    expect(unitOf(goal({ sourceKind: "project", unit: null }))).toBe("%");
    expect(unitOf(goal())).toBe("libros");
  });
  test("the value never goes below zero", () => {
    expect(readGoal(goal({ sum: -4 }), TODAY)).toMatchObject({ value: 0, count: "0 de 12 libros" });
  });
});
