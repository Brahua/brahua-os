"use server";

// Server Actions of expenses (create, edit, delete, restore). Each one goes through ownerAction():
// owner check first, Zod, then an ActionResult (SPEC-core "Estilo de código"). Reachable by any
// POST, so input is `unknown`. The catalog's actions live in catalog-actions.ts; F2 adds its own
// file (`payment-actions.ts`), not here.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import {
  createExpenseInputSchema,
  expenseIdInputSchema,
  updateExpenseInputSchema,
  type ExpenseItem,
} from "./expense-input";
import {
  insertExpense,
  restoreExpense as restoreById,
  softDeleteExpense,
  updateExpense,
} from "./expenses";
import { expenseRefused } from "./failures";
import { EXPENSE_ERRORS } from "./finance-copy";
import { revalidateFinanceScreens } from "./revalidate";

const create = ownerAction(
  createExpenseInputSchema,
  async (data) => {
    const expense = await insertExpense(getDb(), data, ownerDateKey(new Date()));
    // Either way: a refusal means the form's catalog was out of date.
    revalidateFinanceScreens();
    return typeof expense === "string" ? expenseRefused<ExpenseItem>(expense) : ok(expense);
  },
  { name: "createExpense" },
);

/**
 * Registers an expense. Only the amount is required; what is left out takes its default
 * (SPEC-finance "Valores por defecto"): today, the last method used, its currency, no category.
 */
export async function createExpense(input: unknown): Promise<ActionResult<ExpenseItem>> {
  return create(input);
}

const update = ownerAction(
  updateExpenseInputSchema,
  async (data) => {
    const expense = await updateExpense(getDb(), data);
    revalidateFinanceScreens();
    return typeof expense === "string" ? expenseRefused<ExpenseItem>(expense) : ok(expense);
  },
  { name: "updateExpense" },
);

/** Edits an expense (the whole form). Its stored rate only changes with the currency or amount. */
export async function editExpense(input: unknown): Promise<ActionResult<ExpenseItem>> {
  return update(input);
}

const remove = ownerAction(
  expenseIdInputSchema,
  async ({ id }) => {
    const deleted = await softDeleteExpense(getDb(), id);
    revalidateFinanceScreens();
    return deleted ? ok(deleted) : fail<ExpenseItem>(EXPENSE_ERRORS.notFound);
  },
  { name: "deleteExpense" },
);

/** Soft delete (SPEC-finance "Eliminar"): out of the month, back with "Deshacer". */
export async function deleteExpense(input: unknown): Promise<ActionResult<ExpenseItem>> {
  return remove(input);
}

const restore = ownerAction(
  expenseIdInputSchema,
  async ({ id }) => {
    const expense = await restoreById(getDb(), id);
    revalidateFinanceScreens();
    return expense ? ok(expense) : fail<ExpenseItem>(EXPENSE_ERRORS.notFound);
  },
  { name: "restoreExpense" },
);

/** "Deshacer" of a delete: the expense is back as it was. Twice is fine. */
export async function restoreExpense(input: unknown): Promise<ActionResult<ExpenseItem>> {
  return restore(input);
}
