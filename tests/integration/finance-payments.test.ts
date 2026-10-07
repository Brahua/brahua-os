// F2 of `finance` against the throwaway database: recurring payments (create, edit, archive,
// delete), their periods (pay once even with two taps at once, skip, undo), deleting and
// restoring a paid expense from "Mes", the reads (Pagos, the payment page, getPendingForMonth)
// and authorization. Made-up names and amounts only.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { ownerDateKey } from "@/lib/time";
import { deleteExpense, restoreExpense } from "@/modules/finance/actions";
import { FINANCE_ADVISORY_SPACE } from "@/modules/finance/catalog";
import {
  archiveCategory,
  archivePaymentMethod,
  createCategory,
  createPaymentMethod,
  setExchangeRate,
} from "@/modules/finance/catalog-actions";
import {
  financeExpenses,
  financeRecurringPayments,
  financeSettlements,
} from "@/modules/finance/db/schema";
import {
  archiveRecurringPayment,
  createRecurringPayment,
  deleteRecurringPayment,
  editRecurringPayment,
  markPaid,
  restoreRecurringPayment,
  skipPeriod,
  unarchiveRecurringPayment,
  undoPaid,
  undoSkipped,
} from "@/modules/finance/payment-actions";
import {
  getDeletedRecurringName,
  getPaymentsView,
  getPendingForMonth,
  getRecurringDetail,
} from "@/modules/finance/payment-queries";
import { RECURRING_ERRORS } from "@/modules/finance/payments-copy";
import type { RecurringItem } from "@/modules/finance/recurring-input";
import { addDays, monthOfDay, nextDueDate } from "@/modules/finance/schedule";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const MISSING = "00000000-0000-4000-8000-000000000000";
/**
 * The actions use Lima's today by the real clock: so do the tests, read once per test (a test
 * running across midnight keeps one day). The "fixed clock" block fakes it instead.
 */
let currentDay = "";
const today = () => currentDay;
/** Today's day of the month: a monthly payment on it is due today. */
const todayDay = () => Number(today().slice(8, 10));

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  currentDay = ownerDateKey(new Date());
  vi.mocked(revalidatePath).mockClear();
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`Action failed: ${JSON.stringify(result)}`);
  return result.data;
}

const FIELDS = {
  variable: false,
  amount: "50",
  currency: "PEN",
  categoryId: null,
  paymentMethodId: null,
  cycle: "monthly",
  weekday: null,
  dayOfMonth: 1,
  intervalMonths: null,
  anchorMonth: null,
  startDate: "2026-01-01",
  notes: null,
};

/** A monthly payment due today (and every month on today's day) unless told otherwise. */
async function payment(values: Record<string, unknown> = {}): Promise<RecurringItem> {
  return unwrap(
    await createRecurringPayment({
      ...FIELDS,
      name: "Internet",
      dayOfMonth: todayDay(),
      ...values,
    }),
  );
}

async function newMethod(name: string, currency: "PEN" | "USD" = "PEN") {
  return unwrap(await createPaymentMethod({ name, currency })).methods.find(
    (method) => method.name === name,
  )!;
}

async function newCategory(name: string) {
  return unwrap(await createCategory({ name })).categories.find((item) => item.name === name)!;
}

const expensesOf = (id: string) =>
  testDb.select().from(financeExpenses).where(eq(financeExpenses.recurringPaymentId, id));
const settlementsOf = (id: string) =>
  testDb.select().from(financeSettlements).where(eq(financeSettlements.recurringPaymentId, id));

