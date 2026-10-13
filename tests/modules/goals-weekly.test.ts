// G3 of `goals`: the weekly objective's pure rules (Monday of a Lima week, validation, the undo's
// input) and the extension point `habits` offers (registry, composition root, page order).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GOAL_ERRORS } from "@/modules/goals/goals-copy";
import {
  clearWeeklyObjectiveInputSchema,
  currentWeekStart,
  isDateKey,
  isMonday,
  mondayOf,
  setWeeklyObjectiveInputSchema,
  undoWeeklyObjectiveInputSchema,
  weekEnd,
  weeklyTextSchema,
} from "@/modules/goals/weekly-input";
import { WEEKLY_OBJECTIVE_MAX_LENGTH } from "@/modules/goals/goal-constants";
import { registerHabitSection, renderHabitSections } from "@/modules/habits/contracts";
import {
  createHabitSectionRegistry,
  type HabitSection,
  type HabitSectionContext,
} from "@/modules/habits/habit-extensions";
import { ownerDateKey } from "@/lib/time";

describe("the Monday of a week", () => {
  test.each([
    ["2026-10-12", "2026-10-12"], // a Monday is its own
    ["2026-10-13", "2026-10-12"],
    ["2026-10-18", "2026-10-12"], // Sunday closes the week that started on Monday 12
    ["2026-10-19", "2026-10-19"],
    ["2026-01-01", "2025-12-29"], // across the year
    ["2024-03-01", "2024-02-26"], // leap year
    ["2024-03-03", "2024-02-26"],
    ["2026-03-01", "2026-02-23"],
  ])("%s is in the week of %s", (day, monday) => {
    expect(mondayOf(day)).toBe(monday);
    expect(currentWeekStart(day)).toBe(monday);
    expect(isMonday(monday)).toBe(true);
  });

  test("every day of a week gives the same Monday (a table over 3 years)", () => {
    const mismatches: string[] = [];
    for (let time = Date.UTC(2025, 0, 1); time < Date.UTC(2028, 0, 1); time += 86_400_000) {
      const day = new Date(time).toISOString().slice(0, 10);
      const monday = mondayOf(day);
      const back = (time - Date.parse(`${monday}T00:00:00Z`)) / 86_400_000;
      if (!isMonday(monday) || back < 0 || back > 6) mismatches.push(day);
    }
    expect(mismatches).toEqual([]);
  });

  test("the week of Lima's clock: just before and after midnight on a Sunday", () => {
    // Sunday 2026-10-18 23:59 Lima (UTC-5) is still the week of the 12th; one minute later is the 19th.
    expect(currentWeekStart(ownerDateKey(new Date("2026-10-19T04:59:00Z")))).toBe("2026-10-12");
    expect(currentWeekStart(ownerDateKey(new Date("2026-10-19T05:00:00Z")))).toBe("2026-10-19");
  });

  test("a week ends on its Sunday", () => {
    expect(weekEnd("2026-10-12")).toBe("2026-10-18");
    expect(weekEnd("2025-12-29")).toBe("2026-01-04");
  });

  test("real dates only: no 2026-02-30, no 2026-1-5, no text", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-1-5")).toBe(false);
    expect(isDateKey("2026-10-12T00:00:00Z")).toBe(false);
    expect(isDateKey("lunes")).toBe(false);
    expect(isMonday("2026-10-13")).toBe(false);
    expect(isMonday("2026-02-30")).toBe(false);
  });
});

describe("the objective's text", () => {
  test("is normalized like a name", () => {
    expect(weeklyTextSchema.parse("  Terminar \n  el   informe ")).toBe("Terminar el informe");
  });

  test("1 to 140 characters, counted after normalizing", () => {
    expect(weeklyTextSchema.safeParse("a".repeat(WEEKLY_OBJECTIVE_MAX_LENGTH)).success).toBe(true);
    const long = weeklyTextSchema.safeParse("a".repeat(WEEKLY_OBJECTIVE_MAX_LENGTH + 1));
    expect(long.error?.issues[0]?.message).toBe(GOAL_ERRORS.weeklyTooLong);
    expect(weeklyTextSchema.safeParse("   ").error?.issues[0]?.message).toBe(
      GOAL_ERRORS.weeklyRequired,
    );
    expect(weeklyTextSchema.safeParse(undefined).error?.issues[0]?.message).toBe(
      GOAL_ERRORS.weeklyRequired,
    );
    // Whitespace that collapses does not count against the limit.
    expect(
      weeklyTextSchema.safeParse(`${"a ".repeat(70)}${" ".repeat(300)}`.trimEnd()).success,
    ).toBe(true);
  });

  test("invisible and control characters are refused", () => {
    expect(weeklyTextSchema.safeParse("hola​mundo").error?.issues[0]?.message).toBe(
      GOAL_ERRORS.weeklyInvisible,
    );
    expect(weeklyTextSchema.safeParse("hola\u0000").error?.issues[0]?.message).toBe(
      GOAL_ERRORS.weeklyInvisible,
    );
  });

  test("set, clear and undo need a Monday", () => {
    expect(
      setWeeklyObjectiveInputSchema.safeParse({ weekStart: "2026-10-12", text: "x" }).success,
    ).toBe(true);
    for (const weekStart of ["2026-10-13", "2026-02-30", "", 5, null]) {
      expect(setWeeklyObjectiveInputSchema.safeParse({ weekStart, text: "x" }).success).toBe(false);
      expect(clearWeeklyObjectiveInputSchema.safeParse({ weekStart }).success).toBe(false);
    }
    expect(
      clearWeeklyObjectiveInputSchema.safeParse({ weekStart: "2026-10-13" }).error?.issues[0]
        ?.message,
    ).toBe(GOAL_ERRORS.weekInvalid);
  });

  test("the undo carries the text to put back and what the change left (either may be none)", () => {
    const parse = (value: unknown) => undoWeeklyObjectiveInputSchema.safeParse(value);
    expect(parse({ weekStart: "2026-10-12", previous: null, applied: "Nuevo" }).success).toBe(true);
    expect(parse({ weekStart: "2026-10-12", previous: "Antes", applied: null }).success).toBe(true);
    expect(parse({ weekStart: "2026-10-12", previous: "Antes" }).success).toBe(false);
    expect(parse({ weekStart: "2026-10-12", applied: null }).success).toBe(false);
    expect(parse({ weekStart: "2026-10-12", previous: "", applied: null }).success).toBe(false);
  });
});

