// P6: the contracts of `projects` with other modules, pure parts: progress sources (the sum,
// the registry, a fake source) and the summary for `today` (Lima date limit and order).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { contributedProgress, registerProgressSource } from "@/modules/projects/contracts";
import {
  combineProgressCounts,
  createProgressRegistry,
  type ProgressCounts,
  type ProgressSource,
} from "@/modules/projects/progress-source";
import {
  buildTodaySummary,
  compareTodayItems,
  dueSoonLimit,
  type ProjectTodayRow,
} from "@/modules/projects/today-summary";
import type { ProjectPriority, ProjectStatus } from "@/modules/projects/project-constants";

/** A source that answers from a fixed table and records what it was asked. */
function fakeSource(id: string, counts: Record<string, ProgressCounts>) {
  const calls: string[][] = [];
  const source: ProgressSource = {
    id,
    async countsFor(projectIds) {
      calls.push([...projectIds]);
      return new Map(Object.entries(counts).filter(([key]) => projectIds.includes(key)));
    },
  };
  return { source, calls };
}

describe("combineProgressCounts", () => {
  test("adds milestones and every source, unit by unit", () => {
    expect(combineProgressCounts({ done: 1, total: 2 }, { done: 3, total: 8 })).toEqual({
      done: 4,
      total: 10,
    });
    expect(
      combineProgressCounts({ done: 1, total: 1 }, undefined, null, { done: 0, total: 4 }),
    ).toEqual({ done: 1, total: 5 });
  });

  test("only one side: that side", () => {
    expect(combineProgressCounts(undefined, { done: 2, total: 5 })).toEqual({ done: 2, total: 5 });
    expect(combineProgressCounts({ done: 2, total: 5 })).toEqual({ done: 2, total: 5 });
  });

  test("nothing to count gives undefined (no progress, never 0 %)", () => {
    expect(combineProgressCounts()).toBeUndefined();
    expect(combineProgressCounts(undefined, null)).toBeUndefined();
    expect(combineProgressCounts({ done: 0, total: 0 }, { done: 0, total: 0 })).toBeUndefined();
  });

  test("a bad pair is cleaned before adding: whole, non-negative, done ≤ total", () => {
    expect(
      combineProgressCounts(
        { done: 5, total: 2 },
        { done: -1, total: 3.7 },
        {
          done: Number.NaN,
          total: Number.POSITIVE_INFINITY,
        },
      ),
    ).toEqual({ done: 2, total: 5 });
  });
});

describe("progress registry", () => {
  test("with no source it answers empty without calling anything", async () => {
    const registry = createProgressRegistry();
    expect(registry.size()).toBe(0);
    expect(await registry.countsFor(["a"])).toEqual(new Map());
  });

  test("sums every source by project, only for the ids asked", async () => {
    const registry = createProgressRegistry();
    const tasks = fakeSource("tasks", {
      a: { done: 1, total: 4 },
      b: { done: 0, total: 2 },
      other: { done: 9, total: 9 },
    });
    const habits = fakeSource("habits", { a: { done: 2, total: 2 } });
    registry.register(tasks.source);
    registry.register(habits.source);
    const counts = await registry.countsFor(["a", "b", "a", "c"]);
    expect(counts).toEqual(
      new Map([
        ["a", { done: 3, total: 6 }],
        ["b", { done: 0, total: 2 }],
      ]),
    );
    // Asked once, with each id once.
    expect(tasks.calls).toEqual([["a", "b", "c"]]);
  });

  test("ignores ids a source returns that weren't asked for", async () => {
    const registry = createProgressRegistry();
    registry.register({
      id: "sloppy",
      countsFor: async () => new Map([["not-asked", { done: 1, total: 1 }]]),
    });
    expect(await registry.countsFor(["a"])).toEqual(new Map());
  });

  test("no ids: no call", async () => {
    const registry = createProgressRegistry();
    const tasks = fakeSource("tasks", {});
    registry.register(tasks.source);
    expect(await registry.countsFor([])).toEqual(new Map());
    expect(tasks.calls).toEqual([]);
  });

  test("registering the same id again replaces it (idempotent; never counts twice)", async () => {
    const registry = createProgressRegistry();
    const first = fakeSource("tasks", { a: { done: 1, total: 2 } });
    const second = fakeSource("tasks", { a: { done: 2, total: 2 } });
    const removeFirst = registry.register(first.source);
    registry.register(second.source);
    registry.register(second.source);
    expect(registry.size()).toBe(1);
    expect(await registry.countsFor(["a"])).toEqual(new Map([["a", { done: 2, total: 2 }]]));
    expect(first.calls).toEqual([]);
    // Removing the replaced one keeps the newer registration.
    removeFirst();
    expect(registry.size()).toBe(1);
  });

  test("the removal function unregisters", async () => {
    const registry = createProgressRegistry();
    const remove = registry.register(fakeSource("tasks", { a: { done: 1, total: 1 } }).source);
    remove();
    expect(registry.size()).toBe(0);
    expect(await registry.countsFor(["a"])).toEqual(new Map());
  });

  test("sources run in parallel, and a failing source fails the read", async () => {
    const registry = createProgressRegistry();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    for (const id of ["one", "two"]) {
      registry.register({
        id,
        async countsFor() {
          started.push(id);
          await gate;
          return new Map([["a", { done: 1, total: 1 }]]);
        },
      });
    }
    const pending = registry.countsFor(["a"]);
    await vi.waitFor(() => expect(started).toEqual(["one", "two"]));
    release();
    expect(await pending).toEqual(new Map([["a", { done: 2, total: 2 }]]));

    registry.register({
      id: "broken",
      countsFor: async () => {
        throw new Error("boom");
      },
    });
    await expect(registry.countsFor(["a"])).rejects.toThrow("boom");
  });
});

