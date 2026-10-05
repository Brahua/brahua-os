// The Zod inputs of `finance` (expenses and the catalog) and its small pure helpers: the month
// parameter, day and month titles, the list's groups and rows, the form's choices.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  catalogIdInputSchema,
  createCategoryInputSchema,
  createPaymentMethodInputSchema,
  reorderCatalogInputSchema,
  setExchangeRateInputSchema,
  unarchiveCatalogInputSchema,
  type FinanceCatalog,
} from "@/modules/finance/catalog-input";
import {
  createExpenseInputSchema,
  updateExpenseInputSchema,
  type ExpenseItem,
} from "@/modules/finance/expense-input";
import {
  categoryOptions,
  currencyForMethod,
  defaultMethodId,
  expenseLabel,
  methodOptions,
} from "@/modules/finance/expense-form";
import {
  CATALOG_ERRORS,
  dayTitle,
  EXPENSE_ERRORS,
  monthTitle,
  RATE_ERRORS,
} from "@/modules/finance/finance-copy";
import { expenseRowText, groupByDay } from "@/modules/finance/month-list";
import { parseFinanceView, parseMonth } from "@/modules/finance/routes";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
/** 10:00 in Lima on 2026-10-05. Only Date is faked. */
const NOW = new Date("2026-10-05T15:00:00.000Z");

const firstError = (result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => result.error?.issues.map((issue) => [issue.path.join("."), issue.message]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createExpenseInputSchema", () => {
  test("the amount alone: everything else is left to the server's defaults", () => {
    expect(createExpenseInputSchema.parse({ amount: "12,50" })).toEqual({ amount: 1250 });
  });

  test("every field: normalized description, refs, currency and date", () => {
    expect(
      createExpenseInputSchema.parse({
        amount: "95",
        description: "  Claude \n Pro ",
        currency: "USD",
        categoryId: ID,
        paymentMethodId: "",
        spentOn: "2026-10-01",
      }),
    ).toEqual({
      amount: 9500,
      description: "Claude Pro",
      currency: "USD",
      categoryId: ID,
      paymentMethodId: null,
      spentOn: "2026-10-01",
    });
    // An empty description is none.
    expect(
      createExpenseInputSchema.parse({ amount: "1", description: "   " }).description,
    ).toBeNull();
  });

  test.each([
    [{ amount: "" }, "amount", EXPENSE_ERRORS.amount.required],
    [{ amount: "12.505" }, "amount", EXPENSE_ERRORS.amount.decimals],
    [{ amount: "0" }, "amount", EXPENSE_ERRORS.amount.tooSmall],
    [{ amount: "2000000" }, "amount", EXPENSE_ERRORS.amount.tooLarge],
    [{ amount: "doce" }, "amount", EXPENSE_ERRORS.amount.invalid],
    [{ amount: 12 }, "amount", EXPENSE_ERRORS.amount.required],
    [
      { amount: "1", description: "x".repeat(81) },
      "description",
      EXPENSE_ERRORS.descriptionTooLong,
    ],
    [{ amount: "1", description: "a​b" }, "description", EXPENSE_ERRORS.descriptionInvisible],
    [{ amount: "1", currency: "EUR" }, "currency", EXPENSE_ERRORS.currency],
    [{ amount: "1", categoryId: "comida" }, "categoryId", EXPENSE_ERRORS.categoryUnavailable],
    [{ amount: "1", paymentMethodId: 7 }, "paymentMethodId", EXPENSE_ERRORS.methodUnavailable],
    [{ amount: "1", spentOn: "2026-02-30" }, "spentOn", EXPENSE_ERRORS.dateInvalid],
    [{ amount: "1", spentOn: "05/10/2026" }, "spentOn", EXPENSE_ERRORS.dateInvalid],
    [{ amount: "1", spentOn: "1999-12-31" }, "spentOn", EXPENSE_ERRORS.dateTooOld],
    [{ amount: "1", spentOn: "2026-10-06" }, "spentOn", EXPENSE_ERRORS.dateFuture],
  ])("%j is refused on %s", (input, field, message) => {
    const result = createExpenseInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(firstError(result)?.[0]).toEqual([field, message]);
  });

  test("today in Lima is fine even when it is already tomorrow in UTC", () => {
    // 23:30 in Lima on 2026-10-05 is 04:30 UTC on 2026-10-06.
    vi.setSystemTime(new Date("2026-10-06T04:30:00.000Z"));
    expect(createExpenseInputSchema.safeParse({ amount: "1", spentOn: "2026-10-05" }).success).toBe(
      true,
    );
    expect(createExpenseInputSchema.safeParse({ amount: "1", spentOn: "2026-10-06" }).success).toBe(
      false,
    );
  });
});

