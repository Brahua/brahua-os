// Recurring payments of `finance` (F2, server only): create, edit, archive, delete, and the
// periods: pay ("Pagado" / "Pagado…"), skip and their undo. These functions take the database and
// trust their input: the actions check the owner and validate first.
//
// Lock (CLAUDE.md "Advisory locks"; SPEC-finance "Bloqueos"): every write of one payment or of
// its periods takes `(5000, hashtext(<recurring id>))` (`lockRecurring`) as the FIRST lock of its
// transaction, before any row lock (the category and method are read FOR SHARE after it). Two
// "Pagado" of the same period at once: the second waits, then finds the settlement and answers
// "Ya estaba pagado"; the settlements' primary key (recurring_payment_id, due_on) is the defense
// behind the lock. Expense deletes take the same lock (expenses.ts, `softDeleteExpense`).
//
// `finance_settlements` is the one table with physical deletes: undoing a pay or a skip removes the
// row, because a period's state is not the owner's data (SPEC-finance "Pagar"). The paid expense
// itself is only soft-deleted.
import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { lockRecurring, readSettingsIn, selectUsdToPen, type Tx } from "./catalog";
import {
  financeCategories,
  financeExpenses,
  financePaymentMethods,
  financeRecurringPayments,
  financeSettlements,
} from "./db/schema";
import type { ExpenseItem } from "./expense-input";
import { activeCategory, activeMethod, selectExpenseById, visibleExpense } from "./expenses";
import type { Currency, PaymentCycle, SettlementStatus } from "./finance-constants";
import { rateFromDb } from "./money";
import { isUniqueViolation, PeriodTaken } from "./period-errors";
import {
  buildPaymentsView,
  pendingForMonth,
  pendingMonthRange,
  pendingPeriodsOf,
  settlementRange,
  type PaymentsViewData,
  type PendingForMonth,
  type PendingPeriod,
} from "./payments-view";
import type {
  CreateRecurringInput,
  PayInput,
  PeriodInput,
  RecurringItem,
  UndoPaidInput,
  UndoSkippedInput,
  SettlementItem,
  UpdateRecurringInput,
} from "./recurring-input";
import {
  addDays,
  isDueDate,
  lastInstallmentDue,
  monthlyPosition,
  nextDueDate,
  nextOpenDue,
  pendingWindow,
  startFrom,
  type Schedule,
} from "./schedule";

type Reader = Database | Tx;

/** Why a write of a recurring payment (or one of its periods) was refused. */
export type RecurringFailure =
  | "notFound"
  | "archived"
  | "categoryUnavailable"
  | "methodUnavailable"
  | "notDue"
  | "alreadyPaid"
  | "alreadySkipped"
  | "notSettled"
  | "variableNeedsAmount"
  | "installmentsScheduleLocked"
  | "installmentsKeepMonthly"
  | "installmentsDone";

/** An edit of N below what is already settled: `min` is the lowest N that holds it. */
export type InstallmentsTooLow = { failure: "installmentsTooLow"; min: number };

/**
 * Whether a recurring payment is visible (SPEC-finance "Visibilidad"): not deleted. Every read
 * and write of recurring payments filters with it. Archived ones are visible (Archivados, its
 * page) but can't be paid or skipped.
 */
export const visibleRecurring = isNull(financeRecurringPayments.deletedAt);

const ITEM = {
  id: financeRecurringPayments.id,
  name: financeRecurringPayments.name,
  amountCents: financeRecurringPayments.amountCents,
  currency: financeRecurringPayments.currency,
  cycle: financeRecurringPayments.cycle,
  weekday: financeRecurringPayments.weekday,
  dayOfMonth: financeRecurringPayments.dayOfMonth,
  intervalMonths: financeRecurringPayments.intervalMonths,
  anchorMonth: financeRecurringPayments.anchorMonth,
  startDate: financeRecurringPayments.startDate,
  installmentsTotal: financeRecurringPayments.installmentsTotal,
  notes: financeRecurringPayments.notes,
  archivedAt: financeRecurringPayments.archivedAt,
  categoryId: financeCategories.id,
  categoryName: financeCategories.name,
  methodId: financePaymentMethods.id,
  methodName: financePaymentMethods.name,
};

