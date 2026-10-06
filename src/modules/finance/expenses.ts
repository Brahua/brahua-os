// Expenses of `finance` (server only): the month's list, create, edit, soft delete and restore.
// These functions take the database and trust their input: the actions check the owner and
// validate first. Locks: see catalog.ts (expense writes take no advisory lock; they read the
// category and method FOR SHARE).
import "server-only";
import { and, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { lockRecurring, readSettingsIn, rememberPaymentMethod, type Tx } from "./catalog";
import {
  financeCategories,
  financeExpenses,
  financePaymentMethods,
  financeSettlements,
} from "./db/schema";
import type { CreateExpenseInput, ExpenseItem, UpdateExpenseInput } from "./expense-input";
import type { Currency } from "./finance-constants";
import { rateFromDb } from "./money";

type Reader = Database | Tx;

/** Why an expense write was refused. */
export type ExpenseFailure = "notFound" | "categoryUnavailable" | "methodUnavailable";

/**
 * Whether an expense is visible (SPEC-finance "Visibilidad"): not deleted. EVERY read and write of
 * expenses (F2's history and "Pagado", F3's summary, F4's contract) must filter with it. An
 * expense of a deleted recurring payment stays visible.
 */
export const visibleExpense = isNull(financeExpenses.deletedAt);

const ITEM = {
  id: financeExpenses.id,
  description: financeExpenses.description,
  amountCents: financeExpenses.amountCents,
  currency: financeExpenses.currency,
  exchangeRate: financeExpenses.exchangeRate,
  spentOn: financeExpenses.spentOn,
  recurringPaymentId: financeExpenses.recurringPaymentId,
  categoryId: financeCategories.id,
  categoryName: financeCategories.name,
  methodId: financePaymentMethods.id,
  methodName: financePaymentMethods.name,
};

type ItemRow = {
  id: string;
  description: string | null;
  amountCents: number;
  currency: Currency;
  exchangeRate: string | null;
  spentOn: string;
  recurringPaymentId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  methodId: string | null;
  methodName: string | null;
};

function toItem(row: ItemRow): ExpenseItem {
  return {
    id: row.id,
    description: row.description,
    amountCents: row.amountCents,
    currency: row.currency,
    exchangeRateE4: rateFromDb(row.exchangeRate),
    spentOn: row.spentOn,
    category:
      row.categoryId && row.categoryName ? { id: row.categoryId, name: row.categoryName } : null,
    paymentMethod:
      row.methodId && row.methodName ? { id: row.methodId, name: row.methodName } : null,
    recurringPaymentId: row.recurringPaymentId,
  };
}

/** Expenses with their category and method (archived ones too: they keep showing). */
async function selectItems(db: Reader, where: SQL | undefined): Promise<ExpenseItem[]> {
  const rows = await db
    .select(ITEM)
    .from(financeExpenses)
    .leftJoin(financeCategories, eq(financeCategories.id, financeExpenses.categoryId))
    .leftJoin(financePaymentMethods, eq(financePaymentMethods.id, financeExpenses.paymentMethodId))
    .where(where)
    .orderBy(
      desc(financeExpenses.spentOn),
      desc(financeExpenses.createdAt),
      desc(financeExpenses.id),
    );
  return rows.map(toItem);
}

/** One visible expense, or null. */
export async function selectExpenseById(db: Reader, id: string): Promise<ExpenseItem | null> {
  const [item] = await selectItems(db, and(eq(financeExpenses.id, id), visibleExpense));
  return item ?? null;
}

/** The first day of the month after `month` (YYYY-MM) as YYYY-MM-DD. */
function nextMonthStart(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
}

/**
 * The visible expenses spent in `month` (YYYY-MM, Lima days), the most recent day first and, in a
 * day, the last saved first. One query (the spent_on index).
 */
export async function selectMonthExpenses(db: Reader, month: string): Promise<ExpenseItem[]> {
  return selectItems(
    db,
    and(
      visibleExpense,
      gte(financeExpenses.spentOn, `${month}-01`),
      lt(financeExpenses.spentOn, nextMonthStart(month)),
    ),
  );
}

/** A category still visible, locked FOR SHARE (an archive at the same time waits). */
export async function activeCategory(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: financeCategories.id })
    .from(financeCategories)
    .where(and(eq(financeCategories.id, id), isNull(financeCategories.archivedAt)))
    .for("share");
  return row ?? null;
}