describe("create and edit", () => {
  test("each cycle is stored with exactly its fields; the view lists them", async () => {
    const monthly = await payment({ name: "Mensual", dayOfMonth: 15 });
    const weekly = await payment({ name: "Semanal", cycle: "weekly", weekday: 2, dayOfMonth: 9 });
    const every = await payment({
      name: "Trimestral",
      cycle: "every_n_months",
      dayOfMonth: 5,
      intervalMonths: 3,
      anchorMonth: 3,
      weekday: 4,
    });
    const yearly = await payment({
      name: "Seguro",
      cycle: "yearly",
      dayOfMonth: 23,
      anchorMonth: 3,
      variable: true,
    });
    expect(monthly).toMatchObject({ cycle: "monthly", dayOfMonth: 15, weekday: null });
    expect(weekly).toMatchObject({ cycle: "weekly", weekday: 2, dayOfMonth: null });
    expect(every).toMatchObject({ intervalMonths: 3, anchorMonth: 3, weekday: null });
    expect(yearly).toMatchObject({ amountCents: null, anchorMonth: 3, intervalMonths: null });

    const view = await getPaymentsView(today());
    expect(view.active.map((entry) => entry.recurring.name).sort()).toEqual([
      "Mensual",
      "Seguro",
      "Semanal",
      "Trimestral",
    ]);
    // Every next due date agrees with schedule.ts.
    for (const entry of view.active) {
      expect(entry.nextDue).toBe(nextDueDate(entry.recurring, today()));
    }
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/finance", "layout");
  });

  test("a new category or method must be visible; the one it has may stay archived", async () => {
    const casa = await newCategory("Casa");
    const tarjeta = await newMethod("Tarjeta");
    const created = await payment({ categoryId: casa.id, paymentMethodId: tarjeta.id });
    await archiveCategory({ id: casa.id });
    await archivePaymentMethod({ id: tarjeta.id });
    // Editing other fields keeps the archived ones.
    const edited = unwrap(
      await editRecurringPayment({
        ...FIELDS,
        id: created.id,
        name: "Internet fibra",
        dayOfMonth: 20,
        categoryId: casa.id,
        paymentMethodId: tarjeta.id,
      }),
    );
    expect(edited).toMatchObject({ name: "Internet fibra", dayOfMonth: 20 });
    expect(edited.category?.id).toBe(casa.id);
    // A new payment can't take them.
    expect(await createRecurringPayment({ ...FIELDS, name: "Otro", categoryId: casa.id })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { categoryId: [RECURRING_ERRORS.categoryUnavailable] },
    });
  });

  test("editing waits for the payment's lock (the same as pay and skip)", async () => {
    const created = await payment();
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        FINANCE_ADVISORY_SPACE,
        created.id,
      ]);
      // Positive control: another payment's lock is free.
      const other = await payment({ name: "Otro" });
      expect(
        unwrap(await editRecurringPayment({ ...FIELDS, id: other.id, name: "Otro 2" })).name,
      ).toBe("Otro 2");
      const editing = editRecurringPayment({ ...FIELDS, id: created.id, name: "Cambiado" });
      const paying = markPaid({ id: created.id, dueOn: today() });
      await waitForLockWaiters(created.id, 2);
      const [row] = await testDb
        .select({ name: financeRecurringPayments.name })
        .from(financeRecurringPayments)
        .where(eq(financeRecurringPayments.id, created.id));
      expect(row.name).toBe("Internet");
      await holder.query("commit");
      expect((await editing).ok).toBe(true);
      await paying;
    } finally {
      holder.release();
    }
  });
});