type ItemRow = {
  id: string;
  name: string;
  amountCents: number | null;
  currency: Currency;
  cycle: PaymentCycle;
  weekday: number | null;
  dayOfMonth: number | null;
  intervalMonths: number | null;
  anchorMonth: number | null;
  startDate: string;
  installmentsTotal: number | null;
  notes: string | null;
  archivedAt: Date | null;
  categoryId: string | null;
  categoryName: string | null;
  methodId: string | null;
  methodName: string | null;
};

function toItem(row: ItemRow): RecurringItem {
  return {
    id: row.id,
    name: row.name,
    amountCents: row.amountCents,
    currency: row.currency,
    category:
      row.categoryId && row.categoryName ? { id: row.categoryId, name: row.categoryName } : null,
    paymentMethod:
      row.methodId && row.methodName ? { id: row.methodId, name: row.methodName } : null,
    cycle: row.cycle,
    weekday: row.weekday,
    dayOfMonth: row.dayOfMonth,
    intervalMonths: row.intervalMonths,
    anchorMonth: row.anchorMonth,
    startDate: row.startDate,
    installmentsTotal: row.installmentsTotal,
    notes: row.notes,
    archived: row.archivedAt !== null,
  };
}

/** Visible recurring payments (archived ones too) with their category and method, by name. */
async function selectItems(
  db: Reader,
  onlyId?: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): Promise<RecurringItem[]> {
  const rows = await db
    .select(ITEM)
    .from(financeRecurringPayments)
    .leftJoin(financeCategories, eq(financeCategories.id, financeRecurringPayments.categoryId))
    .leftJoin(
      financePaymentMethods,
      eq(financePaymentMethods.id, financeRecurringPayments.paymentMethodId),
    )
    .where(
      and(
        visibleRecurring,
        onlyId === undefined ? undefined : eq(financeRecurringPayments.id, onlyId),
        activeOnly ? isNull(financeRecurringPayments.archivedAt) : undefined,
      ),
    )
    .orderBy(asc(financeRecurringPayments.name), asc(financeRecurringPayments.id));
  return rows.map(toItem);
}

/** Every visible recurring payment (active and archived). */
export function selectRecurringItems(db: Reader): Promise<RecurringItem[]> {
  return selectItems(db);
}

/** One visible recurring payment, or null. */
export async function selectRecurringById(db: Reader, id: string): Promise<RecurringItem | null> {
  const [item] = await selectItems(db, id);
  return item ?? null;
}

/**
 * Settlements with the visible expense of the paid ones, due from `from` to `to` (both
 * included), optionally of one payment. One query.
 */
async function selectSettlements(
  db: Reader,
  range: { from?: string; to?: string; recurringId?: string },
  order: "asc" | "desc" = "asc",
  limit?: number,
): Promise<SettlementItem[]> {
  const rows = await db
    .select({
      recurringId: financeSettlements.recurringPaymentId,
      dueOn: financeSettlements.dueOn,
      status: financeSettlements.status,
      expenseId: financeExpenses.id,
      amountCents: financeExpenses.amountCents,
      currency: financeExpenses.currency,
      exchangeRate: financeExpenses.exchangeRate,
      spentOn: financeExpenses.spentOn,
    })
    .from(financeSettlements)
    .leftJoin(
      financeExpenses,
      and(eq(financeExpenses.id, financeSettlements.expenseId), visibleExpense),
    )
    .where(
      and(
        range.from === undefined ? undefined : gte(financeSettlements.dueOn, range.from),
        range.to === undefined ? undefined : lte(financeSettlements.dueOn, range.to),
        range.recurringId === undefined
          ? undefined
          : eq(financeSettlements.recurringPaymentId, range.recurringId),
      ),
    )
    .orderBy(order === "asc" ? asc(financeSettlements.dueOn) : desc(financeSettlements.dueOn))
    .limit(limit ?? 10_000);
  return rows.map((row) => ({
    recurringId: row.recurringId,
    dueOn: row.dueOn,
    status: row.status as SettlementStatus,
    expense:
      row.status === "paid" &&
      row.expenseId &&
      row.amountCents !== null &&
      row.currency &&
      row.spentOn
        ? {
            id: row.expenseId,
            amountCents: row.amountCents,
            currency: row.currency,
            exchangeRateE4: rateFromDb(row.exchangeRate),
            spentOn: row.spentOn,
          }
        : null,
  }));
}