describe("the app's registry (contracts.ts)", () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const remove of cleanup) remove();
    cleanup = [];
  });

  test("a registered fake source shows up in contributedProgress", async () => {
    expect(await contributedProgress(["p1"])).toEqual(new Map());
    cleanup.push(registerProgressSource(fakeSource("tasks", { p1: { done: 3, total: 4 } }).source));
    expect(await contributedProgress(["p1", "p2"])).toEqual(
      new Map([["p1", { done: 3, total: 4 }]]),
    );
  });
});

// Lima is UTC-5 all year: Lima midnight is 05:00 UTC.
const OCT_1_LIMA_MIDNIGHT = new Date("2026-10-01T05:00:00.000Z");
const SEP_30_LATE = new Date("2026-10-01T04:59:59.999Z"); // 23:59 Sep 30 in Lima, Oct 1 in UTC

describe("dueSoonLimit (Lima's today + 7)", () => {
  test("by Lima's day, not UTC's, around midnight", () => {
    expect(dueSoonLimit(OCT_1_LIMA_MIDNIGHT)).toBe("2026-10-08");
    expect(dueSoonLimit(SEP_30_LATE)).toBe("2026-10-07");
  });

  test("across months and years", () => {
    expect(dueSoonLimit(new Date("2026-12-28T15:00:00Z"))).toBe("2027-01-04");
    expect(dueSoonLimit(new Date("2028-02-25T15:00:00Z"))).toBe("2028-03-03");
  });
});

const AREA: ProjectTodayRow["area"] = {
  id: "area",
  slug: "home",
  name: "Hogar",
  icon: "house",
  color: "home",
};

function row(
  name: string,
  dueDate: string | null,
  {
    status = "active",
    priority = "medium",
  }: { status?: ProjectStatus; priority?: ProjectPriority } = {},
): ProjectTodayRow {
  return {
    id: `id-${name}`,
    name,
    area: { ...AREA },
    status,
    priority,
    dueDate,
  };
}

