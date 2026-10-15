// Reads of `finance` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { selectCatalog } from "./catalog";
import type { FinanceCatalog } from "./catalog-input";
import type { ExpenseItem } from "./expense-input";
import { selectMonthExpenses, selectTrendRows } from "./expenses";
import { shiftMonth } from "./routes";
import { monthlyTotals, type MonthlyTotal } from "./trend";

/** The catalog (categories, methods, the rate, the last method used): Ajustes and the form. */
export async function getFinanceCatalog(): Promise<FinanceCatalog> {
  await requireOwner();
  return selectCatalog(getDb());
}

/** The visible expenses of `month` (YYYY-MM), the most recent first. */
export async function listMonthExpenses(month: string): Promise<ExpenseItem[]> {
  await requireOwner();
  return selectMonthExpenses(getDb(), month);
}

/**
 * The totals of the `count` months ending at `month` (oldest first), each whole and up to `day`
 * of it (the comparison's "same point of the month"). PEN only, converted like the summary; one
 * read.
 */
export async function getMonthlyTotals(
  month: string,
  count = 6,
  day = 31,
): Promise<MonthlyTotal[]> {
  await requireOwner();
  const rows = await selectTrendRows(getDb(), shiftMonth(month, 1 - count), month);
  return monthlyTotals(rows, month, count, day);
}