/** The "Pagos" view for Lima's `today`: two queries (the payments, their nearby settlements). */
export async function selectPaymentsView(db: Reader, today: string): Promise<PaymentsViewData> {
  const [items, settlements] = await Promise.all([
    selectItems(db),
    selectSettlements(db, settlementRange(today)),
  ]);
  return buildPaymentsView(items, settlements, today);
}

/**
 * The pending periods of the active payments for Lima's `today` (F4's home section, the same
 * list as "Pendientes"): two queries in parallel, the active payments and the settlements of the
 * pending window. The schedule rules are `schedule.ts`'s (`pendingPeriodsOf`).
 */
export async function selectPendingPeriods(db: Reader, today: string): Promise<PendingPeriod[]> {
  const [items, settlements] = await Promise.all([
    selectItems(db, undefined, { activeOnly: true }),
    selectSettlements(db, pendingWindow(today)),
  ]);
  return pendingPeriodsOf(items, settlements, today);
}

/** What is left to pay in `month` (F3's "Pendiente de pagar"). Three small queries. */
export async function selectPendingForMonth(
  db: Reader,
  month: string,
  today: string,
): Promise<PendingForMonth> {
  const range = pendingMonthRange(month, today);
  const [items, settlements, rateE4] = await Promise.all([
    selectItems(db),
    selectSettlements(db, range),
    selectUsdToPen(db),
  ]);
  return pendingForMonth(items, settlements, month, today, rateE4);
}

/** The payment page's history shows the newest settled periods, up to this many. */
export const HISTORY_LIMIT = 120;

/** A payment's page: the payment, its next 3 due dates and its newest settled periods. */
export type RecurringDetail = {
  item: RecurringItem;
  nextDues: string[];
  history: SettlementItem[];
};

export async function selectRecurringDetail(
  db: Reader,
  id: string,
  today: string,
): Promise<RecurringDetail | null> {
  const [item, history] = await Promise.all([
    selectRecurringById(db, id),
    selectSettlements(db, { recurringId: id }, "desc", HISTORY_LIMIT),
  ]);
  if (!item) return null;
  const settled = new Set(history.map((settlement) => settlement.dueOn));
  // The next due dates still to pay (one paid ahead of time is not "next" any more); a payment
  // with installments may have fewer than 3 left.
  const nextDues: string[] = [];
  let from = today;
  while (nextDues.length < 3) {
    const due = nextOpenDue(item, from, settled);
    if (due === null) break;
    nextDues.push(due);
    from = addDays(due, 1);
  }
  return { item, nextDues, history };
}

/** The payment's row, locked FOR UPDATE (after its advisory lock), if it is visible. */
async function lockedRow(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: financeRecurringPayments.id,
      name: financeRecurringPayments.name,
      amountCents: financeRecurringPayments.amountCents,
      currency: financeRecurringPayments.currency,
      categoryId: financeRecurringPayments.categoryId,
      paymentMethodId: financeRecurringPayments.paymentMethodId,
      cycle: financeRecurringPayments.cycle,
      weekday: financeRecurringPayments.weekday,
      dayOfMonth: financeRecurringPayments.dayOfMonth,
      intervalMonths: financeRecurringPayments.intervalMonths,
      anchorMonth: financeRecurringPayments.anchorMonth,
      startDate: financeRecurringPayments.startDate,
      installmentsTotal: financeRecurringPayments.installmentsTotal,
      archivedAt: financeRecurringPayments.archivedAt,
    })
    .from(financeRecurringPayments)
    .where(and(eq(financeRecurringPayments.id, id), visibleRecurring))
    .for("update");
  return row ?? null;
}

