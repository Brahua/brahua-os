"use client";

import { ChevronDown, Ellipsis, Plus } from "lucide-react";
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
import { Icon, IconKey, Key, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import { monthTitle } from "../finance-copy";
import { formatMoney, spokenMoney } from "../money";
import { skipPeriod, undoSkipped, unarchiveRecurringPayment } from "../payment-actions";
import { failureText, paymentCompletion, type PayablePeriod } from "../payment-completion";
import {
  cycleSummary,
  dueState,
  installmentLabel,
  isUrgent,
  PAYMENTS_COPY,
  shortDay,
  spokenDay,
} from "../payments-copy";
import type { MonthEntry, PaymentsViewData, PendingPeriod } from "../payments-view";
import type { RecurringItem } from "../recurring-input";
import { recurringPaymentPath } from "../routes";
import { monthOfDay } from "../schedule";
import { installmentOf } from "../today-summary";
import { useFinanceScreen } from "./finance-screen";
import { PaySheet, type PayOverrides } from "./pay-sheet";
import { RecurringSheet } from "./recurring-sheet";

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

/** What `paymentCompletion` needs of a pending period. */
const payable = ({ recurring, dueOn }: PendingPeriod): PayablePeriod => ({
  recurringId: recurring.id,
  name: recurring.name,
  dueOn,
});

type SheetState =
  | { key: number; open: boolean; kind: "pay"; period: PendingPeriod }
  | { key: number; open: boolean; kind: "new" };

type Settled = "paid" | "skipped";

/**
 * "Pagos" of /finance (SPEC-finance "Pantallas" → Pagos): Pendientes (overdue ≤ 60 days and due
 * within 7, oldest first) with "Pagado" (one tap; the "Pagado…" sheet for a variable amount), the
 * "Pagado…" / "Omitir este período" sheet and their "Deshacer"; Este mes; Todos with "Nuevo pago
 * recurrente"; Archivados (folded, "Reactivar").
 *
 * Pay, skip and reactivate are optimistic: the row leaves at once (Este mes shows the new state)
 * and focus goes to the next row's key (or the previous one's, or the section). Queue keys:
 * `payment-period:<id>:<due>` (pay, skip and their undo), `payment-archive:<id>`.
 */
export function PaymentsView({ data }: { data: PaymentsViewData }) {
  const { today, catalog, enqueue, toaster, announce } = useFinanceScreen();
  const completion = useMemo(
    () => paymentCompletion({ enqueue, toaster, announce }),
    [enqueue, toaster, announce],
  );
  const ids = useId();
  const [settled, settle] = useOptimistic(
    new Map<string, Settled>(),
    (map, [key, status]: [string, Settled]) => new Map(map).set(key, status),
  );
  const [reactivated, reactivate] = useOptimistic(new Set<string>(), (keys, id: string) =>
    new Set(keys).add(id),
  );
  const pending = data.pending.filter((period) => !settled.has(periodKey(period)));
  const archived = data.archived.filter((item) => !reactivated.has(item.id));
  const [sheet, setSheet] = useState<SheetState | null>(null);
  // Pay, skip, undo and reactivate: `data-saving` while one is in flight (E2E waits on it).
  const [saving, startSaving] = useTransition();

  const pendingHeading = useRef<HTMLHeadingElement>(null);
  const newKey = useRef<HTMLButtonElement>(null);
  const archivedSummary = useRef<HTMLElement>(null);
  const payKeys = useRef(new Map<string, HTMLButtonElement>());
  const reactivateKeys = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLElement | null>(null);
  const createdName = useRef<string | null>(null);
  // After a one-tap pay or a reactivation the focused key unmounts: focus goes to a neighbor once
  // the row is gone.
  const payFocus = useRef<{ gone: string; target: string | null } | null>(null);
  const reactivateFocus = useRef<{ gone: string; target: string | null } | null>(null);

  useLayoutEffect(() => {
    const pay = payFocus.current;
    if (pay && !payKeys.current.has(pay.gone)) {
      payFocus.current = null;
      // The heading describes the empty list when it was the last row.
      ((pay.target && payKeys.current.get(pay.target)) || pendingHeading.current)?.focus();
    }
    const back = reactivateFocus.current;
    if (back && !reactivateKeys.current.has(back.gone)) {
      reactivateFocus.current = null;
      (
        (back.target && reactivateKeys.current.get(back.target)) ||
        archivedSummary.current ||
        newKey.current
      )?.focus();
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
        announce(
          result.value.data.reopened
            ? PAYMENTS_COPY.undoneSkipReopened(recurring.name)
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
      await completion.pay(payable(period), overrides, (expenseId, closedStamp) =>
        undoPay(period, expenseId, closedStamp),
      );
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
    setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true, kind: "pay", period }));
  }

  function openNew(opener: HTMLElement) {
    returnFocus.current = opener;
    setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true, kind: "new" }));
  }

  function closeSheet() {
    setSheet((previous) => (previous ? { ...previous, open: false } : previous));
  }

  /** The sheet settles its period: focus goes to a neighbor (the row leaves), then it closes. */
  function settleFromSheet(period: PendingPeriod, run: () => void) {
    const neighbor = neighborKey(periodKey(period));
    returnFocus.current =
      (neighbor && payKeys.current.get(neighbor)) || pendingHeading.current || newKey.current;
    closeSheet();
    run();
  }

  function reactivateItem(item: RecurringItem) {
    const index = archived.findIndex((other) => other.id === item.id);
    const neighbor = archived[index + 1] ?? archived[index - 1];
    reactivateFocus.current = { gone: item.id, target: neighbor?.id ?? null };
    startSaving(async () => {
      reactivate(item.id);
      const result = await enqueue(`payment-archive:${item.id}`, () =>
        unarchiveRecurringPayment({ id: item.id }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        announce(PAYMENTS_COPY.reactivatedNotice(item.name));
        return;
      }
      toaster.push({
        title: PAYMENTS_COPY.notSavedTitle,
        text: `${PAYMENTS_COPY.notUndone} ${failureText(result)}`,
        tone: "error",
      });
    });
  }

  const sectionIds = {
    pending: `${ids}-pending`,
    pendingEmpty: `${ids}-pending-empty`,
    month: `${ids}-month`,
    all: `${ids}-all`,
    archived: `${ids}-archived`,
  };

  return (
    <div
      className="flex flex-col gap-8"
      data-payments-view=""
      data-saving={saving ? "" : undefined}
    >
      <section aria-labelledby={sectionIds.pending} className="flex flex-col gap-3">
        <h2
          ref={pendingHeading}
          id={sectionIds.pending}
          tabIndex={-1}
          // When the last row leaves, focus lands here and the empty message is read with it.
          aria-describedby={pending.length === 0 ? sectionIds.pendingEmpty : undefined}
          className="bo-text-title outline-none"
        >
          {PAYMENTS_COPY.pendingHeading}
        </h2>
        {pending.length === 0 ? (
          <p
            id={sectionIds.pendingEmpty}
            className="bo-card bo-text-body-sm max-w-160 text-text-secondary"
            data-pending-empty=""
          >
            {PAYMENTS_COPY.pendingEmpty}
          </p>
        ) : (
          <ul aria-labelledby={sectionIds.pending} className="bo-list" data-pending-list="">
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
      </section>

      <section aria-labelledby={sectionIds.month} className="flex flex-col gap-3">
        <h2 id={sectionIds.month} className="bo-text-title">
          {PAYMENTS_COPY.monthHeading(monthTitle(monthOfDay(today)))}
        </h2>
        {data.thisMonth.length === 0 ? (
          <p className="bo-card bo-text-body-sm max-w-160 text-text-secondary">
            {PAYMENTS_COPY.monthEmpty}
          </p>
        ) : (
          <ul aria-labelledby={sectionIds.month} className="bo-list" data-month-list="">
            {data.thisMonth.map((entry) => (
              <li key={`${entry.recurring.id}:${entry.dueOn ?? "none"}`}>
                <MonthRow
                  entry={entry}
                  settledNow={
                    entry.status === "pending"
                      ? settled.get(periodKey({ recurring: entry.recurring, dueOn: entry.dueOn }))
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={sectionIds.all} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id={sectionIds.all} className="bo-text-title">
            {PAYMENTS_COPY.allHeading}
          </h2>
          <Key
            ref={newKey}
            variant="signal"
            icon={Plus}
            aria-haspopup="dialog"
            onClick={(event) => openNew(event.currentTarget)}
          >
            {PAYMENTS_COPY.newPayment}
          </Key>
        </div>
        {data.active.length === 0 ? (
          <p className="bo-card bo-text-body-sm max-w-160 text-text-secondary" data-all-empty="">
            {PAYMENTS_COPY.allEmpty}
          </p>
        ) : (
          <ul aria-labelledby={sectionIds.all} className="bo-list" data-all-list="">
            {data.active.map(({ recurring, nextDue }) => (
              <li key={recurring.id}>
                <Link
                  href={recurringPaymentPath(recurring.id)}
                  className="bo-row"
                  // Spoken in words: "S/" and "jue 9 oct" read badly.
                  aria-label={[
                    recurring.name,
                    cycleSummary(recurring),
                    recurring.paymentMethod?.name,
                    spokenExpected(recurring),
                    nextDue
                      ? PAYMENTS_COPY.nextDueSpoken(spokenDay(nextDue))
                      : PAYMENTS_COPY.noMoreDues,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  data-payment-link={recurring.id}
                >
                  <span className="bo-row__body" aria-hidden>
                    <span className="bo-row__title truncate">{recurring.name}</span>
                    <span className="bo-row__subtitle">
                      {[cycleSummary(recurring), recurring.paymentMethod?.name]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="bo-row__trail flex-col items-end gap-0.5" aria-hidden>
                    <span className="bo-amount bo-text-body text-text">
                      {expectedAmount(recurring)}
                    </span>
                    <span className="bo-text-body-sm">
                      {nextDue
                        ? PAYMENTS_COPY.nextDue(shortDay(nextDue))
                        : PAYMENTS_COPY.noMoreDues}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 ? (
        <details className="group flex flex-col gap-3" data-archived-payments="">
          <summary
            ref={archivedSummary}
            id={sectionIds.archived}
            className="bo-text-body-sm flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-md font-semibold text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Icon icon={ChevronDown} size="sm" className="group-open:rotate-180" />
            {PAYMENTS_COPY.archivedHeading(archived.length)}
          </summary>
          <ul aria-labelledby={sectionIds.archived} className="bo-list mt-3">
            {archived.map((item) => (
              <li key={item.id} className="bo-row bo-row--static">
                <span className="bo-row__body">
                  <Link
                    href={recurringPaymentPath(item.id)}
                    className="bo-task-title bo-row-link bo-row__title w-fit"
                  >
                    {item.name}
                  </Link>
                  <span className="bo-row__subtitle">{cycleSummary(item)}</span>
                </span>
                <Key
                  ref={(element) => {
                    if (element) reactivateKeys.current.set(item.id, element);
                    else reactivateKeys.current.delete(item.id);
                  }}
                  variant="ghost"
                  aria-label={`${PAYMENTS_COPY.reactivate} «${item.name}»`}
                  onClick={() => reactivateItem(item)}
                >
                  {PAYMENTS_COPY.reactivate}
                </Key>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {sheet?.kind === "pay" ? (
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
      {sheet?.kind === "new" ? (
        <RecurringSheet
          key={sheet.key}
          open={sheet.open}
          onOpenChange={(open) => (open ? undefined : closeSheet())}
          returnFocusRef={returnFocus}
          recurring={null}
          catalog={catalog}
          today={today}
          onSaved={(item) => {
            // Said once the sheet is gone (the page is hidden from screen readers until then).
            createdName.current = item.name;
          }}
          onClosed={() => {
            const name = createdName.current;
            createdName.current = null;
            if (name) announce(PAYMENTS_COPY.created(name));
          }}
        />
      ) : null}
    </div>
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

type MonthRowProps = {
  entry: MonthEntry;
  /** Paid or skipped just now (optimistic), before the page's new data arrives. */
  settledNow?: Settled;
};

/** A row of "Este mes": the period's day and its status (visible short, spoken in words). */
function MonthRow({ entry, settledNow }: MonthRowProps) {
  const { recurring } = entry;
  const metaId = useId();
  const installment = entry.dueOn === null ? null : installmentOf(recurring, entry.dueOn);
  const installmentText = installment ? installmentLabel(installment) : null;
  let status: string;
  let spoken: string;
  switch (entry.status) {
    case "paid":
      status = PAYMENTS_COPY.statusPaid(
        formatMoney(entry.expense.amountCents, entry.expense.currency),
      );
      spoken = PAYMENTS_COPY.statusPaidSpoken(
        spokenMoney(entry.expense.amountCents, entry.expense.currency),
      );
      break;
    case "skipped":
      status = spoken = PAYMENTS_COPY.statusSkipped;
      break;
    case "pending":
      status = spoken =
        settledNow === "paid"
          ? PAYMENTS_COPY.statusPaidNow
          : settledNow === "skipped"
            ? PAYMENTS_COPY.statusSkipped
            : PAYMENTS_COPY.statusPending;
      break;
    case "none":
      status = spoken = PAYMENTS_COPY.statusNotThisMonth;
      break;
  }
  const shown = entry.status === "pending" && settledNow ? settledNow : entry.status;
  return (
    <div className="bo-row bo-row--static" data-month-row={recurring.id} data-status={shown}>
      <span className="bo-row__body">
        <Link
          href={recurringPaymentPath(recurring.id)}
          className="bo-task-title bo-row-link bo-row__title w-fit"
          aria-describedby={metaId}
        >
          {recurring.name}
        </Link>
        <span id={metaId} hidden>
          {[
            entry.status === "none"
              ? entry.nextDue
                ? PAYMENTS_COPY.nextDueSpoken(spokenDay(entry.nextDue))
                : PAYMENTS_COPY.noMoreDues
              : [
                  PAYMENTS_COPY.dueSpoken(spokenDay(entry.dueOn)),
                  installmentText,
                  spokenExpected(recurring),
                ]
                  .filter(Boolean)
                  .join(", "),
            spoken,
          ].join(", ")}
        </span>
        <span className="bo-row__subtitle" aria-hidden>
          {entry.status === "none"
            ? entry.nextDue
              ? PAYMENTS_COPY.nextDue(shortDay(entry.nextDue))
              : PAYMENTS_COPY.noMoreDues
            : [shortDay(entry.dueOn), expectedAmount(recurring), installmentText]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "bo-row__trail bo-text-body-sm",
          entry.status === "paid" && "bo-amount text-text",
        )}
      >
        {status}
      </span>
    </div>
  );
}
