// Validation and client types of recurring payments (F2, SPEC-finance "Pagos recurrentes",
// "Ciclos", "Pagar"). Client-safe: the server actions are the authority, and the sheets run the
// same schemas first so errors show without a round trip.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { isCalendarDay, optionalRef, spentOnSchema, type ExpenseRef } from "./expense-input";
import { EXPENSE_ERRORS } from "./finance-copy";
import {
  CURRENCIES,
  PAYMENT_CYCLES,
  RECURRING_NAME_MAX_LENGTH,
  RECURRING_NOTES_MAX_LENGTH,
  type Currency,
  type PaymentCycle,
  type SettlementStatus,
} from "./finance-constants";
import { parseAmount } from "./money";
import { RECURRING_ERRORS } from "./payments-copy";

/** A recurring payment as the screens get it (never the whole row). */
export type RecurringItem = {
  id: string;
  name: string;
  /** Null: "Monto variable" (the "Pagado…" sheet asks for it). */
  amountCents: number | null;
  currency: Currency;
  category: ExpenseRef | null;
  paymentMethod: ExpenseRef | null;
  cycle: PaymentCycle;
  weekday: number | null;
  dayOfMonth: number | null;
  intervalMonths: number | null;
  anchorMonth: number | null;
  /** First due date counted (YYYY-MM-DD). */
  startDate: string;
  notes: string | null;
  archived: boolean;
};

/** The expense of a paid period, as the lists show it. */
export type SettlementExpense = {
  id: string;
  amountCents: number;
  currency: Currency;
  exchangeRateE4: number | null;
  spentOn: string;
};

/** A settled period of a recurring payment: paid (with its expense) or skipped. */
export type SettlementItem = {
  recurringId: string;
  dueOn: string;
  status: SettlementStatus;
  /** Paid only; null when skipped. */
  expense: SettlementExpense | null;
};

const id = z.uuid({ error: RECURRING_ERRORS.notFound });

const name = z
  .string({ error: RECURRING_ERRORS.nameRequired })
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, RECURRING_ERRORS.nameRequired)
      .max(RECURRING_NAME_MAX_LENGTH, RECURRING_ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), RECURRING_ERRORS.nameInvisible),
  );

/** Optional notes: trimmed (line breaks kept), empty is none. */
const notes = z
  .string({ error: RECURRING_ERRORS.notesTooLong })
  .nullable()
  .transform((value) => (value ?? "").normalize("NFC").trim())
  .pipe(
    z
      .string()
      .max(RECURRING_NOTES_MAX_LENGTH, RECURRING_ERRORS.notesTooLong)
      // Line breaks and tabs are fine in notes; other control characters are not.
      .refine(
        (value) => !hasInvisibleCharacters(value.replace(/[\n\r\t]/g, " ")),
        RECURRING_ERRORS.notesInvisible,
      )
      .transform((value) => (value === "" ? null : value)),
  );

/** A whole number in a range, or null (the cycle fields a cycle doesn't use). */
const smallInt = z.number().int().nullable().optional();

const DAY_MIN = "2000-01-01";
const DAY_MAX = "2100-12-31";

const startDate = z
  .string({ error: RECURRING_ERRORS.startInvalid })
  .refine(isCalendarDay, RECURRING_ERRORS.startInvalid)
  .refine((value) => value >= DAY_MIN && value <= DAY_MAX, RECURRING_ERRORS.startOutOfRange);

const between = (value: number | null | undefined, low: number, high: number) =>
  typeof value === "number" && value >= low && value <= high;

/** The fields of the "Pago recurrente" sheet (create and edit). */
const recurringFields = z.object({
  name,
  /** "Monto variable": the amount is ignored and stored as none. */
  variable: z.boolean({ error: RECURRING_ERRORS.amountRequired }),
  amount: z.string({ error: RECURRING_ERRORS.amountRequired }),
  currency: z.enum(CURRENCIES, { error: EXPENSE_ERRORS.currency }),
  categoryId: optionalRef(EXPENSE_ERRORS.categoryUnavailable),
  paymentMethodId: optionalRef(EXPENSE_ERRORS.methodUnavailable),
  cycle: z.enum(PAYMENT_CYCLES, { error: RECURRING_ERRORS.cycle }),
  weekday: smallInt,
  dayOfMonth: smallInt,
  intervalMonths: smallInt,
  anchorMonth: smallInt,
  startDate,
  notes,
});

type Fields = z.output<typeof recurringFields>;

/** Each cycle needs exactly its own fields (the database CHECK says the same), and an amount
 * unless it is variable. */