/** A new category or method must be visible; the one it already has may stay archived. */
async function checkRefs(
  tx: Tx,
  input: { categoryId: string | null; paymentMethodId: string | null },
  existing: { categoryId: string | null; paymentMethodId: string | null } | null,
): Promise<RecurringFailure | null> {
  if (
    input.categoryId !== null &&
    input.categoryId !== existing?.categoryId &&
    !(await activeCategory(tx, input.categoryId))
  ) {
    return "categoryUnavailable";
  }
  if (
    input.paymentMethodId !== null &&
    input.paymentMethodId !== existing?.paymentMethodId &&
    !(await activeMethod(tx, input.paymentMethodId))
  ) {
    return "methodUnavailable";
  }
  return null;
}

/** "Nuevo pago recurrente". */
export async function insertRecurring(
  db: Database,
  input: CreateRecurringInput,
): Promise<RecurringItem | RecurringFailure> {
  return db.transaction(async (tx) => {
    const refused = await checkRefs(tx, input, null);
    if (refused) return refused;
    const [created] = await tx
      .insert(financeRecurringPayments)
      .values(input)
      .returning({ id: financeRecurringPayments.id });
    return (await selectRecurringById(tx, created.id)) as RecurringItem;
  });
}

const SCHEDULE_FIELDS = [
  "cycle",
  "weekday",
  "dayOfMonth",
  "intervalMonths",
  "anchorMonth",
  "startDate",
] as const;

/** The latest settled due date of a payment (paid or skipped), or null. */
async function latestSettlement(tx: Tx, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ dueOn: financeSettlements.dueOn })
    .from(financeSettlements)
    .where(eq(financeSettlements.recurringPaymentId, id))
    .orderBy(desc(financeSettlements.dueOn))
    .limit(1);
  return row?.dueOn ?? null;
}

/**
 * The schedule an edit stores when the cycle or the start changed, so that the edit never reopens
 * a period (SPEC-finance "Pagar": one expense per period):
 * - what was already covered stays covered: the new first due date comes on or after the old
 *   cycle's next due date after the latest settlement (paid on the 15th, moved to the 16th: this
 *   month's 16th is not pending, next month's is the first);
 * - moving the start earlier never brings back overdue periods: it goes no earlier than the old
 *   start or today, whichever is earlier (decisión autónoma: an edit adds no new overdue).
 * `startFrom` keeps the new cycle's dates from there on (and re-anchors every N months).
 */
async function editedSchedule<T extends Schedule>(
  tx: Tx,
  id: string,
  existing: Schedule,
  values: T,
  today: string,
): Promise<T> {
  const oldest = existing.startDate < today ? existing.startDate : today;
  let from = values.startDate > oldest ? values.startDate : oldest;
  const latest = await latestSettlement(tx, id);
  if (latest) {
    const covered = nextDueDate(existing, addDays(latest, 1));
    if (covered !== null && covered > from) from = covered;
  }
  return startFrom(values, from);
}

/**
 * The stamp of a payment's archive as text (UTC, microseconds): what the auto-close of the last
 * installment leaves in the pay's or the skip's answer, so its "Deshacer" reopens only that exact
 * archive (never one the owner made or remade by hand in between).
 */
const archiveStamp = sql<string>`to_char(${financeRecurringPayments.archivedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** How many periods a payment has settled (paid or skipped) and the latest one's due date. */
async function settledSummary(
  tx: Tx,
  id: string,
): Promise<{ count: number; latest: string | null }> {
  const [row] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${financeSettlements.dueOn})`,
    })
    .from(financeSettlements)
    .where(eq(financeSettlements.recurringPaymentId, id));
  return { count: row?.count ?? 0, latest: row?.latest ?? null };
}

