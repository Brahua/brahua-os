// Installments (polish → installments) against the throwaway database: a monthly payment with
// N installments never shows an (N+1)th due date; paying (or skipping) the last one archives the
// payment in the same transaction and "Deshacer" reopens it only if that archive is still there;
// two "Pagado" at once still make one expense; editing N below what is settled is refused;
// reactivating a finished plan; the export and the home summary ("Cuota 3 de 6", fixed queries).
// Made-up names and amounts only. Clock: Monday 2026-10-05 in Lima (the pending window is
// 2026-08-06 … 2026-10-12).
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { selectFinanceTodaySummary, getFinanceTodaySummary } from "@/modules/finance/contracts";
import {
  financeExpenses,
  financeRecurringPayments,
  financeSettlements,
} from "@/modules/finance/db/schema";
import {
  archiveRecurringPayment,
  createRecurringPayment,
  editRecurringPayment,
  markPaid,
  skipPeriod,
  unarchiveRecurringPayment,
  undoPaid,
  undoSkipped,
} from "@/modules/finance/payment-actions";
import { getPaymentsView, getRecurringDetail } from "@/modules/finance/payment-queries";
import { RECURRING_ERRORS } from "@/modules/finance/payments-copy";
import type { RecurringItem } from "@/modules/finance/recurring-input";
import { AUTH_ENV, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const NOW = new Date("2026-10-05T15:00:00.000Z");
const T = "2026-10-05";

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(revalidatePath).mockClear();
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`Action failed: ${JSON.stringify(result)}`);
  return result.data;
}

const FIELDS = {
  name: "Notebook",
  variable: false,
  amount: "250",
  currency: "PEN",
  categoryId: null,
  paymentMethodId: null,
  cycle: "monthly",
  weekday: null,
  dayOfMonth: 5,
  intervalMonths: null,
  anchorMonth: null,
  installmentsTotal: 2,
  // Installment 1 is September 5 (overdue by 30 days), 2 is today's October 5.
  startDate: "2026-09-05",
  notes: null,
};

async function plan(values: Record<string, unknown> = {}): Promise<RecurringItem> {
  return unwrap(await createRecurringPayment({ ...FIELDS, ...values }));
}

const edit = (id: string, values: Record<string, unknown> = {}) =>
  editRecurringPayment({ ...FIELDS, id, ...values });

const stored = async (id: string) => {
  const [row] = await testDb
    .select()
    .from(financeRecurringPayments)
    .where(eq(financeRecurringPayments.id, id));
  return row;
};
const expensesOf = (id: string) =>
  testDb.select().from(financeExpenses).where(eq(financeExpenses.recurringPaymentId, id));
const settlementsOf = (id: string) =>
  testDb.select().from(financeSettlements).where(eq(financeSettlements.recurringPaymentId, id));
const pendingDues = async (id: string) =>
  (await getPaymentsView(T)).pending
    .filter((period) => period.recurring.id === id)
    .map((period) => period.dueOn);

describe("the end of the plan", () => {
  test("it stores N and never shows an (N+1)th due date", async () => {
    const created = await plan({ installmentsTotal: 2 });
    expect(created).toMatchObject({ installmentsTotal: 2, cycle: "monthly" });
    expect((await stored(created.id)).installmentsTotal).toBe(2);
    // Sep 5 and Oct 5 are pending; Nov 5 would be a 3rd one.
    expect(await pendingDues(created.id)).toEqual(["2026-09-05", "2026-10-05"]);
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    expect(await pendingDues(created.id)).toEqual(["2026-10-05"]);
    // Nothing past the last one: not payable, not skippable, not a next due date.
    expect(await markPaid({ id: created.id, dueOn: "2026-11-05" })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.notDue,
    });
    expect((await getRecurringDetail(created.id, T))?.nextDues).toEqual(["2026-10-05"]);
  });

  test("a payment without installments is unchanged (positive control)", async () => {
    const created = await plan({ installmentsTotal: null });
    expect(created.installmentsTotal).toBeNull();
    expect((await getRecurringDetail(created.id, T))?.nextDues).toEqual([
      "2026-10-05",
      "2026-11-05",
      "2026-12-05",
    ]);
  });

  test("N is refused outside 1–120 and on another cycle, before the database", async () => {
    for (const installmentsTotal of [0, 121, 1.5]) {
      expect(await createRecurringPayment({ ...FIELDS, installmentsTotal })).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsRange] },
      });
    }
    expect(
      await createRecurringPayment({
        ...FIELDS,
        cycle: "weekly",
        weekday: 1,
        dayOfMonth: null,
        installmentsTotal: 3,
      }),
    ).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsCycle] },
    });
  });
});

