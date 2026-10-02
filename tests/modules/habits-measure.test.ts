// H3 of `habits`: kind and measure (Zod, columns, summary), the quantity writes' schemas, when a
// day is done (quantity, avoid), the pad's status line and bar, and the optimistic quantity.
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { padSegments, padStatus } from "@/modules/habits/components/habit-pad";
import {
  createHabitInputSchema,
  updateHabitInputSchema,
  type HabitItem,
} from "@/modules/habits/habit-input";
import { applyHabitListChange, quantityPatch } from "@/modules/habits/habit-list-optimistic";
import { hasRelapse, isDayDone, todayCount } from "@/modules/habits/habit-status";
import { MEASURE_ERRORS } from "@/modules/habits/measure-copy";
import {
  measureColumns,
  measureInputShape,
  measureSummary,
  refineMeasure,
} from "@/modules/habits/measure-input";
import { logHabitInputSchema, setHabitQuantityInputSchema } from "@/modules/habits/quantity-input";

const ID = "00000000-0000-4000-8000-000000000001";
const TODAY = "2026-10-02";

const issues = (result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) =>
  result.success
    ? []
    : result.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

function habit(values: Partial<HabitItem> = {}): HabitItem {
  return {
    id: ID,
    name: "Agua",
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
    ...values,
  };
}

