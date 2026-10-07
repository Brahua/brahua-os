"use client";

import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useRef, useState, useTransition } from "react";
import { Key } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { financeViewCookie, FINANCE_PATH } from "../routes";
import { formatMoney, spokenMoney } from "../money";
import {
  archiveRecurringPayment,
  deleteRecurringPayment,
  unarchiveRecurringPayment,
} from "../payment-actions";
import { DELETED_PAYMENT_PARAM } from "../payment-routes";
import {
  cycleSummary,
  installmentLabel,
  longDay,
  PAYMENTS_COPY,
  shortDay,
  spokenDay,
} from "../payments-copy";
import { installmentOf } from "../today-summary";
import type { RecurringItem, SettlementItem } from "../recurring-input";
import { useFinanceScreen } from "./finance-screen";
import { expectedAmount, spokenExpected } from "./payments-view";
import { RecurringSheet } from "./recurring-sheet";

type RecurringDetailProps = {
  item: RecurringItem;
  nextDues: string[];
  history: SettlementItem[];
  headingId: string;
};

/** " · Cuota 2 de 6" after a settled period's due date (nothing without installments). */
function historyInstallment(item: RecurringItem, dueOn: string) {
  const installment = installmentOf(item, dueOn);
  return installment ? <span>{` · ${installmentLabel(installment)}`}</span> : null;
}

function reason(result: { kind: string; value?: ActionResult<unknown> }): string {
  if (result.kind === "done" && result.value && !result.value.ok) return result.value.error;
  return PAYMENTS_COPY.checkConnection;
}

/**
 * A recurring payment's page (SPEC-finance "/finance/payments/[id]"): its data, the next 3 due
 * dates, the history of settled periods (paid with amount and date, skipped) and its actions:
 * edit, archive / reactivate (optimistic, with "Deshacer") and delete (back to Pagos, where
 * "Deshacer" waits in the notices).
 */