/** A payment method still visible, with its currency, locked FOR SHARE. */
export async function activeMethod(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: financePaymentMethods.id, currency: financePaymentMethods.currency })
    .from(financePaymentMethods)
    .where(and(eq(financePaymentMethods.id, id), isNull(financePaymentMethods.archivedAt)))
    .for("share");
  return row ?? null;
}

/**
 * Saves a new expense with the defaults of SPEC-finance for what was left out: `today` (Lima),
 * the method of the last expense (if it is still visible; none otherwise), the method's currency
 * (PEN without one) and no category. A USD expense stores the rate of the settings (null if it
 * isn't set: "sin convertir"). The method used becomes the next default.
 */
export async function insertExpense(
  db: Database,
  input: CreateExpenseInput,
  today: string,
): Promise<ExpenseItem | ExpenseFailure> {
  return db.transaction(async (tx) => {
    const settings = await readSettingsIn(tx);
    let method: { id: string; currency: Currency } | null = null;
    if (input.paymentMethodId === undefined) {
      // The default: skipped quietly if it was archived since.
      if (settings.lastPaymentMethodId)
        method = await activeMethod(tx, settings.lastPaymentMethodId);
    } else if (input.paymentMethodId !== null) {
      method = await activeMethod(tx, input.paymentMethodId);
      if (!method) return "methodUnavailable";
    }
    const categoryId = input.categoryId ?? null;
    if (categoryId !== null && !(await activeCategory(tx, categoryId))) {
      return "categoryUnavailable";
    }
    const currency = input.currency ?? method?.currency ?? "PEN";
    const [created] = await tx
      .insert(financeExpenses)
      .values({
        description: input.description ?? null,
        amountCents: input.amount,
        currency,
        exchangeRate: currency === "USD" ? settings.usdToPen : null,
        spentOn: input.spentOn ?? today,
        categoryId,
        paymentMethodId: method?.id ?? null,
      })
      .returning({ id: financeExpenses.id });
    if (method) await rememberPaymentMethod(tx, method.id);
    return (await selectExpenseById(tx, created.id)) as ExpenseItem;
  });
}

/**
 * Edits a visible expense (the whole form). A new category or method must be visible; the one it
 * already has stays even if it was archived since. The stored rate only changes when the currency
 * or the amount does (SPEC-finance "Tipo de cambio"): then a USD expense takes the current rate
 * of the settings, and PEN never has one.
 */
export async function updateExpense(
  db: Database,
  input: UpdateExpenseInput,
): Promise<ExpenseItem | ExpenseFailure> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        currency: financeExpenses.currency,
        amountCents: financeExpenses.amountCents,
        exchangeRate: financeExpenses.exchangeRate,
        categoryId: financeExpenses.categoryId,
        paymentMethodId: financeExpenses.paymentMethodId,
      })
      .from(financeExpenses)
      .where(and(eq(financeExpenses.id, input.id), visibleExpense))
      .for("update");
    if (!existing) return "notFound";
    if (
      input.categoryId !== null &&
      input.categoryId !== existing.categoryId &&
      !(await activeCategory(tx, input.categoryId))
    ) {
      return "categoryUnavailable";
    }
    if (
      input.paymentMethodId !== null &&
      input.paymentMethodId !== existing.paymentMethodId &&
      !(await activeMethod(tx, input.paymentMethodId))
    ) {
      return "methodUnavailable";
    }
    // USD: a new currency or amount takes the current rate; otherwise the stored one stays. A
    // stored rate is never replaced by "none", and an expense saved without one adopts the
    // current rate once it exists (decisión autónoma: it can then be converted).
    let exchangeRate: string | null = null;
    if (input.currency === "USD") {
      const changed = existing.currency !== "USD" || existing.amountCents !== input.amount;
      const stored = existing.currency === "USD" ? existing.exchangeRate : null;
      const current = changed || stored === null ? (await readSettingsIn(tx)).usdToPen : null;
      exchangeRate = changed ? (current ?? stored) : (stored ?? current);
    }
    await tx
      .update(financeExpenses)
      .set({
        description: input.description,
        amountCents: input.amount,
        currency: input.currency,
        exchangeRate,
        spentOn: input.spentOn,
        categoryId: input.categoryId,
        paymentMethodId: input.paymentMethodId,
      })
      .where(eq(financeExpenses.id, input.id));
    return (await selectExpenseById(tx, input.id)) as ExpenseItem;
  });
}