describe("createHabitInputSchema: kind and measure", () => {
  test("a quantity: goal, unit (normalized) and step; the step defaults to the columns' 1", () => {
    const parsed = createHabitInputSchema.parse({
      name: "Agua",
      measure: "quantity",
      goal: 8,
      unit: "  vasos ",
    });
    expect(parsed).toEqual({
      name: "Agua",
      lifeAreaId: null,
      kind: "build",
      measure: "quantity",
      goal: 8,
      unit: "vasos",
    });
    expect(measureColumns(parsed)).toEqual({
      kind: "build",
      measure: "quantity",
      goal: 8,
      unit: "vasos",
      step: 1,
    });
    const stepped = createHabitInputSchema.parse({
      name: "Correr",
      measure: "quantity",
      goal: 30,
      unit: "min",
      step: 5,
    });
    expect(measureColumns(stepped).step).toBe(5);
  });

  test("goal 1–10 000, whole numbers; unit 1–20 characters; step 1–goal", () => {
    const base = { name: "Agua", measure: "quantity", unit: "vasos" };
    expect(createHabitInputSchema.safeParse({ ...base, goal: 1 }).success).toBe(true);
    expect(createHabitInputSchema.safeParse({ ...base, goal: 10_000 }).success).toBe(true);
    // An invalid goal says so once (the step isn't compared with it).
    expect(issues(createHabitInputSchema.safeParse({ ...base, goal: 0, step: 1 }))).toEqual([
      `goal: ${MEASURE_ERRORS.goalInvalid}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ ...base, goal: 10_001 }))).toEqual([
      `goal: ${MEASURE_ERRORS.goalTooBig}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ ...base, goal: 2.5 }))).toEqual([
      `goal: ${MEASURE_ERRORS.goalInvalid}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ ...base, goal: Number.NaN }))).toEqual([
      `goal: ${MEASURE_ERRORS.goalInvalid}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ ...base, goal: "8" }))).toEqual([
      `goal: ${MEASURE_ERRORS.goalInvalid}`,
    ]);
    // Missing (or blank, as the form sends it) is "write it".
    expect(issues(createHabitInputSchema.safeParse({ ...base, goal: "" }))).toEqual([
      `goal: ${MEASURE_ERRORS.goalRequired}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse(base))).toEqual([
      `goal: ${MEASURE_ERRORS.goalRequired}`,
    ]);

    const goal = { name: "Agua", measure: "quantity", goal: 8 };
    expect(createHabitInputSchema.safeParse({ ...goal, unit: "a".repeat(20) }).success).toBe(true);
    expect(issues(createHabitInputSchema.safeParse({ ...goal, unit: "a".repeat(21) }))).toEqual([
      `unit: ${MEASURE_ERRORS.unitTooLong}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ ...goal, unit: "   " }))).toEqual([
      `unit: ${MEASURE_ERRORS.unitRequired}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ ...goal, unit: "va​sos" }))).toEqual([
      `unit: ${MEASURE_ERRORS.unitInvisible}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse(goal))).toEqual([
      `unit: ${MEASURE_ERRORS.unitRequired}`,
    ]);

    const both = { ...goal, unit: "vasos" };
    expect(createHabitInputSchema.safeParse({ ...both, step: 8 }).success).toBe(true);
    expect(issues(createHabitInputSchema.safeParse({ ...both, step: 9 }))).toEqual([
      `step: ${MEASURE_ERRORS.stepTooBig}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ ...both, step: 0 }))).toEqual([
      `step: ${MEASURE_ERRORS.stepInvalid}`,
    ]);
  });

  test("a yes/no ignores a quantity's fields: goal 1, step 1, no unit", () => {
    const parsed = createHabitInputSchema.parse({ name: "Leer", measure: "check", goal: 8 });
    expect(measureColumns(parsed)).toEqual({
      kind: "build",
      measure: "check",
      goal: 1,
      unit: null,
      step: 1,
    });
  });

  test("an unknown kind or measure is refused", () => {
    expect(issues(createHabitInputSchema.safeParse({ name: "Leer", kind: "limit" }))).toEqual([
      `kind: ${MEASURE_ERRORS.kind}`,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ name: "Leer", measure: "x" }))).toEqual([
      `measure: ${MEASURE_ERRORS.measure}`,
    ]);
  });

  test("a habit to avoid is a yes/no", () => {
    const parsed = createHabitInputSchema.parse({ name: "No fumar", kind: "avoid" });
    expect(measureColumns(parsed)).toEqual({
      kind: "avoid",
      measure: "check",
      goal: 1,
      unit: null,
      step: 1,
    });
    expect(
      issues(
        createHabitInputSchema.safeParse({
          name: "Cafés",
          kind: "avoid",
          measure: "quantity",
          goal: 2,
          unit: "tazas",
        }),
      ),
    ).toEqual([`measure: ${MEASURE_ERRORS.avoidMeasure}`]);
  });

  test("…and daily: the rule reads the frequency when the schema has it (H2)", () => {
    // What H2's frequency field adds, composed the same way createHabitInputSchema is built.
    const withFrequency = z
      .object({ frequency: z.string().default("daily"), ...measureInputShape })
      .superRefine(refineMeasure);
    expect(withFrequency.safeParse({ kind: "avoid" }).success).toBe(true);
    expect(withFrequency.safeParse({ kind: "avoid", frequency: "daily" }).success).toBe(true);
    expect(issues(withFrequency.safeParse({ kind: "avoid", frequency: "weekly_count" }))).toEqual([
      `frequency: ${MEASURE_ERRORS.avoidDaily}`,
    ]);
    // Positive control: the same frequency is fine for a habit to keep.
    expect(withFrequency.safeParse({ kind: "build", frequency: "weekly_count" }).success).toBe(
      true,
    );
  });

  test("the live summary: Sí o no, 8 vasos (with the step), A evitar", () => {
    expect(measureSummary({})).toBe("Sí o no");
    expect(measureSummary({ kind: "build", measure: "check" })).toBe("Sí o no");
    expect(measureSummary({ kind: "avoid", measure: "quantity" })).toBe("A evitar");
    expect(measureSummary({ measure: "quantity", goal: 8, unit: "vasos", step: 1 })).toBe(
      "8 vasos",
    );
    expect(measureSummary({ measure: "quantity", goal: 30, unit: " min ", step: 5 })).toBe(
      "30 min, de 5 en 5",
    );
    // What is missing (or not valid yet) reads as "…".
    expect(measureSummary({ measure: "quantity", goal: undefined, unit: "" })).toBe("… …");
  });
});

describe("quantity writes", () => {
  test("a tap's delta: a whole number, never 0, within ± the goal's maximum", () => {
    expect(logHabitInputSchema.parse({ id: ID, day: TODAY, delta: 1 })).toEqual({
      id: ID,
      day: TODAY,
      delta: 1,
    });
    for (const delta of [-10_000, 10_000]) {
      expect(logHabitInputSchema.safeParse({ id: ID, day: TODAY, delta }).success).toBe(true);
    }
    for (const delta of [0, 1.5, 10_001, -10_001, "1", null]) {
      expect(logHabitInputSchema.safeParse({ id: ID, day: TODAY, delta }).success).toBe(false);
    }
    expect(logHabitInputSchema.safeParse({ id: ID, day: "2026-02-30", delta: 1 }).success).toBe(
      false,
    );
  });

  test("a day's exact quantity: 0–99 999", () => {
    for (const quantity of [0, 7, 99_999]) {
      expect(setHabitQuantityInputSchema.safeParse({ id: ID, day: TODAY, quantity }).success).toBe(
        true,
      );
    }
    for (const quantity of [-1, 100_000, 2.5, "3", undefined]) {
      expect(
        issues(setHabitQuantityInputSchema.safeParse({ id: ID, day: TODAY, quantity })),
      ).toEqual([`quantity: ${MEASURE_ERRORS.quantityInvalid}`]);
    }
  });

  test("an edit: a quantity's goal, unit and step up to it; a yes/no sends none", () => {
    const edit = { id: ID, name: "Agua", lifeAreaId: null, frequency: "daily" };
    const parse = (values: Record<string, unknown>) =>
      updateHabitInputSchema.safeParse({ ...edit, ...values });
    expect(updateHabitInputSchema.parse({ ...edit, goal: 10, unit: "vasos" })).toMatchObject({
      goal: 10,
      unit: "vasos",
    });
    // A yes/no's edit: no measure fields, nothing to check.
    expect(updateHabitInputSchema.parse(edit)).not.toHaveProperty("goal");
    expect(issues(parse({ goal: 2, unit: "x", step: 3 }))).toEqual([
      `step: ${MEASURE_ERRORS.stepTooBig}`,
    ]);
    expect(issues(parse({ goal: 0, unit: "x" }))).toEqual([`goal: ${MEASURE_ERRORS.goalInvalid}`]);
    expect(issues(parse({ goal: 10_001, unit: "x" }))).toEqual([
      `goal: ${MEASURE_ERRORS.goalTooBig}`,
    ]);
    expect(issues(parse({ goal: 3, unit: " " }))).toEqual([`unit: ${MEASURE_ERRORS.unitRequired}`]);
    // Any of them asks for the goal and unit.
    expect(issues(parse({ step: 2 }))).toEqual([
      `goal: ${MEASURE_ERRORS.goalRequired}`,
      `unit: ${MEASURE_ERRORS.unitRequired}`,
    ]);
  });
});

describe("isDayDone", () => {
  test("a quantity is done at its target, and past it", () => {
    const water = { kind: "build", measure: "quantity", target: 8 } as const;
    expect(isDayDone(habit({ ...water, quantity: 7 }))).toBe(false);
    expect(isDayDone(habit({ ...water, quantity: 8 }))).toBe(true);
    expect(isDayDone(habit({ ...water, quantity: 10 }))).toBe(true);
  });

  test("a habit to avoid is done while there is no relapse", () => {
    expect(isDayDone(habit({ kind: "avoid", quantity: 0 }))).toBe(true);
    expect(isDayDone(habit({ kind: "avoid", quantity: 1 }))).toBe(false);
    expect(hasRelapse(habit({ kind: "avoid", quantity: 1 }))).toBe(true);
    expect(hasRelapse(habit({ kind: "avoid", quantity: 0 }))).toBe(false);
    // Positive control: the same quantity is "done" for a habit to keep.
    expect(isDayDone(habit({ kind: "build", quantity: 1 }))).toBe(true);
    expect(hasRelapse(habit({ kind: "build", quantity: 1 }))).toBe(false);
  });

  test("the count of today: a clean habit to avoid counts as done", () => {
    const list = [
      habit({ id: "a", kind: "avoid", quantity: 0 }),
      habit({ id: "b", measure: "quantity", target: 8, quantity: 3, goal: 8, unit: "vasos" }),
    ];
    expect(todayCount(list, TODAY)).toEqual({ done: 1, total: 2 });
  });
});

describe("the pad", () => {
  test("status line: 3/8 VASOS, HECHO, SIN RECAÍDAS HOY / RECAÍDA REGISTRADA HOY", () => {
    expect(
      padStatus(habit({ measure: "quantity", goal: 8, target: 8, unit: "vasos", quantity: 3 })),
    ).toBe("3/8 VASOS");
    expect(
      padStatus(habit({ measure: "quantity", goal: 8, target: 8, unit: "vasos", quantity: 10 })),
    ).toBe("10/8 VASOS");
    expect(padStatus(habit({ quantity: 1 }))).toBe("HECHO");
    expect(padStatus(habit({ quantity: 0 }))).toBe("");
    expect(padStatus(habit({ kind: "avoid", quantity: 0 }))).toBe("SIN RECAÍDAS HOY");
    expect(padStatus(habit({ kind: "avoid", quantity: 1 }))).toBe("RECAÍDA REGISTRADA HOY");
  });

  test("its bar: one segment per unit up to 10, then 10 in proportion, full only at the goal", () => {
    expect(padSegments(3, 8)).toEqual({ total: 8, filled: 3 });
    expect(padSegments(12, 8)).toEqual({ total: 8, filled: 8 });
    expect(padSegments(0, 1)).toEqual({ total: 1, filled: 0 });
    expect(padSegments(5, 10)).toEqual({ total: 10, filled: 5 });
    expect(padSegments(5, 11)).toEqual({ total: 10, filled: 4 });
    expect(padSegments(30, 60)).toEqual({ total: 10, filled: 5 });
    expect(padSegments(9_999, 10_000)).toEqual({ total: 10, filled: 9 });
    expect(padSegments(10_000, 10_000)).toEqual({ total: 10, filled: 10 });
  });
});

describe("optimistic quantity", () => {
  test("a tap: what is shown plus the delta, clamped to 0–99 999, and the day has logs", () => {
    expect(quantityPatch(3, 2)).toEqual({ quantity: 5, hasLogs: true });
    expect(quantityPatch(3, -5)).toEqual({ quantity: 0, hasLogs: true });
    expect(quantityPatch(99_998, 5)).toEqual({ quantity: 99_999, hasLogs: true });
    const list = [habit({ measure: "quantity", quantity: 3, target: 8 })];
    const patch = quantityPatch(3, 1);
    expect(applyHabitListChange(list, { type: "update", id: ID, patch })[0].quantity).toBe(4);
  });
});
