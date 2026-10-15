"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { IconKey, Key, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import { skipPeriod, undoSkipped } from "../payment-actions";
import { failureText, paymentCompletion, type PayablePeriod } from "../payment-completion";
import { dueState, installmentLabel, isUrgent, PAYMENTS_COPY, spokenDay } from "../payments-copy";
import type { PendingPeriod } from "../payments-view";
import { recurringPaymentPath } from "../routes";
import { installmentOf } from "../today-summary";
import { useFinanceViews } from "./finance-views";
import { useFinanceScreen } from "./finance-screen";
import { expectedAmount, periodKey, spokenExpected } from "./payment-format";
import { PaySheet, type PayOverrides } from "./pay-sheet";

/** What `paymentCompletion` needs of a pending period. */
const payable = ({ recurring, dueOn }: PendingPeriod): PayablePeriod => ({
  recurringId: recurring.id,
  name: recurring.name,
  dueOn,
});

type SheetState = { key: number; open: boolean; period: PendingPeriod };

type Settled = "paid" | "skipped";

/**
 * «Por pagar» of «Gastos» (current month only): the recurring payments overdue (≤ 60 days) or due
 * within 7 days, oldest first, with "Pagado" (one tap; the "Pagado…" sheet for a variable amount),
 * "Omitir este período" and their "Deshacer". Pay and skip are optimistic: the row leaves at once
 * and focus goes to the next row's key (or the previous one's, or the heading). Queue keys:
 * `payment-period:<id>:<due>` (pay, skip and their undo).
 */
export function PendingPayments({ pending: all }: { pending: PendingPeriod[] }) {
  const { today, catalog, enqueue, toaster, announce } = useFinanceScreen();
  const views = useFinanceViews();
  const completion = useMemo(
    () => paymentCompletion({ enqueue, toaster, announce }),
    [enqueue, toaster, announce],
  );
  const ids = useId();
  const [settled, settle] = useOptimistic(
    new Map<string, Settled>(),
    (map, [key, status]: [string, Settled]) => new Map(map).set(key, status),
  );
  const pending = all.filter((period) => !settled.has(periodKey(period)));
  const [sheet, setSheet] = useState<SheetState | null>(null);
  // Pay, skip and undo: `data-saving` while one is in flight (E2E waits on it).
  const [saving, startSaving] = useTransition();

  const heading = useRef<HTMLHeadingElement>(null);
  const payKeys = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLElement | null>(null);
  // After a one-tap pay the focused key unmounts: focus goes to a neighbor once the row is gone.
  const payFocus = useRef<{ gone: string; target: string | null } | null>(null);

  useLayoutEffect(() => {
    const pay = payFocus.current;
    if (pay && !payKeys.current.has(pay.gone)) {
      payFocus.current = null;
      // The heading describes the empty list when it was the last row.
      ((pay.target && payKeys.current.get(pay.target)) || heading.current)?.focus();
    }
  });

  /** The key of the row after `key` (or before it), if any: where focus goes when it leaves. */
  function neighborKey(key: string): string | null {
    const index = pending.findIndex((period) => periodKey(period) === key);
    const next = pending[index + 1] ?? pending[index - 1];
    return next ? periodKey(next) : null;
  }

  function undoPay(period: PendingPeriod, expenseId: string, closedStamp: string | null) {
    startSaving(async () => {
      await completion.undo(payable(period), expenseId, closedStamp);
    });
  }

  function undoSkip(period: PendingPeriod, closedStamp: string | null) {
    const { recurring, dueOn } = period;
    startSaving(async () => {
      const result = await enqueue(`payment-period:${periodKey(period)}`, () =>
        undoSkipped({
          id: recurring.id,
          dueOn,
          ...(closedStamp ? { reopenStamp: closedStamp } : {}),
        }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        const { reopened, stillArchived } = result.value.data;
        announce(
          reopened
            ? PAYMENTS_COPY.undoneSkipReopened(recurring.name)
            : stillArchived
              ? PAYMENTS_COPY.undoneSkipArchived(recurring.name)
              : PAYMENTS_COPY.undoneSkip(recurring.name),
        );
        return;
      }
      toaster.push({
        title: PAYMENTS_COPY.notSavedTitle,
        text: `${PAYMENTS_COPY.notUndone} ${failureText(result)}`,
        tone: "error",
      });
    });
  }

  function pay(period: PendingPeriod, overrides: PayOverrides | null) {
    startSaving(async () => {
      settle([periodKey(period), "paid"]);
      // A failure puts it back in the list (the optimistic removal ends with the transition),
      // unless it was already paid: the page's new data leaves it out.
      const outcome = await completion.pay(payable(period), overrides, (expenseId, closedStamp) =>
        undoPay(period, expenseId, closedStamp),
      );
      // Only a saved pay celebrates: a refusal, a network error or a newer call do not.
      if (outcome === "saved") views?.celebratePaid();
    });
  }

  function skip(period: PendingPeriod) {
    const key = periodKey(period);
    const { recurring, dueOn } = period;
    startSaving(async () => {
      settle([key, "skipped"]);
      const result = await enqueue(`payment-period:${key}`, () =>
        skipPeriod({ id: recurring.id, dueOn }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        const { closedStamp } = result.value.data;
        toaster.push({
          title: PAYMENTS_COPY.skippedTitle,
          // The last installment says so: the payment archived itself in the same save.
          text: closedStamp
            ? PAYMENTS_COPY.lastInstallmentText(recurring.name)
            : PAYMENTS_COPY.skippedText(recurring.name, spokenDay(dueOn)),
          action: {
            label: PAYMENTS_COPY.undo,
            run: () => undoSkip(period, closedStamp),
          },
        });
        return;
      }
      toaster.push({
        title: PAYMENTS_COPY.notSavedTitle,
        text: `${PAYMENTS_COPY.notSkipped} ${failureText(result)}`,
        tone: "error",
      });
    });
  }

  function payNow(period: PendingPeriod) {
    const key = periodKey(period);
    payFocus.current = { gone: key, target: neighborKey(key) };
    pay(period, null);
  }

  function openPaySheet(period: PendingPeriod, opener: HTMLElement) {
    returnFocus.current = opener;
    setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true, period }));
  }

  function closeSheet() {
    setSheet((previous) => (previous ? { ...previous, open: false } : previous));
  }

  /** The sheet settles its period: focus goes to a neighbor (the row leaves), then it closes. */
  function settleFromSheet(period: PendingPeriod, run: () => void) {
    const neighbor = neighborKey(periodKey(period));
    returnFocus.current = (neighbor && payKeys.current.get(neighbor)) || heading.current;
    closeSheet();
    run();
  }

  const headingId = `${ids}-pending`;
  const emptyId = `${ids}-pending-empty`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      data-pending-payments=""
      data-saving={saving ? "" : undefined}
    >
      <h3
        ref={heading}
        id={headingId}
        tabIndex={-1}
        // When the last row leaves, focus lands here and the empty message is read with it.
        aria-describedby={pending.length === 0 ? emptyId : undefined}
        className="bo-text-subheading outline-none"
      >
        {PAYMENTS_COPY.pendingHeading}
      </h3>
      {pending.length === 0 ? (
        <p
          id={emptyId}
          className="bo-card bo-text-body-sm max-w-160 text-text-secondary"
          data-pending-empty=""
        >
          {PAYMENTS_COPY.pendingEmpty}
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="bo-list" data-pending-list="">
          {pending.map((period) => (
            <li key={periodKey(period)}>
              <PendingRow
                period={period}
                today={today}
                payRef={(element) => {
                  if (element) payKeys.current.set(periodKey(period), element);
                  else payKeys.current.delete(periodKey(period));
                }}
                onPay={(element) =>
                  period.recurring.amountCents === null
                    ? openPaySheet(period, element)
                    : payNow(period)
                }
                onMore={(element) => openPaySheet(period, element)}
              />
            </li>
          ))}
        </ul>
      )}
      {sheet ? (
        <PaySheet
          key={sheet.key}
          open={sheet.open}
          onOpenChange={(open) => (open ? undefined : closeSheet())}
          period={sheet.period}
          catalog={catalog}
          today={today}
          returnFocusRef={returnFocus}
          onPay={(overrides) => settleFromSheet(sheet.period, () => pay(sheet.period, overrides))}
          onSkip={() => settleFromSheet(sheet.period, () => skip(sheet.period))}
        />
      ) : null}
    </section>
  );
}

