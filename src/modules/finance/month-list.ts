// Pure helpers of the month's list (client-safe): days and what each row shows.
import type { ExpenseItem } from "./expense-input";
import { expenseLabel } from "./expense-form";
import { FINANCE_COPY } from "./finance-copy";
import { formatMoney, toPenCents } from "./money";

export type DayGroup = { day: string; expenses: ExpenseItem[] };

/** Consecutive expenses of the same day together, in the list's order (most recent first). */
export function groupByDay(expenses: readonly ExpenseItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const expense of expenses) {
    const last = groups.at(-1);
    if (last && last.day === expense.spentOn) last.expenses.push(expense);
    else groups.push({ day: expense.spentOn, expenses: [expense] });
  }
  return groups;
}

export type ExpenseRowText = {
  /** The description, else the category, else "Sin categoría". */
  label: string;
  /** In its own currency: "S/ 12.50", "USD 95.00". */
  amount: string;
  /** USD only: "≈ S/ 356.25" with its stored rate, or "sin convertir" without one. */
  converted: string | null;
  /** Method, the category (when the label is the description) and "Recurrente". */
  meta: string[];
};

/** What a row of the month shows of an expense. */
export function expenseRowText(expense: ExpenseItem): ExpenseRowText {
  let converted: string | null = null;
  if (expense.currency === "USD") {
    const pen = toPenCents(expense.amountCents, expense.currency, expense.exchangeRateE4);
    converted =
      pen === null ? FINANCE_COPY.unconverted : FINANCE_COPY.approx(formatMoney(pen, "PEN"));
  }
  const meta: string[] = [];
  if (expense.paymentMethod) meta.push(expense.paymentMethod.name);
  if (expense.description && expense.category) meta.push(expense.category.name);
  if (expense.recurringPaymentId) meta.push(FINANCE_COPY.recurring);
  return {
    label: expenseLabel(expense),
    amount: formatMoney(expense.amountCents, expense.currency),
    converted,
    meta,
  };
}
