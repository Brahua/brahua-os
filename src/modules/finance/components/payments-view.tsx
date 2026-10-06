"use client";

import { ChevronDown, Ellipsis, Plus } from "lucide-react";
import Link from "next/link";
import { useId, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Icon, IconKey, Key, Led } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { monthTitle } from "../finance-copy";
import { formatMoney, spokenMoney } from "../money";
import {
  markPaid,
  skipPeriod,
  undoPaid,
  undoSkipped,
  unarchiveRecurringPayment,
} from "../payment-actions";
import { cycleSummary, dueState, isUrgent, PAYMENTS_COPY, shortDay } from "../payments-copy";
import type { MonthEntry, PaymentsViewData, PendingPeriod } from "../payments-view";
import type { RecurringItem } from "../recurring-input";
import { recurringPaymentPath } from "../routes";
import { monthOfDay } from "../schedule";
import { useFinanceScreen } from "./finance-screen";
import { PaySheet, type PayOverrides } from "./pay-sheet";
import { RecurringSheet } from "./recurring-sheet";

/** A period's key: the queue key's tail and the optimistic set's member. */
export const periodKey = (period: { recurring: { id: string }; dueOn: string }) =>
  `${period.recurring.id}:${period.dueOn}`;

/** The expected amount, or "Monto variable". */
export function expectedAmount(recurring: RecurringItem): string {
  return recurring.amountCents === null
    ? PAYMENTS_COPY.variable
    : formatMoney(recurring.amountCents, recurring.currency);
}

/** The same for screen readers. */
function spokenExpected(recurring: RecurringItem): string {
  return recurring.amountCents === null
    ? PAYMENTS_COPY.variable
    : spokenMoney(recurring.amountCents, recurring.currency);
}

/** Why a save failed, for its notice. */
function reason(result: { kind: string; value?: ActionResult<unknown> }): string {
  if (result.kind === "done" && result.value && !result.value.ok) return result.value.error;
  return PAYMENTS_COPY.checkConnection;
}

type SheetState =
  | { key: number; open: boolean; kind: "pay"; period: PendingPeriod }
  | { key: number; open: boolean; kind: "new" };

/**
 * "Pagos" of /finance (SPEC-finance "Pantallas" → Pagos): Pendientes (overdue ≤ 60 days and due
 * within 7, oldest first) with "Pagado" (one tap; the "Pagado…" sheet for a variable amount), the
 * "Pagado…" / "Omitir este período" sheet and their "Deshacer"; Este mes; Todos with "Nuevo pago
 * recurrente"; Archivados (folded, "Reactivar").
 *
 * Pay and skip are optimistic: the row leaves at once and focus goes to the next row's "Pagado"
 * (or the previous one's, or the section's heading). Queue keys: `payment-period:<id>:<due>`
 * (pay, skip and their undo), `payment-archive:<id>`.
 */
