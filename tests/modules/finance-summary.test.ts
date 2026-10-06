// F3 of `finance`: summary.ts (the month's aggregates) with tables of cases, the month's arrows
// (routes.ts) and the summary's copy. Made-up names and amounts only (public repo).
import { describe, expect, test } from "vitest";
import { monthHref, shiftMonth } from "@/modules/finance/routes";
import {
  largestRemainderPercents,
  summarizeMonth,
  type SummaryExpense,
} from "@/modules/finance/summary";
import { moneyTotalText, percentText, spokenTotal } from "@/modules/finance/summary-copy";

const MONTH = "2026-10";
const COMIDA = { id: "c-comida", name: "Comida" };
const CASA = { id: "c-casa", name: "Casa" };
const OCIO = { id: "c-ocio", name: "Ocio" };
const EFECTIVO = { id: "m-efectivo", name: "Efectivo" };
const DOLARES = { id: "m-dolares", name: "Débito dólares" };

function spent(values: Partial<SummaryExpense> = {}): SummaryExpense {
  return {
    amountCents: 1000,
    currency: "PEN",
    exchangeRateE4: null,
    spentOn: "2026-10-05",
    category: null,
    paymentMethod: null,
    recurringPaymentId: null,
    ...values,
  };
}

describe("summarizeMonth: the total", () => {
  test.each<
    [string, SummaryExpense[], { penCents: number; unconvertedUsdCents: number; count: number }]
  >([
    ["an empty month", [], { penCents: 0, unconvertedUsdCents: 0, count: 0 }],
    [
      "PEN as it is",
      [spent({ amountCents: 1250 }), spent({ amountCents: 50 })],
      { penCents: 1300, unconvertedUsdCents: 0, count: 2 },
    ],
    [
      "USD with its stored rate (each expense its own)",
      [
        spent({ currency: "USD", amountCents: 9500, exchangeRateE4: 37_500 }),
        spent({ currency: "USD", amountCents: 1000, exchangeRateE4: 38_000 }),
      ],
      { penCents: 35_625 + 3_800, unconvertedUsdCents: 0, count: 2 },
    ],
    [
      "USD rounded half up per expense, then summed (USD 0.01 at 3.7550 is S/ 0.04)",
      [
        spent({ currency: "USD", amountCents: 1, exchangeRateE4: 37_550 }),
        spent({ currency: "USD", amountCents: 1, exchangeRateE4: 37_550 }),
      ],
      { penCents: 8, unconvertedUsdCents: 0, count: 2 },
    ],
    [
      "USD without a rate is summed apart",
      [spent({ amountCents: 500 }), spent({ currency: "USD", amountCents: 9500 })],
      { penCents: 500, unconvertedUsdCents: 9500, count: 2 },
    ],
    [
      "deleted expenses are out",
      [spent({ amountCents: 500 }), spent({ amountCents: 700, deletedAt: new Date() })],
      { penCents: 500, unconvertedUsdCents: 0, count: 1 },
    ],
    [
      "days of another month are out (Lima days: the 1st and the last count, not their neighbors)",
      [
        spent({ amountCents: 1, spentOn: "2026-10-01" }),
        spent({ amountCents: 2, spentOn: "2026-10-31" }),
        spent({ amountCents: 4, spentOn: "2026-09-30" }),
        spent({ amountCents: 8, spentOn: "2026-11-01" }),
      ],
      { penCents: 3, unconvertedUsdCents: 0, count: 2 },
    ],
  ])("%s", (_, expenses, total) => {
    expect(summarizeMonth(MONTH, expenses).total).toEqual(total);
  });
});

