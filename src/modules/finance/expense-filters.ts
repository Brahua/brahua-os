// The filters, the order and the pages of «Gastos» (finance-gastos). Pure and client-safe: a lens
// over the month's rows the page already loaded. It never touches the month's total, the chart or
// the summary (they read every row); it only decides which rows the list shows.
//
// Money rules (money.ts): amounts compare in PEN cents, each expense converted with its own stored
// rate. USD without a rate has no PEN value: it is left out of any range of amount (never guessed)
// and goes last when sorting by amount.
import type { ExpenseItem } from "./expense-input";
import type { Currency } from "./finance-constants";
import { toPenCents } from "./money";
import { groupKey, NO_GROUP_KEY } from "./summary";

export type ExpenseKind = "all" | "recurring" | "one-off";
export type CurrencyFilter = "all" | Currency;
export type SortKey = "recent" | "oldest" | "highest" | "lowest";

export type ExpenseFilters = {
  /** Category ids; `"none"` is «Sin categoría». Empty: any. */
  categories: readonly string[];
  /** Payment method ids; `"none"` is «Sin medio de pago». Empty: any. */
  methods: readonly string[];
  /** Words in the description, the category or the method (any case, with or without accents). */
  text: string;
  /** Range of amount in PEN cents (both inclusive); null: open. */
  minCents: number | null;
  maxCents: number | null;
  /** Range of days inside the month (YYYY-MM-DD, inclusive); null: open. */
  from: string | null;
  to: string | null;
  kind: ExpenseKind;
  currency: CurrencyFilter;
};

export const NO_FILTERS: ExpenseFilters = {
  categories: [],
  methods: [],
  text: "",
  minCents: null,
  maxCents: null,
  from: null,
  to: null,
  kind: "all",
  currency: "all",
};

/** «Sin medio de pago» uses the same key as «Sin categoría». */
export const NO_METHOD_KEY = NO_GROUP_KEY;

/** Lower case without accents: «Café» matches «cafe». */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

const hasText = (filters: ExpenseFilters) => normalizeText(filters.text) !== "";

/** How many filters are on (a range of amount or of days counts as one each). */
export function countActive(filters: ExpenseFilters): number {
  return [
    filters.categories.length > 0,
    filters.methods.length > 0,
    hasText(filters),
    filters.minCents !== null || filters.maxCents !== null,
    filters.from !== null || filters.to !== null,
    filters.kind !== "all",
    filters.currency !== "all",
  ].filter(Boolean).length;
}

const penOf = (expense: ExpenseItem) =>
  toPenCents(expense.amountCents, expense.currency, expense.exchangeRateE4);

/** Whether one expense passes every filter that is on. */
export function matches(expense: ExpenseItem, filters: ExpenseFilters): boolean {
  if (filters.categories.length > 0) {
    const key = expense.category?.id ?? NO_GROUP_KEY;
    if (!filters.categories.includes(key)) return false;
  }
  if (filters.methods.length > 0) {
    const key = expense.paymentMethod?.id ?? NO_METHOD_KEY;
    if (!filters.methods.includes(key)) return false;
  }
  if (hasText(filters)) {
    const haystack = normalizeText(
      [expense.description, expense.category?.name, expense.paymentMethod?.name]
        .filter(Boolean)
        .join(" "),
    );
    // Every word typed must be there (any order).
    if (
      !normalizeText(filters.text)
        .split(/\s+/)
        .every((word) => haystack.includes(word))
    ) {
      return false;
    }
  }
  if (filters.minCents !== null || filters.maxCents !== null) {
    const pen = penOf(expense);
    if (pen === null) return false;
    if (filters.minCents !== null && pen < filters.minCents) return false;
    if (filters.maxCents !== null && pen > filters.maxCents) return false;
  }
  if (filters.from !== null && expense.spentOn < filters.from) return false;
  if (filters.to !== null && expense.spentOn > filters.to) return false;
  if (filters.kind === "recurring" && !expense.recurringPaymentId) return false;
  if (filters.kind === "one-off" && expense.recurringPaymentId) return false;
  if (filters.currency !== "all" && expense.currency !== filters.currency) return false;
  return true;
}

export const applyFilters = (expenses: readonly ExpenseItem[], filters: ExpenseFilters) =>
  countActive(filters) === 0 ? [...expenses] : expenses.filter((e) => matches(e, filters));

/**
 * The list in the order asked for. The page hands the rows most recent first (day, then last
 * saved): ties keep that order, reversed for «Más antiguos»; USD without a rate goes last when
 * sorting by amount.
 */
export function sortExpenses(expenses: readonly ExpenseItem[], sort: SortKey): ExpenseItem[] {
  const indexed = expenses.map((expense, index) => ({ expense, index }));
  indexed.sort((a, b) => {
    switch (sort) {
      case "recent":
        return a.index - b.index;
      case "oldest":
        return b.index - a.index;
      case "highest":
      case "lowest": {
        const left = penOf(a.expense);
        const right = penOf(b.expense);
        if (left === null || right === null) {
          if (left === right) return a.index - b.index;
          return left === null ? 1 : -1;
        }
        const delta = sort === "highest" ? right - left : left - right;
        return delta || a.index - b.index;
      }
    }
  });
  return indexed.map((entry) => entry.expense);
}

/** Days per page when sorted by date; expenses per page when sorted by amount. */
export const DAYS_PER_PAGE = 7;
export const EXPENSES_PER_PAGE = 25;

export type Page = {
  items: ExpenseItem[];
  /** True when the list is by day (date order): headers per day. */
  byDay: boolean;
  /** What is shown and what there is, in days (by day) or in expenses (by amount). */
  shown: number;
  total: number;
  hasMore: boolean;
};

/** The first `pages` pages of an ordered list (see `DAYS_PER_PAGE` and `EXPENSES_PER_PAGE`). */
export function paginate(expenses: readonly ExpenseItem[], sort: SortKey, pages: number): Page {
  const count = Math.max(1, Math.floor(pages));
  if (sort === "highest" || sort === "lowest") {
    const limit = count * EXPENSES_PER_PAGE;
    return {
      items: expenses.slice(0, limit),
      byDay: false,
      shown: Math.min(limit, expenses.length),
      total: expenses.length,
      hasMore: expenses.length > limit,
    };
  }
  const days: string[] = [];
  for (const expense of expenses) {
    if (days.at(-1) !== expense.spentOn) days.push(expense.spentOn);
  }
  const limit = count * DAYS_PER_PAGE;
  const shownDays = new Set(days.slice(0, limit));
  return {
    items: expenses.filter((expense) => shownDays.has(expense.spentOn)),
    byDay: true,
    shown: Math.min(limit, days.length),
    total: days.length,
    hasMore: days.length > limit,
  };
}

export type SelectionSummary = { count: number; penCents: number; unconvertedUsdCents: number };

/** How many expenses and how much, with the month's own conversion (USD without a rate apart). */
export function summarizeSelection(expenses: readonly ExpenseItem[]): SelectionSummary {
  const summary: SelectionSummary = { count: 0, penCents: 0, unconvertedUsdCents: 0 };
  for (const expense of expenses) {
    summary.count += 1;
    const pen = penOf(expense);
    if (pen === null) summary.unconvertedUsdCents += expense.amountCents;
    else summary.penCents += pen;
  }
  return summary;
}

/** A category's key as the filters use it (same as the summary's). */
export const categoryFilterKey = groupKey;
