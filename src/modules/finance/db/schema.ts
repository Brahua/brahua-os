import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AMOUNT_MAX_CENTS,
  AMOUNT_MIN_CENTS,
  CATALOG_NAME_MAX_LENGTH,
  CURRENCIES,
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  PAYMENT_CYCLES,
  RECURRING_NAME_MAX_LENGTH,
  RECURRING_NOTES_MAX_LENGTH,
  SETTLEMENT_STATUSES,
} from "../finance-constants";

export { CURRENCIES, PAYMENT_CYCLES, SETTLEMENT_STATUSES } from "../finance-constants";

// `finance` depends on `core` only (CAPABILITY-MAP) and has its own categories (SPEC-finance
// "Áreas de vida": no life areas here). Its six tables come in F1; F2 fills the recurring
// payments and their settlements.
//
// Defense in depth behind the Zod schemas (SPEC-finance "Modelo de datos"): raw SQL, scripts or a
// bug can't store an unknown currency, cycle or status, an empty or too long text, an amount out
// of range, a cycle without exactly its own fields, a rate on a PEN expense or a paid period
// without its expense. A NULL optional column passes (a CHECK only fails on false), so the rules
// that combine columns are wrapped in coalesce(…, false), like `tasks_recurrence_check`.

/** `'a', 'b', …` for an IN list. Only for these compile-time constants, never for user input. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", "));

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));

export const financeCategories = pgTable(
  "finance_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 1–40, normalized like names
    // Manual order; contiguous under the categories lock (catalog.ts).
    sortOrder: integer("sort_order").notNull(),
    // Archive, never delete: the expenses that use it keep it.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "finance_categories_name_length_check",
      sql`char_length(${table.name}) between 1 and ${n(CATALOG_NAME_MAX_LENGTH)}`,
    ),
    // Two visible categories never share a name ("Comida" and "comida" included).
    uniqueIndex("finance_categories_name_unique")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
  ],
);

export const financePaymentMethods = pgTable(
  "finance_payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 1–40
    // What a new expense with this method is in by default ("Débito dólares" → USD).
    currency: text("currency", { enum: CURRENCIES }).notNull().default("PEN"),
    sortOrder: integer("sort_order").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "finance_payment_methods_name_length_check",
      sql`char_length(${table.name}) between 1 and ${n(CATALOG_NAME_MAX_LENGTH)}`,
    ),
    check(
      "finance_payment_methods_currency_check",
      sql`${table.currency} in (${sqlList(CURRENCIES)})`,
    ),
    uniqueIndex("finance_payment_methods_name_unique")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
  ],
);

/** F2: a fixed payment with its cycle (the table exists from F1; F2 writes it). */
export const financeRecurringPayments = pgTable(
  "finance_recurring_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 1–80
    amountCents: bigint("amount_cents", { mode: "number" }), // null = variable; 1–100 000 000
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    categoryId: uuid("category_id").references(() => financeCategories.id, {
      onDelete: "restrict",
    }),
    paymentMethodId: uuid("payment_method_id").references(() => financePaymentMethods.id, {
      onDelete: "restrict",
    }),
    cycle: text("cycle", { enum: PAYMENT_CYCLES }).notNull(),
    weekday: integer("weekday"), // ISO 1–7, weekly only
    dayOfMonth: integer("day_of_month"), // 1–31: monthly, every_n_months, yearly
    intervalMonths: integer("interval_months"), // 2–12, every_n_months only
    anchorMonth: integer("anchor_month"), // 1–12: every_n_months (first month), yearly (the month)
    startDate: date("start_date").notNull(), // first due date counted (a Lima day)
    // Cuotas (polish → installments): the payment ends after this many due dates counted from
    // `start_date` (the Nth is the last). Null: it never ends. Monthly only, 1–120.
    installmentsTotal: integer("installments_total"),
    notes: text("notes"), // ≤ 500
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Soft delete: its past expenses stay (with their name).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      // Stamped by the database clock on every Drizzle update. Raw SQL updates must set it themselves.
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    check(
      "finance_recurring_payments_name_length_check",
      sql`char_length(${table.name}) between 1 and ${n(RECURRING_NAME_MAX_LENGTH)}`,
    ),
    check(
      "finance_recurring_payments_notes_length_check",
      sql`char_length(${table.notes}) between 1 and ${n(RECURRING_NOTES_MAX_LENGTH)}`,
    ),
    check(
      "finance_recurring_payments_amount_check",
      sql`${table.amountCents} between ${n(AMOUNT_MIN_CENTS)} and ${n(AMOUNT_MAX_CENTS)}`,
    ),
    check(
      "finance_recurring_payments_currency_check",
      sql`${table.currency} in (${sqlList(CURRENCIES)})`,
    ),
    check(
      "finance_recurring_payments_cycle_check",
      sql`${table.cycle} in (${sqlList(PAYMENT_CYCLES)})`,
    ),
    // Each cycle with exactly its own fields (SPEC-finance "Ciclos"): weekly → an ISO weekday;
    // monthly → a day; every N months → a day, N (2–12) and the first month; yearly → a day and
    // its month.
    check(
      "finance_recurring_payments_cycle_rule_check",
      sql`coalesce((
        ${table.cycle} = 'weekly'
        and ${table.weekday} between 1 and 7
        and ${table.dayOfMonth} is null
        and ${table.intervalMonths} is null
        and ${table.anchorMonth} is null
      ) or (
        ${table.cycle} = 'monthly'
        and ${table.weekday} is null
        and ${table.dayOfMonth} between 1 and 31
        and ${table.intervalMonths} is null
        and ${table.anchorMonth} is null
      ) or (
        ${table.cycle} = 'every_n_months'
        and ${table.weekday} is null
        and ${table.dayOfMonth} between 1 and 31
        and ${table.intervalMonths} between 2 and 12
        and ${table.anchorMonth} between 1 and 12
      ) or (
        ${table.cycle} = 'yearly'
        and ${table.weekday} is null
        and ${table.dayOfMonth} between 1 and 31
        and ${table.intervalMonths} is null
        and ${table.anchorMonth} between 1 and 12
      ), false)`,
    ),
    // Installments exist only for the monthly cycle (a due date per month: the Nth is the last).
    check(
      "finance_recurring_payments_installments_check",
      sql`coalesce(${table.installmentsTotal} is null or (
        ${table.installmentsTotal} between 1 and 120 and ${table.cycle} = 'monthly'
      ), false)`,
    ),
    // "Todos" and "Archivados" of the Pagos view (F2).
    index("finance_recurring_payments_archived_idx")
      .on(table.archivedAt)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const financeExpenses = pgTable(
  "finance_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    description: text("description"), // ≤ 80; null shows the category
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(), // 1–100 000 000
    currency: text("currency", { enum: CURRENCIES }).notNull(),
    // PEN for 1 USD in force when it was saved (USD only). Null on a USD expense saved before a
    // rate was set: it is summed apart, "sin convertir" (SPEC-finance "Tipo de cambio").
    exchangeRate: numeric("exchange_rate", { precision: 8, scale: 4 }),
    spentOn: date("spent_on").notNull(), // a Lima day; the month it counts in
    categoryId: uuid("category_id").references(() => financeCategories.id, {
      onDelete: "restrict",
    }),
    paymentMethodId: uuid("payment_method_id").references(() => financePaymentMethods.id, {
      onDelete: "restrict",
    }),
    // F2: the recurring payment this expense paid ("Pagado"); null for a loose expense.
    recurringPaymentId: uuid("recurring_payment_id").references(() => financeRecurringPayments.id, {
      onDelete: "restrict",
    }),
    // F2: the due date of the period this expense paid (with `recurring_payment_id`, never apart).
    // Deleting the expense frees the period (its settlement row goes); restoring it needs to know
    // which period to settle again.
    recurringDueOn: date("recurring_due_on"),
    // Soft delete with "Deshacer" (`visibleExpense`).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    check(
      "finance_expenses_description_length_check",
      sql`char_length(${table.description}) between 1 and ${n(EXPENSE_DESCRIPTION_MAX_LENGTH)}`,
    ),
    check(
      "finance_expenses_amount_check",
      sql`${table.amountCents} between ${n(AMOUNT_MIN_CENTS)} and ${n(AMOUNT_MAX_CENTS)}`,
    ),
    check("finance_expenses_currency_check", sql`${table.currency} in (${sqlList(CURRENCIES)})`),
    // PEN never has a rate; USD may have one (1–10) or none yet.
    check(
      "finance_expenses_exchange_rate_check",
      sql`coalesce((
        ${table.currency} = 'PEN' and ${table.exchangeRate} is null
      ) or (
        ${table.currency} = 'USD'
        and (${table.exchangeRate} is null or ${table.exchangeRate} between 1 and 10)
      ), false)`,
    ),
    // A recurring payment's expense knows its period; a loose expense has neither.
    check(
      "finance_expenses_recurring_period_check",
      sql`(${table.recurringPaymentId} is null) = (${table.recurringDueOn} is null)`,
    ),
    // The month's list and summary.
    index("finance_expenses_spent_on_idx")
      .on(table.spentOn)
      .where(sql`${table.deletedAt} is null`),
    // F2: a recurring payment's history.
    index("finance_expenses_recurring_idx")
      .on(table.recurringPaymentId)
      .where(sql`${table.deletedAt} is null`),
    // F2: at most one live expense per period of a recurring payment (behind the payment's lock
    // and the settlements' primary key).
    uniqueIndex("finance_expenses_recurring_period_unique")
      .on(table.recurringPaymentId, table.recurringDueOn)
      .where(sql`${table.deletedAt} is null and ${table.recurringPaymentId} is not null`),
  ],
);