describe("summarizeMonth: by category", () => {
  test("biggest first, Sin categoría last, with the exact share and whole percentages", () => {
    const { categories, total } = summarizeMonth(MONTH, [
      spent({ amountCents: 2000, category: CASA }),
      spent({ amountCents: 5000 }),
      spent({ amountCents: 6000, category: COMIDA }),
      spent({ amountCents: 2000, category: COMIDA }),
    ]);
    expect(total.penCents).toBe(15_000);
    expect(categories).toEqual([
      {
        id: COMIDA.id,
        name: "Comida",
        penCents: 8000,
        unconvertedUsdCents: 0,
        count: 2,
        share: 8000 / 15_000,
        percent: 54,
      },
      {
        id: CASA.id,
        name: "Casa",
        penCents: 2000,
        unconvertedUsdCents: 0,
        count: 1,
        share: 2000 / 15_000,
        percent: 13,
      },
      {
        id: null,
        name: null,
        penCents: 5000,
        unconvertedUsdCents: 0,
        count: 1,
        share: 5000 / 15_000,
        percent: 33,
      },
    ]);
  });

  test("ties by amount go by name; a category with only USD without a rate has no percentage", () => {
    const { categories } = summarizeMonth(MONTH, [
      spent({ amountCents: 1000, category: OCIO }),
      spent({ amountCents: 1000, category: CASA }),
      spent({ currency: "USD", amountCents: 9500, category: COMIDA }),
    ]);
    expect(
      categories.map((group) => [group.name, group.percent, group.unconvertedUsdCents]),
    ).toEqual([
      ["Casa", 50, 0],
      ["Ocio", 50, 0],
      ["Comida", null, 9500],
    ]);
  });

  test("an archived category still groups by its id and keeps its name", () => {
    const { categories } = summarizeMonth(MONTH, [
      spent({ category: { id: "c-old", name: "Antigua" } }),
      spent({ category: { id: "c-old", name: "Antigua" } }),
    ]);
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({ id: "c-old", name: "Antigua", count: 2, percent: 100 });
  });

  test("the categories always add up to the month's total (PEN and USD apart)", () => {
    const expenses = [
      spent({ amountCents: 333, category: COMIDA }),
      spent({ currency: "USD", amountCents: 777, exchangeRateE4: 37_512, category: CASA }),
      spent({ currency: "USD", amountCents: 100 }),
      spent({ amountCents: 1 }),
    ];
    const { categories, methods, total, recurring, oneOff } = summarizeMonth(MONTH, expenses);
    const sum = (groups: { penCents: number; unconvertedUsdCents: number }[]) => ({
      penCents: groups.reduce((acc, group) => acc + group.penCents, 0),
      unconvertedUsdCents: groups.reduce((acc, group) => acc + group.unconvertedUsdCents, 0),
    });
    const expected = { penCents: total.penCents, unconvertedUsdCents: total.unconvertedUsdCents };
    expect(sum(categories)).toEqual(expected);
    expect(sum(methods)).toEqual(expected);
    expect(sum([recurring, oneOff])).toEqual(expected);
  });

  test("no PEN at all: no percentages, shares at 0", () => {
    const { categories } = summarizeMonth(MONTH, [spent({ currency: "USD", amountCents: 100 })]);
    expect(categories).toEqual([
      {
        id: null,
        name: null,
        penCents: 0,
        unconvertedUsdCents: 100,
        count: 1,
        share: 0,
        percent: null,
      },
    ]);
  });
});

describe("largestRemainderPercents (the rounding rule)", () => {
  test.each<[string, number[], number[]]>([
    ["exact", [50, 50], [50, 50]],
    ["thirds: the extra point goes to the first of the tie", [1, 1, 1], [34, 33, 33]],
    ["the largest remainder gets the point", [2, 6, 3], [18, 55, 27]],
    ["a tie of remainders goes to the earlier one", [8000, 2000, 5000], [54, 13, 33]],
    ["a tiny one may round to 0 (shown as < 1%)", [9990, 5, 5], [100, 0, 0]],
    ["99.5 and 0.5: one point missing, the tie goes to the earlier one", [995, 5], [100, 0]],
    ["zeros never get a point", [0, 3, 0], [0, 100, 0]],
    ["seven equal parts", [1, 1, 1, 1, 1, 1, 1], [15, 15, 14, 14, 14, 14, 14]],
  ])("%s", (_, amounts, percents) => {
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    expect(largestRemainderPercents(amounts, total)).toEqual(percents);
  });

  test("always 100 for any positive amounts (random cases, asserted once)", () => {
    const mismatches: string[] = [];
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let round = 0; round < 2000; round += 1) {
      const amounts = Array.from({ length: 1 + (random() % 12) }, () => random() % 100_000_000);
      const total = amounts.reduce((sum, amount) => sum + amount, 0);
      if (total === 0) continue;
      const percents = largestRemainderPercents(amounts, total);
      const sum = percents.reduce((acc, value) => acc + value, 0);
      const offByMoreThanOne = percents.some(
        (value, index) => Math.abs(value - (amounts[index] * 100) / total) >= 1,
      );
      if (sum !== 100 || offByMoreThanOne) mismatches.push(JSON.stringify({ amounts, percents }));
    }
    expect(mismatches).toEqual([]);
  });

  test("no total: all 0", () => {
    expect(largestRemainderPercents([0, 0], 0)).toEqual([0, 0]);
  });
});

