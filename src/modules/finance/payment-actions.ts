"use server";

// Server Actions of recurring payments (F2): create, edit, archive, reactivate, delete, restore,
// and the periods: pay ("Pagado" / "Pagado…"), skip, and their undo. Each one goes through
// ownerAction(): owner check first, Zod, then an ActionResult. Reachable by any POST, so input is
// `unknown`. A write revalidates /finance (the payment pages are under it) and the home page
// ("Pagos", F4) when it changed something, or when it was refused because the page is out of date
// (paid, deleted or archived elsewhere; a category or method archived); never for a refusal of the
// input itself.
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { RECURRING_ERRORS } from "./payments-copy";
import {
  insertRecurring,
  payPeriod,
  restoreRecurring,
  setRecurringArchived,
  skipPeriod as skipById,
  softDeleteRecurring,
  undoPaidPeriod,
  undoSkippedPeriod,
  updateRecurring,
  type PaidPeriod,
  type UndoResult,
  type RecurringFailure,
} from "./recurring";
import {
  createRecurringInputSchema,
  payInputSchema,
  periodInputSchema,
  recurringIdInputSchema,
  undoPaidInputSchema,
  undoSkippedInputSchema,
  updateRecurringInputSchema,
  type RecurringItem,
} from "./recurring-input";
import { revalidateFinanceAndHome } from "./revalidate";

/** Refusals that belong to a field of the sheets. */
const ON_FIELD: Partial<Record<RecurringFailure, string>> = {
  categoryUnavailable: "categoryId",
  methodUnavailable: "paymentMethodId",
  variableNeedsAmount: "amount",
  installmentsKeepMonthly: "cycle",
  // Said under the field to clear (the other message, "installmentsDone", answers a reactivation
  // button, not a sheet: it stays a notice).
  installmentsScheduleLocked: "installmentsTotal",
};

/** A refusal: on its field when it has one (category, method, amount), else the message. */
function refused<T>(failure: RecurringFailure): ActionResult<T> {
  const field = ON_FIELD[failure];
  if (field) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { [field]: [RECURRING_ERRORS[failure]] },
    };
  }
  return fail(RECURRING_ERRORS[failure]);
}

const today = () => ownerDateKey(new Date());

/** Refusals of the input alone: the page is not out of date, nothing to read again. */
const INPUT_ONLY: ReadonlySet<RecurringFailure> = new Set(["variableNeedsAmount"]);

function settle<T extends object>(result: T | RecurringFailure): ActionResult<T> {
  if (typeof result !== "string" || !INPUT_ONLY.has(result)) revalidateFinanceAndHome();
  return typeof result === "string" ? refused<T>(result) : ok(result);
}

const create = ownerAction(
  createRecurringInputSchema,
  async (data) => settle(await insertRecurring(getDb(), data)),
  { name: "createRecurringPayment" },
);

/** "Nuevo pago recurrente". */
export async function createRecurringPayment(input: unknown): Promise<ActionResult<RecurringItem>> {
  return create(input);
}

const update = ownerAction(
  updateRecurringInputSchema,
  async (data) => {
    const result = await updateRecurring(getDb(), data, today());
    if (typeof result === "object" && "failure" in result) {
      // N below what is settled: the page may be out of date, so it reads again; the message
      // names the lowest N that holds what is paid or skipped.
      revalidateFinanceAndHome();
      return {
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsTooLow(result.min)] },
      };
    }
    return settle(result);
  },
  { name: "editRecurringPayment" },
);

/** Edits a recurring payment (the whole sheet; the cycle changes under its lock). */
export async function editRecurringPayment(input: unknown): Promise<ActionResult<RecurringItem>> {
  return update(input);
}

const archive = ownerAction(
  recurringIdInputSchema,
  async ({ id }) => settle(await setRecurringArchived(getDb(), id, true, today())),
  { name: "archiveRecurringPayment" },
);

/** "Archivar": out of pending and of "Todos"; its past expenses stay in the summary. */
export async function archiveRecurringPayment(
  input: unknown,
): Promise<ActionResult<RecurringItem>> {
  return archive(input);
}

const unarchive = ownerAction(
  recurringIdInputSchema,
  async ({ id }) => settle(await setRecurringArchived(getDb(), id, false, today())),
  { name: "unarchiveRecurringPayment" },
);

/** "Reactivar". */
export async function unarchiveRecurringPayment(
  input: unknown,
): Promise<ActionResult<RecurringItem>> {
  return unarchive(input);
}

const remove = ownerAction(
  recurringIdInputSchema,
  async ({ id }) => settle((await softDeleteRecurring(getDb(), id)) ?? "notFound"),
  { name: "deleteRecurringPayment" },
);

/** Soft delete, back with "Deshacer". Its past expenses stay (with their name). */
export async function deleteRecurringPayment(input: unknown): Promise<ActionResult<RecurringItem>> {
  return remove(input);
}

const restore = ownerAction(
  recurringIdInputSchema,
  async ({ id }) => settle((await restoreRecurring(getDb(), id)) ?? "notFound"),
  { name: "restoreRecurringPayment" },
);

/** "Deshacer" of a delete. Twice is fine. */
export async function restoreRecurringPayment(
  input: unknown,
): Promise<ActionResult<RecurringItem>> {
  return restore(input);
}

const pay = ownerAction(
  payInputSchema,
  async (data) => settle(await payPeriod(getDb(), data, today())),
  { name: "markPaid" },
);

/**
 * "Pagado" of one period (only `id` and `dueOn`: the payment's amount, today and its method) or
 * "Pagado…" (with `amount`, `spentOn`, `paymentMethodId`). Creates the period's expense once: a
 * second call answers "Ya estaba pagado". F4's home section uses it too.
 */
export async function markPaid(input: unknown): Promise<ActionResult<PaidPeriod>> {
  return pay(input);
}

const undoPay = ownerAction(
  undoPaidInputSchema,
  async (data) => settle(await undoPaidPeriod(getDb(), data)),
  { name: "undoPaid" },
);

/**
 * "Deshacer" of a pay (`{ id, dueOn, expenseId }`, the expense `markPaid` returned): the expense is
 * removed and the period is pending again. Refused if the period now holds another expense. With
 * `reopenStamp` (the pay closed the payment: its last installment) the payment is reactivated too,
 * only if its archive is still the one that pay made.
 */
export async function undoPaid(input: unknown): Promise<ActionResult<UndoResult>> {
  return undoPay(input);
}

const skip = ownerAction(
  periodInputSchema,
  async (data) => settle(await skipById(getDb(), data, today())),
  { name: "skipPeriod" },
);

/** "Omitir este período": out of pending, with no expense. */
export async function skipPeriod(
  input: unknown,
): Promise<ActionResult<{ dueOn: string; name: string; closedStamp: string | null }>> {
  return skip(input);
}

const undoSkip = ownerAction(
  undoSkippedInputSchema,
  async (data) => settle(await undoSkippedPeriod(getDb(), data)),
  { name: "undoSkip" },
);

/** "Deshacer" of a skip: the period is pending again. */
export async function undoSkipped(input: unknown): Promise<ActionResult<UndoResult>> {
  return undoSkip(input);
}