/**
 * F2: one row per settled period of a recurring payment (paid → its expense; skipped → none). The
 * one table with physical deletes: "Deshacer" removes the row, because it is a state and not the
 * owner's data (SPEC-finance "Pagar").
 */
export const financeSettlements = pgTable(
  "finance_settlements",
  {
    recurringPaymentId: uuid("recurring_payment_id")
      .notNull()
      .references(() => financeRecurringPayments.id, { onDelete: "restrict" }),
    dueOn: date("due_on").notNull(),
    status: text("status", { enum: SETTLEMENT_STATUSES }).notNull(),
    expenseId: uuid("expense_id").references(() => financeExpenses.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A second "Pagado" of the same period collides here: never two expenses for one period.
    primaryKey({ columns: [table.recurringPaymentId, table.dueOn] }),
    check(
      "finance_settlements_status_check",
      sql`${table.status} in (${sqlList(SETTLEMENT_STATUSES)})`,
    ),
    // paid ⇔ its expense.
    check(
      "finance_settlements_expense_check",
      sql`coalesce((
        ${table.status} = 'paid' and ${table.expenseId} is not null
      ) or (
        ${table.status} = 'skipped' and ${table.expenseId} is null
      ), false)`,
    ),
  ],
);

/** The single row of `finance`'s settings (id = 1). */
export const financeSettings = pgTable(
  "finance_settings",
  {
    id: integer("id").primaryKey().default(1),
    // PEN for 1 USD (1–10); null = not set yet.
    usdToPen: numeric("usd_to_pen", { precision: 8, scale: 4 }),
    // The method of the last expense saved: the default of the next one.
    lastPaymentMethodId: uuid("last_payment_method_id").references(() => financePaymentMethods.id, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    check("finance_settings_single_row_check", sql`${table.id} = 1`),
    check("finance_settings_usd_to_pen_check", sql`${table.usdToPen} between 1 and 10`),
  ],
);

export type FinanceCategory = typeof financeCategories.$inferSelect;
export type FinancePaymentMethod = typeof financePaymentMethods.$inferSelect;
export type FinanceExpense = typeof financeExpenses.$inferSelect;
export type NewFinanceExpense = typeof financeExpenses.$inferInsert;