/** An expense by id, deleted or not (what a delete returns for its "Deshacer" notice). */
async function selectAnyExpenseById(db: Reader, id: string): Promise<ExpenseItem | null> {
  const [item] = await selectItems(db, eq(financeExpenses.id, id));
  return item ?? null;
}

/** The recurring payment (and period) an expense paid, read without a lock, or null. */
async function peekRecurring(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      recurringPaymentId: financeExpenses.recurringPaymentId,
      recurringDueOn: financeExpenses.recurringDueOn,
    })
    .from(financeExpenses)
    .where(eq(financeExpenses.id, id));
  return row ?? null;
}

/**
 * Soft delete ("Deshacer" restores it). Only a visible expense changes (one atomic UPDATE …
 * WHERE deleted_at IS NULL): a second delete, or one racing it, changes nothing and returns null,
 * so there is never a second "Deshacer". Returns the expense as it was.
 *
 * A paid expense of a recurring payment also removes its settlement: the period is pending again
 * (F2). Order, so the advisory lock stays the first lock of the transaction: read the expense
 * without a lock (its `recurring_payment_id`, which never changes), then `lockRecurring`, then the
 * UPDATE (which locks the row and re-checks it is still visible), then the settlement.
 */
export async function softDeleteExpense(db: Database, id: string): Promise<ExpenseItem | null> {
  return db.transaction(async (tx) => {
    const peeked = await peekRecurring(tx, id);
    if (!peeked) return null;
    if (peeked.recurringPaymentId) await lockRecurring(tx, peeked.recurringPaymentId);
    const [deleted] = await tx
      .update(financeExpenses)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(financeExpenses.id, id), visibleExpense))
      .returning({ id: financeExpenses.id });
    if (!deleted) return null;
    if (peeked.recurringPaymentId) {
      // The documented physical delete (a period's state, not the owner's data).
      await tx.delete(financeSettlements).where(eq(financeSettlements.expenseId, id));
    }
    return selectAnyExpenseById(tx, id);
  });
}

/**
 * Undo of a delete: visible again, as it was. Only a deleted expense changes (UPDATE … WHERE
 * deleted_at IS NOT NULL); restoring a visible one is fine and returns it. "notFound" when it
 * doesn't exist. A paid expense of a recurring payment settles its period again, under the
 * payment's lock (same order as the delete), only if the period is still free: when it was paid
 * or skipped again meanwhile, nothing changes and the answer is "periodTaken" (never two expenses
 * for one period).
 */
export async function restoreExpense(
  db: Database,
  id: string,
): Promise<ExpenseItem | "notFound" | "periodTaken"> {
  return db.transaction(async (tx) => {
    const peeked = await peekRecurring(tx, id);
    if (!peeked) return "notFound";
    const { recurringPaymentId, recurringDueOn } = peeked;
    if (recurringPaymentId) await lockRecurring(tx, recurringPaymentId);
    const [restored] = await tx
      .update(financeExpenses)
      .set({ deletedAt: null })
      .where(and(eq(financeExpenses.id, id), isNotNull(financeExpenses.deletedAt)))
      .returning({ id: financeExpenses.id });
    if (restored && recurringPaymentId && recurringDueOn) {
      const settled = await tx
        .insert(financeSettlements)
        .values({
          recurringPaymentId,
          dueOn: recurringDueOn,
          status: "paid",
          expenseId: id,
        })
        .onConflictDoNothing()
        .returning({ dueOn: financeSettlements.dueOn });
      if (settled.length === 0) {
        // Taken meanwhile: undo the restore (still deleted) and say why.
        await tx
          .update(financeExpenses)
          .set({ deletedAt: sql`now()` })
          .where(eq(financeExpenses.id, id));
        return "periodTaken";
      }
    }
    return (await selectExpenseById(tx, id)) ?? "notFound";
  });
}