/** Whether a period of a payment is settled (paid or skipped). */
async function isSettled(tx: Tx, id: string, dueOn: string): Promise<boolean> {
  return (await settlementOf(tx, id, dueOn)) !== null;
}

/**
 * Archives a payment with installments once its last one (the Nth due date) is settled, in the
 * caller's transaction, under the payment's lock. Returns the archive's stamp when it archived,
 * null when there was nothing to close (not the last installment, or already archived).
 */
async function closeIfFinished(
  tx: Tx,
  row: Schedule & { id: string; archivedAt: Date | null },
): Promise<string | null> {
  const last = lastInstallmentDue(row);
  if (last === null || row.archivedAt !== null || !(await isSettled(tx, row.id, last))) {
    return null;
  }
  const [archived] = await tx
    .update(financeRecurringPayments)
    .set({ archivedAt: sql`now()` })
    .where(
      and(eq(financeRecurringPayments.id, row.id), isNull(financeRecurringPayments.archivedAt)),
    )
    .returning({ stamp: archiveStamp });
  return archived?.stamp ?? null;
}

/**
 * Undoing a pay or a skip that closed the payment: unarchive it only if its archive is still the
 * one that pay or skip made (`stamp`). Archived again by hand, or reactivated, in between: leave it.
 */
async function reopenIfStamped(tx: Tx, id: string, stamp: string | undefined): Promise<boolean> {
  if (stamp === undefined) return false;
  const reopened = await tx
    .update(financeRecurringPayments)
    .set({ archivedAt: null })
    .where(
      and(
        eq(financeRecurringPayments.id, id),
        isNotNull(financeRecurringPayments.archivedAt),
        sql`${archiveStamp} = ${stamp}`,
      ),
    )
    .returning({ id: financeRecurringPayments.id });
  return reopened.length > 0;
}

/**
 * Edits a visible payment (the whole sheet), under its lock: a pay or skip at the same time
 * waits, so a period is never settled against a cycle that is changing. Settled periods stay as
 * they are (a due date that no longer fits the new cycle is just history), and a new cycle or
 * start never reopens a covered period (`editedSchedule`).
 */
export async function updateRecurring(
  db: Database,
  input: UpdateRecurringInput,
  today: string,
): Promise<RecurringItem | RecurringFailure | InstallmentsTooLow> {
  return db.transaction(async (tx) => {
    await lockRecurring(tx, input.id);
    const existing = await lockedRow(tx, input.id);
    if (!existing) return "notFound";
    const refused = await checkRefs(tx, input, existing);
    if (refused) return refused;
    const { id, ...chosen } = input;
    // Installments (decisiones autónomas): a payment with them stays monthly (the owner removes
    // them first), and N never goes below what is settled (F2's lesson: an edit never reopens or
    // drops a period). With periods settled the count is anchored to the start and the day, so
    // those two don't move in the same save: a new day would settle the same month twice.
    if (existing.installmentsTotal !== null && chosen.cycle !== "monthly") {
      return "installmentsKeepMonthly";
    }
    const changed = SCHEDULE_FIELDS.some((field) => existing[field] !== chosen[field]);
    if (chosen.installmentsTotal !== null) {
      const { count, latest } = await settledSummary(tx, id);
      if (count > 0) {
        if (changed) return "installmentsScheduleLocked";
        const position = latest ? (monthlyPosition(existing, latest) ?? 0) : 0;
        const min = Math.max(count, position);
        if (chosen.installmentsTotal < min) return { failure: "installmentsTooLow", min };
      }
    }
    const values = changed ? await editedSchedule(tx, id, existing, chosen, today) : chosen;
    await tx
      .update(financeRecurringPayments)
      .set(values)
      .where(eq(financeRecurringPayments.id, id));
    // N equal to what is settled (its last installment already settled) closes the payment.
    if (values.installmentsTotal !== null) await closeIfFinished(tx, { ...existing, ...values });
    return (await selectRecurringById(tx, id)) as RecurringItem;
  });
}