describe("updateExpenseInputSchema", () => {
  test("the whole form is required", () => {
    expect(
      updateExpenseInputSchema.parse({
        id: ID,
        amount: "10",
        description: null,
        currency: "PEN",
        categoryId: null,
        paymentMethodId: OTHER,
        spentOn: "2026-10-05",
      }),
    ).toEqual({
      id: ID,
      amount: 1000,
      description: null,
      currency: "PEN",
      categoryId: null,
      paymentMethodId: OTHER,
      spentOn: "2026-10-05",
    });
    const missing = updateExpenseInputSchema.safeParse({ id: ID, amount: "10" });
    expect(missing.success).toBe(false);
    expect(firstError(missing)?.map(([field]) => field)).toEqual(
      expect.arrayContaining(["currency", "spentOn"]),
    );
    expect(
      updateExpenseInputSchema.safeParse({ id: "x", amount: "1" }).error?.issues[0].message,
    ).toBe(EXPENSE_ERRORS.notFound);
  });
});

describe("catalog inputs", () => {
  test("names are normalized and limited", () => {
    expect(createCategoryInputSchema.parse({ name: "  Comida   y  bebida " })).toEqual({
      name: "Comida y bebida",
    });
    expect(firstError(createCategoryInputSchema.safeParse({ name: "  " }))).toEqual([
      ["name", CATALOG_ERRORS.nameRequired],
    ]);
    expect(firstError(createCategoryInputSchema.safeParse({ name: "x".repeat(41) }))).toEqual([
      ["name", CATALOG_ERRORS.nameTooLong],
    ]);
    expect(firstError(createCategoryInputSchema.safeParse({ name: "a‮b" }))).toEqual([
      ["name", CATALOG_ERRORS.nameInvisible],
    ]);
  });

  test("a method needs its currency", () => {
    expect(
      createPaymentMethodInputSchema.parse({ name: "Débito dólares", currency: "USD" }),
    ).toEqual({ name: "Débito dólares", currency: "USD" });
    expect(firstError(createPaymentMethodInputSchema.safeParse({ name: "Yape" }))).toEqual([
      ["currency", CATALOG_ERRORS.currency],
    ]);
  });

  test("reorder: ids as a set; reactivate defaults to the end", () => {
    expect(reorderCatalogInputSchema.safeParse({ ids: [ID, OTHER] }).success).toBe(true);
    for (const ids of [[], [ID, ID], ["x"], "x"]) {
      expect(reorderCatalogInputSchema.safeParse({ ids }).error?.issues[0].message).toBe(
        CATALOG_ERRORS.order,
      );
    }
    expect(unarchiveCatalogInputSchema.parse({ id: ID })).toEqual({ id: ID, position: "end" });
    expect(catalogIdInputSchema.safeParse({ id: "x" }).error?.issues[0].message).toBe(
      CATALOG_ERRORS.notFound,
    );
  });

  test("the rate: typed with comma or point; empty or null clears it", () => {
    expect(setExchangeRateInputSchema.parse({ rate: "3,75" })).toEqual({ rate: 37_500 });
    expect(setExchangeRateInputSchema.parse({ rate: "" })).toEqual({ rate: null });
    expect(setExchangeRateInputSchema.parse({ rate: null })).toEqual({ rate: null });
    expect(firstError(setExchangeRateInputSchema.safeParse({ rate: "11" }))).toEqual([
      ["rate", RATE_ERRORS.outOfRange],
    ]);
    expect(firstError(setExchangeRateInputSchema.safeParse({ rate: "3.75123" }))).toEqual([
      ["rate", RATE_ERRORS.decimals],
    ]);
    expect(setExchangeRateInputSchema.safeParse({ rate: 3.75 }).success).toBe(false);
  });
});

describe("routes", () => {
  test.each([
    [undefined, "2026-10"],
    ["2026-09", "2026-09"],
    ["2000-01", "2000-01"],
    ["1999-12", "2026-10"],
    ["2026-11", "2026-10"],
    ["2026-13", "2026-10"],
    ["2026-9", "2026-10"],
    [["2026-09"], "2026-10"],
  ])("?mes=%j → %s", (value, month) => {
    expect(parseMonth(value, "2026-10")).toBe(month);
  });

  test("the remembered view", () => {
    expect(parseFinanceView("payments")).toBe("payments");
    expect(parseFinanceView("month")).toBe("month");
    expect(parseFinanceView(undefined)).toBe("month");
    expect(parseFinanceView("x")).toBe("month");
  });
});

