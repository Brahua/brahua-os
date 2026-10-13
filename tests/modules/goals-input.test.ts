// G1 of `goals`: the Zod schemas (goal-input.ts). All three sources are validated from G1, even
// though the form only offers "Cantidad" until G2.
import { describe, expect, test } from "vitest";
import {
  addEntryInputSchema,
  createGoalInputSchema,
  reorderGoalsInputSchema,
  undoEntryInputSchema,
  unarchiveGoalInputSchema,
  updateGoalInputSchema,
} from "@/modules/goals/goal-input";
import { GOAL_ERRORS } from "@/modules/goals/goals-copy";

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const MANUAL = {
  title: "Leer 12 libros",
  periodKind: "year",
  year: 2026,
  sourceKind: "manual",
  target: 12,
  unit: "libros",
} as const;

function issues(input: unknown) {
  const result = createGoalInputSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

describe("createGoalInputSchema", () => {
  test("a manual yearly goal: defaults for notes and area", () => {
    const parsed = createGoalInputSchema.parse(MANUAL);
    expect(parsed).toMatchObject({
      title: "Leer 12 libros",
      periodKind: "year",
      year: 2026,
      quarter: null,
      sourceKind: "manual",
      target: 12,
      unit: "libros",
      notes: null,
      areaId: null,
    });
  });

  test("a quarterly goal needs its quarter; a yearly one cannot have it", () => {
    expect(
      createGoalInputSchema.safeParse({ ...MANUAL, periodKind: "quarter", quarter: 4 }).success,
    ).toBe(true);
    expect(issues({ ...MANUAL, periodKind: "quarter" })).toEqual([["quarter", GOAL_ERRORS.period]]);
    expect(issues({ ...MANUAL, periodKind: "year", quarter: 2 })).toEqual([
      ["quarter", GOAL_ERRORS.period],
    ]);
    expect(issues({ ...MANUAL, periodKind: "quarter", quarter: 5 }).length).toBeGreaterThan(0);
    expect(issues({ ...MANUAL, periodKind: "quarter", quarter: 0 }).length).toBeGreaterThan(0);
    // "" means none, like the form's blank.
    expect(createGoalInputSchema.safeParse({ ...MANUAL, quarter: "" }).success).toBe(true);
  });

  test.each([
    [1999, false],
    [2000, true],
    [2100, true],
    [2101, false],
    [2026.5, false],
  ])("year %d valid: %s", (year, valid) => {
    expect(createGoalInputSchema.safeParse({ ...MANUAL, year }).success).toBe(valid);
  });

  test("an unknown period kind or source", () => {
    expect(issues({ ...MANUAL, periodKind: "month" })[0]?.[0]).toBe("periodKind");
    expect(issues({ ...MANUAL, sourceKind: "money" })[0]?.[0]).toBe("sourceKind");
    expect(issues({ ...MANUAL, sourceKind: undefined })[0]?.[0]).toBe("sourceKind");
  });

  describe("title", () => {
    test("normalized: collapsed whitespace, trimmed, NFC", () => {
      expect(
        createGoalInputSchema.parse({ ...MANUAL, title: "  Leer \n  12   libros " }).title,
      ).toBe("Leer 12 libros");
      expect(createGoalInputSchema.parse({ ...MANUAL, title: "Café" }).title).toBe("Café");
    });
    test("1–80 characters, nothing invisible", () => {
      expect(issues({ ...MANUAL, title: "" })).toEqual([["title", GOAL_ERRORS.titleRequired]]);
      expect(issues({ ...MANUAL, title: "   " })).toEqual([["title", GOAL_ERRORS.titleRequired]]);
      expect(issues({ ...MANUAL, title: undefined })[0]?.[0]).toBe("title");
      expect(createGoalInputSchema.safeParse({ ...MANUAL, title: "a".repeat(80) }).success).toBe(
        true,
      );
      expect(issues({ ...MANUAL, title: "a".repeat(81) })).toEqual([
        ["title", GOAL_ERRORS.titleTooLong],
      ]);
      expect(issues({ ...MANUAL, title: "Leer​más" })).toEqual([
        ["title", GOAL_ERRORS.titleInvisible],
      ]);
    });
  });

  describe("manual source: target and unit", () => {
    test.each([
      [0, false],
      [1, true],
      [100_000, true],
      [100_001, false],
      [1.5, false],
      [-1, false],
    ])("target %d valid: %s", (target, valid) => {
      expect(createGoalInputSchema.safeParse({ ...MANUAL, target }).success).toBe(valid);
    });
    test("a target that is not a number (NaN from an empty field) is refused", () => {
      expect(issues({ ...MANUAL, target: Number.NaN })[0]?.[0]).toBe("target");
      expect(issues({ ...MANUAL, target: undefined })[0]?.[0]).toBe("target");
      expect(issues({ ...MANUAL, target: "12" })[0]?.[0]).toBe("target");
    });
    test("unit: required, 1–20, normalized, nothing invisible", () => {
      expect(issues({ ...MANUAL, unit: "" })).toEqual([["unit", GOAL_ERRORS.unitRequired]]);
      expect(issues({ ...MANUAL, unit: undefined })[0]?.[0]).toBe("unit");
      expect(createGoalInputSchema.parse({ ...MANUAL, unit: "  km  " })).toMatchObject({
        unit: "km",
      });
      expect(createGoalInputSchema.safeParse({ ...MANUAL, unit: "a".repeat(20) }).success).toBe(
        true,
      );
      expect(issues({ ...MANUAL, unit: "a".repeat(21) })).toEqual([
        ["unit", GOAL_ERRORS.unitTooLong],
      ]);
      expect(issues({ ...MANUAL, unit: "k\u0000m" })).toEqual([
        ["unit", GOAL_ERRORS.unitInvisible],
      ]);
    });
  });

  describe("habit and project sources", () => {
    const base = { title: "Correr", periodKind: "quarter", year: 2026, quarter: 4 } as const;
    test("a habit goal: a habit id and a number of days", () => {
      expect(
        createGoalInputSchema.parse({ ...base, sourceKind: "habit", habitId: UUID, target: 40 }),
      ).toMatchObject({ sourceKind: "habit", habitId: UUID, target: 40 });
      expect(
        createGoalInputSchema.safeParse({ ...base, sourceKind: "habit", target: 40 }).success,
      ).toBe(false);
      expect(
        createGoalInputSchema.safeParse({ ...base, sourceKind: "habit", habitId: "x", target: 40 })
          .success,
      ).toBe(false);
      expect(
        createGoalInputSchema.safeParse({ ...base, sourceKind: "habit", habitId: UUID, target: 0 })
          .success,
      ).toBe(false);
    });
    test("a project goal: a project id and a target fixed at 100", () => {
      expect(
        createGoalInputSchema.parse({ ...base, sourceKind: "project", projectId: UUID }),
      ).toMatchObject({ sourceKind: "project", projectId: UUID, target: 100 });
      expect(
        createGoalInputSchema.safeParse({
          ...base,
          sourceKind: "project",
          projectId: UUID,
          target: 50,
        }).success,
      ).toBe(false);
      expect(createGoalInputSchema.safeParse({ ...base, sourceKind: "project" }).success).toBe(
        false,
      );
    });
    test("extra fields of another source are dropped, never stored", () => {
      const parsed = createGoalInputSchema.parse({
        ...base,
        sourceKind: "habit",
        habitId: UUID,
        target: 40,
        unit: "días",
        projectId: OTHER,
      });
      expect(parsed).not.toHaveProperty("unit");
      expect(parsed).not.toHaveProperty("projectId");
    });
  });

  describe("area and notes", () => {
    test("area: '', null or missing is none; otherwise a uuid", () => {
      for (const areaId of ["", null, undefined]) {
        expect(createGoalInputSchema.parse({ ...MANUAL, areaId })).toMatchObject({ areaId: null });
      }
      expect(createGoalInputSchema.parse({ ...MANUAL, areaId: UUID })).toMatchObject({
        areaId: UUID,
      });
      expect(issues({ ...MANUAL, areaId: "casa" })).toEqual([["areaId", GOAL_ERRORS.area]]);
    });
    test("notes: blank is none, line breaks stay, 2000 at most", () => {
      expect(createGoalInputSchema.parse({ ...MANUAL, notes: "   " })).toMatchObject({
        notes: null,
      });
      expect(createGoalInputSchema.parse({ ...MANUAL, notes: " uno\ndos " })).toMatchObject({
        notes: "uno\ndos",
      });
      expect(createGoalInputSchema.safeParse({ ...MANUAL, notes: "a".repeat(2000) }).success).toBe(
        true,
      );
      expect(issues({ ...MANUAL, notes: "a".repeat(2001) })).toEqual([
        ["notes", GOAL_ERRORS.notesTooLong],
      ]);
      expect(issues({ ...MANUAL, notes: "a\u0000b" })).toEqual([
        ["notes", GOAL_ERRORS.notesInvisible],
      ]);
    });
  });
});

describe("updateGoalInputSchema", () => {
  const edit = {
    id: UUID,
    title: "Leer 15",
    sourceKind: "manual",
    target: 15,
    unit: "libros",
  } as const;
  test("takes the goal's own source fields and no period", () => {
    const parsed = updateGoalInputSchema.parse({ ...edit, periodKind: "quarter", year: 2030 });
    expect(parsed).toMatchObject({ id: UUID, title: "Leer 15", target: 15, unit: "libros" });
    expect(parsed).not.toHaveProperty("periodKind");
    expect(parsed).not.toHaveProperty("year");
  });
  test("a bad id is 'not found', never a query", () => {
    const result = updateGoalInputSchema.safeParse({ ...edit, id: "1; drop table goals" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(GOAL_ERRORS.notFound);
  });
  test("validates like a create", () => {
    expect(updateGoalInputSchema.safeParse({ ...edit, target: 0 }).success).toBe(false);
    expect(updateGoalInputSchema.safeParse({ ...edit, unit: "" }).success).toBe(false);
  });
});

describe("entries, order and unarchive", () => {
  test.each([
    [1, true],
    [-1, true],
    [100_000, true],
    [-100_000, true],
    [100_001, false],
    [0, false],
    [1.5, false],
    [Number.NaN, false],
  ])("delta %d valid: %s", (delta, valid) => {
    expect(addEntryInputSchema.safeParse({ goalId: UUID, delta }).success).toBe(valid);
  });
  test("an entry needs a goal id, an undo needs both ids", () => {
    expect(addEntryInputSchema.safeParse({ goalId: "x", delta: 1 }).success).toBe(false);
    expect(undoEntryInputSchema.safeParse({ goalId: UUID, entryId: OTHER }).success).toBe(true);
    expect(undoEntryInputSchema.safeParse({ goalId: UUID }).success).toBe(false);
    expect(undoEntryInputSchema.safeParse({ goalId: UUID, entryId: "x" }).success).toBe(false);
  });
  test("reorder: uuids without repeats, 1–500", () => {
    expect(reorderGoalsInputSchema.safeParse({ ids: [UUID, OTHER] }).success).toBe(true);
    expect(reorderGoalsInputSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderGoalsInputSchema.safeParse({ ids: [UUID, UUID] }).success).toBe(false);
    expect(reorderGoalsInputSchema.safeParse({ ids: ["x"] }).success).toBe(false);
    const many = Array.from(
      { length: 501 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(reorderGoalsInputSchema.safeParse({ ids: many }).success).toBe(false);
  });
  test("unarchive defaults to the end", () => {
    expect(unarchiveGoalInputSchema.parse({ id: UUID }).position).toBe("end");
    expect(unarchiveGoalInputSchema.parse({ id: UUID, position: "original" }).position).toBe(
      "original",
    );
    expect(unarchiveGoalInputSchema.safeParse({ id: UUID, position: "middle" }).success).toBe(
      false,
    );
  });
});
