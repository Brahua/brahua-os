"use client";

import Link from "next/link";
import { useId } from "react";
import { Key, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import { formatMoney, spokenMoney } from "../money";
import { dueState, isUrgent, PAYMENTS_COPY } from "../payments-copy";
import { recurringPaymentPath } from "../routes";
import { financeTodayKey, type FinanceTodayItem } from "../today-summary";

/** A home row's "Pagado" key: where focus goes when a neighbor leaves. */
export const paymentTodayPaySelector = (key: string) => `[data-pay-today="${CSS.escape(key)}"]`;

/** Whether a row pays with the sheet ("Pagado…"): the amount is variable. */
export const paysWithSheet = (item: Pick<FinanceTodayItem, "amountCents">) =>
  item.amountCents === null;

type PaymentTodayRowProps = {
  item: FinanceTodayItem;
  /** Lima's today (YYYY-MM-DD): "Vence hoy", "Venció hace 3 días", "Vence el jue 9". */
  today: string;
  /**
   * "Pagado": one tap pays (the caller removes the row and saves); with a variable amount it is
   * "Pagado…" and the caller opens the sheet (`element` is where focus returns).
   */
  onPay: (item: FinanceTodayItem, element: HTMLButtonElement) => void;
  /**
   * A save of this period is in flight (an undo putting it back): the key stays focusable and
   * says so with `aria-disabled`, and a tap does nothing (never `disabled` on a focused control).
   */
  busy?: boolean;
};

/**
 * A pending period of `getFinanceTodaySummary` (F4) on another module's screen (`today`'s
 * "Pagos"), as "Pendientes" draws it: the name linking to the payment's page, the due date ("Vence
 * hoy" and overdue in the signal color with a LED, never red), the expected amount ("Monto
 * variable" without one), the method, and "Pagado" / "Pagado…". The visible metadata is
 * aria-hidden; the name is described in words ("Vence hoy, 50 soles, Crédito"). The `<li>` is
 * the caller's.
 */
export function PaymentTodayRow({ item, today, onPay, busy = false }: PaymentTodayRowProps) {
  const metaId = useId();
  const due = dueState(item.dueOn, today);
  const urgent = isUrgent(due);
  const variable = paysWithSheet(item);
  const key = financeTodayKey(item);
  const amount =
    item.amountCents === null
      ? PAYMENTS_COPY.variable
      : formatMoney(item.amountCents, item.currency);
  const spokenAmount =
    item.amountCents === null
      ? PAYMENTS_COPY.variable
      : spokenMoney(item.amountCents, item.currency);

  return (
    <div className="bo-row bo-row--static bo-payment-row" data-payment-today={key}>
      <span className="bo-row__body">
        <Link
          href={recurringPaymentPath(item.recurringId)}
          prefetch={false}
          className="bo-task-title bo-row-link bo-row__title w-fit"
          aria-describedby={metaId}
        >
          {item.name}
        </Link>
        <span id={metaId} hidden>
          {[due.spoken, spokenAmount, item.paymentMethod?.name].filter(Boolean).join(", ")}
        </span>
        <span aria-hidden className="bo-text-body-sm flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              urgent ? "text-signal-text" : "text-text-secondary",
            )}
            data-due={due.kind}
          >
            {urgent ? <Led signal on size="sm" /> : null}
            {due.label}
          </span>
          <span className="bo-amount text-text">{amount}</span>
          {item.paymentMethod ? (
            <span className="text-text-secondary">{item.paymentMethod.name}</span>
          ) : null}
        </span>
      </span>
      <span className="bo-row__trail">
        <Key
          // The signal key only where attention is due (overdue or today); upcoming ones are calm.
          variant={urgent ? "signal" : "ghost"}
          aria-haspopup={variable ? "dialog" : undefined}
          aria-disabled={busy || undefined}
          aria-label={
            variable
              ? PAYMENTS_COPY.payWithAmount(item.name, due.spoken.toLowerCase())
              : PAYMENTS_COPY.payNamed(item.name, due.spoken.toLowerCase())
          }
          onClick={(event) => {
            if (!busy) onPay(item, event.currentTarget);
          }}
          data-pay-today={key}
        >
          {variable ? `${PAYMENTS_COPY.pay}…` : PAYMENTS_COPY.pay}
        </Key>
      </span>
    </div>
  );
}
