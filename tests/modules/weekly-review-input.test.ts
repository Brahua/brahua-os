// W1 of `weekly-review`: the Zod schemas (week = a Monday, note 1–280 normalized) and the routes.
import { describe, expect, test } from "vitest";
import { REVIEW_ERRORS } from "@/modules/weekly-review/review-copy";
import {
  closeWeekSchema,
  reviewNoteSchema,
  reviewWeekSchema,
} from "@/modules/weekly-review/review-input";
import { parseStep, reviewStepPath, REVIEW_PATH } from "@/modules/weekly-review/routes";

describe("reviewWeekSchema", () => {
  test.each(["2026-10-12", "2026-12-28", "2028-02-28", "2024-02-26"])("%s is a Monday", (week) => {
    expect(reviewWeekSchema.parse(week)).toBe(week);
  });

  test.each([
    "2026-10-13",
    "2026-10-18",
    "2026-02-30",
    "2026-1-5",
    "12/10/2026",
    "",
    " 2026-10-12",
    "2026-10-12T00:00:00Z",
  ])("%j is refused", (week) => {
    const result = reviewWeekSchema.safeParse(week);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(REVIEW_ERRORS.weekInvalid);
  });

  test("a non-string is refused", () => {
    expect(reviewWeekSchema.safeParse(20261012).success).toBe(false);
    expect(reviewWeekSchema.safeParse(null).success).toBe(false);
  });
});

describe("reviewNoteSchema", () => {
  test.each([
    ["Aprendí a cerrar el día", "Aprendí a cerrar el día"],
    ["  mucho   espacio \n y saltos  ", "mucho espacio y saltos"],
    // NFC: "e" + combining acute becomes "é".
    ["café", "café"],
    ["a", "a"],
    ["x".repeat(280), "x".repeat(280)],
    // Emoji sequences with a joiner stay.
    ["en familia 👨‍👩‍👧", "en familia 👨‍👩‍👧"],
  ])("%j is stored as %j", (input, stored) => {
    expect(reviewNoteSchema.parse(input)).toBe(stored);
  });

  test.each([undefined, null, "", "   ", "\n\t "])("%j is no note (null)", (input) => {
    expect(reviewNoteSchema.parse(input)).toBeNull();
  });

  test("281 characters (after normalizing) is an error, never cut", () => {
    const result = reviewNoteSchema.safeParse("x".repeat(281));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(REVIEW_ERRORS.noteTooLong);
    // Whitespace around does not count: 280 real characters padded still pass.
    expect(reviewNoteSchema.safeParse(`  ${"x".repeat(280)}  `).success).toBe(true);
  });

  test("an absurdly long string is refused without normalizing it", () => {
    expect(reviewNoteSchema.safeParse("x".repeat(100_000)).success).toBe(false);
  });

  test.each(["con\u0000nulo", "cero​ancho", "bidi‮oculto"])(
    "invisible characters are refused (%#)",
    (input) => {
      const result = reviewNoteSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(REVIEW_ERRORS.noteInvisible);
    },
  );

  test("a non-string note is refused", () => {
    expect(reviewNoteSchema.safeParse(42).success).toBe(false);
  });
});

describe("closeWeekSchema", () => {
  test("a week and a note", () => {
    expect(closeWeekSchema.parse({ weekStart: "2026-10-12", note: " Bien " })).toEqual({
      weekStart: "2026-10-12",
      note: "Bien",
    });
  });

  test("the note is optional", () => {
    expect(closeWeekSchema.parse({ weekStart: "2026-10-12" })).toEqual({
      weekStart: "2026-10-12",
      note: null,
    });
  });

  test("a week that is not a Monday fails on its own field", () => {
    const result = closeWeekSchema.safeParse({ weekStart: "2026-10-13", note: "ok" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(["weekStart"]);
  });
});

describe("routes", () => {
  test("the first step of the default week is the bare path", () => {
    expect(REVIEW_PATH).toBe("/review");
    expect(reviewStepPath()).toBe("/review");
    expect(reviewStepPath(1)).toBe("/review");
  });

  test("a step and a week go in the query", () => {
    expect(reviewStepPath(2)).toBe("/review?paso=2");
    expect(reviewStepPath(1, "2026-10-05")).toBe("/review?semana=2026-10-05");
    expect(reviewStepPath(4, "2026-10-05")).toBe("/review?paso=4&semana=2026-10-05");
  });

  test.each([
    ["1", 1],
    ["2", 2],
    ["4", 4],
    ["5", 1],
    ["0", 1],
    ["x", 1],
    ["", 1],
    [undefined, 1],
    [["2", "3"], 1],
  ])("?paso=%j → step %i", (value, step) => {
    expect(parseStep(value as string | undefined)).toBe(step);
  });
});