describe("paying the last installment", () => {
  test("it archives the payment in the same transaction; the earlier ones don't", async () => {
    const created = await plan();
    const first = unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    expect(first.closedStamp).toBeNull();
    expect((await stored(created.id)).archivedAt).toBeNull();
    const last = unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    expect(last.closedStamp).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/));
    const row = await stored(created.id);
    expect(row.archivedAt).not.toBeNull();
    expect(await expensesOf(created.id)).toHaveLength(2);
    expect(await settlementsOf(created.id)).toHaveLength(2);
    // Archived: out of pending and of "Todos", in "Archivados".
    const view = await getPaymentsView(T);
    expect(view.pending.some((period) => period.recurring.id === created.id)).toBe(false);
    expect(view.active.some((entry) => entry.recurring.id === created.id)).toBe(false);
    expect(view.archived.map((item) => item.id)).toContain(created.id);
  });

  test("a refused pay of the last installment archives nothing", async () => {
    // A variable amount without one is refused before anything is written (the period is due).
    const variable = await plan({
      name: "Variable",
      variable: true,
      installmentsTotal: 1,
      startDate: "2026-10-05",
    });
    expect(await markPaid({ id: variable.id, dueOn: "2026-10-05" })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { amount: [RECURRING_ERRORS.variableNeedsAmount] },
    });
    expect((await stored(variable.id)).archivedAt).toBeNull();
    expect(await settlementsOf(variable.id)).toHaveLength(0);
    // Positive control: the same plan paid with its amount closes.
    const paid = unwrap(await markPaid({ id: variable.id, dueOn: "2026-10-05", amount: "80" }));
    expect(paid.closedStamp).not.toBeNull();
    expect((await stored(variable.id)).archivedAt).not.toBeNull();
  });

  test("the last while an earlier one is still pending in the window does not archive", async () => {
    const created = await plan();
    const last = unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    expect(last.closedStamp).toBeNull();
    expect((await stored(created.id)).archivedAt).toBeNull();
    // The 1st is still there: in Pagos and on the home page, as "Cuota 1 de 2".
    expect(await pendingDues(created.id)).toEqual(["2026-09-05"]);
    const home = await getFinanceTodaySummary(NOW);
    expect(home.filter((item) => item.name === "Notebook")).toMatchObject([
      { dueOn: "2026-09-05", installment: { number: 1, total: 2 } },
    ]);
    // Settling that last pending one (the 1st, not the Nth) closes the plan.
    const first = unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    expect(first.closedStamp).not.toBeNull();
    expect((await stored(created.id)).archivedAt).not.toBeNull();
  });

  test("skipping the last pending one closes it too, even if it is not the Nth", async () => {
    const created = await plan();
    expect(unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" })).closedStamp).toBeNull();
    const skipped = unwrap(await skipPeriod({ id: created.id, dueOn: "2026-09-05" }));
    expect(skipped.closedStamp).not.toBeNull();
    expect((await stored(created.id)).archivedAt).not.toBeNull();
  });

  test("earlier installments out of the 60-day window don't hold the plan open", async () => {
    // Aug 5 is 61 days back: it is never shown, so the plan closes when the 3rd is paid.
    const created = await plan({ installmentsTotal: 3, startDate: "2026-08-05" });
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    const last = unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    expect(last.closedStamp).not.toBeNull();
  });

  test("two taps at once on the last one: one expense, one archive", async () => {
    const created = await plan({ installmentsTotal: 1, startDate: "2026-10-05" });
    const results = await Promise.all([
      markPaid({ id: created.id, dueOn: "2026-10-05" }),
      markPaid({ id: created.id, dueOn: "2026-10-05" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      error: RECURRING_ERRORS.alreadyPaid,
    });
    expect(await expensesOf(created.id)).toHaveLength(1);
    expect(await settlementsOf(created.id)).toHaveLength(1);
    expect((await stored(created.id)).archivedAt).not.toBeNull();
    // Positive control: two different payments at once are two expenses.
    const a = await plan({ name: "A", installmentsTotal: 1, startDate: "2026-10-05" });
    const b = await plan({ name: "B", installmentsTotal: 1, startDate: "2026-10-05" });
    const both = await Promise.all([
      markPaid({ id: a.id, dueOn: "2026-10-05" }),
      markPaid({ id: b.id, dueOn: "2026-10-05" }),
    ]);
    expect(both.every((result) => result.ok)).toBe(true);
  });

  test("skipping the last one closes it too (it counts as an installment)", async () => {
    const created = await plan();
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    const skipped = unwrap(await skipPeriod({ id: created.id, dueOn: "2026-10-05" }));
    expect(skipped.closedStamp).not.toBeNull();
    expect((await stored(created.id)).archivedAt).not.toBeNull();
    // Skipping an earlier one while the last is pending does not.
    const other = await plan({ name: "Otro" });
    expect(unwrap(await skipPeriod({ id: other.id, dueOn: "2026-09-05" })).closedStamp).toBeNull();
    expect((await stored(other.id)).archivedAt).toBeNull();
  });
});

describe("Deshacer of the last installment", () => {
  async function closed() {
    const created = await plan();
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    const paid = unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    return { created, paid, stamp: paid.closedStamp as string };
  }

  test("it removes the pay and reactivates the payment", async () => {
    const { created, paid, stamp } = await closed();
    const undone = unwrap(
      await undoPaid({
        id: created.id,
        dueOn: "2026-10-05",
        expenseId: paid.expense.id,
        reopenStamp: stamp,
      }),
    );
    expect(undone).toEqual({ dueOn: "2026-10-05", reopened: true, stillArchived: false });
    expect((await stored(created.id)).archivedAt).toBeNull();
    // The 1st stays paid; the 2nd is pending again.
    expect(await settlementsOf(created.id)).toHaveLength(1);
    expect(await pendingDues(created.id)).toEqual(["2026-10-05"]);
    const expenses = await expensesOf(created.id);
    expect(expenses.filter((expense) => expense.deletedAt !== null)).toHaveLength(1);
    // Twice: the second finds nothing to undo and touches nothing.
    expect(
      await undoPaid({
        id: created.id,
        dueOn: "2026-10-05",
        expenseId: paid.expense.id,
        reopenStamp: stamp,
      }),
    ).toEqual({ ok: false, error: RECURRING_ERRORS.notSettled });
  });

  test("without the stamp (a pay that did not close it) the payment is left as it is", async () => {
    const { created, paid } = await closed();
    const undone = unwrap(
      await undoPaid({ id: created.id, dueOn: "2026-10-05", expenseId: paid.expense.id }),
    );
    expect(undone.reopened).toBe(false);
    expect((await stored(created.id)).archivedAt).not.toBeNull();
  });

  test("archived again by hand in between: the undo does not reopen it", async () => {
    const { created, paid, stamp } = await closed();
    // By hand: raise N, reactivate, archive again (a new archive stamp).
    unwrap(await edit(created.id, { installmentsTotal: 3 }));
    unwrap(await unarchiveRecurringPayment({ id: created.id }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    unwrap(await archiveRecurringPayment({ id: created.id }));
    const archivedAt = (await stored(created.id)).archivedAt;
    const undone = unwrap(
      await undoPaid({
        id: created.id,
        dueOn: "2026-10-05",
        expenseId: paid.expense.id,
        reopenStamp: stamp,
      }),
    );
    expect(undone.reopened).toBe(false);
    expect((await stored(created.id)).archivedAt).toEqual(archivedAt);
    // The pay itself was undone (the 1st stays paid).
    expect(await settlementsOf(created.id)).toHaveLength(1);
  });

  test("reactivated by hand in between: nothing to reopen", async () => {
    const { created, paid, stamp } = await closed();
    unwrap(await edit(created.id, { installmentsTotal: 3 }));
    unwrap(await unarchiveRecurringPayment({ id: created.id }));
    const undone = unwrap(
      await undoPaid({
        id: created.id,
        dueOn: "2026-10-05",
        expenseId: paid.expense.id,
        reopenStamp: stamp,
      }),
    );
    expect(undone.reopened).toBe(false);
    expect((await stored(created.id)).archivedAt).toBeNull();
  });

  test("edited by hand in between: the edit stays, the archive is the one to reopen", async () => {
    const { created, paid, stamp } = await closed();
    unwrap(await edit(created.id, { name: "Notebook nuevo", amount: "300", installmentsTotal: 2 }));
    const undone = unwrap(
      await undoPaid({
        id: created.id,
        dueOn: "2026-10-05",
        expenseId: paid.expense.id,
        reopenStamp: stamp,
      }),
    );
    expect(undone.reopened).toBe(true);
    expect(await stored(created.id)).toMatchObject({
      name: "Notebook nuevo",
      amountCents: 30_000,
      archivedAt: null,
    });
  });

  test("a forged or old stamp reopens nothing", async () => {
    const { created, paid } = await closed();
    const undone = unwrap(
      await undoPaid({
        id: created.id,
        dueOn: "2026-10-05",
        expenseId: paid.expense.id,
        reopenStamp: "2020-01-01T00:00:00.000000Z",
      }),
    );
    expect(undone.reopened).toBe(false);
    expect((await stored(created.id)).archivedAt).not.toBeNull();
  });

  test("another period's expense id never undoes this pay", async () => {
    const { created, stamp } = await closed();
    expect(
      await undoPaid({
        id: created.id,
        dueOn: "2026-10-05",
        expenseId: "00000000-0000-4000-8000-000000000000",
        reopenStamp: stamp,
      }),
    ).toEqual({ ok: false, error: RECURRING_ERRORS.notSettled });
    expect((await stored(created.id)).archivedAt).not.toBeNull();
    expect(await settlementsOf(created.id)).toHaveLength(2);
  });

  test("the undo of a skip that closed it reopens it the same way", async () => {
    const created = await plan();
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    const skipped = unwrap(await skipPeriod({ id: created.id, dueOn: "2026-10-05" }));
    const undone = unwrap(
      await undoSkipped({
        id: created.id,
        dueOn: "2026-10-05",
        reopenStamp: skipped.closedStamp as string,
      }),
    );
    expect(undone).toEqual({ dueOn: "2026-10-05", reopened: true, stillArchived: false });
    expect((await stored(created.id)).archivedAt).toBeNull();
    expect(await settlementsOf(created.id)).toHaveLength(1);
  });

  test("the undo of an earlier installment of an archived plan: it reopens only with its own stamp", async () => {
    const created = await plan();
    const later = unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    expect(later.closedStamp).toBeNull();
    const earlier = unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    const stamp = earlier.closedStamp as string;
    expect(stamp).not.toBeNull();
    // Undoing the 2nd (its pay did not close the plan): the period is pending again, the plan
    // stays archived and the answer says so (the copy tells the owner to reactivate it).
    const undone = unwrap(
      await undoPaid({ id: created.id, dueOn: "2026-10-05", expenseId: later.expense.id }),
    );
    expect(undone).toEqual({ dueOn: "2026-10-05", reopened: false, stillArchived: true });
    expect((await stored(created.id)).archivedAt).not.toBeNull();
    expect(await settlementsOf(created.id)).toHaveLength(1);
    // Undoing the pay that closed it, with its stamp, reopens the plan (both are pending again).
    const reopened = unwrap(
      await undoPaid({
        id: created.id,
        dueOn: "2026-09-05",
        expenseId: earlier.expense.id,
        reopenStamp: stamp,
      }),
    );
    expect(reopened).toEqual({ dueOn: "2026-09-05", reopened: true, stillArchived: false });
    expect((await stored(created.id)).archivedAt).toBeNull();
    expect(await pendingDues(created.id)).toEqual(["2026-09-05", "2026-10-05"]);
  });

  test("the undo still works after the paid expense was edited", async () => {
    const { created, paid, stamp } = await closed();
    await testDb
      .update(financeExpenses)
      .set({ amountCents: 31_000, description: "Notebook (editado)" })
      .where(eq(financeExpenses.id, paid.expense.id));
    const undone = unwrap(
      await undoPaid({
        id: created.id,
        dueOn: "2026-10-05",
        expenseId: paid.expense.id,
        reopenStamp: stamp,
      }),
    );
    expect(undone.reopened).toBe(true);
    const [expense] = await testDb
      .select()
      .from(financeExpenses)
      .where(eq(financeExpenses.id, paid.expense.id));
    expect(expense).toMatchObject({ amountCents: 31_000, deletedAt: expect.any(Date) });
  });

  test("the undo of a skip after archiving by hand again leaves it archived and says so", async () => {
    const created = await plan();
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    const skipped = unwrap(await skipPeriod({ id: created.id, dueOn: "2026-10-05" }));
    unwrap(await edit(created.id, { installmentsTotal: 3 }));
    unwrap(await unarchiveRecurringPayment({ id: created.id }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    unwrap(await archiveRecurringPayment({ id: created.id }));
    const undone = unwrap(
      await undoSkipped({
        id: created.id,
        dueOn: "2026-10-05",
        reopenStamp: skipped.closedStamp as string,
      }),
    );
    expect(undone).toEqual({ dueOn: "2026-10-05", reopened: false, stillArchived: true });
    expect((await stored(created.id)).archivedAt).not.toBeNull();
  });
});

describe("editing N and the plan", () => {
  test("N below what is settled is refused with the lowest N; equal or above is saved", async () => {
    const created = await plan({ installmentsTotal: 5 });
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    unwrap(await skipPeriod({ id: created.id, dueOn: "2026-10-05" }));
    // Two settled (one paid, one skipped): 1 is refused, saying 2 holds them.
    expect(await edit(created.id, { installmentsTotal: 1 })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsTooLow(2)] },
    });
    expect((await stored(created.id)).installmentsTotal).toBe(5);
    // Positive controls: it can grow, and it can equal what is settled (then it closes).
    expect(unwrap(await edit(created.id, { installmentsTotal: 8 })).installmentsTotal).toBe(8);
    const equal = unwrap(await edit(created.id, { installmentsTotal: 2 }));
    expect(equal).toMatchObject({ installmentsTotal: 2, archived: true });
    expect(await settlementsOf(created.id)).toHaveLength(2);
  });

  test("the position counts too: a settled 5th installment needs N of at least 5", async () => {
    // Pay the 4th installment (Oct 5) of a plan that started in July, nothing before it.
    const created = await plan({ installmentsTotal: 6, startDate: "2026-07-05" });
    unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    expect(await edit(created.id, { installmentsTotal: 3, startDate: "2026-07-05" })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsTooLow(4)] },
    });
    expect(
      unwrap(await edit(created.id, { installmentsTotal: 4, startDate: "2026-07-05" }))
        .installmentsTotal,
    ).toBe(4);
  });

  test("removing N makes it endless again; adding N to a payment with history respects it", async () => {
    const created = await plan({ installmentsTotal: 6, startDate: "2026-07-05" });
    unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    // Paid the 4th due date: N can't go below 4, but it can be removed.
    const SAME = { startDate: "2026-07-05" };
    expect(
      unwrap(await edit(created.id, { installmentsTotal: null, ...SAME })).installmentsTotal,
    ).toBeNull();
    expect((await stored(created.id)).installmentsTotal).toBeNull();
    // Adding N below the settled position is refused with the same message.
    expect(await edit(created.id, { installmentsTotal: 2, ...SAME })).toMatchObject({
      ok: false,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsTooLow(4)] },
    });
  });

  test("with periods settled the day and the start don't move in the same save", async () => {
    const created = await plan({ installmentsTotal: 5 });
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    expect(await edit(created.id, { installmentsTotal: 5, dayOfMonth: 7 })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsScheduleLocked] },
    });
    expect((await stored(created.id)).dayOfMonth).toBe(5);
    // Without installments after the edit (or without settlements) the day moves as before.
    const free = await plan({ name: "Libre", installmentsTotal: 5 });
    expect(unwrap(await edit(free.id, { installmentsTotal: 5, dayOfMonth: 7 })).dayOfMonth).toBe(7);
  });

  test("changing the cycle with the installments removed in the same save works", async () => {
    const created = await plan({ installmentsTotal: 5 });
    const weekly = unwrap(
      await edit(created.id, {
        installmentsTotal: null,
        cycle: "weekly",
        weekday: 1,
        dayOfMonth: null,
      }),
    );
    expect(weekly).toMatchObject({ cycle: "weekly", installmentsTotal: null });
    expect((await stored(created.id)).installmentsTotal).toBeNull();
    // Zod and the CHECK still refuse installments on another cycle.
    expect(
      await edit(created.id, {
        installmentsTotal: 3,
        cycle: "weekly",
        weekday: 1,
        dayOfMonth: null,
      }),
    ).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsCycle] },
    });
  });

  test("adding N to a payment with history: the day and start stay; N respects what is settled", async () => {
    const created = await plan({ installmentsTotal: null });
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    expect(await edit(created.id, { installmentsTotal: 3, dayOfMonth: 7 })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsScheduleLocked] },
    });
    // Positive control: with the schedule as it was, N is added.
    expect(unwrap(await edit(created.id, { installmentsTotal: 3 })).installmentsTotal).toBe(3);
  });

  test("N = 120 is the top: its first installment is paid; 121 is refused", async () => {
    const created = await plan({ installmentsTotal: 120 });
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    expect((await stored(created.id)).archivedAt).toBeNull();
    expect(await createRecurringPayment({ ...FIELDS, installmentsTotal: 121 })).toMatchObject({
      ok: false,
      fieldErrors: { installmentsTotal: [RECURRING_ERRORS.installmentsRange] },
    });
  });

  test("short months and the year change: the 31st clamps and the count stays", async () => {
    const feb = await plan({
      name: "Feb",
      dayOfMonth: 31,
      startDate: "2026-02-28",
      installmentsTotal: 3,
    });
    expect((await getRecurringDetail(feb.id, "2026-03-01"))?.nextDues).toEqual([
      "2026-03-31",
      "2026-04-30",
    ]);
    const year = await plan({
      name: "Año",
      dayOfMonth: 31,
      startDate: "2026-12-31",
      installmentsTotal: 3,
    });
    expect((await getRecurringDetail(year.id, "2026-12-31"))?.nextDues).toEqual([
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
    ]);
    expect((await getRecurringDetail(year.id, "2027-02-01"))?.nextDues).toEqual(["2027-02-28"]);
  });

  test("reactivating a finished plan is refused until N grows; the start stays", async () => {
    const created = await plan();
    unwrap(await markPaid({ id: created.id, dueOn: "2026-09-05" }));
    unwrap(await markPaid({ id: created.id, dueOn: "2026-10-05" }));
    expect(await unarchiveRecurringPayment({ id: created.id })).toEqual({
      ok: false,
      error: RECURRING_ERRORS.installmentsDone,
    });
    expect((await stored(created.id)).archivedAt).not.toBeNull();
    unwrap(await edit(created.id, { installmentsTotal: 4 }));
    // Still archived after editing N (an edit never reactivates), then reactivated by hand.
    expect((await stored(created.id)).archivedAt).not.toBeNull();
    const back = unwrap(await unarchiveRecurringPayment({ id: created.id }));
    expect(back).toMatchObject({ archived: false, startDate: "2026-09-05", installmentsTotal: 4 });
    // The 3rd installment is next (Nov 5); the 2nd stays paid.
    expect((await getRecurringDetail(created.id, T))?.nextDues).toEqual([
      "2026-11-05",
      "2026-12-05",
    ]);
  });

  test("an archived payment with installments that was not finished reactivates in place", async () => {
    const created = await plan({ installmentsTotal: 5 });
    unwrap(await archiveRecurringPayment({ id: created.id }));
    const back = unwrap(await unarchiveRecurringPayment({ id: created.id }));
    expect(back).toMatchObject({ archived: false, startDate: "2026-09-05" });
    // The installments left, late ones included, are pending again.
    expect(await pendingDues(created.id)).toEqual(["2026-09-05", "2026-10-05"]);
  });
});

