import { describe, expect, test } from "vitest";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import {
  createProjectInputSchema,
  normalizeProjectName,
  PROJECT_ERRORS,
} from "@/modules/projects/project-input";

const AREA_ID = "8f6c1a2e-4b3d-4c5e-9f70-112233445566";

const errorsOf = (input: unknown) => {
  const parsed = createProjectInputSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    (errors[issue.path.join(".")] ??= []).push(issue.message);
  }
  return errors;
};

describe("createProjectInputSchema", () => {
  test("normalizes the name and starts as an idea by default", () => {
    expect(
      createProjectInputSchema.parse({ name: "  Mudanza \n a  Lima ", lifeAreaId: AREA_ID }),
    ).toEqual({ name: "Mudanza a Lima", lifeAreaId: AREA_ID, status: "idea" });
  });

  test("accepts the four open states", () => {
    for (const status of ["idea", "active", "paused", "maintenance"]) {
      expect(
        createProjectInputSchema.parse({ name: "x", lifeAreaId: AREA_ID, status }).status,
      ).toBe(status);
    }
  });

  test("a project can't be created finished or canceled", () => {
    expect(errorsOf({ name: "x", lifeAreaId: AREA_ID, status: "done" })).toEqual({
      status: [PROJECT_ERRORS.status],
    });
    expect(errorsOf({ name: "x", lifeAreaId: AREA_ID, status: "canceled" })).toEqual({
      status: [PROJECT_ERRORS.status],
    });
  });

  test("name: required, 1–80 characters after normalizing", () => {
    expect(errorsOf({ name: "   ", lifeAreaId: AREA_ID })).toEqual({
      name: [PROJECT_ERRORS.nameRequired],
    });
    expect(errorsOf({ lifeAreaId: AREA_ID })).toEqual({ name: [PROJECT_ERRORS.nameRequired] });
    expect(errorsOf({ name: "a".repeat(81), lifeAreaId: AREA_ID })).toEqual({
      name: [PROJECT_ERRORS.nameTooLong],
    });
    expect(errorsOf({ name: `  ${"ñ".repeat(80)}  `, lifeAreaId: AREA_ID })).toEqual({});
  });

  test.each([
    ["NUL", "Mu\u0000danza"],
    ["zero-width space", "Mu​danza"],
    ["bidi override", "a‮b"],
  ])("a name with a %s is rejected", (_, name) => {
    expect(errorsOf({ name, lifeAreaId: AREA_ID })).toEqual({
      name: [PROJECT_ERRORS.nameInvisible],
    });
  });

  test("emoji sequences with joiners are fine", () => {
    expect(errorsOf({ name: "Familia 👨‍👩‍👧", lifeAreaId: AREA_ID })).toEqual({});
  });

  test("the area is required and must be a uuid", () => {
    expect(errorsOf({ name: "x" })).toEqual({ lifeAreaId: [PROJECT_ERRORS.area] });
    expect(errorsOf({ name: "x", lifeAreaId: "home" })).toEqual({
      lifeAreaId: [PROJECT_ERRORS.area],
    });
  });

  test("unknown fields are dropped (no priority, dates or deletedAt on create)", () => {
    expect(
      createProjectInputSchema.parse({
        name: "x",
        lifeAreaId: AREA_ID,
        priority: "high",
        deletedAt: "2026-01-01",
        completedAt: "2026-01-01",
      }),
    ).toEqual({ name: "x", lifeAreaId: AREA_ID, status: "idea" });
  });
});

describe("shared name helpers", () => {
  test("project names normalize exactly like area names", () => {
    expect(normalizeProjectName).toBe(normalizeName);
    expect(normalizeName("  México \n  lindo ")).toBe("México lindo");
  });

  test("hasInvisibleCharacters keeps U+200C and U+200D", () => {
    expect(hasInvisibleCharacters("a‍b")).toBe(false);
    expect(hasInvisibleCharacters("a‌b")).toBe(false);
    expect(hasInvisibleCharacters("a​b")).toBe(true);
    expect(hasInvisibleCharacters("a\tb")).toBe(true);
  });
});
