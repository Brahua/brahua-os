// P3: milestone schemas, progress, the optimistic view and the segment math (pure code).
import { describe, expect, test } from "vitest";
import { filledSegments, MAX_SEGMENTS } from "@/modules/projects/components/progress-meter";
import {
  addMilestoneInputSchema,
  MAX_MILESTONES_PER_PROJECT,
  MILESTONE_ERRORS,
  reorderMilestonesInputSchema,
  restoreMilestoneInputSchema,
  setMilestoneDoneInputSchema,
  updateMilestoneInputSchema,
  type ProjectMilestoneItem,
} from "@/modules/projects/milestone-input";
import { applyMilestoneChange } from "@/modules/projects/milestone-optimistic";
import { countMilestones, milestoneProgress } from "@/modules/projects/progress";
import { PROJECT_ERRORS } from "@/modules/projects/project-input";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-0000000000a1";

function errorsOf(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]);
}

describe("schemas", () => {
  test("a title is normalized like names and must be 1–120 visible characters", () => {
    expect(
      addMilestoneInputSchema.parse({ projectId: PROJECT, id: ID, title: "  Pedir   presupuesto " })
        .title,
    ).toBe("Pedir presupuesto");
    expect(
      addMilestoneInputSchema.safeParse({ projectId: PROJECT, id: ID, title: "x".repeat(120) })
        .success,
    ).toBe(true);
    for (const [title, message] of [
      ["  ", MILESTONE_ERRORS.titleRequired],
      [undefined, MILESTONE_ERRORS.titleRequired],
      ["x".repeat(121), MILESTONE_ERRORS.titleTooLong],
      ["Hito\u0007", MILESTONE_ERRORS.titleInvisible],
    ] as const) {
      expect(
        errorsOf(addMilestoneInputSchema.safeParse({ projectId: PROJECT, id: ID, title })),
      ).toEqual([["title", message]]);
    }
  });

  test("ids must be uuids: the project's says “not found”, like the project actions", () => {
    expect(
      errorsOf(addMilestoneInputSchema.safeParse({ projectId: "x", id: "y", title: "A" })),
    ).toEqual([
      ["projectId", PROJECT_ERRORS.notFound],
      ["id", MILESTONE_ERRORS.notFound],
    ]);
  });

  test("the due date is optional and must be a real day", () => {
    const base = { projectId: PROJECT, id: ID, title: "A" };
    expect(updateMilestoneInputSchema.parse({ ...base, dueDate: "" }).dueDate).toBeNull();
    expect(updateMilestoneInputSchema.parse({ ...base }).dueDate).toBeNull();
    expect(updateMilestoneInputSchema.parse({ ...base, dueDate: "2026-02-28" }).dueDate).toBe(
      "2026-02-28",
    );
    expect(
      errorsOf(updateMilestoneInputSchema.safeParse({ ...base, dueDate: "2026-02-30" })),
    ).toEqual([["dueDate", MILESTONE_ERRORS.dateInvalid]]);
  });

  test("done is a boolean", () => {
    expect(
      setMilestoneDoneInputSchema.safeParse({ projectId: PROJECT, id: ID, done: "true" }).success,
    ).toBe(false);
    expect(
      setMilestoneDoneInputSchema.safeParse({ projectId: PROJECT, id: ID, done: false }).success,
    ).toBe(true);
  });

  test("restore: an ISO instant or null, and a position within bounds", () => {
    const base = { projectId: PROJECT, id: ID, title: "A", dueDate: null };
    expect(
      restoreMilestoneInputSchema.safeParse({ ...base, doneAt: null, position: 0 }).success,
    ).toBe(true);
    expect(
      restoreMilestoneInputSchema.safeParse({
        ...base,
        doneAt: "2026-10-01T15:00:00.000Z",
        position: 3,
      }).success,
    ).toBe(true);
    for (const bad of [
      { doneAt: "ayer", position: 0 },
      { doneAt: null, position: -1 },
      { doneAt: null, position: 1.5 },
      { doneAt: null, position: MAX_MILESTONES_PER_PROJECT + 1 },
    ]) {
      expect(restoreMilestoneInputSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
  });

  test("reorder: 1 to 100 distinct uuids", () => {
    const ids = [ID, "00000000-0000-4000-8000-0000000000a2"];
    expect(reorderMilestonesInputSchema.safeParse({ projectId: PROJECT, ids }).success).toBe(true);
    for (const bad of [
      [],
      [ID, ID],
      ["x"],
      Array.from({ length: 101 }, () => crypto.randomUUID()),
    ]) {
      const result = reorderMilestonesInputSchema.safeParse({ projectId: PROJECT, ids: bad });
      expect(result.success).toBe(false);
      for (const [, message] of errorsOf(result)) expect(message).toBe(MILESTONE_ERRORS.order);
    }
  });
});

describe("progress", () => {
  test("done / total, with 0, some and all milestones done", () => {
    expect(milestoneProgress({ done: 0, total: 4 }, "active")).toEqual({
      done: 0,
      total: 4,
      ratio: 0,
    });
    expect(milestoneProgress({ done: 1, total: 4 }, "active")).toEqual({
      done: 1,
      total: 4,
      ratio: 0.25,
    });
    expect(milestoneProgress({ done: 4, total: 4 }, "done")).toEqual({
      done: 4,
      total: 4,
      ratio: 1,
    });
  });

  test("nothing without milestones, nor in Mantenimiento", () => {
    expect(milestoneProgress({ done: 0, total: 0 }, "active")).toBeNull();
    expect(milestoneProgress(undefined, "active")).toBeNull();
    expect(milestoneProgress(null, "idea")).toBeNull();
    expect(milestoneProgress({ done: 2, total: 3 }, "maintenance")).toBeNull();
  });

  test("every other state shows it", () => {
    for (const status of ["idea", "active", "paused", "done", "canceled"] as const) {
      expect(milestoneProgress({ done: 1, total: 2 }, status)?.ratio).toBe(0.5);
    }
  });

  test("a bad pair never goes past 100 % or below 0", () => {
    expect(milestoneProgress({ done: 7, total: 3 }, "active")).toEqual({
      done: 3,
      total: 3,
      ratio: 1,
    });
    expect(milestoneProgress({ done: -1, total: 3 }, "active")?.done).toBe(0);
  });

  test("countMilestones counts the ones with doneAt", () => {
    expect(countMilestones([])).toEqual({ done: 0, total: 0 });
    expect(
      countMilestones([{ doneAt: new Date() }, { doneAt: null }, { doneAt: new Date() }]),
    ).toEqual({
      done: 2,
      total: 3,
    });
  });

  test("segments: one per milestone up to the cap, then proportional (full only when all done)", () => {
    expect(filledSegments({ done: 3, total: 5, ratio: 0.6 }, 5)).toBe(3);
    expect(filledSegments({ done: 39, total: 40, ratio: 39 / 40 }, MAX_SEGMENTS)).toBe(19);
    expect(filledSegments({ done: 40, total: 40, ratio: 1 }, MAX_SEGMENTS)).toBe(MAX_SEGMENTS);
    expect(filledSegments({ done: 1, total: 40, ratio: 1 / 40 }, MAX_SEGMENTS)).toBe(0);
  });
});

const item = (
  id: string,
  sortOrder: number,
  extra: Partial<ProjectMilestoneItem> = {},
): ProjectMilestoneItem => ({
  id,
  title: id.toUpperCase(),
  dueDate: null,
  doneAt: null,
  sortOrder,
  ...extra,
});

describe("applyMilestoneChange", () => {
  const list = [item("a", 0), item("b", 1), item("c", 2)];
  const ids = (items: ProjectMilestoneItem[]) => items.map((one) => `${one.id}${one.sortOrder}`);

  test("add goes last (once)", () => {
    const added = applyMilestoneChange(list, { type: "add", milestone: item("d", 99) });
    expect(ids(added)).toEqual(["a0", "b1", "c2", "d3"]);
    expect(applyMilestoneChange(added, { type: "add", milestone: item("d", 3) })).toBe(added);
  });

  test("update and done change one item; checking a done one keeps its date", () => {
    const at = new Date("2026-10-01T10:00:00Z");
    const updated = applyMilestoneChange(list, {
      type: "update",
      id: "b",
      title: "Nuevo",
      dueDate: "2026-11-01",
    });
    expect(updated[1]).toMatchObject({ title: "Nuevo", dueDate: "2026-11-01" });
    const done = applyMilestoneChange(list, { type: "done", id: "a", doneAt: at });
    expect(done[0].doneAt).toBe(at);
    const again = applyMilestoneChange(done, { type: "done", id: "a", doneAt: new Date() });
    expect(again[0].doneAt).toBe(at);
    expect(
      applyMilestoneChange(done, { type: "done", id: "a", doneAt: null })[0].doneAt,
    ).toBeNull();
  });

  test("remove closes the gap; restore puts it back at its position (clamped), once", () => {
    const removed = applyMilestoneChange(list, { type: "remove", id: "b" });
    expect(ids(removed)).toEqual(["a0", "c1"]);
    const restored = applyMilestoneChange(removed, {
      type: "restore",
      milestone: list[1],
      position: 1,
    });
    expect(ids(restored)).toEqual(["a0", "b1", "c2"]);
    expect(
      applyMilestoneChange(restored, { type: "restore", milestone: list[1], position: 0 }),
    ).toBe(restored);
    expect(
      ids(applyMilestoneChange(removed, { type: "restore", milestone: list[1], position: 9 })),
    ).toEqual(["a0", "c1", "b2"]);
  });

  test("reorder renumbers; ids it doesn't know about keep their place after the known ones", () => {
    expect(ids(applyMilestoneChange(list, { type: "reorder", ids: ["c", "a", "b"] }))).toEqual([
      "c0",
      "a1",
      "b2",
    ]);
    // The base got a new milestone (revalidation) before the move was applied.
    const newer = [...list, item("d", 3)];
    expect(ids(applyMilestoneChange(newer, { type: "reorder", ids: ["b", "a", "c"] }))).toEqual([
      "b0",
      "a1",
      "c2",
      "d3",
    ]);
  });
});