describe("the reads", () => {
  test("Pagos, the payment page and Este mes hold the same installments", async () => {
    const created = await plan({ installmentsTotal: 3, startDate: "2026-08-05" });
    const view = await getPaymentsView(T);
    // Aug 5 is 61 days back: out of the window; Sep 5 (2nd) and Oct 5 (3rd, the last) show.
    expect(view.pending.filter((p) => p.recurring.id === created.id).map((p) => p.dueOn)).toEqual([
      "2026-09-05",
      "2026-10-05",
    ]);
    // After the last pending ones are settled (skipped) there is no next due date.
    unwrap(await skipPeriod({ id: created.id, dueOn: "2026-10-05" }));
    unwrap(await skipPeriod({ id: created.id, dueOn: "2026-09-05" }));
    const detail = await getRecurringDetail(created.id, T);
    expect(detail?.nextDues).toEqual([]);
    expect(detail?.item.archived).toBe(true);
  });

  test("a plan whose last installment fell out of the window unsettled shows as Terminado, not in Todos", async () => {
    // Installments 1–2 in the far past, never settled and out of the window: nothing to pay and
    // nobody archived it. Derived in the view: nothing is written on a read.
    const [row] = await testDb
      .insert(financeRecurringPayments)
      .values({
        name: "Viejo",
        amountCents: 1_000,
        currency: "PEN",
        cycle: "monthly",
        dayOfMonth: 5,
        startDate: "2026-01-05",
        installmentsTotal: 2,
      })
      .returning();
    const view = await getPaymentsView(T);
    expect(view.active.some((entry) => entry.recurring.id === row.id)).toBe(false);
    expect(view.thisMonth.some((entry) => entry.recurring.id === row.id)).toBe(false);
    expect(view.pending.some((period) => period.recurring.id === row.id)).toBe(false);
    expect(view.archived.find((item) => item.id === row.id)).toMatchObject({
      name: "Viejo",
      archived: false,
    });
    expect((await stored(row.id)).archivedAt).toBeNull();
    expect((await getRecurringDetail(row.id, T))?.nextDues).toEqual([]);
    // Positive control: with an installment still inside the window it stays active.
    const live = await plan({ name: "Vivo", installmentsTotal: 3, startDate: "2026-08-05" });
    expect((await getPaymentsView(T)).active.map((entry) => entry.recurring.id)).toContain(live.id);
  });

  test("the export has the new column (null without installments)", async () => {
    const created = await plan({ installmentsTotal: 6 });
    const plain = await plan({ name: "Sin cuotas", installmentsTotal: null });
    const data = await buildExport(testDb, new Date());
    expect(data.tables.finance_recurring_payments.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, installments_total: 6 }),
        expect.objectContaining({ id: plain.id, installments_total: null }),
      ]),
    );
  });
});