/**
 * Archive ("Archivar") or reactivate ("Reactivar"). Twice is fine. Reactivating starts again from
 * today (`startFrom`): the periods due while it was archived never show as overdue.
 */
export async function setRecurringArchived(
  db: Database,
  id: string,
  archived: boolean,
  today: string,
): Promise<RecurringItem | RecurringFailure> {
  return db.transaction(async (tx) => {
    await lockRecurring(tx, id);
    const existing = await lockedRow(tx, id);
    if (!existing) return "notFound";
    if (archived && existing.archivedAt === null) {
      await tx
        .update(financeRecurringPayments)
        .set({ archivedAt: sql`now()` })
        .where(eq(financeRecurringPayments.id, id));
    } else if (!archived && existing.archivedAt !== null) {
      if (existing.installmentsTotal !== null) {
        // With installments the count is anchored to the start: it stays, and the installments
        // left (including a late one) show as pending. One that was paid in full stays closed.
        const last = lastInstallmentDue(existing);
        if (last !== null && (await isSettled(tx, id, last))) return "installmentsDone";
        await tx
          .update(financeRecurringPayments)
          .set({ archivedAt: null })
          .where(eq(financeRecurringPayments.id, id));
        return (await selectRecurringById(tx, id)) as RecurringItem;
      }
      const moved = startFrom(existing, today);
      await tx
        .update(financeRecurringPayments)
        .set({ archivedAt: null, startDate: moved.startDate, anchorMonth: moved.anchorMonth })
        .where(eq(financeRecurringPayments.id, id));
    }
    return (await selectRecurringById(tx, id)) as RecurringItem;
  });
}

/**
 * Soft delete ("Deshacer" restores it): one atomic UPDATE … WHERE deleted_at IS NULL, so a second
 * delete returns null (no second "Deshacer"). Its expenses stay (with their name).
 */
export async function softDeleteRecurring(db: Database, id: string): Promise<RecurringItem | null> {
  return db.transaction(async (tx) => {
    await lockRecurring(tx, id);
    const item = await selectRecurringById(tx, id);
    if (!item) return null;
    await tx
      .update(financeRecurringPayments)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(financeRecurringPayments.id, id), visibleRecurring));
    return item;
  });
}

/** Undo of a delete: visible again, as it was. Restoring a visible one returns it. */
export async function restoreRecurring(db: Database, id: string): Promise<RecurringItem | null> {
  return db.transaction(async (tx) => {
    await lockRecurring(tx, id);
    await tx
      .update(financeRecurringPayments)
      .set({ deletedAt: null })
      .where(
        and(eq(financeRecurringPayments.id, id), isNotNull(financeRecurringPayments.deletedAt)),
      );
    return selectRecurringById(tx, id);
  });
}

/** A deleted payment's name (the "Deshacer" notice after deleting it from its page), or null. */
export async function selectDeletedRecurringName(db: Reader, id: string): Promise<string | null> {
  const [row] = await db
    .select({ name: financeRecurringPayments.name })
    .from(financeRecurringPayments)
    .where(and(eq(financeRecurringPayments.id, id), isNotNull(financeRecurringPayments.deletedAt)));
  return row?.name ?? null;
}

/**
 * Whether `dueOn` is a period that can be settled now: one of the payment's due dates (on or
 * after its start) within the pending window (the last 60 days up to the next 7).
 */
function isSettleable(
  row: NonNullable<Awaited<ReturnType<typeof lockedRow>>>,
  dueOn: string,
  today: string,
) {
  const window = pendingWindow(today);
  return dueOn >= window.from && dueOn <= window.to && isDueDate(row, dueOn);
}

