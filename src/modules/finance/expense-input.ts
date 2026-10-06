// Validation and client types of expenses (SPEC-finance "Gastos sueltos", "Valores por
// defecto"). Client-safe: the server actions are the authority, and the expense form runs the
// same schemas first so errors show without a round trip.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { ownerDateKey } from "@/lib/time";
import { EXPENSE_ERRORS } from "./finance-copy";
import {
  CURRENCIES,
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  EXPENSE_MIN_DAY,
  type Currency,
} from "./finance-constants";
import { parseAmount } from "./money";

/** A category or payment method as an expense shows it (it may be archived since). */
export type ExpenseRef = { id: string; name: string };

/** What the screens get of an expense (never the whole row). */
export type ExpenseItem = {
  id: string;
  /** Null: the list shows the category instead (or "Sin categoría"). */
  description: string | null;
  amountCents: number;
  currency: Currency;
  /** USD only: PEN for 1 USD in ten-thousandths, stored when it was saved; null without a rate. */
  exchangeRateE4: number | null;
  /** The Lima day it counts on (YYYY-MM-DD). */
  spentOn: string;
  category: ExpenseRef | null;
  paymentMethod: ExpenseRef | null;
  /** F2: the recurring payment it paid ("Recurrente" in the list); null for a loose expense. */
  recurringPaymentId: string | null;
};

/** The amount as typed ("12,50") in cents. */
const amount = z.string({ error: EXPENSE_ERRORS.amount.required }).transform((value, context) => {
  const parsed = parseAmount(value);
  if (parsed.ok) return parsed.value;
  context.addIssue({ code: "custom", message: EXPENSE_ERRORS.amount[parsed.error] });
  return z.NEVER;
});

/** Optional: normalized like a name; empty is none (null). */
const description = z
  .string({ error: EXPENSE_ERRORS.descriptionTooLong })
  .nullable()
  .transform((value) => (value === null ? "" : normalizeName(value)))
  .pipe(
    z
      .string()
      .max(EXPENSE_DESCRIPTION_MAX_LENGTH, EXPENSE_ERRORS.descriptionTooLong)
      .refine((value) => !hasInvisibleCharacters(value), EXPENSE_ERRORS.descriptionInvisible)
      .transform((value) => (value === "" ? null : value)),
  );

/** A category or method: an id, or "" / null for none. */
export const optionalRef = (message: string) =>
  z
    .union([z.uuid({ error: message }), z.literal(""), z.null()], { error: message })
    .transform((value) => (value === "" ? null : value));

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day (YYYY-MM-DD): "2026-02-30" is not one. */
export function isCalendarDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The Lima day it was spent: a real day from 2000 on and never after today in Lima (an expense
 * is what already left the account; F2's "Pagado…" uses the same rule).
 */
export const spentOnSchema = z
  .string({ error: EXPENSE_ERRORS.dateInvalid })
  .refine(isCalendarDay, EXPENSE_ERRORS.dateInvalid)
  .refine((value) => value >= EXPENSE_MIN_DAY, EXPENSE_ERRORS.dateTooOld)
  .refine((value) => value <= ownerDateKey(new Date()), EXPENSE_ERRORS.dateFuture);

const currency = z.enum(CURRENCIES, { error: EXPENSE_ERRORS.currency });

/**
 * A new expense: the amount is all it needs (SPEC-finance "Valores por defecto"). A field left
 * out takes its default on the server: today in Lima, the method of the last expense saved (if it
 * is still visible), the method's currency (PEN without one) and no category. Sent as null (or
 * ""), a category or method is none on purpose.
 */
export const createExpenseInputSchema = z.object({
  amount,
  description: description.optional(),
  currency: currency.optional(),
  categoryId: optionalRef(EXPENSE_ERRORS.categoryUnavailable).optional(),
  paymentMethodId: optionalRef(EXPENSE_ERRORS.methodUnavailable).optional(),
  spentOn: spentOnSchema.optional(),
});

/** Editing an expense: the whole form. */
export const updateExpenseInputSchema = z.object({
  id: z.uuid({ error: EXPENSE_ERRORS.notFound }),
  amount,
  description,
  currency,
  categoryId: optionalRef(EXPENSE_ERRORS.categoryUnavailable),
  paymentMethodId: optionalRef(EXPENSE_ERRORS.methodUnavailable),
  spentOn: spentOnSchema,
});

/** Delete and restore. */
export const expenseIdInputSchema = z.object({ id: z.uuid({ error: EXPENSE_ERRORS.notFound }) });

export type CreateExpenseInput = z.output<typeof createExpenseInputSchema>;
export type UpdateExpenseInput = z.output<typeof updateExpenseInputSchema>;

/** The form's fields, in the order they show (focus goes to the first invalid one). */
export const EXPENSE_FIELDS = [
  "amount",
  "description",
  "categoryId",
  "paymentMethodId",
  "currency",
  "spentOn",
] as const;
export type ExpenseField = (typeof EXPENSE_FIELDS)[number];
