// hitos-agrupan-tareas H1: the state of a milestone from its tasks' counts (pure) and the registry's
// answer by milestone.
import { describe, expect, test } from "vitest";
import { createProgressRegistry, type MilestoneCounts } from "@/modules/projects/progress-source";
import { completedWithin, milestoneState, phaseChange } from "@/modules/tasks/milestone-state";

const at = (iso: string) => new Date(iso);
const counts = (done: number, total: number, lastDoneAt: Date | null = null): MilestoneCounts => ({
  done,
  total,
  lastDoneAt,
});

describe("milestoneState", () => {
  test("no tasks is empty: a planned phase, never done", () => {
    for (const none of [null, undefined, counts(0, 0)]) {
      expect(milestoneState(none)).toEqual({
        status: "empty",
        done: 0,
        total: 0,
        ratio: 0,
        completedAt: null,
      });
    }
  });

  test("some done, some open is in progress; all done is complete with its closing instant", () => {
    expect(milestoneState(counts(0, 3))).toMatchObject({ status: "inProgress", ratio: 0 });
    expect(milestoneState(counts(2, 4, at("2026-10-05T10:00:00Z")))).toMatchObject({
      status: "inProgress",
      done: 2,
      total: 4,
      ratio: 0.5,
      completedAt: null,
    });
    const closed = at("2026-10-07T15:00:00Z");
    expect(milestoneState(counts(4, 4, closed))).toEqual({
      status: "complete",
      done: 4,
      total: 4,
      ratio: 1,
      completedAt: closed,
    });
  });

  test("a bad pair never yields more than complete", () => {
    expect(milestoneState(counts(9, 3))).toMatchObject({ status: "complete", done: 3, total: 3 });
    expect(milestoneState(counts(-2, 3))).toMatchObject({ status: "inProgress", done: 0 });
  });
});

describe("completedWithin and phaseChange", () => {
  const from = at("2026-10-05T05:00:00Z");
  const to = at("2026-10-12T05:00:00Z");

  test("a phase closed inside the week counts; one closed outside, or still open, does not", () => {
    expect(
      completedWithin(milestoneState(counts(1, 1, at("2026-10-07T00:00:00Z"))), from, to),
    ).toBe(true);
    expect(
      completedWithin(milestoneState(counts(1, 1, at("2026-10-12T05:00:00Z"))), from, to),
    ).toBe(false); // the end is exclusive
    expect(
      completedWithin(milestoneState(counts(1, 1, at("2026-09-30T00:00:00Z"))), from, to),
    ).toBe(false);
    expect(
      completedWithin(milestoneState(counts(1, 2, at("2026-10-07T00:00:00Z"))), from, to),
    ).toBe(false);
    expect(completedWithin(milestoneState(null), from, to)).toBe(false);
  });

  test("closing the last task closes the phase; undoing it reopens; the rest changes nothing", () => {
    const open = milestoneState(counts(2, 3));
    const closed = milestoneState(counts(3, 3, at("2026-10-07T00:00:00Z")));
    expect(phaseChange(open, closed)).toBe("closed");
    expect(phaseChange(closed, open)).toBe("reopened");
    expect(phaseChange(open, milestoneState(counts(1, 3)))).toBeNull();
    expect(phaseChange(closed, closed)).toBeNull();
    // A first task added to an empty phase, or a done one: not a closing of a phase that was open.
    expect(phaseChange(milestoneState(null), milestoneState(counts(1, 1)))).toBe("closed");
  });
});

describe("the registry's counts by milestone", () => {
  const source = (id: string, answer: Record<string, MilestoneCounts>) => ({
    id,
    countsFor: async () => new Map(),
    milestoneCountsFor: async () => new Map(Object.entries(answer)),
  });

  test("nothing registered, no ids, or a source without the method: no work, no answer", async () => {
    const registry = createProgressRegistry();
    expect(await registry.milestoneCountsFor(["m1"])).toEqual(new Map());
    registry.register({ id: "plain", countsFor: async () => new Map() });
    expect(await registry.milestoneCountsFor(["m1"])).toEqual(new Map());
    registry.register(source("tasks", { m1: counts(1, 2) }));
    expect(await registry.milestoneCountsFor([])).toEqual(new Map());
  });

  test("answers only for the ids asked, adds sources up and keeps the latest instant", async () => {
    const registry = createProgressRegistry();
    registry.register(
      source("a", { m1: counts(1, 2, at("2026-10-01T00:00:00Z")), m2: counts(1, 1) }),
    );
    registry.register(source("b", { m1: counts(2, 2, at("2026-10-03T00:00:00Z")) }));
    const result = await registry.milestoneCountsFor(["m1", "m3"]);
    expect([...result.keys()]).toEqual(["m1"]);
    expect(result.get("m1")).toEqual({ done: 3, total: 4, lastDoneAt: at("2026-10-03T00:00:00Z") });
    // Positive control: m2 is there when it is asked for.
    expect((await registry.milestoneCountsFor(["m2"])).get("m2")).toMatchObject({
      done: 1,
      total: 1,
    });
  });
});
