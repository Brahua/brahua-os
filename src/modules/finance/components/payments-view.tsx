"use client";

import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { useId, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Icon, Key } from "@/design-system";
import { formatMoney, spokenMoney } from "../money";
import { unarchiveRecurringPayment } from "../payment-actions";
import { failureText } from "../payment-completion";
import { cycleSummary, PAYMENTS_COPY, shortDay, spokenDay } from "../payments-copy";
import type { MonthEntry, PaymentsViewData } from "../payments-view";
import type { RecurringItem } from "../recurring-input";
import { recurringPaymentPath } from "../routes";
import { useFinanceScreen } from "./finance-screen";
import { ViewPanel } from "./finance-views";
import { expectedAmount, spokenExpected } from "./payment-format";
import { RecurringSheet } from "./recurring-sheet";

// Kept for the payment's page, which imports them from here.
export { expectedAmount, spokenExpected };

type SheetState = { key: number; open: boolean };

/**
 * This month's state of each payment, for its row: pending wins over paid over skipped (a weekly
 * payment can have several periods in a month); none when it does not fall in it.
 */
export function monthStatusOf(entries: readonly MonthEntry[]): Map<string, MonthEntry> {
  const rank = { pending: 3, paid: 2, skipped: 1, none: 0 } as const;
  const map = new Map<string, MonthEntry>();
  for (const entry of entries) {
    const current = map.get(entry.recurring.id);
    if (!current || rank[entry.status] > rank[current.status]) map.set(entry.recurring.id, entry);
  }
  return map;
}

/** The row's words for this month's state (null: it does not fall in this month). */
function monthStateOf(entry: MonthEntry | undefined): { text: string; spoken: string } | null {
  if (!entry || entry.status === "none") return null;
  if (entry.status === "paid") {
    const { amountCents, currency } = entry.expense;
    return {
      text: PAYMENTS_COPY.statusPaid(formatMoney(amountCents, currency)),
      spoken: PAYMENTS_COPY.statusPaidSpoken(spokenMoney(amountCents, currency)),
    };
  }
  const text =
    entry.status === "skipped" ? PAYMENTS_COPY.statusSkipped : PAYMENTS_COPY.statusPending;
  return { text, spoken: text };
}

/**
 * «Recurrentes» of /finance: the upkeep of the recurring payments. Every active payment with its
 * cycle, method, expected amount, next due date and this month's state, "Nuevo pago recurrente",
 * and «Archivados» (folded, "Reactivar"). Paying and skipping live in «Gastos» (`PendingPayments`);
 * each row opens the payment's page to edit, archive or delete it.
 *
 * Reactivating is optimistic: the row leaves at once and focus goes to a neighbor (or the fold).
 * Queue key: `payment-archive:<id>`.
 */
export function PaymentsView({ data }: { data: PaymentsViewData }) {
  const { today, catalog, enqueue, toaster, announce } = useFinanceScreen();
  const ids = useId();
  const [reactivated, reactivate] = useOptimistic(new Set<string>(), (keys, id: string) =>
    new Set(keys).add(id),
  );
  const archived = data.archived.filter((item) => !reactivated.has(item.id));
  const statuses = monthStatusOf(data.thisMonth);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  // Reactivate: `data-saving` while it is in flight (E2E waits on it).
  const [saving, startSaving] = useTransition();

  const newKey = useRef<HTMLButtonElement>(null);
  const archivedSummary = useRef<HTMLElement>(null);
  const reactivateKeys = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLElement | null>(null);
  const createdName = useRef<string | null>(null);
  const reactivateFocus = useRef<{ gone: string; target: string | null } | null>(null);

  useLayoutEffect(() => {
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

  function openNew(opener: HTMLElement) {
    returnFocus.current = opener;
    setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true }));
  }

  function closeSheet() {
    setSheet((previous) => (previous ? { ...previous, open: false } : previous));
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
    all: `${ids}-all`,
    archived: `${ids}-archived`,
  };

  return (
    <div className="contents" data-payments-view="" data-saving={saving ? "" : undefined}>
      <ViewPanel section="recurrentes" className="flex flex-col gap-8">
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
              {data.active.map(({ recurring, nextDue }) => {
                const state = monthStateOf(statuses.get(recurring.id));
                return (
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
                        state?.spoken,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      data-payment-link={recurring.id}
                    >
                      <span className="bo-row__body" aria-hidden>
                        <span className="bo-row__title truncate">{recurring.name}</span>
                        <span className="bo-row__subtitle">
                          {[cycleSummary(recurring), recurring.paymentMethod?.name, state?.text]
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
                );
              })}
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
                    <span className="bo-row__subtitle">
                      {item.archived
                        ? cycleSummary(item)
                        : `${cycleSummary(item)} · ${PAYMENTS_COPY.endedLabel}`}
                    </span>
                  </span>
                  {/* A plan that ended unsettled isn't archived: there is nothing to reactivate. */}
                  {item.archived ? (
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
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </ViewPanel>
      {sheet ? (
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