type PendingRowProps = {
  period: PendingPeriod;
  today: string;
  payRef: React.Ref<HTMLButtonElement>;
  onPay: (element: HTMLButtonElement) => void;
  onMore: (element: HTMLButtonElement) => void;
};

/** A pending period: name (to its page), due date (signal color when urgent), amount, actions. */
function PendingRow({ period, today, payRef, onPay, onMore }: PendingRowProps) {
  const { recurring, dueOn } = period;
  const due = dueState(dueOn, today);
  const urgent = isUrgent(due);
  const variable = recurring.amountCents === null;
  const metaId = useId();
  const installment = installmentOf(recurring, dueOn);
  const installmentText = installment ? installmentLabel(installment) : null;
  return (
    <div className="bo-row bo-row--static bo-payment-row" data-pending-row={periodKey(period)}>
      <span className="bo-row__body">
        <Link
          href={recurringPaymentPath(recurring.id)}
          className="bo-task-title bo-row-link bo-row__title w-fit"
          aria-describedby={metaId}
        >
          {recurring.name}
        </Link>
        <span id={metaId} hidden>
          {[due.spoken, installmentText, spokenExpected(recurring), recurring.paymentMethod?.name]
            .filter(Boolean)
            .join(", ")}
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
          <span className="bo-amount text-text">{expectedAmount(recurring)}</span>
          {installmentText ? (
            <span className="text-text-secondary" data-installment="">
              {installmentText}
            </span>
          ) : null}
          {recurring.paymentMethod ? (
            <span className="text-text-secondary">{recurring.paymentMethod.name}</span>
          ) : null}
        </span>
      </span>
      <span className="bo-row__trail">
        <Key
          ref={payRef}
          variant={urgent ? "signal" : "ghost"}
          aria-haspopup={variable ? "dialog" : undefined}
          aria-label={
            variable
              ? PAYMENTS_COPY.payWithAmount(recurring.name, due.spoken.toLowerCase())
              : PAYMENTS_COPY.payNamed(recurring.name, due.spoken.toLowerCase())
          }
          onClick={(event) => onPay(event.currentTarget)}
          data-pay={periodKey(period)}
        >
          {variable ? `${PAYMENTS_COPY.pay}…` : PAYMENTS_COPY.pay}
        </Key>
        <IconKey
          icon={Ellipsis}
          variant="ghost"
          label={PAYMENTS_COPY.moreActions(recurring.name)}
          aria-haspopup="dialog"
          onClick={(event) => onMore(event.currentTarget)}
        />
      </span>
    </div>
  );
}