describe("summarizeMonth: by payment method, recurring and one-off", () => {
  test("methods biggest first, Sin medio de pago last; USD converted and not", () => {
    const { methods } = summarizeMonth(MONTH, [
      spent({ amountCents: 1000, paymentMethod: EFECTIVO }),
      spent({ currency: "USD", amountCents: 9500, exchangeRateE4: 37_500, paymentMethod: DOLARES }),
      spent({ currency: "USD", amountCents: 500, paymentMethod: DOLARES }),
      spent({ amountCents: 99_999 }),
    ]);
    expect(
      methods.map((group) => [group.name, group.penCents, group.unconvertedUsdCents, group.count]),
    ).toEqual([
      ["Débito dólares", 35_625, 500, 2],
      ["Efectivo", 1000, 0, 1],
      [null, 99_999, 0, 1],
    ]);
  });

  test("recurring (paid a recurring payment) and one-off", () => {
    const { recurring, oneOff } = summarizeMonth(MONTH, [
      spent({ amountCents: 5000, recurringPaymentId: "r-1" }),
      spent({ currency: "USD", amountCents: 9500, recurringPaymentId: "r-2" }),
      spent({ amountCents: 1250 }),
      spent({ amountCents: 700, recurringPaymentId: "r-3", deletedAt: "2026-10-05T10:00:00Z" }),
    ]);
    expect(recurring).toEqual({ penCents: 5000, unconvertedUsdCents: 9500, count: 2 });
    expect(oneOff).toEqual({ penCents: 1250, unconvertedUsdCents: 0, count: 1 });
  });

  test("an empty month has no groups", () => {
    expect(summarizeMonth(MONTH, [])).toEqual({
      total: { penCents: 0, unconvertedUsdCents: 0, count: 0 },
      categories: [],
      methods: [],
      recurring: { penCents: 0, unconvertedUsdCents: 0, count: 0 },
      oneOff: { penCents: 0, unconvertedUsdCents: 0, count: 0 },
    });
  });
});

describe("the month's arrows", () => {
  test.each([
    ["2026-10", -1, "2026-09"],
    ["2026-01", -1, "2025-12"],
    ["2025-12", 1, "2026-01"],
    ["2000-01", 13, "2001-02"],
    ["2026-03", -15, "2024-12"],
  ])("shiftMonth(%s, %i) is %s", (month, delta, expected) => {
    expect(shiftMonth(month, delta)).toBe(expected);
  });

  test("the current month is plain /finance; another one carries ?mes=", () => {
    expect(monthHref("2026-10", "2026-10")).toBe("/finance");
    expect(monthHref("2026-09", "2026-10")).toBe("/finance?mes=2026-09");
  });
});

describe("the summary's copy", () => {
  test.each<[number | null, string | null]>([
    [58, "58%"],
    [0, "< 1%"],
    [100, "100%"],
    [null, null],
  ])("percentText(%s)", (percent, text) => {
    expect(percentText(percent)).toBe(text);
  });

  test("totals with USD apart, for the eye and for screen readers", () => {
    expect(moneyTotalText(125_000, 0)).toBe("S/ 1,250.00");
    expect(moneyTotalText(125_000, 9500)).toBe("S/ 1,250.00 + USD 95.00 sin convertir");
    expect(spokenTotal(125_000, 0)).toBe("1,250 soles");
    expect(spokenTotal(125_050, 100)).toBe("1,250.50 soles, y 1 dólar sin convertir");
  });
});
