import { describe, expect, test } from "vitest";
import {
  applyOrder,
  isSameIdSet,
  moveId,
  planReorder,
  renumberIntoSlots,
} from "@/modules/core/life-area-order";

describe("moveId", () => {
  test("moves an item up, down, to the ends, and returns a new array", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveId(ids, 2, 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveId(ids, 0, 1)).toEqual(["b", "a", "c", "d"]);
    expect(moveId(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveId(ids, 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  test("clamps the target and ignores an index out of range", () => {
    expect(moveId(["a", "b"], 0, 9)).toEqual(["b", "a"]);
    expect(moveId(["a", "b"], 1, -3)).toEqual(["b", "a"]);
    expect(moveId(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveId([], 0, 0)).toEqual([]);
  });
});

describe("isSameIdSet", () => {
  test.each([
    [["a", "b"], ["b", "a"], true],
    [[], [], true],
    [["a", "b"], ["a"], false],
    [["a"], ["a", "b"], false],
    [["a", "b"], ["a", "c"], false],
    [["a", "a"], ["a", "b"], false],
    [["a", "b"], ["a", "a"], false],
  ])("%j vs %j → %s", (a, b, expected) => {
    expect(isSameIdSet(a, b)).toBe(expected);
  });
});

describe("planReorder", () => {
  const current = [
    { id: "a", archived: false },
    { id: "x", archived: true },
    { id: "b", archived: false },
    { id: "c", archived: false },
    { id: "y", archived: true },
  ];

  test("archived areas keep their index; the active ones fill the other slots in order", () => {
    expect(planReorder(current, ["c", "a", "b"])).toEqual(["c", "x", "a", "b", "y"]);
  });

  test("the same order is a valid no-op", () => {
    expect(planReorder(current, ["a", "b", "c"])).toEqual(["a", "x", "b", "c", "y"]);
  });

  test.each([
    ["a missing active area (created elsewhere)", ["a", "b"]],
    ["an extra id (archived or deleted elsewhere)", ["a", "b", "c", "x"]],
    ["an unknown id", ["a", "b", "z"]],
    ["a duplicate", ["a", "b", "b"]],
    ["an empty list", []],
  ])("rejects %s", (_, submitted) => {
    expect(planReorder(current, submitted)).toBeNull();
  });

  test("with no areas at all, only the empty list matches", () => {
    expect(planReorder([], [])).toEqual([]);
  });
});

describe("applyOrder", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "new" }];

  test("orders by the ids and keeps the rest after them, in their order", () => {
    expect(applyOrder(items, ["c", "a", "b"]).map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
      "new",
    ]);
  });

  test("ignores ids that are not in the list", () => {
    expect(applyOrder(items, ["gone", "b"]).map((item) => item.id)).toEqual(["b", "a", "c", "new"]);
  });
});

describe("renumberIntoSlots", () => {
  test("hands the active slots (gaps for archived areas included) out in the new order", () => {
    const moved = [
      { id: "c", sortOrder: 3 },
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 2 },
    ];
    expect(renumberIntoSlots(moved)).toEqual([
      { id: "c", sortOrder: 0 },
      { id: "a", sortOrder: 2 },
      { id: "b", sortOrder: 3 },
    ]);
  });

  test("keeps items that are already in their slot", () => {
    const same = [{ id: "a", sortOrder: 0 }];
    expect(renumberIntoSlots(same)[0]).toBe(same[0]);
  });
});
