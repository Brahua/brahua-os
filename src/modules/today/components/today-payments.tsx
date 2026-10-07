"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { keyClasses } from "@/design-system";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import {
  PaymentTodayRow,
  paymentTodayPaySelector,
  paysWithSheet,
} from "@/modules/finance/components/payment-today-row";
import { TodayPaySheet } from "@/modules/finance/components/today-pay-sheet";
import { paymentCompletion, type PayOverrides } from "@/modules/finance/payment-completion";
import { financeViewCookie, FINANCE_PATH } from "@/modules/finance/routes";
import { financeTodayKey, type FinanceTodayItem } from "@/modules/finance/today-summary";
import {
  applyTodayTaskChange,
  focusAfterTaskLeaves,
  paymentsFold,
  paymentsOrder,
  paymentsTally,
  TODAY_HEADING_ID,
  type TodayTaskChange,
} from "../today-board";
import { TODAY_COPY } from "../today-copy";
import { useReportPayments } from "./today-progress";

/** Id of the section's heading (tabIndex -1): focus lands there if its target is gone. */
export const TODAY_PAYMENTS_HEADING_ID = "today-payments-title";

/** A row of the optimistic list: the contract's item with its stable key as `id`. */
type Row = FinanceTodayItem & { id: string };

const toRow = (item: FinanceTodayItem): Row => ({ ...item, id: financeTodayKey(item) });

type SheetState = { key: number; open: boolean; row: Row };

type TodayPaymentsProps = {
  /** Lima's day the page was read for (YYYY-MM-DD). */
  today: string;
  /** `getFinanceTodaySummary(now)`: overdue (≤ 60 days) and due within 7 days, by date. */
  payments: FinanceTodayItem[];
};

/**
 * "Pagos" on the board (F4 of `finance`, SPEC-finance "Con `today`"): the pending periods of the
 * recurring payments, overdue or due within 7 days, the urgent ones (overdue or due today) first
 * and then by date (`paymentsOrder`); 3 shown and the rest behind "Ver N más", like "Tareas"
 * (principles 5 and 13; expanded on this page only). "Pagado" pays with one tap with `finance`'s
 * own rule (`paymentCompletion`: the expected amount, today, the payment's method; its notice and
 * "Deshacer"); a variable amount opens "Pagado…" (`TodayPaySheet`). Through the board's queue and
 * notices. The row leaves at once and the next folded one rises; focus goes to the next row's
 * "Pagado", else the previous one's, else the board's heading (the section leaves with its last
 * row). Overdue and due-today rows keep "Día completo" away (`useReportPayments`).
 */