describe("getFinanceTodaySummary", () => {
  async function row(
    values: Partial<typeof financeRecurringPayments.$inferInsert> & { name: string },
  ) {
    const [created] = await testDb
      .insert(financeRecurringPayments)
      .values({
        amountCents: 5_000,
        currency: "PEN",
        cycle: "monthly",
        dayOfMonth: 5,
        startDate: "2026-06-05",
        ...values,
      })
      .returning();
    return created;
  }

  test("each period says its installment; payments without installments say null", async () => {
    await row({ name: "Notebook", installmentsTotal: 6 }); // Jun … Nov: Oct 5 is the 5th
    await row({ name: "Agua" });
    const items = await getFinanceTodaySummary(NOW);
    const notebook = items.filter((item) => item.name === "Notebook");
    // Sep 5 (4th) and Oct 5 (5th) are in the window.
    expect(notebook.map((item) => [item.dueOn, item.installment])).toEqual([
      ["2026-09-05", { number: 4, total: 6 }],
      ["2026-10-05", { number: 5, total: 6 }],
    ]);
    expect(
      items.filter((item) => item.name === "Agua").every((item) => item.installment === null),
    ).toBe(true);
  });

  test("a plan's last installment is the last row, and nothing after it appears", async () => {
    await row({ name: "Corto", installmentsTotal: 4 }); // Jun, Jul, Aug, Sep: ended on Sep 5
    const items = await getFinanceTodaySummary(NOW);
    expect(items.map((item) => [item.dueOn, item.installment])).toEqual([
      ["2026-09-05", { number: 4, total: 4 }],
    ]);
  });

  test("still two queries, whatever the number of plans", async () => {
    for (let index = 0; index < 6; index += 1) {
      await row({ name: `Cuotas ${index}`, installmentsTotal: 8 });
    }
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const items = await selectFinanceTodaySummary(testDb, NOW);
    expect(items).toHaveLength(12);
    expect(select).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });
});
