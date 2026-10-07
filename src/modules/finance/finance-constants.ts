// Plain constants of `finance` shared by the Zod schemas (client and server), the pure helpers
// (money.ts) and the database CHECK constraints (SPEC-finance "Modelo de datos"). No server code:
// the client imports them.

/** Every amount and expense has its own currency; the summary converts USD to PEN. */
export const CURRENCIES = ["PEN", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** F2: the cycles of a recurring payment. */
export const PAYMENT_CYCLES = ["weekly", "monthly", "every_n_months", "yearly"] as const;
export type PaymentCycle = (typeof PAYMENT_CYCLES)[number];

/** F2: a settled period of a recurring payment, paid (with its expense) or skipped (none). */
export const SETTLEMENT_STATUSES = ["paid", "skipped"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** A category's or payment method's name: 1–40 characters, unique (case-insensitive) when visible. */
export const CATALOG_NAME_MAX_LENGTH = 40;
/** F2: a recurring payment's name, 1–80. */
export const RECURRING_NAME_MAX_LENGTH = 80;
/** F2: a recurring payment's notes, 1–500. */
export const RECURRING_NOTES_MAX_LENGTH = 500;
/** Installments ("Termina después de N pagos") of a monthly payment: 1–120. */
export const INSTALLMENTS_MIN = 1;
export const INSTALLMENTS_MAX = 120;
/** An expense's optional description, 1–80. */
export const EXPENSE_DESCRIPTION_MAX_LENGTH = 80;

/** Amounts are whole cents (bigint): > 0 and ≤ 1 000 000.00. */
export const AMOUNT_MIN_CENTS = 1;
export const AMOUNT_MAX_CENTS = 100_000_000;

/**
 * The USD → PEN rate (PEN for 1 USD) has 4 decimals and lies between 1 and 10. In code it is a
 * whole number of ten-thousandths (`rateE4`: 3.7512 → 37 512), never a float.
 */
export const RATE_SCALE = 10_000;
export const RATE_DECIMALS = 4;
export const RATE_MIN_E4 = 1 * RATE_SCALE;
export const RATE_MAX_E4 = 10 * RATE_SCALE;

/** The earliest day an expense can have (anything older is a typo). */
export const EXPENSE_MIN_DAY = "2000-01-01";

/** Bounds the work a single reorder request can ask for. */
export const MAX_CATALOG_ITEMS_IN_ORDER = 500;
