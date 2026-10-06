"use client";

import { useEffect, useState } from "react";
import { readFinanceCatalog } from "../catalog-actions";
import type { FinanceCatalog } from "../catalog-input";
import type { FinanceTodayItem } from "../today-summary";
import { PaySheet, type PayOverrides } from "./pay-sheet";

type TodayPaySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The home row being paid. */
  item: FinanceTodayItem;
  /** Lima's today: the date by default and the field's maximum. */
  today: string;
  /** Where focus goes when the sheet closes (the host points it at a neighbor after a save). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** "Registrar pago": the host closes the sheet and saves (optimistic, with "Deshacer"). */
  onPay: (overrides: PayOverrides) => void;
};

/**
 * F2's "Pagado…" sheet for a screen outside /finance (the home page's "Pagos", F4): the amount,
 * the date and the method, without "Omitir este período" (the home page only pays). The home page
 * has no catalog, so it is read when the sheet opens (like the quick capture); until it arrives
 * the payment's own method is the only option and the sheet can be saved anyway.
 */
export function TodayPaySheet({
  open,
  onOpenChange,
  item,
  today,
  returnFocusRef,
  onPay,
}: TodayPaySheetProps) {
  const [catalog, setCatalog] = useState<FinanceCatalog | null>(null);

  useEffect(() => {
    let current = true;
    readFinanceCatalog({})
      .then((result) => {
        if (current && result.ok) setCatalog(result.data);
      })
      // Without the catalog the payment's method is still offered: nothing to say.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  return (
    <PaySheet
      open={open}
      onOpenChange={onOpenChange}
      period={{
        recurring: {
          id: item.recurringId,
          name: item.name,
          amountCents: item.amountCents,
          currency: item.currency,
          paymentMethod: item.paymentMethod,
        },
        dueOn: item.dueOn,
      }}
      catalog={catalog}
      today={today}
      returnFocusRef={returnFocusRef}
      onPay={onPay}
    />
  );
}
