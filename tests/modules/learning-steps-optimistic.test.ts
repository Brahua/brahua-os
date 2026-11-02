// L1 of `learning`: the optimistic view of a syllabus (what the section shows while a change is on
// its way). Positions stay 0…n-1, as the server writes them.
import { describe, expect, test } from "vitest";
import type { StepItem } from "@/modules/learning/steps-input";
import { applyStepChange } from "@/modules/learning/steps-optimistic";

const step = (id: string, position: number, doneAt: string | null = null): StepItem => ({
  id,
  title: `Paso ${id}`,
  position,
  doneAt,
});
const ids = (steps: StepItem[]) => steps.map((item) => `${item.id}${item.position}`);

const BASE = [step("a", 0), step("b", 1), step("c", 2)];

describe("applyStepChange", () => {
  test("adds at the end, once", () => {
    const added = applyStepChange(BASE, { type: "add", step: step("d", 9) });
    expect(ids(added)).toEqual(["a0", "b1", "c2", "d3"]);
    expect(applyStepChange(added, { type: "add", step: step("d", 9) })).toBe(added);
  });

  test("renames and checks one step only", () => {
    const renamed = applyStepChange(BASE, { type: "rename", id: "b", title: "Nuevo" });
    expect(renamed.map((item) => item.title)).toEqual(["Paso a", "Nuevo", "Paso c"]);
    const done = applyStepChange(BASE, {
      type: "done",
      id: "c",
      doneAt: "2026-11-02T15:00:00.000Z",
    });
    expect(done.map((item) => item.doneAt !== null)).toEqual([false, false, true]);
  });

  test("removes and restores after its neighbour, else at its position", () => {
    const removed = applyStepChange(BASE, { type: "remove", id: "b" });
    expect(ids(removed)).toEqual(["a0", "c1"]);
    expect(
      ids(
        applyStepChange(removed, {
          type: "restore",
          step: step("b", 1),
          position: 1,
          afterId: "a",
        }),
      ),
    ).toEqual(["a0", "b1", "c2"]);
    // The neighbour left too: its position, clamped.
    const alone = [step("c", 0)];
    expect(
      ids(
        applyStepChange(alone, { type: "restore", step: step("b", 1), position: 5, afterId: "a" }),
      ),
    ).toEqual(["c0", "b1"]);
    // Already there: nothing changes.
    expect(
      applyStepChange(BASE, { type: "restore", step: step("b", 1), position: 0, afterId: null }),
    ).toBe(BASE);
  });

  test("reorders; a step missing from the order keeps its place after the ordered ones", () => {
    expect(ids(applyStepChange(BASE, { type: "reorder", ids: ["c", "a", "b"] }))).toEqual([
      "c0",
      "a1",
      "b2",
    ]);
    expect(ids(applyStepChange(BASE, { type: "reorder", ids: ["b", "a"] }))).toEqual([
      "b0",
      "a1",
      "c2",
    ]);
  });
});