describe("pay", () => {
  test("one tap: the period's expense with the payment's data, and its settlement", async () => {
    const tarjeta = await newMethod("Tarjeta");
    const casa = await newCategory("Casa");
    const created = await payment({
      paymentMethodId: tarjeta.id,
      categoryId: casa.id,
      amount: "59.90",
    });
    const paid = unwrap(await markPaid({ id: created.id, dueOn: today() }));
    expect(paid.expense).toMatchObject({
      description: "Internet",
      amountCents: 5990,
      currency: "PEN",
      spentOn: today(),
      category: { id: casa.id },
      paymentMethod: { id: tarjeta.id },
      recurringPaymentId: created.id,
    });
    const [stored] = await expensesOf(created.id);
    expect(stored.recurringDueOn).toBe(today());
    expect(await settlementsOf(created.id)).toMatchObject([
      { dueOn: today(), status: "paid", expenseId: stored.id },
    ]);
    // Out of pending.
    const view = await getPaymentsView(today());
    expect(
      view.pending.some((period) => period.recurring.id === created.id && period.dueOn === today()),
    ).toBe(false);
    expect(view.thisMonth.find((entry) => entry.recurring.id === created.id)).toMatchObject({
      status: "paid",
      expense: { amountCents: 5990 },
    });
  });

  test("two taps at once: one expense; the second says it was already paid", async () => {
    const created = await payment();
    const results = await Promise.all([
      markPaid({ id: created.id, dueOn: today() }),
      markPaid({ id: created.id, dueOn: today() }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      error: RECURRING_ERRORS.alreadyPaid,
    });
    expect(await expensesOf(created.id)).toHaveLength(1);
    expect(await settlementsOf(created.id)).toHaveLength(1);
    // Positive control: two different periods at once are two expenses.
    const last = addDays(today(), -1);
    const daily = await payment({ name: "Semanal", cycle: "weekly", weekday: isoOf(last) });
    const other = await payment({ name: "Semanal hoy", cycle: "weekly", weekday: isoOf(today()) });
    const both = await Promise.all([
      markPaid({ id: daily.id, dueOn: last }),
      markPaid({ id: other.id, dueOn: today() }),
    ]);
    expect(both.every((result) => result.ok)).toBe(true);
  });

  test("Pagado…: the amount, date and method given; a variable payment needs an amount", async () => {
    const yape = await newMethod("Yape");
    const luz = await payment({ name: "Luz", variable: true });
    expect(await markPaid({ id: luz.id, dueOn: today() })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { amount: [RECURRING_ERRORS.variableNeedsAmount] },
    });
    expect(await expensesOf(luz.id)).toHaveLength(0);
    const yesterday = addDays(today(), -1);
    const paid = unwrap(
      await markPaid({
        id: luz.id,
        dueOn: today(),
        amount: "1080,50",
        spentOn: yesterday,
        paymentMethodId: yape.id,
      }),
    );
    expect(paid.expense).toMatchObject({
      amountCents: 108_050,
      spentOn: yesterday,
      paymentMethod: { id: yape.id },
    });
  });

  test("a USD payment stores the current rate (or none: unconverted)", async () => {
    const claude = await payment({ name: "Suscripción", currency: "USD", amount: "20" });
    const first = unwrap(await markPaid({ id: claude.id, dueOn: today() }));
    expect(first.expense).toMatchObject({ currency: "USD", exchangeRateE4: null });
    await undoPaid({ id: claude.id, dueOn: today(), expenseId: first.expense.id });
    await setExchangeRate({ rate: "3.75" });
    const second = unwrap(await markPaid({ id: claude.id, dueOn: today() }));
    expect(second.expense).toMatchObject({ currency: "USD", exchangeRateE4: 37_500 });
  });

  test("only a due, pending period of an active payment can be paid", async () => {
    const created = await payment();
    // Not one of its due dates.
    expect(await markPaid({ id: created.id, dueOn: addDays(today(), 1) })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notDue,
    });
    // Too far back (more than 60 days).
    const old = await payment({ name: "Viejo", cycle: "weekly", weekday: isoOf(today()) });
    expect(await markPaid({ id: old.id, dueOn: addDays(today(), -63) })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notDue,
    });
    // Positive control: 56 days back is fine.
    expect((await markPaid({ id: old.id, dueOn: addDays(today(), -56) })).ok).toBe(true);
    // Archived, deleted or missing.
    await archiveRecurringPayment({ id: created.id });
    expect(await markPaid({ id: created.id, dueOn: today() })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.archived,
    });
    expect(await markPaid({ id: MISSING, dueOn: today() })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notFound,
    });
    expect(await expensesOf(created.id)).toHaveLength(0);
  });

  test("undo: the expense is deleted (logically), the period is pending again and can be paid", async () => {
    const created = await payment();
    const paid = unwrap(await markPaid({ id: created.id, dueOn: today() }));
    expect(
      unwrap(await undoPaid({ id: created.id, dueOn: today(), expenseId: paid.expense.id })),
    ).toEqual({ dueOn: today(), reopened: false, stillArchived: false });
    const [stored] = await expensesOf(created.id);
    expect(stored.id).toBe(paid.expense.id);
    expect(stored.deletedAt).not.toBeNull();
    expect(await settlementsOf(created.id)).toHaveLength(0);
    // Twice: nothing left to undo.
    expect(await undoPaid({ id: created.id, dueOn: today(), expenseId: paid.expense.id })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notSettled,
    });
    expect((await markPaid({ id: created.id, dueOn: today() })).ok).toBe(true);
  });
});

