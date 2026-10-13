// G4 of `goals`: «Pasar al próximo periodo». The next period (T4 → T1 of the next year, years,
// leap years), which goals can move on which day, the label of the key and the Zod inputs. Pure:
// no database.
import { describe, expect, test } from "vitest";
import {
  moveGoalInputSchema,
  undoMoveGoalInputSchema,
  type GoalItem,
} from "@/modules/goals/goal-input";
import { movedPatch, moveLabelOf, movePeriodOf } from "@/modules/goals/goal-move";
import { nextPeriod, periodBounds, periodDays, type GoalPeriod } from "@/modules/goals/pace";

const ID = "11111111-1111-4111-8111-111111111111";

function goal(values: Partial<GoalItem> = {}): GoalItem {
  return {
    id: ID,
    title: "Leer 12 libros",
    notes: null,
    periodKind: "quarter",
    year: 2026,
    quarter: 3,
    sourceKind: "manual",
    habitId: null,
    projectId: null,
    target: 12,
    unit: "libros",
    status: "active",
    achievedAt: null,
    position: 0,
    area: null,
    sum: 5,
    source: null,
    ...values,
  };
}

describe("nextPeriod", () => {
  test("a year goes to the next year", () => {
    expect(nextPeriod({ kind: "year", year: 2026 })).toEqual({ kind: "year", year: 2027 });
  });

  test.each([
    [1, 2026, 2, 2026],
    [2, 2026, 3, 2026],
    [3, 2026, 4, 2026],
    [4, 2026, 1, 2027],
  ] as const)("T%i %i goes to T%i %i", (quarter, year, nextQuarter, nextYear) => {
    expect(nextPeriod({ kind: "quarter", year, quarter })).toEqual({
      kind: "quarter",
      year: nextYear,
      quarter: nextQuarter,
    });
  });

  test("the next period starts the day after the period ends, leap years included", () => {
    const quarters: GoalPeriod[] = [];
    for (const year of [2027, 2028, 2099]) {
      for (const quarter of [1, 2, 3, 4] as const)
        quarters.push({ kind: "quarter", year, quarter });
      quarters.push({ kind: "year", year });
    }
    const mismatches = quarters.filter((period) => {
      const end = Date.parse(`${periodBounds(period).end}T00:00:00Z`);
      const start = Date.parse(`${periodBounds(nextPeriod(period)).start}T00:00:00Z`);
      return start - end !== 86_400_000;
    });
    expect(mismatches).toEqual([]);
    // The leap year is a longer next period: T1 2028 has 91 days, T1 2027 has 90.
    expect(periodDays(nextPeriod({ kind: "quarter", year: 2027, quarter: 4 }))).toBe(91);
  });
});

describe("movePeriodOf", () => {
  test("a goal in course of a past period moves to the next one", () => {
    expect(movePeriodOf(goal(), "2026-10-13")).toEqual({ kind: "quarter", year: 2026, quarter: 4 });
  });

  test("the current period moves too (rolling over early)", () => {
    expect(movePeriodOf(goal({ quarter: 4 }), "2026-10-13")).toEqual({
      kind: "quarter",
      year: 2027,
      quarter: 1,
    });
    expect(movePeriodOf(goal({ periodKind: "year", quarter: null }), "2026-10-13")).toEqual({
      kind: "year",
      year: 2027,
    });
  });

  test("a period that has not started, and achieved or archived goals, stay", () => {
    expect(movePeriodOf(goal({ quarter: 1, year: 2027 }), "2026-10-13")).toBeNull();
    expect(movePeriodOf(goal({ status: "achieved" }), "2026-10-13")).toBeNull();
    expect(movePeriodOf(goal({ status: "archived" }), "2026-10-13")).toBeNull();
  });

  test("never past the last year a goal can have", () => {
    expect(
      movePeriodOf(goal({ periodKind: "year", quarter: null, year: 2100 }), "2100-02-01"),
    ).toBeNull();
  });

  test("the key says where it goes", () => {
    expect(moveLabelOf(goal(), "2026-10-13")).toBe("Pasar a T4 2026");
    expect(moveLabelOf(goal({ quarter: 4 }), "2026-10-13")).toBe("Pasar a T1 2027");
    expect(moveLabelOf(goal({ status: "achieved" }), "2026-10-13")).toBeNull();
  });

  test("the optimistic patch changes only the period", () => {
    expect(movedPatch({ kind: "quarter", year: 2027, quarter: 1 })).toEqual({
      periodKind: "quarter",
      year: 2027,
      quarter: 1,
    });
    expect(movedPatch({ kind: "year", year: 2027 })).toEqual({
      periodKind: "year",
      year: 2027,
      quarter: null,
    });
  });
});

describe("inputs", () => {
  test("a move carries a goal id and the period it was seen in", () => {
    expect(moveGoalInputSchema.safeParse({ id: ID, year: 2026, quarter: 3 }).success).toBe(true);
    expect(moveGoalInputSchema.parse({ id: ID, year: 2026 })).toEqual({
      id: ID,
      year: 2026,
      quarter: null,
    });
    for (const bad of [
      { id: "x", year: 2026, quarter: 3 },
      { id: ID, year: 1999, quarter: null },
      { id: ID, year: 2026, quarter: 5 },
      { id: ID, year: 2026.5, quarter: null },
      { id: ID },
    ]) {
      expect(moveGoalInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("an undo carries where it was and what the move left", () => {
    const good = {
      id: ID,
      from: { year: 2026, quarter: 3, position: 2 },
      applied: { year: 2026, quarter: 4 },
    };
    expect(undoMoveGoalInputSchema.safeParse(good).success).toBe(true);
    for (const bad of [
      { ...good, from: { ...good.from, position: -1 } },
      { ...good, from: { ...good.from, position: 1.5 } },
      { ...good, applied: { year: 2026, quarter: 9 } },
      { id: ID, from: good.from },
    ]) {
      expect(undoMoveGoalInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});
