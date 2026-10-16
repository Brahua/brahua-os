// finance-resumen-charts R1: the donut's slices and geometry (pure).
import { describe, expect, test } from "vitest";
import {
  donutGeometry,
  donutItems,
  MAX_SLICES,
  nextSegment,
  sectorPath,
} from "@/modules/finance/donut-geometry";
import { summarizeMonth, type SummaryGroup } from "@/modules/finance/summary";
import type { ExpenseItem } from "@/modules/finance/expense-input";

const group = (
  id: string | null,
  penCents: number,
  percent: number | null,
  colorSlot: number | null = null,
): SummaryGroup => ({
  id,
  name: id ? `Cat ${id}` : null,
  colorSlot,
  penCents,
  unconvertedUsdCents: 0,
  count: 1,
  share: 0,
  percent,
});
const others = (count: number) => ({
  name: `Otros · ${count} categorías`,
  short: `Otros · ${count}`,
});
const items = (groups: SummaryGroup[], max?: number) =>
  donutItems(groups, "Sin categoría", others, max);

describe("donutItems", () => {
  test("only categories with PEN, in the summary's order, «Sin categoría» named", () => {
    const list = items([
      group("a", 500, 50),
      group("b", 300, 30),
      group(null, 200, 20),
      group("c", 0, null),
    ]);
    expect(list.map((item) => [item.key, item.name])).toEqual([
      ["a", "Cat a"],
      ["b", "Cat b"],
      ["none", "Sin categoría"],
    ]);
  });

  test("with more than 8 the smallest become «Otros · N», with their keys, money and percent", () => {
    const groups = Array.from({ length: 10 }, (_, index) =>
      group(`c${index}`, 1000 - index * 10, 10, index + 1),
    );
    const list = items(groups);
    expect(list).toHaveLength(MAX_SLICES);
    const last = list.at(-1)!;
    expect(last).toMatchObject({
      key: "others",
      name: "Otros · 3 categorías",
      short: "Otros · 3",
      colorSlot: 8,
      percent: 30,
    });
    expect(last.keys).toEqual(["c7", "c8", "c9"]);
    expect(last.penCents).toBe(930 + 920 + 910);
    // Exactly 8 are not grouped (positive control).
    expect(items(groups.slice(0, 8))).toHaveLength(8);
    expect(items(groups.slice(0, 8)).every((item) => item.key !== "others")).toBe(true);
  });
});

describe("donutGeometry", () => {
  test("the slices add up to the whole turn, in order, with a gap between neighbours", () => {
    const geometry = donutGeometry(
      items([group("a", 600, 60), group("b", 300, 30), group("c", 100, 10)]),
      208,
      28,
    );
    const { segments } = geometry;
    expect(segments[0].start).toBe(0);
    expect(segments.at(-1)!.end).toBeCloseTo(Math.PI * 2, 10);
    segments
      .slice(1)
      .forEach((segment, index) => expect(segment.start).toBeCloseTo(segments[index].end, 10));
    expect(segments[0].end).toBeCloseTo(0.6 * Math.PI * 2, 10);
    // Each path is its own sector (gaps inside), not the neighbour's.
    expect(new Set(segments.map((segment) => segment.d)).size).toBe(3);
    expect(geometry.middle).toBeCloseTo(104 - 8 - 14, 10);
  });

  test("one slice is a whole ring (no gap); nothing in PEN draws nothing", () => {
    const one = donutGeometry(items([group("a", 900, 100)]), 176, 24).segments;
    expect(one).toHaveLength(1);
    expect(one[0].d.match(/M/g)).toHaveLength(2); // outer and inner circles
    expect(donutGeometry(items([group("a", 0, null)]), 176, 24).segments).toEqual([]);
  });

  test("selected paths reach further out; the focus ring wraps the slice", () => {
    const [segment] = donutGeometry(
      items([group("a", 600, 60), group("b", 400, 40)]),
      208,
      28,
    ).segments;
    expect(segment.grown).not.toBe(segment.d);
    expect(segment.focusRing).not.toBe(segment.d);
  });

  test("its percentages are the summary's: the same ones, never recalculated", () => {
    const rows = [
      {
        description: null,
        amountCents: 5000,
        currency: "PEN",
        exchangeRateE4: null,
        spentOn: "2026-10-02",
        category: { id: "x", name: "X", colorSlot: 1 },
        paymentMethod: null,
        recurringPaymentId: null,
      },
      {
        description: null,
        amountCents: 2500,
        currency: "PEN",
        exchangeRateE4: null,
        spentOn: "2026-10-03",
        category: { id: "y", name: "Y", colorSlot: 2 },
        paymentMethod: null,
        recurringPaymentId: null,
      },
      {
        description: null,
        amountCents: 2500,
        currency: "PEN",
        exchangeRateE4: null,
        spentOn: "2026-10-03",
        category: null,
        paymentMethod: null,
        recurringPaymentId: null,
      },
    ] as unknown as ExpenseItem[];
    const summary = summarizeMonth("2026-10", rows);
    const list = items(summary.categories);
    expect(list.map((item) => item.percent)).toEqual(
      summary.categories.map((group) => group.percent),
    );
    expect(list.reduce((sum, item) => sum + (item.percent ?? 0), 0)).toBe(100);
    expect(list.map((item) => item.colorSlot)).toEqual([1, 2, null]);
  });
});

describe("sectorPath and nextSegment", () => {
  test("a path closes (Z) and a half ring is not the 'large arc'", () => {
    expect(sectorPath(100, 50, 80, 0, Math.PI / 2)).toMatch(/^M.* Z$/);
    expect(sectorPath(100, 50, 80, 0, Math.PI / 2)).toContain("0 0 1");
    expect(sectorPath(100, 50, 80, 0, Math.PI * 1.5)).toContain("0 1 1");
  });

  test("arrows walk the slices in a circle", () => {
    expect([nextSegment(0, "ArrowRight", 3), nextSegment(2, "ArrowRight", 3)]).toEqual([1, 0]);
    expect([nextSegment(0, "ArrowLeft", 3), nextSegment(2, "ArrowUp", 3)]).toEqual([2, 1]);
    expect(nextSegment(1, "x", 3)).toBe(1);
    expect(nextSegment(0, "ArrowRight", 0)).toBe(0);
  });
});
