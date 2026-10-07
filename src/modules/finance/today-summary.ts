// What `finance` shows on the home page (F4, SPEC-finance "Contratos" → "Con `today`"). Pure and
// client-safe: the contract (contracts.ts, server-only) builds these rows from F2's pending
// periods, and `today`'s "Pagos" section and its rows read them.
import type { Currency } from "./finance-constants";
import type { RecurringItem } from "./recurring-input";
import type { PendingPeriod } from "./payments-view";
import { installmentNumber } from "./schedule";

/** A pending period of an active recurring payment, as the home page shows it. */
export type FinanceTodayItem = {
  recurringId: string;
  name: string;
  /** The period's due date (YYYY-MM-DD, Lima): overdue (≤ 60 days) or due within 7 days. */
  dueOn: string;
  /** The expected amount in cents; null: "Monto variable" ("Pagado…" asks for it). */
  amountCents: number | null;
  currency: Currency;
  paymentMethod: { id: string; name: string } | null;
  /** "Cuota 3 de 6": this period's number and the total; null for a payment with no installments. */
  installment: { number: number; total: number } | null;
};

/** A row's stable key (the same period never shows twice): `<recurring id>:<due date>`. */
export const financeTodayKey = (item: Pick<FinanceTodayItem, "recurringId" | "dueOn">) =>
  `${item.recurringId}:${item.dueOn}`;

/** The installment a period is ("Cuota 3 de 6"), or null when the payment has none. */
export function installmentOf(
  recurring: RecurringItem,
  dueOn: string,
): { number: number; total: number } | null {
  const number = installmentNumber(recurring, dueOn);
  return number !== null && recurring.installmentsTotal
    ? { number, total: recurring.installmentsTotal }
    : null;
}

/** The rows of the home page, in the pending list's order (by due date, then name). */
export function toFinanceTodayItems(pending: readonly PendingPeriod[]): FinanceTodayItem[] {
  return pending.map(({ recurring, dueOn }) => ({
    recurringId: recurring.id,
    name: recurring.name,
    dueOn,
    amountCents: recurring.amountCents,
    currency: recurring.currency,
    paymentMethod: recurring.paymentMethod,
    installment: installmentOf(recurring, dueOn),
  }));
}

/**
 * Whether a period keeps "Día completo" from showing (SPEC-finance: only overdue or due today;
 * the upcoming ones don't).
 */
export const blocksDay = (item: Pick<FinanceTodayItem, "dueOn">, today: string) =>
  item.dueOn <= today;