describe("buildTodaySummary", () => {
  const now = OCT_1_LIMA_MIDNIGHT;

  test("keeps due within 7 days, today and overdue; drops later or no date unless blocked", () => {
    const rows = [
      row("En 7", "2026-10-08"),
      row("En 8", "2026-10-09"),
      row("Hoy", "2026-10-01"),
      row("Vencido", "2026-09-29"),
      row("Sin fecha", null),
      row("Bloqueado sin fecha", null),
    ];
    const blockers = new Map([["id-Bloqueado sin fecha", [{ id: "x", name: "X" }]]]);
    const summary = buildTodaySummary(rows, blockers, now);
    expect(summary.map((item) => item.name)).toEqual([
      "Vencido",
      "Hoy",
      "En 7",
      "Bloqueado sin fecha",
    ]);
    expect(summary[0]).toMatchObject({
      due: { kind: "overdue", days: 2, label: "Vencido hace 2 días" },
      blockedBy: [],
    });
    expect(summary[3]).toMatchObject({ due: null, blockedBy: [{ id: "x", name: "X" }] });
  });

  test("maintenance never has a due notice, but a blocked one still shows", () => {
    const rows = [
      row("Mantenimiento vencido", "2026-09-01", { status: "maintenance" }),
      row("Mantenimiento bloqueado", "2026-09-01", { status: "maintenance" }),
    ];
    const blockers = new Map([["id-Mantenimiento bloqueado", [{ id: "x", name: "X" }]]]);
    expect(buildTodaySummary(rows, blockers, now)).toEqual([
      expect.objectContaining({ name: "Mantenimiento bloqueado", due: null }),
    ]);
  });

  test("the day changes at Lima's midnight", () => {
    const rows = [row("Mañana", "2026-10-01"), row("Lejos", "2026-10-08")];
    // 23:59 of Sep 30 in Lima: Oct 1 is tomorrow, and Oct 8 is 8 days away.
    expect(buildTodaySummary(rows, new Map(), SEP_30_LATE)).toEqual([
      expect.objectContaining({
        name: "Mañana",
        due: expect.objectContaining({ label: "Vence en 1 día" }),
      }),
    ]);
    expect(
      buildTodaySummary(rows, new Map(), OCT_1_LIMA_MIDNIGHT).map((i) => i.due?.label),
    ).toEqual(["Vence hoy", "Vence en 7 días"]);
  });
});

describe("compareTodayItems", () => {
  test("overdue (oldest first), then due soonest, then priority, then name", () => {
    const blocked = new Map(
      ["Bloqueado alta", "Bloqueado baja", "Bloqueado b"].map((name) => [
        `id-${name}`,
        [{ id: "x", name: "X" }],
      ]),
    );
    const rows = [
      row("Bloqueado baja", null, { priority: "low" }),
      row("En 3 baja", "2026-10-04", { priority: "low" }),
      row("En 3 alta", "2026-10-04", { priority: "high" }),
      row("Hoy", "2026-10-01"),
      row("Vencido hace 1", "2026-09-30", { priority: "high" }),
      row("Vencido hace 5", "2026-09-26", { priority: "low" }),
      row("Bloqueado b", null),
      row("Bloqueado alta", "2026-12-01", { priority: "high" }),
      row("Ábaco", "2026-10-04"),
      row("En 3 media", "2026-10-04"),
    ];
    const summary = buildTodaySummary(rows, blocked, OCT_1_LIMA_MIDNIGHT);
    expect(summary.map((item) => item.name)).toEqual([
      "Vencido hace 5",
      "Vencido hace 1",
      "Hoy",
      "En 3 alta",
      "Ábaco",
      "En 3 media",
      "En 3 baja",
      "Bloqueado alta",
      "Bloqueado b",
      "Bloqueado baja",
    ]);
    // A total order: comparing an item with itself is 0.
    expect(compareTodayItems(summary[0], summary[0])).toBe(0);
  });
});

describe("composition root", () => {
  // The code that computes progress registers the sources first, by calling the root (never a
  // side-effect-only import, which the bundler drops: package.json "sideEffects").
  test.each([
    "src/app/(app)/projects/page.tsx",
    "src/app/(app)/projects/[id]/page.tsx",
    "src/modules/projects/close-actions.ts",
  ])("%s calls ensureProgressSources() before contributedProgress()", (file) => {
    const source = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    expect(source).not.toMatch(/^import "@\/lib\/progress-sources";$/m);
    const ensure = source.indexOf("ensureProgressSources();");
    expect(ensure).toBeGreaterThan(-1);
    expect(ensure).toBeLessThan(source.indexOf("contributedProgress(", ensure - 1));
  });

  test("the root never registers through a side-effect-only import", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../src/lib/progress-sources.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^import "@\/modules\//m);
  });
});
