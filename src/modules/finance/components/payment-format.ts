import { formatMoney, spokenMoney } from "../money";
import { PAYMENTS_COPY } from "../payments-copy";
import type { RecurringItem } from "../recurring-input";

/** A period's key: the queue key's tail and the optimistic map's key. */
export const periodKey = (period: { recurring: { id: string }; dueOn: string }) =>
  `${period.recurring.id}:${period.dueOn}`;

/** The expected amount, or "Monto variable". */
export function expectedAmount(recurring: RecurringItem): string {
  return recurring.amountCents === null
    ? PAYMENTS_COPY.variable
    : formatMoney(recurring.amountCents, recurring.currency);
}

/** The same for screen readers ("50 soles"). */
export function spokenExpected(recurring: RecurringItem): string {
  return recurring.amountCents === null
    ? PAYMENTS_COPY.variable
    : spokenMoney(recurring.amountCents, recurring.currency);
}