export function RecurringDetail({ item, nextDues, history, headingId }: RecurringDetailProps) {
  const { today, catalog, enqueue, toaster, announce } = useFinanceScreen();
  const router = useRouter();
  const ids = useId();
  const [archived, setArchived] = useOptimistic(item.archived);
  const [sheet, setSheet] = useState<{ key: number; open: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, startSaving] = useTransition();
  const editKey = useRef<HTMLButtonElement>(null);
  const afterClose = useRef<string | null>(null);

  function toggleArchived(next: boolean, undoable: boolean) {
    startSaving(async () => {
      setArchived(next);
      const result = await enqueue(`payment-archive:${item.id}`, () =>
        next
          ? archiveRecurringPayment({ id: item.id })
          : unarchiveRecurringPayment({ id: item.id }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        if (next && undoable) {
          toaster.push({
            title: PAYMENTS_COPY.archivedNotice(item.name),
            text: PAYMENTS_COPY.archiveHelp,
            action: { label: PAYMENTS_COPY.undo, run: () => toggleArchived(false, false) },
          });
        } else {
          announce(
            next
              ? PAYMENTS_COPY.archivedNotice(item.name)
              : PAYMENTS_COPY.reactivatedNotice(item.name),
          );
        }
        return;
      }
      toaster.push({
        title: PAYMENTS_COPY.notSavedTitle,
        text: reason(result),
        tone: "error",
      });
    });
  }

  function remove() {
    if (deleting) return;
    setDeleting(true);
    startSaving(async () => {
      const result = await enqueue(`payment-delete:${item.id}`, () =>
        deleteRecurringPayment({ id: item.id }),
      );
      if (result.kind === "done" && result.value.ok) {
        // Back to "Pagos", where the notice offers "Deshacer" (like habits and tasks).
        document.cookie = financeViewCookie("payments", window.location.protocol === "https:");
        router.push(`${FINANCE_PATH}?${DELETED_PAYMENT_PARAM}=${item.id}`);
        return;
      }
      setDeleting(false);
      if (result.kind === "skipped") return;
      toaster.push({ title: PAYMENTS_COPY.notSavedTitle, text: reason(result), tone: "error" });
    });
  }

  // [label, visible value, spoken value when it reads badly ("S/")]
  const facts: [string, string, string?][] = [
    [PAYMENTS_COPY.cycleFact, cycleSummary(item)],
    [PAYMENTS_COPY.amountFact, expectedAmount(item), spokenExpected(item)],
    [PAYMENTS_COPY.methodFact, item.paymentMethod?.name ?? PAYMENTS_COPY.noMethod],
    [PAYMENTS_COPY.categoryFact, item.category?.name ?? PAYMENTS_COPY.noCategory],
    [PAYMENTS_COPY.startFact, longDay(item.startDate)],
  ];
  if (item.notes) facts.push([PAYMENTS_COPY.notesFact, item.notes]);

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-8"
      data-payment-page={item.id}
      data-saving={saving ? "" : undefined}
    >
      <header className="flex flex-col gap-2">
        <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
          {item.name}
        </h1>
        {archived ? (
          <p className="bo-text-body-sm text-text-secondary" data-archived-badge="">
            {PAYMENTS_COPY.archivedBadge}
          </p>
        ) : null}
      </header>

      <section aria-labelledby={`${ids}-facts`} className="flex flex-col gap-3">
        <h2 id={`${ids}-facts`} className="bo-text-title">
          {PAYMENTS_COPY.facts}
        </h2>
        <dl className="bo-card grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr] sm:gap-x-6">
          {facts.map(([label, value, spoken]) => (
            <div key={label} className="contents">
              <dt className="bo-text-body-sm text-text-secondary">{label}</dt>
              <dd
                className={
                  spoken
                    ? "bo-amount bo-text-body"
                    : "bo-text-body whitespace-pre-wrap [overflow-wrap:anywhere]"
                }
              >
                {spoken ? (
                  <>
                    <span aria-hidden>{value}</span>
                    <span className="sr-only">{spoken}</span>
                  </>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby={`${ids}-next`} className="flex flex-col gap-3">
        <h2 id={`${ids}-next`} className="bo-text-title">
          {PAYMENTS_COPY.nextHeading}
        </h2>
        {nextDues.length === 0 ? (
          <p className="bo-card bo-text-body-sm max-w-160 text-text-secondary" data-next-empty="">
            {PAYMENTS_COPY.noMoreDues}
          </p>
        ) : (
          <ul aria-labelledby={`${ids}-next`} className="bo-list" data-next-dues="">
            {nextDues.map((due) => {
              const installment = installmentOf(item, due);
              return (
                <li key={due} className="bo-row bo-row--compact bo-row--static">
                  <span className="bo-row__body">
                    <span className="bo-row__title">
                      <time dateTime={due}>{longDay(due)}</time>
                    </span>
                  </span>
                  {installment ? (
                    <span className="bo-row__trail bo-text-body-sm" data-installment="">
                      {installmentLabel(installment)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${ids}-history`} className="flex flex-col gap-3">
        <h2 id={`${ids}-history`} className="bo-text-title">
          {PAYMENTS_COPY.historyHeading}
        </h2>
        {history.length === 0 ? (
          <p className="bo-card bo-text-body-sm max-w-160 text-text-secondary">
            {PAYMENTS_COPY.historyEmpty}
          </p>
        ) : (
          <ul aria-labelledby={`${ids}-history`} className="bo-list" data-history="">
            {history.map((settlement) => (
              <li
                key={settlement.dueOn}
                className="bo-row bo-row--static"
                data-history-row={settlement.status}
              >
                <span className="bo-row__body">
                  <span className="bo-row__title">
                    {settlement.expense ? (
                      <>
                        <span aria-hidden>
                          {PAYMENTS_COPY.historyPaid(
                            formatMoney(
                              settlement.expense.amountCents,
                              settlement.expense.currency,
                            ),
                            shortDay(settlement.expense.spentOn),
                          )}
                        </span>
                        <span className="sr-only">
                          {PAYMENTS_COPY.historyPaidSpoken(
                            spokenMoney(
                              settlement.expense.amountCents,
                              settlement.expense.currency,
                              settlement.expense.exchangeRateE4,
                            ),
                            spokenDay(settlement.expense.spentOn),
                          )}
                        </span>
                      </>
                    ) : (
                      PAYMENTS_COPY.historySkipped
                    )}
                  </span>
                  <span className="bo-row__subtitle">
                    <time dateTime={settlement.dueOn} aria-hidden>
                      {PAYMENTS_COPY.historyDue(shortDay(settlement.dueOn))}
                    </time>
                    {historyInstallment(item, settlement.dueOn)}
                    <span className="sr-only">
                      {PAYMENTS_COPY.historyDueSpoken(spokenDay(settlement.dueOn))}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <div className="flex flex-wrap gap-3">
          <Key
            ref={editKey}
            icon={Pencil}
            aria-haspopup="dialog"
            onClick={() => setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true }))}
          >
            {PAYMENTS_COPY.edit}
          </Key>
          {archived ? (
            <Key icon={ArchiveRestore} onClick={() => toggleArchived(false, false)}>
              {PAYMENTS_COPY.reactivate}
            </Key>
          ) : (
            <Key
              icon={Archive}
              aria-describedby={`${ids}-archive-help`}
              onClick={() => toggleArchived(true, true)}
            >
              {PAYMENTS_COPY.archive}
            </Key>
          )}
          <Key
            variant="ghost"
            icon={Trash2}
            aria-describedby={`${ids}-delete-help`}
            aria-disabled={deleting || undefined}
            onClick={remove}
          >
            {PAYMENTS_COPY.delete}
          </Key>
        </div>
        {archived ? null : (
          <p id={`${ids}-archive-help`} className="bo-field__help">
            {PAYMENTS_COPY.archiveHelp}
          </p>
        )}
        <p id={`${ids}-delete-help`} className="bo-field__help">
          {PAYMENTS_COPY.deleteHelp}
        </p>
      </section>

      {sheet ? (
        <RecurringSheet
          key={sheet.key}
          open={sheet.open}
          onOpenChange={(open) =>
            setSheet((previous) => (previous ? { ...previous, open } : previous))
          }
          returnFocusRef={editKey}
          recurring={item}
          catalog={catalog}
          today={today}
          onSaved={(saved) => {
            afterClose.current = PAYMENTS_COPY.saved(saved.name);
          }}
          onClosed={() => {
            const message = afterClose.current;
            afterClose.current = null;
            if (message) announce(message);
          }}
        />
      ) : null}
    </article>
  );
}
