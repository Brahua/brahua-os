// finance-motion M2: the comparison with the previous month ("same point of the month"), over
// thin rows, converted with the same rule as the summary (so the two always agree).
import { describe, expect, test } from "vitest";
import { categorySlot } from "@/modules/finance/category-color";
import { summarizeMonth } from "@/modules/finance/summary";
import {
  compareToPrevious,
  daysInMonth,
  monthlyTotals,
  monthPoint,
  type TrendExpense,
} from "@/modules/finance/trend";

const pen = (spentOn: string, amountCents: number): TrendExpense => ({
  spentOn,
  amountCents,
  currency: "PEN",
  exchangeRateE4: null,
});

describe("daysInMonth and monthPoint", () => {
  test("month lengths, leap February included", () => {
    expect(daysInMonth("2026-10")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
  });

  test("the current month stops at today; another month is whole", () => {
    expect(monthPoint("2026-10", "2026-10-14")).toEqual({ day: 14, total: 31, isCurrent: true });
    expect(monthPoint("2026-09", "2026-10-14")).toEqual({ day: 30, total: 30, isCurrent: false });
  });
});

describe("monthlyTotals", () => {
  const rows = [
    pen("2026-10-03", 1000),
    pen("2026-10-20", 5000),
    pen("2026-09-05", 2000),
    pen("2026-09-25", 4000),
    pen("2026-05-31", 700),
    pen("2026-04-30", 999), // outside the six months
    { spentOn: "2026-09-10", amountCents: 100, currency: "USD", exchangeRateE4: 37_500 } as const,
    { spentOn: "2026-09-11", amountCents: 900, currency: "USD", exchangeRateE4: null } as const,
  ];

  test("six months, oldest first, whole and up to the day; empty months are zeros", () => {
    const totals = monthlyTotals(rows, "2026-10", 6, 14);
    expect(totals.map((total) => total.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(totals[0]).toMatchObject({ penCents: 700, uptoDayPenCents: 0 });
    expect(totals[1]).toMatchObject({ penCents: 0, uptoDayPenCents: 0 });
    // September: 2000 + 4000 + USD 1.00 at 3.75 = 375; up to day 14: 2000 + 375.
    expect(totals[4]).toMatchObject({
      penCents: 6375,
      uptoDayPenCents: 2375,
      unconvertedUsdCents: 900,
    });
    expect(totals[5]).toMatchObject({ penCents: 6000, uptoDayPenCents: 1000 });
  });

  test("a day past the end of a shorter month is its last day", () => {
    const [february] = monthlyTotals([pen("2026-02-28", 800)], "2026-02", 1, 31);
    expect(february.uptoDayPenCents).toBe(800);
  });

  test("agrees with the summary's total, and a different month does not leak in", () => {
    const expenses = rows
      .filter((row) => row.spentOn.startsWith("2026-09"))
      .map((row) => ({ ...row, recurringPaymentId: null, category: null, paymentMethod: null }));
    const summary = summarizeMonth("2026-09", expenses);
    const [september] = monthlyTotals(rows, "2026-09", 1, 30);
    expect(september.penCents).toBe(summary.total.penCents);
    expect(september.unconvertedUsdCents).toBe(summary.total.unconvertedUsdCents);
    // Positive control above; the October rows must not change September.
    expect(monthlyTotals([...rows, pen("2026-10-01", 123_456)], "2026-09", 1, 30)[0].penCents).toBe(
      summary.total.penCents,
    );
  });
});

describe("compareToPrevious", () => {
  test("up, down and the same, in whole percent", () => {
    expect(compareToPrevious("2026-10", "2000-01", 1200, 1000)).toEqual({
      percent: 20,
      direction: "up",
    });
    expect(compareToPrevious("2026-10", "2000-01", 750, 1000)).toEqual({
      percent: 25,
      direction: "down",
    });
    expect(compareToPrevious("2026-10", "2000-01", 1000, 1000)).toEqual({
      percent: 0,
      direction: "same",
    });
  });

  test("nothing to compare against: no month before 2000-01, or nothing spent by then", () => {
    expect(compareToPrevious("2000-01", "2000-01", 100, 100)).toBeNull();
    expect(compareToPrevious("2026-10", "2000-01", 100, 0)).toBeNull();
  });
});

describe("categorySlot", () => {
  test("eight slots that repeat in order", () => {
    expect([0, 7, 8, 9].map(categorySlot)).toEqual([1, 8, 1, 2]);
  });
});
