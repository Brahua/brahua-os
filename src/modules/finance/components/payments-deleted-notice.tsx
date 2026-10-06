"use client";

import { startTransition, useEffect, useRef } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { restoreRecurringPayment } from "../payment-actions";
import { DELETED_PAYMENT_PARAM } from "../payment-routes";
import { PAYMENTS_COPY } from "../payments-copy";
import type { RecurringItem } from "../recurring-input";
import { useFinanceScreen } from "./finance-screen";

/** A live region only speaks what changes after it is on the page. */
const ANNOUNCE_DELAY_MS = 150;

type PaymentsDeletedNoticeProps = {
  /** The payment just deleted from its page (`?deleted=<id>`), while it is still deleted. */
  deleted: { id: string; name: string } | null;
};

/**
 * After deleting a payment from its page, /finance opens with `?deleted=<id>` on "Pagos" (like
 * habits): the parameter leaves the URL (a reload doesn't repeat it) and "Pago recurrente
 * eliminado · Deshacer" shows in the screen's notices. "Deshacer" restores it as it was.
 */
export function PaymentsDeletedNotice({ deleted }: PaymentsDeletedNoticeProps) {
  const { toaster, announce } = useFinanceScreen();
  const { push } = toaster;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!deleted || shown.current === deleted.id) return;
    const payment = deleted;
    const url = new URL(window.location.href);
    if (url.searchParams.has(DELETED_PAYMENT_PARAM)) {
      url.searchParams.delete(DELETED_PAYMENT_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    function undo() {
      startTransition(async () => {
        let result: ActionResult<RecurringItem>;
        try {
          result = await restoreRecurringPayment({ id: payment.id });
        } catch {
          result = fail(PAYMENTS_COPY.checkConnection);
        }
        if (result.ok) announce(PAYMENTS_COPY.restored(payment.name));
        else {
          push({
            title: PAYMENTS_COPY.notSavedTitle,
            text: `${PAYMENTS_COPY.notUndone} ${result.error}`,
            tone: "error",
          });
        }
      });
    }

    const timer = window.setTimeout(() => {
      shown.current = payment.id;
      push({
        title: PAYMENTS_COPY.deletedTitle,
        text: payment.name,
        action: { label: PAYMENTS_COPY.undo, run: undo },
      });
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, push, announce]);

  return null;
}