export function PaymentsView({ data }: { data: PaymentsViewData }) {
  const { today, catalog, enqueue, toaster, announce } = useFinanceScreen();
  const ids = useId();
  const [settled, settle] = useOptimistic(new Set<string>(), (keys, key: string) =>
    new Set(keys).add(key),
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
  const payKeys = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLElement | null>(null);
  const createdName = useRef<string | null>(null);
  // After a one-tap pay the focused key unmounts: focus goes here once the row is gone.
  const focusAfter = useRef<{ gone: string; target: string | null } | null>(null);

  useLayoutEffect(() => {
    const after = focusAfter.current;
    if (!after || payKeys.current.has(after.gone)) return;
    focusAfter.current = null;
    const target = (after.target && payKeys.current.get(after.target)) || pendingHeading.current;
    target?.focus();
  });

  /** The key of the row after `key` (or before it), if any: where focus goes when it leaves. */
  function neighborKey(key: string): string | null {
    const index = pending.findIndex((period) => periodKey(period) === key);
    const next = pending[index + 1] ?? pending[index - 1];
    return next ? periodKey(next) : null;
  }

  function undo(period: PendingPeriod, kind: "paid" | "skipped") {
    const { recurring, dueOn } = period;
    startSaving(async () => {
      const result = await enqueue(`payment-period:${periodKey(period)}`, () =>
        kind === "paid"
          ? undoPaid({ id: recurring.id, dueOn })
          : undoSkipped({ id: recurring.id, dueOn }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        announce(
          kind === "paid"
            ? PAYMENTS_COPY.undonePaid(recurring.name)
            : PAYMENTS_COPY.undoneSkip(recurring.name),
        );
        return;
      }
      toaster.push({
        title: PAYMENTS_COPY.notSavedTitle,
        text: `${PAYMENTS_COPY.notUndone} ${reason(result)}`,
        tone: "error",
      });
    });
  }

  function pay(period: PendingPeriod, overrides: PayOverrides | null) {
    const key = periodKey(period);
    const { recurring, dueOn } = period;
    startSaving(async () => {
      settle(key);
      const result = await enqueue(`payment-period:${key}`, () =>
        markPaid({ id: recurring.id, dueOn, ...(overrides ?? {}) }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        const { expense } = result.value.data;
        toaster.push({
          title: PAYMENTS_COPY.paidTitle,
          text: PAYMENTS_COPY.paidText(
            recurring.name,
            spokenMoney(expense.amountCents, expense.currency, expense.exchangeRateE4),
          ),
          action: { label: PAYMENTS_COPY.undo, run: () => undo(period, "paid") },
        });
        return;
      }
      // Back in the list (the optimistic removal ends with the transition), unless it was
      // already paid: the page's new data leaves it out.
      toaster.push({
        title: PAYMENTS_COPY.notSavedTitle,
        text: `${PAYMENTS_COPY.notPaid} ${reason(result)}`,
        tone: "error",
      });
    });
  }

  function skip(period: PendingPeriod) {
    const key = periodKey(period);
    const { recurring, dueOn } = period;
    startSaving(async () => {
      settle(key);
      const result = await enqueue(`payment-period:${key}`, () =>
        skipPeriod({ id: recurring.id, dueOn }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        toaster.push({
          title: PAYMENTS_COPY.skippedTitle,
          text: PAYMENTS_COPY.skippedText(recurring.name, shortDay(dueOn)),
          action: { label: PAYMENTS_COPY.undo, run: () => undo(period, "skipped") },
        });
        return;
      }
      toaster.push({
        title: PAYMENTS_COPY.notSavedTitle,
        text: `${PAYMENTS_COPY.notSkipped} ${reason(result)}`,
        tone: "error",
      });
    });
  }

  function payNow(period: PendingPeriod) {
    const key = periodKey(period);
    focusAfter.current = { gone: key, target: neighborKey(key) };
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
        text: `${PAYMENTS_COPY.notUndone} ${reason(result)}`,
        tone: "error",
      });
    });
  }

  const sectionIds = {
    pending: `${ids}-pending`,
    month: `${ids}-month`,
    all: `${ids}-all`,
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
          className="bo-text-title outline-none"
        >
          {PAYMENTS_COPY.pendingHeading}
        </h2>
        {pending.length === 0 ? (
          <p
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
                <MonthRow entry={entry} />
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
                  data-payment-link={recurring.id}
                >
                  <span className="bo-row__body">
                    <span className="bo-row__title truncate">{recurring.name}</span>
                    <span className="bo-row__subtitle">
                      {[cycleSummary(recurring), recurring.paymentMethod?.name]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="bo-row__trail flex-col items-end gap-0.5">
                    <span className="bo-amount bo-text-body text-text">
                      {expectedAmount(recurring)}
                    </span>
                    <span className="bo-text-body-sm">
                      {PAYMENTS_COPY.nextDue(shortDay(nextDue))}
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
          <summary className="bo-text-body-sm flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-md font-semibold text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <Icon icon={ChevronDown} size="sm" className="group-open:rotate-180" />
            {PAYMENTS_COPY.archivedHeading(archived.length)}
          </summary>
          <ul className="bo-list mt-3">
            {archived.map((item) => (
              <li key={item.id} className="bo-row">
                <span className="bo-row__body">
                  <Link
                    href={recurringPaymentPath(item.id)}
                    className="bo-task-title bo-row__title w-fit"
                  >
                    {item.name}
                  </Link>
                  <span className="bo-row__subtitle">{cycleSummary(item)}</span>
                </span>
                <Key
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
  return (
    <div className="bo-row bo-payment-row" data-pending-row={periodKey(period)}>
      <span className="bo-row__body">
        <Link
          href={recurringPaymentPath(recurring.id)}
          className="bo-task-title bo-row__title w-fit"
          aria-describedby={metaId}
        >
          {recurring.name}
        </Link>
        <span id={metaId} hidden>
          {[due.label, spokenExpected(recurring), recurring.paymentMethod?.name]
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
          {recurring.paymentMethod ? (
            <span className="text-text-secondary">{recurring.paymentMethod.name}</span>
          ) : null}
        </span>
      </span>
      <span className="bo-row__trail">
        <Key
          ref={payRef}
          variant="signal"
          aria-haspopup={variable ? "dialog" : undefined}
          aria-label={
            variable
              ? PAYMENTS_COPY.payWithAmount(recurring.name, due.label.toLowerCase())
              : PAYMENTS_COPY.payNamed(recurring.name, due.label.toLowerCase())
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

/** A row of "Este mes": the period's day and its status. */
function MonthRow({ entry }: { entry: MonthEntry }) {
  const { recurring } = entry;
  let status: string;
  switch (entry.status) {
    case "paid":
      status = PAYMENTS_COPY.statusPaid(
        formatMoney(entry.expense.amountCents, entry.expense.currency),
      );
      break;
    case "skipped":
      status = PAYMENTS_COPY.statusSkipped;
      break;
    case "pending":
      status = PAYMENTS_COPY.statusPending;
      break;
    case "none":
      status = PAYMENTS_COPY.statusNotThisMonth;
      break;
  }
  return (
    <div className="bo-row" data-month-row={recurring.id} data-status={entry.status}>
      <span className="bo-row__body">
        <Link
          href={recurringPaymentPath(recurring.id)}
          className="bo-task-title bo-row__title w-fit"
        >
          {recurring.name}
        </Link>
        <span className="bo-row__subtitle">
          {entry.status === "none"
            ? PAYMENTS_COPY.nextDue(shortDay(entry.nextDue))
            : `${shortDay(entry.dueOn)} · ${expectedAmount(recurring)}`}
        </span>
      </span>
      <span
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
