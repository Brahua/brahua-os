// How a refused write of `finance` reads in an ActionResult (server only, shared by the actions).
import "server-only";
import { fail, INVALID_FIELDS_MESSAGE, type ActionResult } from "@/lib/action-result";
import type { CatalogFailure } from "./catalog";
import type { CatalogKind } from "./catalog-input";
import type { ExpenseFailure } from "./expenses";
import { CATALOG_ERRORS, EXPENSE_ERRORS } from "./finance-copy";

/** An expense refused: on its field when it has one (category, method), else the general message. */
export function expenseRefused<T>(failure: ExpenseFailure): ActionResult<T> {
  if (failure === "notFound") return fail(EXPENSE_ERRORS.notFound);
  const field = failure === "categoryUnavailable" ? "categoryId" : "paymentMethodId";
  return {
    ok: false,
    error: INVALID_FIELDS_MESSAGE,
    fieldErrors: { [field]: [EXPENSE_ERRORS[failure]] },
  };
}

/** A catalog write refused: a taken name on the name field, else the general message. */
export function catalogRefused<T>(kind: CatalogKind, failure: CatalogFailure): ActionResult<T> {
  if (failure === "nameTaken") {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: {
        name: [kind === "categories" ? CATALOG_ERRORS.categoryTaken : CATALOG_ERRORS.methodTaken],
      },
    };
  }
  return fail(CATALOG_ERRORS[failure]);
}
