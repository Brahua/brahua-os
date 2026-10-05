// F1 of `finance`: the CHECKs, indexes and foreign keys of the six tables, with raw inserts
// (defense in depth behind Zod: scripts, raw SQL or a bug can't store an invalid row).
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  financeCategories,
  financeExpenses,
  financePaymentMethods,
  financeRecurringPayments,
  financeSettings,
  financeSettlements,
} from "@/modules/finance/db/schema";
import { testDb } from "./test-db";

let categoryId: string;
let methodId: string;
let recurringId: string;
let expenseId: string;

/** The constraint a raw statement breaks (Postgres error code and constraint name), or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

const check = (constraint: string) => ({ code: "23514", constraint });

const RECURRING = {
  name: "Netflix",
  amountCents: 5000,
  currency: "PEN",
  cycle: "monthly",
  dayOfMonth: 8,
  startDate: "2026-10-08",
} as const;

beforeEach(async () => {
  const [category] = await testDb
    .insert(financeCategories)
    .values({ name: "Comida", sortOrder: 0 })
    .returning();
  const [method] = await testDb
    .insert(financePaymentMethods)
    .values({ name: "Efectivo", sortOrder: 0 })
    .returning();
  const [recurring] = await testDb.insert(financeRecurringPayments).values(RECURRING).returning();
  const [expense] = await testDb
    .insert(financeExpenses)
    .values({ amountCents: 1250, currency: "PEN", spentOn: "2026-10-05" })
    .returning();
  categoryId = category.id;
  methodId = method.id;
  recurringId = recurring.id;
  expenseId = expense.id;
});

const category = (values: Record<string, unknown>) => () =>
  testDb
    .insert(financeCategories)
    .values({ name: "Otra", sortOrder: 1, ...values } as typeof financeCategories.$inferInsert);
const method = (values: Record<string, unknown>) => () =>
  testDb
    .insert(financePaymentMethods)
    .values({ name: "Otro", sortOrder: 1, ...values } as typeof financePaymentMethods.$inferInsert);
const expense = (values: Record<string, unknown>) => () =>
  testDb.insert(financeExpenses).values({
    amountCents: 100,
    currency: "PEN",
    spentOn: "2026-10-05",
    ...values,
  } as typeof financeExpenses.$inferInsert);
const recurring = (values: Record<string, unknown>) => () =>
  testDb
    .insert(financeRecurringPayments)
    .values({ ...RECURRING, ...values } as typeof financeRecurringPayments.$inferInsert);
const settlement = (values: Record<string, unknown>) => () =>
  testDb.insert(financeSettlements).values({
    recurringPaymentId: recurringId,
    dueOn: "2026-10-08",
    status: "skipped",
    ...values,
  } as typeof financeSettlements.$inferInsert);

describe("categories and payment methods", () => {
  test("names 1–40", async () => {
    expect(await violation(category({ name: "" }))).toEqual(
      check("finance_categories_name_length_check"),
    );
    expect(await violation(category({ name: "a".repeat(41) }))).toEqual(
      check("finance_categories_name_length_check"),
    );
    expect(await violation(category({ name: "a".repeat(40) }))).toBeNull();
    expect(await violation(method({ name: "" }))).toEqual(
      check("finance_payment_methods_name_length_check"),
    );
    expect(await violation(method({ name: "a".repeat(41) }))).toEqual(
      check("finance_payment_methods_name_length_check"),
    );
  });

  test("a method's currency is PEN or USD (PEN by default)", async () => {
    expect(await violation(method({ currency: "EUR" }))).toEqual(
      check("finance_payment_methods_currency_check"),
    );
    const [usd] = await testDb
      .insert(financePaymentMethods)
      .values({ name: "Débito dólares", currency: "USD", sortOrder: 2 })
      .returning();
    expect(usd.currency).toBe("USD");
    const [plain] = await testDb
      .select()
      .from(financePaymentMethods)
      .where(eq(financePaymentMethods.id, methodId));
    expect(plain.currency).toBe("PEN");
  });

  test("visible names are unique in any case; an archived one frees its name", async () => {
    const unique = (constraint: string) => ({ code: "23505", constraint });
    expect(await violation(category({ name: "COMIDA" }))).toEqual(
      unique("finance_categories_name_unique"),
    );
    expect(await violation(method({ name: "efectivo" }))).toEqual(
      unique("finance_payment_methods_name_unique"),
    );
    // Positive control: archived, the name is free (and two archived ones may share it).
    await testDb
      .update(financeCategories)
      .set({ archivedAt: new Date() })
      .where(eq(financeCategories.id, categoryId));
    expect(await violation(category({ name: "comida" }))).toBeNull();
    expect(await violation(category({ name: "Comida", archivedAt: new Date() }))).toBeNull();
  });
});

describe("expenses", () => {
  test("amounts 1–100 000 000 cents", async () => {
    for (const amountCents of [0, -1, 100_000_001]) {
      expect(await violation(expense({ amountCents }))).toEqual(
        check("finance_expenses_amount_check"),
      );
    }
    expect(await violation(expense({ amountCents: 1 }))).toBeNull();
    expect(await violation(expense({ amountCents: 100_000_000 }))).toBeNull();
  });

  test("currency and description", async () => {
    expect(await violation(expense({ currency: "EUR" }))).toEqual(
      check("finance_expenses_currency_check"),
    );
    expect(await violation(expense({ description: "" }))).toEqual(
      check("finance_expenses_description_length_check"),
    );
    expect(await violation(expense({ description: "a".repeat(81) }))).toEqual(
      check("finance_expenses_description_length_check"),
    );
    expect(await violation(expense({ description: "a".repeat(80) }))).toBeNull();
  });

  test("the rate: never on PEN; optional on USD, between 1 and 10", async () => {
    const rule = check("finance_expenses_exchange_rate_check");
    expect(await violation(expense({ currency: "PEN", exchangeRate: "3.7500" }))).toEqual(rule);
    expect(await violation(expense({ currency: "USD", exchangeRate: "0.9999" }))).toEqual(rule);
    expect(await violation(expense({ currency: "USD", exchangeRate: "10.0001" }))).toEqual(rule);
    expect(await violation(expense({ currency: "USD", exchangeRate: "3.7512" }))).toBeNull();
    // SPEC-finance "Tipo de cambio": without a rate set, a USD expense is stored unconverted.
    expect(await violation(expense({ currency: "USD", exchangeRate: null }))).toBeNull();
    const [row] = await testDb
      .select({ rate: financeExpenses.exchangeRate })
      .from(financeExpenses)
      .where(eq(financeExpenses.exchangeRate, "3.7512"));
    expect(row.rate).toBe("3.7512");
  });

  test("foreign keys restrict: a category, method or recurring payment in use can't go", async () => {
    await testDb
      .update(financeExpenses)
      .set({ categoryId, paymentMethodId: methodId, recurringPaymentId: recurringId })
      .where(eq(financeExpenses.id, expenseId));
    for (const statement of [
      sql`delete from finance_categories where id = ${categoryId}`,
      sql`delete from finance_payment_methods where id = ${methodId}`,
      sql`delete from finance_recurring_payments where id = ${recurringId}`,
    ]) {
      expect((await violation(() => testDb.execute(statement)))?.code).toBe("23001");
    }
    // Positive control: one nothing points at goes.
    const [free] = await testDb
      .insert(financeCategories)
      .values({ name: "Libre", sortOrder: 5 })
      .returning();
    expect(
      await violation(() =>
        testDb.execute(sql`delete from finance_categories where id = ${free.id}`),
      ),
    ).toBeNull();
    expect(
      (await violation(expense({ categoryId: "00000000-0000-4000-8000-000000000000" })))?.code,
    ).toBe("23503");
  });

  test("the indexes of the month and of a payment's history are partial (visible rows)", async () => {
    const result = await testDb.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where tablename like 'finance_%'
            and indexname not like '%_pkey' and indexname not like '%_pk'
          order by indexname`,
    );
    expect(result.rows.map((row) => row.indexname)).toEqual([
      "finance_categories_name_unique",
      "finance_expenses_recurring_idx",
      "finance_expenses_spent_on_idx",
      "finance_payment_methods_name_unique",
      "finance_recurring_payments_archived_idx",
    ]);
    for (const row of result.rows) expect(row.indexdef).toMatch(/WHERE/);
  });
});

describe("recurring payments (F2's table)", () => {
  test("each cycle with exactly its own fields", async () => {
    const rule = check("finance_recurring_payments_cycle_rule_check");
    // Valid: one of each cycle.
    expect(
      await violation(recurring({ cycle: "weekly", weekday: 1, dayOfMonth: null })),
    ).toBeNull();
    expect(await violation(recurring({}))).toBeNull();
    expect(
      await violation(recurring({ cycle: "every_n_months", intervalMonths: 3, anchorMonth: 2 })),
    ).toBeNull();
    expect(
      await violation(recurring({ cycle: "yearly", dayOfMonth: 23, anchorMonth: 3 })),
    ).toBeNull();
    // Missing or extra fields (a missing one must not slip through as NULL).
    for (const values of [
      { cycle: "weekly", dayOfMonth: null },
      { cycle: "weekly", weekday: 8, dayOfMonth: null },
      { cycle: "weekly", weekday: 1 },
      { cycle: "monthly", dayOfMonth: null },
      { cycle: "monthly", dayOfMonth: 32 },
      { cycle: "monthly", anchorMonth: 2 },
      { cycle: "every_n_months", intervalMonths: 3 },
      { cycle: "every_n_months", anchorMonth: 3 },
      { cycle: "every_n_months", intervalMonths: 1, anchorMonth: 3 },
      { cycle: "every_n_months", intervalMonths: 13, anchorMonth: 3 },
      { cycle: "yearly", anchorMonth: null },
      { cycle: "yearly", anchorMonth: 13 },
      { cycle: "yearly", anchorMonth: 3, intervalMonths: 12 },
    ]) {
      expect(await violation(recurring(values)), JSON.stringify(values)).toEqual(rule);
    }
    expect(await violation(recurring({ cycle: "daily" }))).toEqual(
      check("finance_recurring_payments_cycle_check"),
    );
  });

  test("amounts (null = variable), names, notes and currency", async () => {
    expect(await violation(recurring({ amountCents: null }))).toBeNull();
    expect(await violation(recurring({ amountCents: 0 }))).toEqual(
      check("finance_recurring_payments_amount_check"),
    );
    expect(await violation(recurring({ name: "" }))).toEqual(
      check("finance_recurring_payments_name_length_check"),
    );
    expect(await violation(recurring({ name: "a".repeat(81) }))).toEqual(
      check("finance_recurring_payments_name_length_check"),
    );
    expect(await violation(recurring({ notes: "a".repeat(501) }))).toEqual(
      check("finance_recurring_payments_notes_length_check"),
    );
    expect(await violation(recurring({ currency: "EUR" }))).toEqual(
      check("finance_recurring_payments_currency_check"),
    );
  });
});

describe("settlements and settings", () => {
  test("paid ⇔ its expense; one row per period", async () => {
    const rule = check("finance_settlements_expense_check");
    expect(await violation(settlement({ status: "paid" }))).toEqual(rule);
    expect(await violation(settlement({ status: "skipped", expenseId }))).toEqual(rule);
    // An unknown status breaks both rules (whichever Postgres checks first).
    expect([check("finance_settlements_status_check"), rule]).toContainEqual(
      await violation(settlement({ status: "late" })),
    );
    expect(await violation(settlement({ status: "paid", expenseId }))).toBeNull();
    // A second settlement of the same period collides with the primary key.
    expect(await violation(settlement({}))).toEqual({
      code: "23505",
      constraint: "finance_settlements_recurring_payment_id_due_on_pk",
    });
  });

  test("a single row (id 1) with a rate between 1 and 10", async () => {
    expect(await violation(() => testDb.insert(financeSettings).values({ id: 2 }))).toEqual(
      check("finance_settings_single_row_check"),
    );
    expect(
      await violation(() => testDb.insert(financeSettings).values({ id: 1, usdToPen: "0.5" })),
    ).toEqual(check("finance_settings_usd_to_pen_check"));
    expect(
      await violation(() => testDb.insert(financeSettings).values({ id: 1, usdToPen: "3.75" })),
    ).toBeNull();
    expect(await violation(() => testDb.insert(financeSettings).values({}))).toEqual({
      code: "23505",
      constraint: "finance_settings_pkey",
    });
  });
});
