"use client";

import { useEffect, useState } from "react";
import type { CaptureSheetProps } from "@/lib/quick-capture";
import { ownerDateKey } from "@/lib/time";
import { readFinanceCatalog } from "../catalog-actions";
import type { FinanceCatalog } from "../catalog-input";
import { ExpenseSheet } from "./expense-sheet";

/**
 * The quick capture's "Gasto" (SPEC-finance "Captura rápida"): the expense sheet, opened from any
 * screen. The catalog (categories, methods, the last method, the rate) is read when it opens, so
 * it is always up to date; the amount can be typed and saved before it arrives (the server then
 * applies the defaults).
 */
export function ExpenseCaptureSheet({
  open,
  onOpenChange,
  returnFocusRef,
  switcher,
}: CaptureSheetProps) {
  const [catalog, setCatalog] = useState<FinanceCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  // Lima's today when the sheet opened (a new sheet each opening).
  const [today] = useState(() => ownerDateKey(new Date()));

  useEffect(() => {
    let current = true;
    readFinanceCatalog({})
      .then((result) => {
        if (!current) return;
        if (result.ok) setCatalog(result.data);
        else setFailed(true);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);

  return (
    <ExpenseSheet
      open={open}
      onOpenChange={onOpenChange}
      returnFocusRef={returnFocusRef}
      catalog={catalog}
      catalogFailed={failed}
      today={today}
      switcher={switcher}
      onSaved={(expense) => {
        // The method used is the next default (the server remembers it too).
        setCatalog((previous) =>
          previous && expense.paymentMethod
            ? { ...previous, lastPaymentMethodId: expense.paymentMethod.id }
            : previous,
        );
      }}
    />
  );
}