describe("skip", () => {
  test("skipped: no expense, out of pending; undo puts it back; a skipped period can't be paid", async () => {
    const created = await payment();
    expect(unwrap(await skipPeriod({ id: created.id, dueOn: today() }))).toEqual({
      dueOn: today(),
      name: "Internet",
      closedStamp: null,
    });
    expect(await settlementsOf(created.id)).toMatchObject([{ status: "skipped", expenseId: null }]);
    expect(await expensesOf(created.id)).toHaveLength(0);
    expect(await markPaid({ id: created.id, dueOn: today() })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.alreadySkipped,
    });
    expect(await skipPeriod({ id: created.id, dueOn: today() })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.alreadySkipped,
    });
    const view = await getPaymentsView(today());
    expect(view.thisMonth.find((entry) => entry.recurring.id === created.id)?.status).toBe(
      "skipped",
    );
    // An undo of a skip never removes a payment's settlement.
    expect(await undoPaid({ id: created.id, dueOn: today(), expenseId: MISSING })).toMatchObject({
      ok: false,
    });
    expect(unwrap(await undoSkipped({ id: created.id, dueOn: today() }))).toEqual({
      dueOn: today(),
      reopened: false,
      stillArchived: false,
    });
    expect(await settlementsOf(created.id)).toHaveLength(0);
    expect((await markPaid({ id: created.id, dueOn: today() })).ok).toBe(true);
    expect(await undoSkipped({ id: created.id, dueOn: today() })).toMatchObject({ ok: false });
    expect(await settlementsOf(created.id)).toHaveLength(1);
  });
});

describe("a paid expense deleted from Mes", () => {
  test("deleting it frees the period; restoring it settles the period again", async () => {
    const created = await payment();
    const { expense } = unwrap(await markPaid({ id: created.id, dueOn: today() }));
    expect((await deleteExpense({ id: expense.id })).ok).toBe(true);
    expect(await settlementsOf(created.id)).toHaveLength(0);
    let view = await getPaymentsView(today());
    expect(view.pending.some((period) => period.recurring.id === created.id)).toBe(true);
    expect((await restoreExpense({ id: expense.id })).ok).toBe(true);
    expect(await settlementsOf(created.id)).toMatchObject([
      { dueOn: today(), status: "paid", expenseId: expense.id },
    ]);
    view = await getPaymentsView(today());
    expect(
      view.pending.some((period) => period.recurring.id === created.id && period.dueOn === today()),
    ).toBe(false);
  });

  test("restoring it when the period was paid again is refused, and it stays deleted", async () => {
    const created = await payment();
    const { expense } = unwrap(await markPaid({ id: created.id, dueOn: today() }));
    await deleteExpense({ id: expense.id });
    const again = unwrap(await markPaid({ id: created.id, dueOn: today() }));
    expect(await restoreExpense({ id: expense.id })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.periodTaken,
    });
    const [old] = await testDb
      .select()
      .from(financeExpenses)
      .where(eq(financeExpenses.id, expense.id));
    expect(old.deletedAt).not.toBeNull();
    expect(await settlementsOf(created.id)).toMatchObject([{ expenseId: again.expense.id }]);
    // Skipped meanwhile: refused too.
    await undoPaid({ id: created.id, dueOn: today(), expenseId: again.expense.id });
    await skipPeriod({ id: created.id, dueOn: today() });
    expect(await restoreExpense({ id: expense.id })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.periodTaken,
    });
  });

  test("a loose expense deletes and restores as before (positive control)", async () => {
    const created = await payment();
    unwrap(await markPaid({ id: created.id, dueOn: today() }));
    const [loose] = await testDb
      .insert(financeExpenses)
      .values({ amountCents: 100, currency: "PEN", spentOn: today() })
      .returning();
    expect((await deleteExpense({ id: loose.id })).ok).toBe(true);
    expect((await restoreExpense({ id: loose.id })).ok).toBe(true);
    // The recurring one's settlement is untouched.
    expect(await settlementsOf(created.id)).toHaveLength(1);
  });
});

