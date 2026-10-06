// Reads of `finance` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { selectCatalog } from "./catalog";
import type { FinanceCatalog } from "./catalog-input";
import type { ExpenseItem } from "./expense-input";
import { selectMonthExpenses } from "./expenses";

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
