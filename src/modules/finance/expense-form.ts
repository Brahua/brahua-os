// Pure helpers of the expense form (client-safe): the choices of its selects and what it sends.
import type { FinanceCatalog } from "./catalog-input";
import type { ExpenseItem, ExpenseRef } from "./expense-input";
import type { Currency } from "./finance-constants";
import { FINANCE_COPY } from "./finance-copy";

export type Option = { value: string; label: string };

/** The visible items, plus the expense's own one when it was archived since (it stays listed). */
function withCurrent(items: readonly ExpenseRef[], current: ExpenseRef | null): Option[] {
  const options = items.map((item) => ({ value: item.id, label: item.name }));
  if (current && !items.some((item) => item.id === current.id)) {
    options.push({ value: current.id, label: FINANCE_COPY.archivedOption(current.name) });
  }
  return options;
}

/** "Sin categoría" first, then the categories in their order. */
export function categoryOptions(
  catalog: FinanceCatalog | null,
  current: ExpenseRef | null = null,
): Option[] {
  return [
    { value: "", label: FINANCE_COPY.noCategory },
    ...withCurrent(catalog?.categories ?? [], current),
  ];
}

/** "Sin medio de pago" first, then the methods in their order. */
export function methodOptions(
  catalog: FinanceCatalog | null,
  current: ExpenseRef | null = null,
): Option[] {
  return [
    { value: "", label: FINANCE_COPY.noMethod },
    ...withCurrent(catalog?.methods ?? [], current),
  ];
}

/** A new expense's method: the last one used, if it is still visible; none otherwise. */
export function defaultMethodId(catalog: FinanceCatalog | null): string {
  return catalog?.lastPaymentMethodId ?? "";
}

/** The currency a method suggests (its default), PEN without a method. */
export function currencyForMethod(catalog: FinanceCatalog | null, methodId: string): Currency {
  return catalog?.methods.find((method) => method.id === methodId)?.currency ?? "PEN";
}

/** What the list shows as an expense's name: its description, else its category, else none. */
export function expenseLabel(expense: Pick<ExpenseItem, "description" | "category">): string {
  return expense.description ?? expense.category?.name ?? FINANCE_COPY.uncategorized;
}
