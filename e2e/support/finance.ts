// Shared helpers for the finance specs. Never real financial data: made-up names and amounts.
import { eq, sql } from "drizzle-orm";
import { expect, test as base, type Page } from "@playwright/test";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import {
  financeCategories,
  financeExpenses,
  financePaymentMethods,
  financeRecurringPayments,
  financeSettings,
  financeSettlements,
} from "@/modules/finance/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";

/**
 * `test` for every finance spec. The month's list, the last method used (the next expense's
 * default) and the rate are shared by every test, so these tests can't run in parallel with each
 * other: each one holds a Postgres advisory lock, on a connection of its own, for the whole test,
 * and starts from empty finance tables (`clearFinance`).
 */
export const test = base.extend<{ financeLock: void }>({
  financeLock: [
    // Playwright requires the object pattern for the (unused) fixtures argument.
    async ({}, provide) => {
      const client = new Client({ connectionString: testDatabaseUrl() });
      await client.connect();
      await client.query("select pg_advisory_lock(hashtext('e2e_finance'))");
      await clearFinance();
      // Fixture teardown runs after a failed test too; ending the session releases the lock.
      await provide();
      await client.end();
    },
    // Waiting for the lock is not the test's time.
    { auto: true, timeout: 240_000 },
  ],
});

export { expect };

async function withDb<T>(run: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const db = createDb(testDatabaseUrl());
  try {
    return await run(db);
  } finally {
    await db.$client.end();
  }
}

/** Empty finance tables (the throwaway test database only). */
export function clearFinance() {
  return withDb((db) =>
    db.execute(
      sql`truncate finance_settlements, finance_expenses, finance_settings,
          finance_recurring_payments, finance_payment_methods, finance_categories`,
    ),
  );
}

/** A payment method; `last`: the default of the next expense. Returns its id. */
export function insertMethod(name: string, currency: "PEN" | "USD" = "PEN", last = false) {
  return withDb(async (db) => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(financePaymentMethods);
    const [row] = await db
      .insert(financePaymentMethods)
      .values({ name, currency, sortOrder: count })
      .returning({ id: financePaymentMethods.id });
    if (last) {
      await db
        .insert(financeSettings)
        .values({ id: 1, lastPaymentMethodId: row.id })
        .onConflictDoUpdate({ target: financeSettings.id, set: { lastPaymentMethodId: row.id } });
    }
    return row.id;
  });
}

/** A category at the end. Returns its id. */
export function insertCategory(name: string) {
  return withDb(async (db) => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(financeCategories);
    const [row] = await db
      .insert(financeCategories)
      .values({ name, sortOrder: count })
      .returning({ id: financeCategories.id });
    return row.id;
  });
}

type NewExpense = {
  description?: string;
  amountCents: number;
  currency?: "PEN" | "USD";
  exchangeRate?: string;
  /** YYYY-MM-DD; today in Lima by default. */
  spentOn: string;
  categoryId?: string;
  paymentMethodId?: string;
};

/** An expense straight in the database. Returns its id. */
export function insertExpense(expense: NewExpense) {
  return withDb(async (db) => {
    const [row] = await db
      .insert(financeExpenses)
      .values({ currency: "PEN", ...expense })
      .returning({ id: financeExpenses.id });
    return row.id;
  });
}

/** The expenses with this description, as stored (deleted ones too). */
export function readExpenses(description: string) {
  return withDb((db) =>
    db.select().from(financeExpenses).where(eq(financeExpenses.description, description)),
  );
}

/** Every expense as stored. */
export function readAllExpenses() {
  return withDb((db) => db.select().from(financeExpenses));
}

/** Opens a page and waits until the navigation is hydrated (keys and clicks reach React). */
export async function openReady(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible" });
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

export const expenseSheet = (page: Page, name = "Nuevo gasto") =>
  page.getByRole("dialog", { name });
export const amountField = (page: Page) =>
  expenseSheet(page).getByRole("textbox", { name: "Monto" });
export const expenseStatus = (page: Page) => expenseSheet(page).locator("[data-expense-status]");
export const financeNotices = (page: Page) =>
  page.getByRole("region", { name: "Avisos de Finanzas" });
/** A row of the month, by the start of its accessible name ("Editar Café, S/ 12.50…"). */
export const expenseRow = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(`^Editar ${label},`) });
/** The capture key that is on screen (bottom bar on the phone, sidebar on the desktop). */
export const captureKey = (page: Page) =>
  page.getByRole("button", { name: "Capturar" }).filter({ visible: true });

type NewRecurring = {
  name: string;
  /** Null: "Monto variable". */
  amountCents?: number | null;
  currency?: "PEN" | "USD";
  cycle?: "weekly" | "monthly" | "every_n_months" | "yearly";
  weekday?: number | null;
  /** Today's day of the month (Lima) by default: a monthly payment due today. */
  dayOfMonth?: number | null;
  intervalMonths?: number | null;
  anchorMonth?: number | null;
  startDate?: string;
  paymentMethodId?: string;
  archived?: boolean;
};

/** A recurring payment straight in the database (monthly, due today from today, S/ 50 by default). */
export function insertRecurring({ archived, ...values }: NewRecurring) {
  return withDb(async (db) => {
    const [row] = await db
      .insert(financeRecurringPayments)
      .values({
        amountCents: 5_000,
        currency: "PEN",
        cycle: "monthly",
        dayOfMonth: Number(ownerDateKey(new Date()).slice(8, 10)),
        // From today: nothing overdue from earlier months.
        startDate: ownerDateKey(new Date()),
        ...values,
        archivedAt: archived ? new Date() : null,
      })
      .returning({ id: financeRecurringPayments.id });
    return row.id;
  });
}

/** A recurring payment as stored, by name (deleted ones too). */
export function readRecurring(name: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select()
      .from(financeRecurringPayments)
      .where(eq(financeRecurringPayments.name, name));
    return row ?? null;
  });
}

/** The settled periods of a recurring payment. */
export function readSettlements(recurringId: string) {
  return withDb((db) =>
    db
      .select()
      .from(financeSettlements)
      .where(eq(financeSettlements.recurringPaymentId, recurringId)),
  );
}

/** The expenses that paid periods of a recurring payment (deleted ones too). */
export function readRecurringExpenses(recurringId: string) {
  return withDb((db) =>
    db.select().from(financeExpenses).where(eq(financeExpenses.recurringPaymentId, recurringId)),
  );
}

/** Opens /finance on "Pagos" (the switch remembers it on the device). */
export async function openPayments(page: Page) {
  await openReady(page, "/finance");
  await page.getByRole("tab", { name: "Pagos" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Pendientes" })).toBeVisible();
}

/** A pending row's "Pagado" key (one tap) or "Pagado…" (variable), by the payment's name. */
export const payKey = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^Pagado(, con monto)?: ${name},`) });
