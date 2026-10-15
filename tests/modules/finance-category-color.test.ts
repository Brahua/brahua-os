// finance-motion M3: the accent slot of a category (1…8, automatic).
import { describe, expect, test } from "vitest";
import { nextFreeSlot, OTHER_SLOT, slotOf } from "@/modules/finance/category-color";

describe("slotOf", () => {
  test("a stored slot is itself; none, or out of range, is «Otros» (8)", () => {
    expect([1, 5, 8].map(slotOf)).toEqual([1, 5, 8]);
    expect([null, undefined, 0, 9, 2.5].map(slotOf)).toEqual(Array(5).fill(OTHER_SLOT));
  });
});

describe("nextFreeSlot", () => {
  test("the first slot nobody uses, filling gaps", () => {
    expect(nextFreeSlot([])).toBe(1);
    expect(nextFreeSlot([1, 2, 3])).toBe(4);
    expect(nextFreeSlot([1, 3])).toBe(2);
    expect(nextFreeSlot([null, 1])).toBe(2);
  });

  test("with all eight taken the colors repeat in order (the least used, lowest first)", () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(nextFreeSlot(all)).toBe(1);
    expect(nextFreeSlot([...all, 1])).toBe(2);
    expect(nextFreeSlot([...all, 1, 2, 3, 4, 5, 6, 7, 8])).toBe(1);
  });
});
