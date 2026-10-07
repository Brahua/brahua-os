// Paying a period and undoing it, client-safe: the calls, queue keys and notices of "Pendientes"
// in one place. Used by `PaymentsView` (F2) and by other modules' screens (`today`'s "Pagos", F4),
// so what "Pagado" does and what its notices say live only in `finance`. The caller keeps its own
// optimistic list and focus.
import type { ActionResult } from "@/lib/action-result";
import type { Queued } from "@/lib/use-save-queue";
import type { ScreenServices } from "@/modules/core/components/screen-services";
import type { PayOverrides } from "./components/pay-sheet";
import { spokenMoney } from "./money";
import { markPaid, undoPaid } from "./payment-actions";
import { PAYMENTS_COPY } from "./payments-copy";

export type { PayOverrides } from "./components/pay-sheet";

/** The screen's queue, notices and announcer (the host's, or the finance screen's own). */
export type PaymentCompletionServices = Pick<ScreenServices, "enqueue" | "toaster" | "announce">;

/** What paying needs to know about the period. */
export type PayablePeriod = { recurringId: string; name: string; dueOn: string };

/**
 * How a call ended: `saved`, `failed` (a refusal or the network: "Sin guardar" was shown, and the
 * caller's optimistic change rolls back when its transition ends) or `stale` (a newer call for the
 * same period took over: it decides what stays, nothing is said).
 */
export type PaymentOutcome = "saved" | "failed" | "stale";

/** The queue key of a period (pay, skip and their undo share it). */
export const periodQueueKey = (period: Pick<PayablePeriod, "recurringId" | "dueOn">) =>
  `payment-period:${period.recurringId}:${period.dueOn}`;

/** Why a save failed, for its notice. */
export function failureText(result: Queued<ActionResult<unknown>>): string {
  if (result.kind === "done" && !result.value.ok) return result.value.error;
  return PAYMENTS_COPY.checkConnection;
}

export type PaymentCompletion = {
  /**
   * "Pagado" (no overrides: the expected amount, today and the payment's method) or "Pagado…"
   * (`overrides` from the sheet) through the screen's queue. "Pago registrado · Internet · 50
   * soles" with "Deshacer" (and ⌘Z / Ctrl+Z, from the notice viewport), which calls `onUndo` with
   * the expense this pay created. Await it inside the transition that removed the row.
   */
  pay: (
    period: PayablePeriod,
    overrides: PayOverrides | null,
    onUndo: (expenseId: string, closedStamp: string | null) => void,
  ) => Promise<PaymentOutcome>;
  /**
   * "Deshacer" of a pay: the expense (the one `pay` created, never a later one) is removed and the
   * period is pending again; said once. Await it inside the transition that put the row back.
   * `closedStamp` (what `pay` handed to `onUndo`: the pay was the last installment and archived
   * the payment) reactivates the payment too, only if that archive is still in place.
   */
  undo: (
    period: PayablePeriod,
    expenseId: string,
    closedStamp?: string | null,
  ) => Promise<PaymentOutcome>;
};

/** Paying with the screen's queue, notices and announcer. */
export function paymentCompletion({
  enqueue,
  toaster,
  announce,
}: PaymentCompletionServices): PaymentCompletion {
  function notSaved(text: string, result: Queued<ActionResult<unknown>>) {
    toaster.push({
      title: PAYMENTS_COPY.notSavedTitle,
      text: `${text} ${failureText(result)}`,
      tone: "error",
    });
  }

  return {
    async pay(period, overrides, onUndo) {
      const { recurringId, name, dueOn } = period;
      const result = await enqueue(periodQueueKey(period), () =>
        markPaid({ id: recurringId, dueOn, ...(overrides ?? {}) }),
      );
      if (result.kind === "skipped") return "stale";
      if (result.kind === "done" && result.value.ok) {
        const { expense, closedStamp } = result.value.data;
        toaster.push({
          title: PAYMENTS_COPY.paidTitle,
          // The last installment says so: the payment archived itself in the same save.
          text: closedStamp
            ? PAYMENTS_COPY.lastInstallmentText(name)
            : PAYMENTS_COPY.paidText(
                name,
                spokenMoney(expense.amountCents, expense.currency, expense.exchangeRateE4),
              ),
          // The undo names this pay's expense: never a later pay of the same period.
          action: { label: PAYMENTS_COPY.undo, run: () => onUndo(expense.id, closedStamp) },
        });
        return "saved";
      }
      notSaved(PAYMENTS_COPY.notPaid, result);
      return "failed";
    },

    async undo(period, expenseId, closedStamp = null) {
      const { recurringId, name, dueOn } = period;
      const result = await enqueue(periodQueueKey(period), () =>
        undoPaid({
          id: recurringId,
          dueOn,
          expenseId,
          ...(closedStamp ? { reopenStamp: closedStamp } : {}),
        }),
      );
      if (result.kind === "skipped") return "stale";
      if (result.kind === "done" && result.value.ok) {
        const { reopened, stillArchived } = result.value.data;
        announce(
          reopened
            ? PAYMENTS_COPY.undonePaidReopened(name)
            : stillArchived
              ? PAYMENTS_COPY.undonePaidArchived(name)
              : PAYMENTS_COPY.undonePaid(name),
        );
        return "saved";
      }
      notSaved(PAYMENTS_COPY.notUndone, result);
      return "failed";
    },
  };
}