/** The status of a period's settlement, if any. */
async function settlementOf(tx: Tx, id: string, dueOn: string) {
  const [row] = await tx
    .select({ status: financeSettlements.status, expenseId: financeSettlements.expenseId })
    .from(financeSettlements)
    .where(and(eq(financeSettlements.recurringPaymentId, id), eq(financeSettlements.dueOn, dueOn)))
    .for("update");
  return row ?? null;
}

const alreadySettled = (status: string): RecurringFailure =>
  status === "paid" ? "alreadyPaid" : "alreadySkipped";

/**
 * Why an archived payment can't settle a period: "Ya estaba pagado" when that period is already
 * settled (a second tap on the last installment, which archived the payment a moment ago), else
 * "archived".
 */
async function archivedFailure(tx: Tx, id: string, dueOn: string): Promise<RecurringFailure> {
  const existing = await settlementOf(tx, id, dueOn);
  return existing ? alreadySettled(existing.status) : "archived";
}

export type PaidPeriod = {
  expense: ExpenseItem;
  dueOn: string;
  name: string;
  /**
   * Set when this pay was the last installment and archived the payment (in the same
   * transaction): the stamp of that archive, which the undo hands back to reopen it.
   */
  closedStamp: string | null;
};

/**
 * "Pagado" (SPEC-finance "Pagar"), in one transaction: the payment's lock first, then the expense
 * of the period (its name as description, the amount given or the payment's, the date given or
 * Lima's today, the method given or the payment's if it is still visible, the payment's category
 * if it is still visible, its currency; a USD one stores the current rate) and the `paid`
 * settlement. A second "Pagado" of the same period answers "alreadyPaid" and writes nothing.
 *
 * Decisión autónoma: paying does not change the next loose expense's default method (that one
 * follows the expenses the owner types).
 */
export async function payPeriod(
  db: Database,
  input: PayInput,
  today: string,
): Promise<PaidPeriod | RecurringFailure> {
  try {
    return await db.transaction(async (tx) => {
      await lockRecurring(tx, input.id);
      const row = await lockedRow(tx, input.id);
      if (!row) return "notFound";
      if (row.archivedAt !== null) return archivedFailure(tx, input.id, input.dueOn);
      if (!isSettleable(row, input.dueOn, today)) return "notDue";
      const existing = await settlementOf(tx, input.id, input.dueOn);
      if (existing) return alreadySettled(existing.status);
      const amount = input.amount ?? row.amountCents;
      if (amount === null) return "variableNeedsAmount";

      let methodId: string | null = null;
      if (input.paymentMethodId === undefined) {
        if (row.paymentMethodId && (await activeMethod(tx, row.paymentMethodId))) {
          methodId = row.paymentMethodId;
        }
      } else if (input.paymentMethodId !== null) {
        if (
          input.paymentMethodId !== row.paymentMethodId &&
          !(await activeMethod(tx, input.paymentMethodId))
        ) {
          return "methodUnavailable";
        }
        methodId = input.paymentMethodId;
      }
      const categoryId =
        row.categoryId && (await activeCategory(tx, row.categoryId)) ? row.categoryId : null;
      const rate = row.currency === "USD" ? (await readSettingsIn(tx)).usdToPen : null;

      const [expense] = await tx
        .insert(financeExpenses)
        .values({
          description: row.name,
          amountCents: amount,
          currency: row.currency,
          exchangeRate: rate,
          spentOn: input.spentOn ?? today,
          categoryId,
          paymentMethodId: methodId,
          recurringPaymentId: row.id,
          recurringDueOn: input.dueOn,
        })
        .returning({ id: financeExpenses.id });
      const settled = await tx
        .insert(financeSettlements)
        .values({
          recurringPaymentId: row.id,
          dueOn: input.dueOn,
          status: "paid",
          expenseId: expense.id,
        })
        .onConflictDoNothing()
        .returning({ dueOn: financeSettlements.dueOn });
      // The primary key, behind the lock: never two expenses for one period.
      if (settled.length === 0) throw new PeriodTaken();
      // The last installment archives the payment, in this same transaction.
      const closedStamp = await closeIfFinished(tx, row);
      return {
        expense: (await selectExpenseById(tx, expense.id)) as ExpenseItem,
        dueOn: input.dueOn,
        name: row.name,
        closedStamp,
      };
    });
  } catch (error) {
    // The settlement's primary key, or the one-live-expense-per-period index, behind the lock.
    if (error instanceof PeriodTaken || isUniqueViolation(error)) return "alreadyPaid";
    throw error;
  }
}