function checkFields(value: Fields, context: z.core.$RefinementCtx<Fields>) {
  const issue = (path: string, message: string) =>
    context.addIssue({ code: "custom", path: [path], message });
  if (value.cycle === "weekly") {
    if (!between(value.weekday, 1, 7)) issue("weekday", RECURRING_ERRORS.weekday);
  } else if (!between(value.dayOfMonth, 1, 31)) {
    issue("dayOfMonth", RECURRING_ERRORS.dayOfMonth);
  }
  if (value.cycle === "every_n_months" && !between(value.intervalMonths, 2, 12)) {
    issue("intervalMonths", RECURRING_ERRORS.intervalMonths);
  }
  if (
    (value.cycle === "every_n_months" || value.cycle === "yearly") &&
    !between(value.anchorMonth, 1, 12)
  ) {
    issue("anchorMonth", RECURRING_ERRORS.anchorMonth);
  }
  if (!value.variable) {
    const parsed = parseAmount(value.amount);
    if (!parsed.ok) {
      issue(
        "amount",
        parsed.error === "required"
          ? RECURRING_ERRORS.amountRequired
          : EXPENSE_ERRORS.amount[parsed.error],
      );
    }
  }
}

/** What the server stores: the amount in cents (null = variable) and only the cycle's fields. */
function toStored(value: Fields) {
  const amount = parseAmount(value.amount);
  const monthBased = value.cycle !== "weekly";
  return {
    name: value.name,
    amountCents: value.variable || !amount.ok ? null : amount.value,
    currency: value.currency,
    categoryId: value.categoryId,
    paymentMethodId: value.paymentMethodId,
    cycle: value.cycle,
    weekday: value.cycle === "weekly" ? (value.weekday ?? null) : null,
    dayOfMonth: monthBased ? (value.dayOfMonth ?? null) : null,
    intervalMonths: value.cycle === "every_n_months" ? (value.intervalMonths ?? null) : null,
    anchorMonth:
      value.cycle === "every_n_months" || value.cycle === "yearly"
        ? (value.anchorMonth ?? null)
        : null,
    startDate: value.startDate,
    notes: value.notes,
  };
}

/** A new recurring payment ("Nuevo pago recurrente"). */
export const createRecurringInputSchema = recurringFields
  .superRefine(checkFields)
  .transform(toStored);

/** Editing one: the whole sheet. Changing the cycle happens under the payment's lock. */
export const updateRecurringInputSchema = recurringFields
  .extend({ id })
  .superRefine(checkFields)
  .transform((value) => ({ id: value.id, ...toStored(value) }));

/** Archive, reactivate, delete and restore. */
export const recurringIdInputSchema = z.object({ id });

const dueOn = z
  .string({ error: RECURRING_ERRORS.notDue })
  .refine(isCalendarDay, RECURRING_ERRORS.notDue);

/** One period of a payment (skip, and the undo of a pay or a skip). */
export const periodInputSchema = z.object({ id, dueOn });

/**
 * "Pagado" (one tap: only the period) or "Pagado…" (the amount, date and method as adjusted).
 * What is left out comes from the payment: its amount (required for a variable one), today in
 * Lima and its method.
 */
export const payInputSchema = z.object({
  id,
  dueOn,
  amount: z
    .string({ error: EXPENSE_ERRORS.amount.required })
    .transform((value, context) => {
      const parsed = parseAmount(value);
      if (parsed.ok) return parsed.value;
      context.addIssue({ code: "custom", message: EXPENSE_ERRORS.amount[parsed.error] });
      return z.NEVER;
    })
    .optional(),
  spentOn: spentOnSchema.optional(),
  paymentMethodId: optionalRef(EXPENSE_ERRORS.methodUnavailable).optional(),
});

export type CreateRecurringInput = z.output<typeof createRecurringInputSchema>;
export type UpdateRecurringInput = z.output<typeof updateRecurringInputSchema>;
export type PayInput = z.output<typeof payInputSchema>;
export type PeriodInput = z.output<typeof periodInputSchema>;

/** The sheet's fields in the order they show (focus goes to the first invalid one). */
export const RECURRING_FIELDS = [
  "name",
  "cycle",
  "weekday",
  "dayOfMonth",
  "intervalMonths",
  "anchorMonth",
  "amount",
  "currency",
  "paymentMethodId",
  "categoryId",
  "startDate",
  "notes",
] as const;
export type RecurringField = (typeof RECURRING_FIELDS)[number];

/** The "Pagado…" sheet's fields. */
export const PAY_FIELDS = ["amount", "spentOn", "paymentMethodId"] as const;
export type PayField = (typeof PAY_FIELDS)[number];