describe("archive and delete", () => {
  test("archived: out of pending and Todos, in Archivados; reactivated: back", async () => {
    const created = await payment();
    unwrap(await archiveRecurringPayment({ id: created.id }));
    let view = await getPaymentsView(today());
    expect(view.pending.some((period) => period.recurring.id === created.id)).toBe(false);
    expect(view.active).toHaveLength(0);
    expect(view.archived.map((item) => item.id)).toEqual([created.id]);
    expect(unwrap(await archiveRecurringPayment({ id: created.id })).archived).toBe(true);
    expect(unwrap(await unarchiveRecurringPayment({ id: created.id })).archived).toBe(false);
    view = await getPaymentsView(today());
    expect(view.active.map((entry) => entry.recurring.id)).toEqual([created.id]);
  });

  test("deleted: its expenses stay; the page is gone; restore brings it back", async () => {
    const created = await payment();
    const { expense } = unwrap(await markPaid({ id: created.id, dueOn: today() }));
    unwrap(await deleteRecurringPayment({ id: created.id }));
    expect(await deleteRecurringPayment({ id: created.id })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notFound,
    });
    expect(await getRecurringDetail(created.id, today())).toBeNull();
    expect(await getDeletedRecurringName(created.id)).toBe("Internet");
    expect((await getPaymentsView(today())).active).toHaveLength(0);
    const [kept] = await testDb
      .select()
      .from(financeExpenses)
      .where(and(eq(financeExpenses.id, expense.id)));
    expect(kept.deletedAt).toBeNull();
    expect(await markPaid({ id: created.id, dueOn: today() })).toMatchObject({ ok: false });
    unwrap(await restoreRecurringPayment({ id: created.id }));
    expect(await getDeletedRecurringName(created.id)).toBeNull();
    expect(await getRecurringDetail(created.id, today())).not.toBeNull();
  });
});

describe("reads", () => {
  test("the payment page: next 3 due dates and the history, newest first", async () => {
    const weekly = await payment({ name: "Gimnasio", cycle: "weekly", weekday: isoOf(today()) });
    unwrap(await markPaid({ id: weekly.id, dueOn: addDays(today(), -7), amount: "30" }));
    unwrap(await skipPeriod({ id: weekly.id, dueOn: today() }));
    const detail = await getRecurringDetail(weekly.id, today());
    // Today's period was skipped: the next ones left start a week later.
    expect(detail?.nextDues).toEqual([
      addDays(today(), 7),
      addDays(today(), 14),
      addDays(today(), 21),
    ]);
    expect(detail?.history).toMatchObject([
      { dueOn: today(), status: "skipped", expense: null },
      { dueOn: addDays(today(), -7), status: "paid", expense: { amountCents: 3000 } },
    ]);
    expect(await getRecurringDetail("not-a-uuid", today())).toBeNull();
    expect(await getRecurringDetail(MISSING, today())).toBeNull();
  });

  test("getPendingForMonth: this month's pending periods, in PEN", async () => {
    await setExchangeRate({ rate: "4" });
    const pen = await payment({ name: "PEN", amount: "100" });
    const usd = await payment({ name: "USD", currency: "USD", amount: "10" });
    await payment({ name: "Variable", variable: true });
    const month = monthOfDay(today());
    expect(await getPendingForMonth(month)).toEqual({
      count: 3,
      totalPenCents: 10_000 + 4000,
      unconvertedUsdCents: 0,
      variableCount: 1,
    });
    unwrap(await markPaid({ id: pen.id, dueOn: today() }));
    unwrap(await skipPeriod({ id: usd.id, dueOn: today() }));
    expect(await getPendingForMonth(month)).toEqual({
      count: 1,
      totalPenCents: 0,
      unconvertedUsdCents: 0,
      variableCount: 1,
    });
  });
});

