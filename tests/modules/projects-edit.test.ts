// P2: the edit schemas of the detail, the status → completed_at rule, the optimistic view and
// the day formats it shows.
import { describe, expect, test } from "vitest";
import { formatDateKey, formatOwnerDay } from "@/lib/time";
import { applyProjectChange } from "@/modules/projects/project-optimistic";
import {
  changeProjectAreaInputSchema,
  changeProjectPriorityInputSchema,
  changeProjectStatusInputSchema,
  PROJECT_ERRORS,
  projectIdInputSchema,
  renameProjectInputSchema,
  updateProjectDatesInputSchema,
  updateProjectObjectiveInputSchema,
  type ProjectSummary,
} from "@/modules/projects/project-input";
import { completedAtAfter, showsDueDate } from "@/modules/projects/project-status";

const ID = "8f6c1a2e-4b3d-4c5e-9f70-112233445566";
const AREA_ID = "1f6c1a2e-4b3d-4c5e-9f70-112233445566";

/** Messages per field of a failed parse (empty when it passes). */
function errorsOf(schema: { safeParse: (input: unknown) => unknown }, input: unknown) {
  const parsed = schema.safeParse(input) as
    | { success: true }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  if (parsed.success) return {};
  const errors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    (errors[issue.path.join(".")] ??= []).push(issue.message);
  }
  return errors;
}

describe("every edit needs a project id (a uuid)", () => {
  test.each([
    ["delete / undo", projectIdInputSchema, {}],
    ["rename", renameProjectInputSchema, { name: "X" }],
    ["status", changeProjectStatusInputSchema, { status: "done" }],
    ["priority", changeProjectPriorityInputSchema, { priority: "low" }],
    ["area", changeProjectAreaInputSchema, { lifeAreaId: AREA_ID }],
    ["objective", updateProjectObjectiveInputSchema, { objective: null }],
    ["dates", updateProjectDatesInputSchema, {}],
  ] as const)("%s", (_, schema, rest) => {
    expect(schema.safeParse({ id: ID, ...rest }).success).toBe(true);
    expect(errorsOf(schema, { id: "not-a-uuid", ...rest })).toEqual({
      id: [PROJECT_ERRORS.notFound],
    });
    expect(errorsOf(schema, rest)).toHaveProperty("id");
  });
});

describe("renameProjectInputSchema", () => {
  test("normalizes like creating and checks 1–80 and invisible characters", () => {
    expect(renameProjectInputSchema.parse({ id: ID, name: "  Viaje \n a  Cusco " })).toEqual({
      id: ID,
      name: "Viaje a Cusco",
    });
    expect(errorsOf(renameProjectInputSchema, { id: ID, name: "   " })).toEqual({
      name: [PROJECT_ERRORS.nameRequired],
    });
    expect(errorsOf(renameProjectInputSchema, { id: ID, name: "x".repeat(81) })).toEqual({
      name: [PROJECT_ERRORS.nameTooLong],
    });
    expect(errorsOf(renameProjectInputSchema, { id: ID, name: "a\u0000b" })).toEqual({
      name: [PROJECT_ERRORS.nameInvisible],
    });
  });

  test("drops fields it doesn't know (status, area, deleted_at…)", () => {
    expect(
      renameProjectInputSchema.parse({ id: ID, name: "X", status: "done", deletedAt: null }),
    ).toEqual({ id: ID, name: "X" });
  });
});

describe("status and priority", () => {
  test("all six states, including Terminado and Cancelado", () => {
    for (const status of ["idea", "active", "paused", "maintenance", "done", "canceled"]) {
      expect(changeProjectStatusInputSchema.safeParse({ id: ID, status }).success).toBe(true);
    }
    expect(errorsOf(changeProjectStatusInputSchema, { id: ID, status: "archived" })).toEqual({
      status: [PROJECT_ERRORS.status],
    });
  });

  test("Baja, Media, Alta", () => {
    for (const priority of ["low", "medium", "high"]) {
      expect(changeProjectPriorityInputSchema.safeParse({ id: ID, priority }).success).toBe(true);
    }
    expect(errorsOf(changeProjectPriorityInputSchema, { id: ID, priority: "urgent" })).toEqual({
      priority: [PROJECT_ERRORS.priority],
    });
  });

  test("area: a uuid", () => {
    expect(errorsOf(changeProjectAreaInputSchema, { id: ID, lifeAreaId: "home" })).toEqual({
      lifeAreaId: [PROJECT_ERRORS.area],
    });
  });
});

