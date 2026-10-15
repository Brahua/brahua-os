// finance-gastos: the filters, the order and the pages of «Gastos» (pure).
import { describe, expect, test } from "vitest";
import type { ExpenseItem } from "@/modules/finance/expense-input";
import {
  applyFilters,
  countActive,
  DAYS_PER_PAGE,
  EXPENSES_PER_PAGE,
  NO_FILTERS,
  normalizeText,
  paginate,
  sortExpenses,
  summarizeSelection,
  type ExpenseFilters,
} from "@/modules/finance/expense-filters";
import { summarizeMonth } from "@/modules/finance/summary";

const COMIDA = { id: "c-comida", name: "Comida" };
const CASA = { id: "c-casa", name: "Casa" };
const EFECTIVO = { id: "m-efectivo", name: "Efectivo" };
const VISA = { id: "m-visa", name: "Visa" };

let serial = 0;
function spent(values: Partial<ExpenseItem> = {}): ExpenseItem {
  serial += 1;
  return {
    id: `e-${serial}`,
    description: null,
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

const filters = (values: Partial<ExpenseFilters>): ExpenseFilters => ({ ...NO_FILTERS, ...values });
const ids = (list: readonly ExpenseItem[]) => list.map((expense) => expense.description);

// Most recent first, like the page hands them.
const ROWS = [
  spent({ description: "Café", amountCents: 1250, category: COMIDA, paymentMethod: EFECTIVO }),
  spent({
    description: "Alquiler",
    amountCents: 80_000,
    category: CASA,
    paymentMethod: VISA,
    recurringPaymentId: "r-1",
  }),
  spent({ description: "Pan", amountCents: 300, category: COMIDA, spentOn: "2026-10-04" }),
  spent({
    description: "Libro",
    amountCents: 2500,
    currency: "USD",
    exchangeRateE4: 37_500,
    spentOn: "2026-10-03",
  }),
  spent({ description: "Suscripción", amountCents: 1000, currency: "USD", spentOn: "2026-10-03" }),
];

describe("applyFilters", () => {
  test("no filters keep everything, in order", () => {
    expect(ids(applyFilters(ROWS, NO_FILTERS))).toEqual(ids(ROWS));
    expect(countActive(NO_FILTERS)).toBe(0);
  });

  test("categories and methods are sets; «none» picks the ones without", () => {
    expect(ids(applyFilters(ROWS, filters({ categories: [COMIDA.id] })))).toEqual(["Café", "Pan"]);
    expect(ids(applyFilters(ROWS, filters({ categories: [COMIDA.id, CASA.id] })))).toEqual([
      "Café",
      "Alquiler",
      "Pan",
    ]);
    expect(ids(applyFilters(ROWS, filters({ categories: ["none"] })))).toEqual([
      "Libro",
      "Suscripción",
    ]);
    expect(ids(applyFilters(ROWS, filters({ methods: [VISA.id] })))).toEqual(["Alquiler"]);
    expect(ids(applyFilters(ROWS, filters({ methods: ["none"] })))).toEqual([
      "Pan",
      "Libro",
      "Suscripción",
    ]);
  });

  test("text: any case, accents ignored, every word, also in the category and the method", () => {
    expect(normalizeText("  CAFÉ ")).toBe("cafe");
    expect(ids(applyFilters(ROWS, filters({ text: "cafe" })))).toEqual(["Café"]);
    expect(ids(applyFilters(ROWS, filters({ text: "suscripcion" })))).toEqual(["Suscripción"]);
    expect(ids(applyFilters(ROWS, filters({ text: "comida pan" })))).toEqual(["Pan"]);
    expect(ids(applyFilters(ROWS, filters({ text: "visa" })))).toEqual(["Alquiler"]);
    expect(ids(applyFilters(ROWS, filters({ text: "zzz" })))).toEqual([]);
    // Blank text is no filter.
    expect(countActive(filters({ text: "   " }))).toBe(0);
  });

  test("range of amount in PEN: USD with a rate converts, USD without one is left out", () => {
    // Libro is USD 25.00 at 3.75 = S/ 93.75; Suscripción has no rate.
    expect(ids(applyFilters(ROWS, filters({ minCents: 5000, maxCents: 10_000 })))).toEqual([
      "Libro",
    ]);
    expect(ids(applyFilters(ROWS, filters({ minCents: 1250 })))).toEqual([
      "Café",
      "Alquiler",
      "Libro",
    ]);
    expect(ids(applyFilters(ROWS, filters({ maxCents: 1250 })))).toEqual(["Café", "Pan"]);
    // Positive control: without a range the one without a rate is there.
    expect(ids(applyFilters(ROWS, NO_FILTERS))).toContain("Suscripción");
  });

  test("days are inclusive; kind and currency", () => {
    expect(ids(applyFilters(ROWS, filters({ from: "2026-10-04", to: "2026-10-04" })))).toEqual([
      "Pan",
    ]);
    expect(ids(applyFilters(ROWS, filters({ from: "2026-10-04" })))).toEqual([
      "Café",
      "Alquiler",
      "Pan",
    ]);
    expect(ids(applyFilters(ROWS, filters({ kind: "recurring" })))).toEqual(["Alquiler"]);
    expect(ids(applyFilters(ROWS, filters({ kind: "one-off" })))).toHaveLength(4);
    expect(ids(applyFilters(ROWS, filters({ currency: "USD" })))).toEqual(["Libro", "Suscripción"]);
  });

  test("filters combine (every one must pass) and count one each", () => {
    const combined = filters({
      categories: [COMIDA.id],
      text: "cafe",
      currency: "PEN",
      minCents: 1000,
    });
    expect(ids(applyFilters(ROWS, combined))).toEqual(["Café"]);
    expect(countActive(combined)).toBe(4);
    expect(countActive(filters({ minCents: 1, maxCents: 9 }))).toBe(1);
    expect(countActive(filters({ from: "2026-10-01", to: "2026-10-09" }))).toBe(1);
  });
});

describe("sortExpenses", () => {
  test("by date keeps the page's order; the oldest first reverses it", () => {
    expect(ids(sortExpenses(ROWS, "recent"))).toEqual(ids(ROWS));
    expect(ids(sortExpenses(ROWS, "oldest"))).toEqual([...ids(ROWS)].reverse());
  });

  test("by amount, ties in the page's order, USD without a rate last either way", () => {
    expect(ids(sortExpenses(ROWS, "highest"))).toEqual([
      "Alquiler",
      "Libro",
      "Café",
      "Pan",
      "Suscripción",
    ]);
    expect(ids(sortExpenses(ROWS, "lowest"))).toEqual([
      "Pan",
      "Café",
      "Libro",
      "Alquiler",
      "Suscripción",
    ]);
    const tied = [spent({ description: "A" }), spent({ description: "B" })];
    expect(ids(sortExpenses(tied, "highest"))).toEqual(["A", "B"]);
  });

  test("does not change its input", () => {
    const copy = [...ROWS];
    sortExpenses(ROWS, "highest");
    expect(ROWS).toEqual(copy);
  });
});

describe("paginate", () => {
  const days = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      spent({
        description: `d${index}`,
        spentOn: `2026-10-${String(count - index).padStart(2, "0")}`,
      }),
    );

  test("by date: 7 days a page, whole days only, with what there is", () => {
    const list = [...days(10), spent({ description: "same day", spentOn: "2026-10-10" })];
    // Sorted most recent first: the two of the 10th come together.
    const sorted = sortExpenses(list, "recent").sort((a, b) => b.spentOn.localeCompare(a.spentOn));
    const first = paginate(sorted, "recent", 1);
    expect(first).toMatchObject({ byDay: true, shown: DAYS_PER_PAGE, total: 10, hasMore: true });
    expect(first.items).toHaveLength(8);
    const all = paginate(sorted, "recent", 2);
    expect(all).toMatchObject({ shown: 10, total: 10, hasMore: false });
    expect(all.items).toHaveLength(11);
  });

  test("by amount: 25 a page, flat", () => {
    const many = Array.from({ length: 30 }, (_, index) => spent({ amountCents: 100 + index }));
    const sorted = sortExpenses(many, "highest");
    const page = paginate(sorted, "highest", 1);
    expect(page).toMatchObject({
      byDay: false,
      shown: EXPENSES_PER_PAGE,
      total: 30,
      hasMore: true,
    });
    expect(paginate(sorted, "highest", 2)).toMatchObject({ shown: 30, hasMore: false });
  });

  test("nothing to show", () => {
    expect(paginate([], "recent", 1)).toMatchObject({
      items: [],
      shown: 0,
      total: 0,
      hasMore: false,
    });
    expect(paginate([], "highest", 1)).toMatchObject({ items: [], hasMore: false });
  });
});

describe("summarizeSelection", () => {
  test("agrees with the month's summary when nothing is filtered, USD without a rate apart", () => {
    const selection = summarizeSelection(ROWS);
    const month = summarizeMonth("2026-10", ROWS);
    expect(selection).toEqual({
      count: month.total.count,
      penCents: month.total.penCents,
      unconvertedUsdCents: month.total.unconvertedUsdCents,
    });
    expect(selection.unconvertedUsdCents).toBe(1000);
  });

  test("sums only what it is given", () => {
    expect(summarizeSelection(applyFilters(ROWS, filters({ categories: [COMIDA.id] })))).toEqual({
      count: 2,
      penCents: 1550,
      unconvertedUsdCents: 0,
    });
    expect(summarizeSelection([])).toEqual({ count: 0, penCents: 0, unconvertedUsdCents: 0 });
  });
});
