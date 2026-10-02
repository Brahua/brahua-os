// T1: the area-or-project picker's values and the optimistic list of tasks.
import { describe, expect, test } from "vitest";
import {
  INBOX_VALUE,
  placementName,
  placementOptions,
  placementPatch,
  placementValue,
  toPlacement,
} from "@/modules/tasks/placement";
import type { TaskItem, TaskTargets } from "@/modules/tasks/task-input";
import { applyTaskListChange, neighborOf } from "@/modules/tasks/task-list-optimistic";

const HEALTH = { id: "a1", slug: "health", name: "Salud", icon: "heart-pulse", color: "health" } as const;
const HOME = { id: "a2", slug: "home", name: "Hogar", icon: "house", color: "home" } as const;
const TARGETS: TaskTargets = {
  areas: [HEALTH, HOME],
  projects: [{ id: "p1", name: "Cocina", status: "active", area: HOME }],
};

const task = (id: string, extra: Partial<TaskItem> = {}): TaskItem => ({
  id,
  title: id,
  priority: "medium",
  dueDate: null,
  doneAt: null,
  createdAt: new Date("2026-10-01T15:00:00Z"),
  lifeAreaId: null,
  projectId: null,
  milestoneId: null,
  isNextAction: false,
  area: null,
  project: null,
  recurrence: null,
  tags: [],
  ...extra,
});

describe("placement values", () => {
  test("encode and decode the inbox, an area and a project", () => {
    expect(placementValue(task("t"))).toBe(INBOX_VALUE);
    expect(placementValue(task("t", { lifeAreaId: "a1" }))).toBe("area:a1");
    expect(placementValue(task("t", { projectId: "p1" }))).toBe("project:p1");
    expect(toPlacement("")).toEqual({ lifeAreaId: null, projectId: null, milestoneId: null });
    expect(toPlacement("area:a1")).toEqual({ lifeAreaId: "a1", projectId: null, milestoneId: null });
    expect(toPlacement("project:p1")).toEqual({
      lifeAreaId: null,
      projectId: "p1",
      milestoneId: null,
    });
    expect(toPlacement("bogus")).toEqual({ lifeAreaId: null, projectId: null, milestoneId: null });
  });

  test("staying in the same project keeps the milestone; another project drops it", () => {
    const current = { projectId: "p1", milestoneId: "m1" };
    expect(toPlacement("project:p1", current).milestoneId).toBe("m1");
    expect(toPlacement("project:p2", current).milestoneId).toBeNull();
  });

  test("options: areas in order, projects with their area; the current one stays if gone", () => {
    expect(placementOptions(TARGETS)).toEqual({
      areas: [
        { value: "area:a1", label: "Salud" },
        { value: "area:a2", label: "Hogar" },
      ],
      projects: [{ value: "project:p1", label: "Cocina · Hogar" }],
    });
    const archived = { id: "a9", slug: "old", name: "Viejo", icon: "house", color: "home" } as const;
    expect(
      placementOptions(TARGETS, task("t", { lifeAreaId: "a9", area: archived })).areas[0],
    ).toEqual({ value: "area:a9", label: "Viejo (archivada)" });
    expect(
      placementOptions(
        TARGETS,
        task("t", { projectId: "p9", project: { id: "p9", name: "Viaje", status: "done" } }),
      ).projects[0],
    ).toEqual({ value: "project:p9", label: "Viaje (cerrado)" });
    expect(placementOptions(null)).toEqual({ areas: [], projects: [] });
  });

  test("names and the optimistic patch (the area comes from the project)", () => {
    expect(placementName(TARGETS, "area:a1")).toBe("Salud");
    expect(placementName(TARGETS, "project:p1")).toBe("Cocina");
    expect(placementName(TARGETS, "")).toBeNull();
    expect(placementPatch(TARGETS, "project:p1", task("t"))).toEqual({
      lifeAreaId: null,
      projectId: "p1",
      milestoneId: null,
      area: HOME,
      project: { id: "p1", name: "Cocina", status: "active" },
    });
    expect(placementPatch(TARGETS, "", task("t", { lifeAreaId: "a1", area: HEALTH }))).toEqual({
      lifeAreaId: null,
      projectId: null,
      milestoneId: null,
      area: null,
      project: null,
    });
  });
});

describe("applyTaskListChange", () => {
  const list = [task("a"), task("b"), task("c")];

  test("remove, restore at its place (clamped), update in place", () => {
    expect(applyTaskListChange(list, { type: "remove", id: "b" }).map((t) => t.id)).toEqual([
      "a",
      "c",
    ]);
    const without = list.filter((t) => t.id !== "b");
    expect(
      applyTaskListChange(without, { type: "restore", task: task("b"), index: 1 }).map((t) => t.id),
    ).toEqual(["a", "b", "c"]);
    expect(
      applyTaskListChange([], { type: "restore", task: task("b"), index: 5 }).map((t) => t.id),
    ).toEqual(["b"]);
    expect(
      applyTaskListChange(list, { type: "update", id: "c", patch: { title: "C" } })[2].title,
    ).toBe("C");
  });

  test("restoring one that is already there replaces it (the server got there first)", () => {
    const restored = applyTaskListChange(list, {
      type: "restore",
      task: task("b", { title: "B" }),
      index: 0,
    });
    expect(restored.map((t) => t.title)).toEqual(["a", "B", "c"]);
  });

  test("neighborOf: the next one, else the previous, else none", () => {
    expect(neighborOf(list, "a")?.id).toBe("b");
    expect(neighborOf(list, "c")?.id).toBe("b");
    expect(neighborOf([task("a")], "a")).toBeNull();
    expect(neighborOf(list, "zz")).toBeNull();
  });
});