describe("with a fixed clock (Monday 2026-10-05, 10:00 in Lima)", () => {
  // Only Date is faked, before the session (like habits' Lima-day tests).
  const T = "2026-10-05";
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T15:00:00.000Z"));
    currentDay = T;
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const pendingDues = async (id: string) =>
    (await getPaymentsView(T)).pending
      .filter((period) => period.recurring.id === id)
      .map((period) => period.dueOn);
  const stored = async (id: string) => {
    const [row] = await testDb
      .select()
      .from(financeRecurringPayments)
      .where(eq(financeRecurringPayments.id, id));
    return row;
  };

  describe("editing the cycle or the start never reopens a period", () => {
    test("paid the 10th ahead of time, moved to the 11th: this month's 11th is not pending", async () => {
      const created = await payment({ dayOfMonth: 10, startDate: "2026-10-01" });
      unwrap(await markPaid({ id: created.id, dueOn: "2026-10-10" }));
      const edited = unwrap(
        await editRecurringPayment({
          ...FIELDS,
          id: created.id,
          name: "Internet",
          dayOfMonth: 11,
          startDate: "2026-10-01",
        }),
      );
      expect(edited.startDate).toBe("2026-11-11");
      expect(await pendingDues(created.id)).toEqual([]);
      expect(await markPaid({ id: created.id, dueOn: "2026-10-11" })).toEqual({
        ok: false,
        error: RECURRING_ERRORS.notDue,
      });
      expect(await expensesOf(created.id)).toHaveLength(1);
      expect((await getRecurringDetail(created.id, T))?.nextDues[0]).toBe("2026-11-11");
    });

    test("positive control: without a settlement the new day is pending", async () => {
      const created = await payment({ dayOfMonth: 10, startDate: "2026-10-01" });
      unwrap(
        await editRecurringPayment({
          ...FIELDS,
          id: created.id,
          name: "Internet",
          dayOfMonth: 11,
          startDate: "2026-10-01",
        }),
      );
      expect(await pendingDues(created.id)).toEqual(["2026-10-11"]);
    });

    test("a skipped period counts as covered too; every N months keeps its rhythm", async () => {
      const created = await payment({
        cycle: "every_n_months",
        dayOfMonth: 10,
        intervalMonths: 3,
        anchorMonth: 10,
        startDate: "2026-10-01",
      });
      unwrap(await skipPeriod({ id: created.id, dueOn: "2026-10-10" }));
      const edited = unwrap(
        await editRecurringPayment({
          ...FIELDS,
          id: created.id,
          name: "Internet",
          cycle: "every_n_months",
          dayOfMonth: 12,
          intervalMonths: 3,
          anchorMonth: 10,
          startDate: "2026-10-01",
        }),
      );
      // The old cycle's next due date was Jan 10: the new first one is Jan 12, counted from it.
      expect(edited).toMatchObject({ startDate: "2027-01-12", anchorMonth: 1 });
      expect(await pendingDues(created.id)).toEqual([]);
      expect((await getRecurringDetail(created.id, T))?.nextDues).toEqual([
        "2027-01-12",
        "2027-04-12",
        "2027-07-12",
      ]);
    });

    test("moving the start earlier brings back no overdue periods", async () => {
      const created = await payment({ dayOfMonth: 1, startDate: T });
      const edited = unwrap(
        await editRecurringPayment({
          ...FIELDS,
          id: created.id,
          name: "Internet",
          dayOfMonth: 1,
          startDate: "2026-08-01",
        }),
      );
      expect(edited.startDate).toBe("2026-11-01");
      expect(await pendingDues(created.id)).toEqual([]);
      // Positive control: a later start is kept as chosen.
      const later = unwrap(
        await editRecurringPayment({
          ...FIELDS,
          id: created.id,
          name: "Internet",
          dayOfMonth: 1,
          startDate: "2026-12-01",
        }),
      );
      expect(later.startDate).toBe("2026-12-01");
    });

    test("an older start that was already pending stays pending (only new overdue is kept out)", async () => {
      const created = await payment({ dayOfMonth: 1, startDate: "2026-09-01" });
      expect(await pendingDues(created.id)).toEqual(["2026-09-01", "2026-10-01"]);
      unwrap(
        await editRecurringPayment({
          ...FIELDS,
          id: created.id,
          name: "Internet",
          dayOfMonth: 1,
          startDate: "2026-07-01",
        }),
      );
      expect((await stored(created.id)).startDate).toBe("2026-09-01");
      expect(await pendingDues(created.id)).toEqual(["2026-09-01", "2026-10-01"]);
    });

    test("editing only the name leaves the schedule alone", async () => {
      const created = await payment({ dayOfMonth: 10, startDate: "2026-10-01" });
      unwrap(await markPaid({ id: created.id, dueOn: "2026-10-10" }));
      const edited = unwrap(
        await editRecurringPayment({
          ...FIELDS,
          id: created.id,
          name: "Fibra",
          dayOfMonth: 10,
          startDate: "2026-10-01",
        }),
      );
      expect(edited).toMatchObject({ name: "Fibra", startDate: "2026-10-01" });
    });
  });

  test("reactivating starts again from today: nothing from the archived months is overdue", async () => {
    const created = await payment({ dayOfMonth: 1, startDate: "2026-08-01" });
    expect(await pendingDues(created.id)).toEqual(["2026-09-01", "2026-10-01"]);
    unwrap(await archiveRecurringPayment({ id: created.id }));
    const back = unwrap(await unarchiveRecurringPayment({ id: created.id }));
    expect(back.startDate).toBe("2026-11-01");
    expect(await pendingDues(created.id)).toEqual([]);
  });

  test("an old Deshacer never removes a later pay of the same period", async () => {
    const created = await payment({ dayOfMonth: 5, startDate: "2026-10-01" });
    const first = unwrap(await markPaid({ id: created.id, dueOn: T }));
    await deleteExpense({ id: first.expense.id });
    const second = unwrap(await markPaid({ id: created.id, dueOn: T }));
    expect(await undoPaid({ id: created.id, dueOn: T, expenseId: first.expense.id })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notSettled,
    });
    expect(await settlementsOf(created.id)).toMatchObject([{ expenseId: second.expense.id }]);
    // Positive control: the undo of the second one works.
    expect((await undoPaid({ id: created.id, dueOn: T, expenseId: second.expense.id })).ok).toBe(
      true,
    );
  });

  test("the undo of a pay or a skip of a deleted payment is refused; an archived one is fine", async () => {
    const created = await payment({ dayOfMonth: 5, startDate: "2026-10-01" });
    const paid = unwrap(await markPaid({ id: created.id, dueOn: T }));
    unwrap(await archiveRecurringPayment({ id: created.id }));
    expect((await undoPaid({ id: created.id, dueOn: T, expenseId: paid.expense.id })).ok).toBe(
      true,
    );
    const other = await payment({ name: "Agua", dayOfMonth: 5, startDate: "2026-10-01" });
    const otherPaid = unwrap(await markPaid({ id: other.id, dueOn: T }));
    unwrap(await deleteRecurringPayment({ id: other.id }));
    expect(await undoPaid({ id: other.id, dueOn: T, expenseId: otherPaid.expense.id })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notFound,
    });
    expect(await undoSkipped({ id: other.id, dueOn: T })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notFound,
    });
  });

  test("the window's borders: 7 days ahead and 60 back are payable; 14 ahead and 61 back are not", async () => {
    const weekly = await payment({ cycle: "weekly", weekday: 1, startDate: "2026-07-01" });
    expect((await markPaid({ id: weekly.id, dueOn: "2026-10-12" })).ok).toBe(true);
    expect(await markPaid({ id: weekly.id, dueOn: "2026-10-19" })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notDue,
    });
    const sixth = await payment({ name: "Día 6", dayOfMonth: 6, startDate: "2026-01-01" });
    const fifth = await payment({ name: "Día 5", dayOfMonth: 5, startDate: "2026-01-01" });
    expect((await markPaid({ id: sixth.id, dueOn: "2026-08-06" })).ok).toBe(true);
    expect(await markPaid({ id: fifth.id, dueOn: "2026-08-05" })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notDue,
    });
  });

  test("refusals: skip outside the window, archived or missing; edit and reactivate a deleted one", async () => {
    const created = await payment({ dayOfMonth: 5, startDate: "2026-10-01" });
    expect(await skipPeriod({ id: created.id, dueOn: "2026-10-06" })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notDue,
    });
    expect(await skipPeriod({ id: MISSING, dueOn: T })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notFound,
    });
    unwrap(await archiveRecurringPayment({ id: created.id }));
    expect(await skipPeriod({ id: created.id, dueOn: T })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.archived,
    });
    unwrap(await deleteRecurringPayment({ id: created.id }));
    expect(await editRecurringPayment({ ...FIELDS, id: created.id, name: "X" })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notFound,
    });
    expect(await unarchiveRecurringPayment({ id: created.id })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notFound,
    });
    // Restoring twice is fine.
    expect((await restoreRecurringPayment({ id: created.id })).ok).toBe(true);
    expect((await restoreRecurringPayment({ id: created.id })).ok).toBe(true);
  });

  test("pay and skip of the same period at once: one settlement", async () => {
    const created = await payment({ dayOfMonth: 5, startDate: "2026-10-01" });
    const results = await Promise.all([
      markPaid({ id: created.id, dueOn: T }),
      skipPeriod({ id: created.id, dueOn: T }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await settlementsOf(created.id)).toHaveLength(1);
    const live = (await expensesOf(created.id)).filter((row) => row.deletedAt === null);
    expect(live.length).toBe((await settlementsOf(created.id))[0].status === "paid" ? 1 : 0);
  });

  test("restore and pay of a freed period at once: never two live expenses", async () => {
    const created = await payment({ dayOfMonth: 5, startDate: "2026-10-01" });
    const first = unwrap(await markPaid({ id: created.id, dueOn: T }));
    await deleteExpense({ id: first.expense.id });
    const [restored, paid] = await Promise.all([
      restoreExpense({ id: first.expense.id }),
      markPaid({ id: created.id, dueOn: T }),
    ]);
    expect([restored.ok, paid.ok].filter(Boolean)).toHaveLength(1);
    const live = (await expensesOf(created.id)).filter((row) => row.deletedAt === null);
    expect(live).toHaveLength(1);
    expect(await settlementsOf(created.id)).toMatchObject([{ expenseId: live[0].id }]);
  });

  test("a refusal of the input alone doesn't revalidate; a stale one does", async () => {
    const luz = await payment({ name: "Luz", variable: true, dayOfMonth: 5 });
    vi.mocked(revalidatePath).mockClear();
    expect((await markPaid({ id: luz.id, dueOn: T })).ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await markPaid({ id: MISSING, dueOn: T })).ok).toBe(false);
    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe("Lima's midnight", () => {
  // 23:30 in Lima on Oct 5 is already Oct 6 in UTC. Only Date is faked; set before the session.
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T04:30:00.000Z"));
    currentDay = "2026-10-05";
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a pay at 23:30 in Lima is spent on the 5th, and the view's today is the 5th", async () => {
    const created = await payment({ dayOfMonth: 5, startDate: "2026-10-01" });
    const view = await getPaymentsView(ownerDateKey(new Date()));
    expect(view.today).toBe("2026-10-05");
    expect(view.pending.map((period) => period.dueOn)).toEqual(["2026-10-05"]);
    const paid = unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    expect(paid.expense.spentOn).toBe("2026-10-05");
    // The 6th is still the future in Lima.
    expect(
      await markPaid({ id: created.id, dueOn: "2026-10-05", spentOn: "2026-10-06" }),
    ).toMatchObject({ ok: false });
  });
});

/** ISO weekday (1 = Monday) of a key. */
function isoOf(day: string): number {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Waits until `count` connections wait on the finance advisory lock with this key. */
async function waitForLockWaiters(key: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_locks
       where locktype = 'advisory' and not granted and objsubid = 2
         and classid::bigint = $1::bigint
         and objid::bigint = (hashtext($2)::bigint & 4294967295)`,
      [FINANCE_ADVISORY_SPACE, key],
    );
    if (result.rows[0].waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} lock waiters`);
}

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every action is refused and nothing changes", async (_, headers) => {
    const created = await payment();
    request.headers = await headers();
    for (const call of [
      () => createRecurringPayment({ ...FIELDS, name: "X" }),
      () => editRecurringPayment({ ...FIELDS, id: created.id, name: "X" }),
      () => archiveRecurringPayment({ id: created.id }),
      () => unarchiveRecurringPayment({ id: created.id }),
      () => deleteRecurringPayment({ id: created.id }),
      () => restoreRecurringPayment({ id: created.id }),
      () => markPaid({ id: created.id, dueOn: today() }),
      () => undoPaid({ id: created.id, dueOn: today(), expenseId: MISSING }),
      () => skipPeriod({ id: created.id, dueOn: today() }),
      () => undoSkipped({ id: created.id, dueOn: today() }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await testDb.$count(financeRecurringPayments)).toBe(1);
    expect(await testDb.$count(financeExpenses)).toBe(0);
    expect(await testDb.$count(financeSettlements)).toBe(0);
    // Positive control: the owner's session still works.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect((await markPaid({ id: created.id, dueOn: today() })).ok).toBe(true);
  });

  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("the reads redirect to /login with %s", async (_, headers) => {
    request.headers = await headers();
    for (const read of [
      () => getPaymentsView(today()),
      () => getPendingForMonth(monthOfDay(today())),
      () => getRecurringDetail(MISSING, today()),
      () => getDeletedRecurringName(MISSING),
    ]) {
      await expect(read()).rejects.toMatchObject({
        digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
      });
    }
  });
});