describe("updateProjectObjectiveInputSchema", () => {
  const parse = (objective: unknown) =>
    updateProjectObjectiveInputSchema.parse({ id: ID, objective }).objective;

  test("one paragraph: whitespace collapsed; empty or null clears it", () => {
    expect(parse("  Todo \n\n listo  ")).toBe("Todo listo");
    expect(parse("   ")).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse(null)).toBeNull();
  });

  test("up to 280 characters, no invisible characters", () => {
    expect(parse("x".repeat(280))).toHaveLength(280);
    expect(
      errorsOf(updateProjectObjectiveInputSchema, { id: ID, objective: "x".repeat(281) }),
    ).toEqual({ objective: [PROJECT_ERRORS.objectiveTooLong] });
    expect(errorsOf(updateProjectObjectiveInputSchema, { id: ID, objective: "a‮b" })).toEqual({
      objective: [PROJECT_ERRORS.objectiveInvisible],
    });
  });
});

describe("updateProjectDatesInputSchema", () => {
  const dates = (startDate: unknown, dueDate: unknown) =>
    errorsOf(updateProjectDatesInputSchema, { id: ID, startDate, dueDate });

  test("each date is optional; empty means none", () => {
    expect(updateProjectDatesInputSchema.parse({ id: ID, startDate: "", dueDate: "" })).toEqual({
      id: ID,
      startDate: null,
      dueDate: null,
    });
    expect(updateProjectDatesInputSchema.parse({ id: ID })).toEqual({
      id: ID,
      startDate: null,
      dueDate: null,
    });
    expect(dates("2026-10-01", null)).toEqual({});
    expect(dates(null, "2026-10-01")).toEqual({});
  });

  test("the end on or after the start; before it is an error on the end", () => {
    expect(dates("2026-10-01", "2026-10-01")).toEqual({});
    expect(dates("2026-10-01", "2026-12-31")).toEqual({});
    expect(dates("2026-10-02", "2026-10-01")).toEqual({ dueDate: [PROJECT_ERRORS.dueBeforeStart] });
    // Across a year: compared as days, not as text that happens to sort.
    expect(dates("2026-12-31", "2027-01-01")).toEqual({});
  });

  test("only real calendar days as YYYY-MM-DD", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "01/10/2026", "2026-10-01T00:00", 20261001]) {
      expect(dates(bad, null)).toEqual({ startDate: [PROJECT_ERRORS.dateInvalid] });
    }
    expect(dates(null, "2028-02-29")).toEqual({});
  });
});

describe("completedAtAfter (status → completed_at, like the database CHECK)", () => {
  const now = new Date("2026-10-01T15:00:00.000Z");
  const before = new Date("2026-09-01T12:00:00.000Z");

  test("moving to Terminado stamps it; staying keeps the original date", () => {
    expect(completedAtAfter("done", null, now)).toBe(now);
    expect(completedAtAfter("done", before, now)).toBe(before);
  });

  test("any other state clears it", () => {
    for (const status of ["idea", "active", "paused", "maintenance", "canceled"] as const) {
      expect(completedAtAfter(status, before, now)).toBeNull();
      expect(completedAtAfter(status, null, now)).toBeNull();
    }
  });

  test("only Mantenimiento hides the end date", () => {
    expect(showsDueDate("maintenance")).toBe(false);
    for (const status of ["idea", "active", "paused", "done", "canceled"] as const) {
      expect(showsDueDate(status)).toBe(true);
    }
  });
});

describe("applyProjectChange (optimistic view)", () => {
  const project: ProjectSummary = {
    id: ID,
    name: "Mudanza",
    objective: null,
    status: "active",
    priority: "medium",
    startDate: null,
    dueDate: "2026-10-04",
    completedAt: null,
    area: { id: AREA_ID, slug: "home", name: "Hogar", icon: "house", color: "home" },
  };
  const at = new Date("2026-10-01T15:00:00.000Z");

  test("applies the fields and leaves the rest", () => {
    expect(
      applyProjectChange(project, { patch: { name: "Mudanza 2", priority: "high" }, at }),
    ).toEqual({ ...project, name: "Mudanza 2", priority: "high" });
  });

  test("a new status moves completed_at like the server", () => {
    const done = applyProjectChange(project, { patch: { status: "done" }, at });
    expect(done.completedAt).toBe(at);
    expect(applyProjectChange(done, { patch: { status: "paused" }, at }).completedAt).toBeNull();
    // An edit that isn't the status keeps it.
    expect(applyProjectChange(done, { patch: { name: "X" }, at }).completedAt).toBe(at);
  });
});

describe("day formats", () => {
  test("an instant's day in Lima (around midnight)", () => {
    // 23:59 on Oct 2 in Lima is 04:59 on Oct 3 UTC.
    expect(formatOwnerDay(new Date("2026-10-03T04:59:00.000Z"))).toBe("2 de octubre de 2026");
    expect(formatOwnerDay(new Date("2026-10-03T05:00:00.000Z"), "short")).toBe("3 oct. 2026");
  });

  test("a YYYY-MM-DD day never shifts", () => {
    expect(formatDateKey("2026-10-01")).toBe("1 de octubre de 2026");
    expect(formatDateKey("2026-01-01", "short")).toBe("1 ene. 2026");
  });
});