export function TodayPayments({ today, payments }: TodayPaymentsProps) {
  const services = useRequiredScreenServices();
  const { isCurrentDay } = services;
  const completion = useMemo(() => paymentCompletion(services), [services]);
  const rows = useMemo(() => paymentsOrder(payments, today).map(toRow), [payments, today]);
  const [view, apply] = useOptimistic(rows, (list: Row[], change: TodayTaskChange<Row>) =>
    applyTodayTaskChange(list, change),
  );
  // Rows put back by "Deshacer" whose undo is still saving: `aria-disabled`, a tap waits.
  const [restoring, markRestoring] = useOptimistic(
    new Set<string>() as ReadonlySet<string>,
    (set: ReadonlySet<string>, id: string) => new Set(set).add(id),
  );
  const [saving, startSaving] = useTransition();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const fold = paymentsFold(view.length, expanded);
  const returnFocus = useRef<HTMLElement | null>(null);
  // "Día completo" follows this optimistic list: an overdue or due-today row keeps the day open.
  const tally = paymentsTally(view, today);
  useReportPayments(tally);

  // ── Focus when a row leaves (after the commit that removed it) ──
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    pendingFocus.current = null;
    const element =
      document.querySelector<HTMLElement>(selector) ??
      document.getElementById(TODAY_PAYMENTS_HEADING_ID) ??
      document.getElementById(TODAY_HEADING_ID);
    element?.focus();
  });

  /** Where focus goes when `id` leaves: the next row's key, else the previous, else the h1. */
  function neighborSelector(id: string): string {
    const target = focusAfterTaskLeaves(
      view.map((row) => row.id),
      id,
    );
    return target.kind === "row" ? paymentTodayPaySelector(target.id) : `#${TODAY_HEADING_ID}`;
  }

  /** If focus is in the leaving row (or nowhere: Safari doesn't focus a tapped button). */
  function focusAfterLeaving(id: string) {
    const active = document.activeElement;
    const inRow = active?.closest(`[data-payment-today="${CSS.escape(id)}"]`);
    if (!inRow && active && active !== document.body) return;
    pendingFocus.current = neighborSelector(id);
  }

  function pay(row: Row, overrides: PayOverrides | null) {
    const index = view.findIndex((item) => item.id === row.id);
    startSaving(async () => {
      apply({ type: "remove", id: row.id });
      // A failure rolls the row back when this transition ends (useOptimistic).
      await completion.pay(row, overrides, (expenseId, closedStamp) =>
        undo(row, index, expenseId, closedStamp),
      );
    });
  }

  /** "Deshacer" (the notice's key, ⌘Z / Ctrl+Z): back in its place, pending again. */
  function undo(row: Row, index: number, expenseId: string, closedStamp: string | null) {
    startSaving(async () => {
      apply({ type: "restore", task: row, index });
      markRestoring(row.id);
      await completion.undo(row, expenseId, closedStamp);
    });
  }

  function onPay(item: FinanceTodayItem, element: HTMLButtonElement) {
    // A new Lima day with the board open: it is being read again (and said); don't act on the
    // day before's list.
    if (isCurrentDay && !isCurrentDay()) return;
    const row = toRow(item);
    if (paysWithSheet(item)) {
      returnFocus.current = element;
      setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true, row }));
      return;
    }
    focusAfterLeaving(row.id);
    pay(row, null);
  }

  function closeSheet() {
    setSheet((previous) => (previous ? { ...previous, open: false } : previous));
  }

  /** "Registrar pago" in the sheet: focus goes to a neighbor (the row leaves), then it closes. */
  function payFromSheet(row: Row, overrides: PayOverrides) {
    // A new Lima day while the sheet was open: it closes without paying (the board is being read
    // again, and says so); focus goes back to "Pagado…".
    if (isCurrentDay && !isCurrentDay()) {
      closeSheet();
      return;
    }
    returnFocus.current = document.querySelector<HTMLElement>(neighborSelector(row.id));
    closeSheet();
    pay(row, overrides);
  }

  return (
    <>
      {/* The last row left: the section leaves too (the sheet, if closing, stays mounted). */}
      {view.length > 0 ? (
        <section
          aria-labelledby={TODAY_PAYMENTS_HEADING_ID}
          className="flex flex-col gap-3"
          data-today-section="payments"
          data-saving={saving ? "" : undefined}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 id={TODAY_PAYMENTS_HEADING_ID} tabIndex={-1} className="bo-text-title outline-none">
              {TODAY_COPY.paymentsTitle}
            </h2>
            <Link
              href={FINANCE_PATH}
              className={keyClasses({ variant: "ghost" })}
              // /finance opens on "Pagos" (the view switch remembers it on the device).
              onClick={() => {
                document.cookie = financeViewCookie(
                  "payments",
                  window.location.protocol === "https:",
                );
              }}
            >
              {TODAY_COPY.seePayments}
            </Link>
          </div>

          <ul id={listId} aria-label={TODAY_COPY.paymentsList} className="bo-list">
            {view.slice(0, fold.shown).map((row) => (
              <li key={row.id}>
                <PaymentTodayRow
                  item={row}
                  today={today}
                  onPay={onPay}
                  busy={restoring.has(row.id)}
                />
              </li>
            ))}
          </ul>

          {fold.toggle ? (
            <div>
              <button
                type="button"
                aria-expanded={fold.toggle === "less"}
                aria-controls={listId}
                className={keyClasses({ variant: "ghost" })}
                data-today-payments-fold=""
                onClick={() => setExpanded((value) => !value)}
              >
                {fold.toggle === "more" ? TODAY_COPY.tasksMore(fold.hidden) : TODAY_COPY.tasksLess}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {sheet ? (
        <TodayPaySheet
          key={sheet.key}
          open={sheet.open}
          onOpenChange={(open) => (open ? undefined : closeSheet())}
          item={sheet.row}
          today={today}
          returnFocusRef={returnFocus}
          onPay={(overrides) => payFromSheet(sheet.row, overrides)}
        />
      ) : null}
    </>
  );
}
