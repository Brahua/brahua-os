import { describe, expect, test } from "vitest";
import { applyAreasChange, type AreasView } from "@/modules/core/areas-optimistic";
import type { LifeAreaSummary } from "@/modules/core/life-area-input";

function area(id: string, sortOrder: number): LifeAreaSummary {
  return { id, slug: id, name: id.toUpperCase(), color: "home", icon: "house", sortOrder };
}

const VIEW: AreasView = {
  active: [area("a", 0), area("b", 2), area("c", 3)],
  archived: [area("x", 1)],
};

const ids = (list: LifeAreaSummary[]) => list.map((item) => item.id);

describe("applyAreasChange", () => {
  test("reorder puts the active areas in the given order", () => {
    const next = applyAreasChange(VIEW, { type: "reorder", ids: ["c", "a", "b"] });
    expect(ids(next.active)).toEqual(["c", "a", "b"]);
    // Renumbered into the active slots (1 belongs to the archived x).
    expect(next.active.map((item) => item.sortOrder)).toEqual([0, 2, 3]);
    expect(next.archived).toBe(VIEW.archived);
  });

  test("reorder on a fresher base keeps areas it does not know about", () => {
    const fresh = { ...VIEW, active: [...VIEW.active, area("d", 4)] };
    const next = applyAreasChange(fresh, { type: "reorder", ids: ["b", "a", "c"] });
    expect(ids(next.active)).toEqual(["b", "a", "c", "d"]);
  });

  test("archive moves the area to the top of the archived list", () => {
    const next = applyAreasChange(VIEW, { type: "archive", id: "b" });
    expect(ids(next.active)).toEqual(["a", "c"]);
    expect(ids(next.archived)).toEqual(["b", "x"]);
  });

  test("unarchive to the end", () => {
    const next = applyAreasChange(VIEW, { type: "unarchive", id: "x", position: "end" });
    expect(ids(next.active)).toEqual(["a", "b", "c", "x"]);
    expect(next.archived).toEqual([]);
  });

  test("unarchive to its original place (undoing an archive) goes by sort order", () => {
    const next = applyAreasChange(VIEW, { type: "unarchive", id: "x", position: "original" });
    expect(ids(next.active)).toEqual(["a", "x", "b", "c"]);

    const last = { active: [area("a", 0)], archived: [area("z", 9)] };
    expect(
      ids(applyAreasChange(last, { type: "unarchive", id: "z", position: "original" }).active),
    ).toEqual(["a", "z"]);
  });

  test("undo of an archive after a reorder puts it back in its slot", () => {
    const archived = applyAreasChange(VIEW, { type: "archive", id: "b" }); // b had slot 2
    const moved = applyAreasChange(archived, { type: "reorder", ids: ["c", "a"] });
    expect(moved.active.map((item) => item.sortOrder)).toEqual([0, 3]);
    const undone = applyAreasChange(moved, { type: "unarchive", id: "b", position: "original" });
    expect(ids(undone.active)).toEqual(["c", "b", "a"]);
  });

  test("archive then undo restores the list as it was", () => {
    const archived = applyAreasChange(VIEW, { type: "archive", id: "b" });
    const undone = applyAreasChange(archived, { type: "unarchive", id: "b", position: "original" });
    expect(ids(undone.active)).toEqual(["a", "b", "c"]);
    expect(ids(undone.archived)).toEqual(["x"]);
  });

  test("an id that is gone (or already moved) leaves the view as it is", () => {
    expect(applyAreasChange(VIEW, { type: "archive", id: "x" })).toBe(VIEW);
    expect(applyAreasChange(VIEW, { type: "archive", id: "nope" })).toBe(VIEW);
    expect(applyAreasChange(VIEW, { type: "unarchive", id: "a", position: "end" })).toBe(VIEW);
  });
});