const CONTEXT: HabitSectionContext = { habit: { id: "h1", name: "Correr", archived: false } };

function fakeSection(id: string, text: string) {
  const calls: HabitSectionContext[] = [];
  const section: HabitSection = {
    id,
    async render(context) {
      calls.push(context);
      return `${text}:${context.habit.name}`;
    },
  };
  return { section, calls };
}

describe("habit sections", () => {
  test("renders every section with the habit's context, in registration order", async () => {
    const registry = createHabitSectionRegistry();
    const goals = fakeSection("goals", "Metas");
    const other = fakeSection("other", "Otra");
    registry.register(goals.section);
    registry.register(other.section);
    expect(await registry.render(CONTEXT)).toEqual([
      { id: "goals", node: "Metas:Correr" },
      { id: "other", node: "Otra:Correr" },
    ]);
    expect(goals.calls).toEqual([CONTEXT]);
  });

  test("registering an id again replaces it (idempotent); removing never drops a newer one", async () => {
    const registry = createHabitSectionRegistry();
    const first = fakeSection("goals", "Uno");
    const second = fakeSection("goals", "Dos");
    const removeFirst = registry.register(first.section);
    registry.register(first.section);
    expect(registry.size()).toBe(1);
    registry.register(second.section);
    expect(registry.size()).toBe(1);
    removeFirst();
    expect(await registry.render(CONTEXT)).toEqual([{ id: "goals", node: "Dos:Correr" }]);
    expect(first.calls).toEqual([]);
  });

  test("without sections nothing renders", async () => {
    expect(await createHabitSectionRegistry().render(CONTEXT)).toEqual([]);
  });

  test("the app's registry (the contract of habits)", async () => {
    const { section } = fakeSection("fake-section", "Falsa");
    const remove = registerHabitSection(section);
    try {
      expect(await renderHabitSections(CONTEXT)).toContainEqual({
        id: "fake-section",
        node: "Falsa:Correr",
      });
    } finally {
      remove();
    }
    expect(await renderHabitSections(CONTEXT)).not.toContainEqual(
      expect.objectContaining({ id: "fake-section" }),
    );
  });
});

describe("composition root of goals", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

  test("registers the providers by name, never through a side-effect-only import", () => {
    const source = read("src/lib/goal-extensions.ts");
    expect(source).not.toMatch(/^import "@\/modules\//m);
    expect(source).toMatch(
      /import \{ habitGoalsSection, projectGoalsSection \} from "@\/modules\/goals\/linked-goals";/,
    );
    expect(source).toMatch(/registerHabitSection\(section\)/);
    expect(source).toMatch(/registerProjectSection\(section\)/);
  });

  test.each([
    ["src/app/(app)/habits/[id]/page.tsx", "renderHabitSections("],
    ["src/app/(app)/projects/[id]/page.tsx", "renderProjectSections("],
  ])("%s calls ensureGoalExtensions() before %s", (file, call) => {
    const source = read(file);
    const ensure = source.indexOf("ensureGoalExtensions();");
    expect(ensure).toBeGreaterThan(-1);
    expect(ensure).toBeLessThan(source.indexOf(call, ensure));
  });

  test("habits and projects never import goals (only the composition root crosses)", () => {
    const files = [
      "src/modules/habits/contracts.ts",
      "src/modules/habits/habit-extensions.ts",
      "src/modules/projects/contracts.ts",
      "src/modules/projects/project-extensions.ts",
      "src/app/(app)/habits/[id]/page.tsx",
      "src/app/(app)/projects/[id]/page.tsx",
    ];
    for (const file of files) expect(read(file)).not.toMatch(/@\/modules\/goals/);
  });
});