/**
 * "Deshacer" of a pay: the expense is soft-deleted and the settlement row removed (the documented
 * exception), so the period is pending again. "notSettled" if it was already undone.
 */
export async function undoPaidPeriod(
  db: Database,
  input: UndoPaidInput,
): Promise<{ dueOn: string; reopened: boolean } | RecurringFailure> {
  return db.transaction(async (tx) => {
    await lockRecurring(tx, input.id);
    // Archived is fine (the undo of a pay right before archiving); deleted is not.
    if (!(await lockedRow(tx, input.id))) return "notFound";
    const existing = await settlementOf(tx, input.id, input.dueOn);
    // The undo is of that pay: if the period was freed and paid again meanwhile (another
    // expense), an old notice's "Deshacer" must not remove the new one.
    if (existing?.status !== "paid" || existing.expenseId !== input.expenseId) return "notSettled";
    await tx
      .delete(financeSettlements)
      .where(
        and(
          eq(financeSettlements.recurringPaymentId, input.id),
          eq(financeSettlements.dueOn, input.dueOn),
        ),
      );
    await tx
      .update(financeExpenses)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(financeExpenses.id, input.expenseId), visibleExpense));
    // The pay that closed the payment: reopen it, only if that archive is still the one in place.
    const reopened = await reopenIfStamped(tx, input.id, input.reopenStamp);
    return { dueOn: input.dueOn, reopened };
  });
}

/** "Omitir este período": the period is settled as `skipped`, with no expense. */
export async function skipPeriod(
  db: Database,
  input: PeriodInput,
  today: string,
): Promise<{ dueOn: string; name: string; closedStamp: string | null } | RecurringFailure> {
  return db.transaction(async (tx) => {
    await lockRecurring(tx, input.id);
    const row = await lockedRow(tx, input.id);
    if (!row) return "notFound";
    if (row.archivedAt !== null) return archivedFailure(tx, input.id, input.dueOn);
    if (!isSettleable(row, input.dueOn, today)) return "notDue";
    const existing = await settlementOf(tx, input.id, input.dueOn);
    if (existing) return alreadySettled(existing.status);
    await tx
      .insert(financeSettlements)
      .values({ recurringPaymentId: row.id, dueOn: input.dueOn, status: "skipped" });
    // Decisión autónoma: skipping the last installment closes the payment too (it counts as one).
    const closedStamp = await closeIfFinished(tx, row);
    return { dueOn: input.dueOn, name: row.name, closedStamp };
  });
}

/** "Deshacer" of a skip: the settlement row goes, the period is pending again. */
export async function undoSkippedPeriod(
  db: Database,
  input: UndoSkippedInput,
): Promise<{ dueOn: string; reopened: boolean } | RecurringFailure> {
  return db.transaction(async (tx) => {
    await lockRecurring(tx, input.id);
    if (!(await lockedRow(tx, input.id))) return "notFound";
    const removed = await tx
      .delete(financeSettlements)
      .where(
        and(
          eq(financeSettlements.recurringPaymentId, input.id),
          eq(financeSettlements.dueOn, input.dueOn),
          eq(financeSettlements.status, "skipped"),
        ),
      )
      .returning({ dueOn: financeSettlements.dueOn });
    if (removed.length === 0) return "notSettled";
    return { dueOn: input.dueOn, reopened: await reopenIfStamped(tx, input.id, input.reopenStamp) };
  });
}
