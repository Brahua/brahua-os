// finance-motion M4: the running totals and the chart's geometry (pure).
import { describe, expect, test } from "vitest";
import {
  areaPath,
  chartMax,
  indexAt,
  linePath,
  pointOf,
  pointsOf,
  stepIndex,
} from "@/modules/finance/chart-geometry";
import { cumulativeByDay, type TrendExpense } from "@/modules/finance/trend";

const pen = (spentOn: string, amountCents: number): TrendExpense => ({
  spentOn,
  amountCents,
  currency: "PEN",
  exchangeRateE4: null,
});

describe("cumulativeByDay", () => {
  const rows = [
    pen("2026-09-01", 100),
    pen("2026-09-01", 50),
    pen("2026-09-03", 200),
    pen("2026-09-30", 1000),
    { spentOn: "2026-09-02", amountCents: 100, currency: "USD", exchangeRateE4: 37_500 } as const,
    { spentOn: "2026-09-02", amountCents: 900, currency: "USD", exchangeRateE4: null } as const,
    pen("2026-10-01", 7777), // another month never leaks in
  ];

  test("a running total per day, converted like the summary, USD without a rate left out", () => {
    const totals = cumulativeByDay(rows, "2026-09");
    expect(totals).toHaveLength(30);
    expect(totals.slice(0, 4)).toEqual([150, 525, 725, 725]);
    expect(totals[29]).toBe(1725);
  });

  test("bounded to the days asked for: a longer month's extra days are ignored", () => {
    const totals = cumulativeByDay(rows, "2026-09", 28);
    expect(totals).toHaveLength(28);
    expect(totals[27]).toBe(725);
  });

  test("a month with nothing is all zeros", () => {
    expect(cumulativeByDay([], "2026-02")).toEqual(Array(28).fill(0));
  });
});

describe("geometry", () => {
  test("points in 0…100, y upside down; an empty axis sits on the baseline", () => {
    expect(pointOf(0, 0, 31, 1000)).toEqual({ x: 0, y: 100 });
    expect(pointOf(30, 1000, 31, 1000)).toEqual({ x: 100, y: 0 });
    expect(pointOf(15, 500, 31, 1000)).toEqual({ x: 50, y: 50 });
    expect(pointOf(0, 0, 31, 0).y).toBe(100);
    expect(pointOf(0, 5, 1, 10).x).toBe(0);
  });

  test("the max holds every series (and ignores a missing one)", () => {
    expect(chartMax([1, 5], null, [3, 9, 2])).toBe(9);
    expect(chartMax(null)).toBe(0);
  });

  test("paths: a line and its closed area", () => {
    const points = pointsOf([0, 50, 100], 3, 100);
    expect(linePath(points)).toBe("M0 100 L50 50 L100 0");
    expect(areaPath(points)).toBe("M0 100 L50 50 L100 0 L100 100 L0 100 Z");
    expect(areaPath([])).toBe("");
  });

  test("the day under a pointer is bounded to the plot", () => {
    expect([0, 0.5, 1].map((f) => indexAt(f, 31))).toEqual([0, 15, 30]);
    expect(indexAt(-3, 31)).toBe(0);
    expect(indexAt(4, 31)).toBe(30);
    expect(indexAt(0.7, 1)).toBe(0);
  });

  test("← → Home End move the cursor and stop at the ends", () => {
    expect(stepIndex(5, "ArrowRight", 30)).toBe(6);
    expect(stepIndex(0, "ArrowLeft", 30)).toBe(0);
    expect(stepIndex(30, "ArrowRight", 30)).toBe(30);
    expect(stepIndex(9, "Home", 30)).toBe(0);
    expect(stepIndex(9, "End", 30)).toBe(30);
    expect(stepIndex(9, "a", 30)).toBe(9);
  });
});
