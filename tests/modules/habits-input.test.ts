// H1 of `habits`: the Zod schemas shared by the forms and the Server Actions.
import { describe, expect, test } from "vitest";
import {
  createHabitInputSchema,
  HABIT_ERRORS,
  habitIdInputSchema,
  setHabitDoneInputSchema,
} from "@/modules/habits/habit-input";

const ID = "00000000-0000-4000-8000-000000000001";

const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : result.error!.issues.map((issue) => issue.message);

describe("createHabitInputSchema", () => {
  test("a name alone: normalized like names, no area", () => {
    expect(createHabitInputSchema.parse({ name: "  Meditar\t 10   min " })).toEqual({
      name: "Meditar 10 min",
      lifeAreaId: null,
    });
  });

  test("an area: a uuid; '' or missing is none; anything else is refused", () => {
    expect(createHabitInputSchema.parse({ name: "Leer", lifeAreaId: ID }).lifeAreaId).toBe(ID);
    expect(createHabitInputSchema.parse({ name: "Leer", lifeAreaId: "" }).lifeAreaId).toBeNull();
    expect(createHabitInputSchema.parse({ name: "Leer", lifeAreaId: null }).lifeAreaId).toBeNull();
    expect(issues(createHabitInputSchema.safeParse({ name: "Leer", lifeAreaId: "salud" }))).toEqual(
      [HABIT_ERRORS.area],
    );
  });

  test("the name is required, 1–80 characters, without invisible characters", () => {
    expect(issues(createHabitInputSchema.safeParse({}))).toEqual([HABIT_ERRORS.nameRequired]);
    expect(issues(createHabitInputSchema.safeParse({ name: "   " }))).toEqual([
      HABIT_ERRORS.nameRequired,
    ]);
    expect(createHabitInputSchema.safeParse({ name: "a".repeat(80) }).success).toBe(true);
    expect(issues(createHabitInputSchema.safeParse({ name: "a".repeat(81) }))).toEqual([
      HABIT_ERRORS.nameTooLong,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ name: "Le\u0000er" }))).toEqual([
      HABIT_ERRORS.nameInvisible,
    ]);
    expect(issues(createHabitInputSchema.safeParse({ name: "Le​er" }))).toEqual([
      HABIT_ERRORS.nameInvisible,
    ]);
    // Emoji sequences keep their joiners.
    expect(createHabitInputSchema.parse({ name: "Familia 👨‍👩‍👧" }).name).toBe("Familia 👨‍👩‍👧");
  });

  test("fields of later tasks or of the row are dropped, never stored as sent", () => {
    expect(
      createHabitInputSchema.parse({ name: "Leer", sortOrder: 0, deletedAt: "x", measure: "x" }),
    ).toEqual({ name: "Leer", lifeAreaId: null });
  });
});

describe("setHabitDoneInputSchema", () => {
  test("a habit, a real day and the state wanted", () => {
    expect(setHabitDoneInputSchema.parse({ id: ID, day: "2026-10-02", done: true })).toEqual({
      id: ID,
      day: "2026-10-02",
      done: true,
    });
    expect(setHabitDoneInputSchema.parse({ id: ID, day: "2024-02-29", done: false }).done).toBe(
      false,
    );
  });

  test("an impossible day, a time, a toggle without a state or a bad id are refused", () => {
    expect(issues(setHabitDoneInputSchema.safeParse({ id: ID, day: "2026-02-30", done: true })))
      .toEqual([HABIT_ERRORS.dayInvalid]);
    expect(
      setHabitDoneInputSchema.safeParse({ id: ID, day: "2026-10-02T10:00:00Z", done: true })
        .success,
    ).toBe(false);
    expect(setHabitDoneInputSchema.safeParse({ id: ID, day: "2026-10-02" }).success).toBe(false);
    expect(
      setHabitDoneInputSchema.safeParse({ id: ID, day: "2026-10-02", done: "true" }).success,
    ).toBe(false);
    expect(issues(habitIdInputSchema.safeParse({ id: "1; drop table habits" }))).toEqual([
      HABIT_ERRORS.notFound,
    ]);
  });
});