describe("titles", () => {
  test("months and days in Spanish (es-PE)", () => {
    expect(monthTitle("2026-10")).toBe("Octubre 2026");
    expect(monthTitle("2026-09")).toBe("Setiembre 2026");
    expect(dayTitle("2026-10-05", "2026-10-05")).toBe("Hoy");
    expect(dayTitle("2026-10-04", "2026-10-05")).toBe("Ayer");
    expect(dayTitle("2026-09-30", "2026-10-01")).toBe("Ayer");
    expect(dayTitle("2026-10-01", "2026-10-05")).toBe("Jueves 1 de octubre");
  });
});

const CATALOG: FinanceCatalog = {
  categories: [{ id: ID, name: "Comida", sortOrder: 0 }],
  methods: [
    { id: OTHER, name: "Débito dólares", currency: "USD", sortOrder: 0 },
    { id: "33333333-3333-4333-8333-333333333333", name: "Efectivo", currency: "PEN", sortOrder: 1 },
  ],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: 37_500,
  lastPaymentMethodId: OTHER,
};

function expense(values: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    id: ID,
    description: null,
    amountCents: 1250,
    currency: "PEN",
    exchangeRateE4: null,
    spentOn: "2026-10-05",
    category: null,
    paymentMethod: null,
    recurringPaymentId: null,
    ...values,
  };
}

describe("the form's choices", () => {
  test("none first, then the catalog; an archived current item stays listed", () => {
    expect(categoryOptions(CATALOG)).toEqual([
      { value: "", label: "Sin categoría" },
      { value: ID, label: "Comida" },
    ]);
    expect(methodOptions(null)).toEqual([{ value: "", label: "Sin medio de pago" }]);
    expect(categoryOptions(CATALOG, { id: OTHER, name: "Viajes" }).at(-1)).toEqual({
      value: OTHER,
      label: "Viajes (archivado)",
    });
    expect(categoryOptions(CATALOG, { id: ID, name: "Comida" })).toHaveLength(2);
  });

  test("defaults: the last method and its currency; PEN without one", () => {
    expect(defaultMethodId(CATALOG)).toBe(OTHER);
    expect(defaultMethodId(null)).toBe("");
    expect(currencyForMethod(CATALOG, OTHER)).toBe("USD");
    expect(currencyForMethod(CATALOG, "")).toBe("PEN");
    expect(currencyForMethod(null, OTHER)).toBe("PEN");
  });
});

describe("the month's list", () => {
  test("groups consecutive days in order", () => {
    const a = expense({ id: "a", spentOn: "2026-10-05" });
    const b = expense({ id: "b", spentOn: "2026-10-05" });
    const c = expense({ id: "c", spentOn: "2026-10-01" });
    expect(groupByDay([a, b, c])).toEqual([
      { day: "2026-10-05", expenses: [a, b] },
      { day: "2026-10-01", expenses: [c] },
    ]);
    expect(groupByDay([])).toEqual([]);
  });

  test("a row: label, amount, the conversion of USD and the meta", () => {
    const comida = { id: ID, name: "Comida" };
    const card = { id: OTHER, name: "Crédito" };
    expect(expenseLabel(expense())).toBe("Sin categoría");
    expect(expenseLabel(expense({ category: comida }))).toBe("Comida");
    expect(expenseLabel(expense({ description: "Café", category: comida }))).toBe("Café");

    const pen = expenseRowText(
      expense({ description: "Café", category: comida, paymentMethod: card }),
    );
    expect({ ...pen, amount: pen.amount.replace(/\s/g, " ") }).toEqual({
      label: "Café",
      amount: "S/ 12.50",
      converted: null,
      meta: ["Crédito", "Comida"],
    });

    const usd = expenseRowText(
      expense({
        currency: "USD",
        amountCents: 9500,
        exchangeRateE4: 37_500,
        recurringPaymentId: ID,
      }),
    );
    expect(usd.amount.replace(/\s/g, " ")).toBe("USD 95.00");
    expect(usd.converted?.replace(/\s/g, " ")).toBe("≈ S/ 356.25");
    expect(usd.meta).toEqual(["Recurrente"]);

    expect(expenseRowText(expense({ currency: "USD", exchangeRateE4: null })).converted).toBe(
      "sin convertir",
    );
  });
});
