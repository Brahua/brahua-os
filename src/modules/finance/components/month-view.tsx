"use client";

import { Plus } from "lucide-react";
import { startTransition, useId, useOptimistic, useRef, useState } from "react";
import { Key } from "@/design-system";
import { deleteExpense, restoreExpense } from "../actions";
import type { ExpenseItem } from "../expense-input";
import { dayTitle, FINANCE_COPY, monthTitle } from "../finance-copy";
import { expenseRowText, groupByDay } from "../month-list";
import { ExpenseSheet } from "./expense-sheet";
import { useFinanceScreen } from "./finance-screen";

type SheetState = { key: number; open: boolean; expense: ExpenseItem | null };

type MonthViewProps = {
  /** YYYY-MM (Lima). */
  month: string;
  /** The month's visible expenses, the most recent first. */
  expenses: ExpenseItem[];
};

/**
 * "Mes" of /finance (SPEC-finance "Pantallas"): the month's header, "Registrar gasto" and its
 * expenses by day (the most recent first). A row opens "Editar gasto"; deleting is optimistic
 * with "Deshacer" in the screen's notices.
 *
 * Slots: F3 adds the month's total (`NumberFlow`) and its arrows in the header, the "Pendiente de
 * pagar" strip and the summary blocks above the list; the category bars filter the list.
 */
export function MonthView({ month, expenses }: MonthViewProps) {
  const { today, catalog, enqueue, toaster, announce } = useFinanceScreen();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const [shown, removeShown] = useOptimistic(expenses, (list, id: string) =>
    list.filter((expense) => expense.id !== id),
  );
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const addKey = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // Where focus goes when the sheet closes: the row (or key) that opened it, or a neighbor.
  const returnFocus = useRef<HTMLElement | null>(null);
  // What to say once the sheet has closed (an edit saved).
  const afterClose = useRef<string | null>(null);

  function openSheet(expense: ExpenseItem | null, opener: HTMLElement | null) {
    returnFocus.current = opener;
    setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true, expense }));
  }

  function closeSheet() {
    setSheet((previous) => (previous ? { ...previous, open: false } : previous));
  }

  /** The row after `id` (or before it), else the add key: where focus goes when it leaves. */
  function neighborOf(id: string): HTMLElement | null {
    const index = shown.findIndex((expense) => expense.id === id);
    const next = shown[index + 1] ?? shown[index - 1];
    return (next && rows.current.get(next.id)) ?? addKey.current ?? heading.current;
  }

  function restore(expense: ExpenseItem) {
    startTransition(async () => {
      const result = await enqueue(`expense-delete:${expense.id}`, () =>
        restoreExpense({ id: expense.id }),
      );
      if (result.kind === "done" && result.value.ok) {
        announce(FINANCE_COPY.restored);
        return;
      }
      if (result.kind === "skipped") return;
      toaster.push({
        title: FINANCE_COPY.notSavedTitle,
        text: `${FINANCE_COPY.notUndone} ${result.kind === "done" && !result.value.ok ? result.value.error : FINANCE_COPY.checkConnection}`,
        tone: "error",
      });
    });
  }

  function deleteRow(expense: ExpenseItem) {
    returnFocus.current = neighborOf(expense.id);
    closeSheet();
    const text = expenseRowText(expense);
    startTransition(async () => {
      removeShown(expense.id);
      const result = await enqueue(`expense-delete:${expense.id}`, () =>
        deleteExpense({ id: expense.id }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        toaster.push({
          title: FINANCE_COPY.deletedTitle,
          text: FINANCE_COPY.savedText(text.amount, text.label),
          action: { label: FINANCE_COPY.undo, run: () => restore(expense) },
        });
        return;
      }
      // Back in the list (the optimistic removal ends with the transition).
      toaster.push({
        title: FINANCE_COPY.notSavedTitle,
        text: `${FINANCE_COPY.notDeleted} ${result.kind === "done" && !result.value.ok ? result.value.error : FINANCE_COPY.checkConnection}`,
        tone: "error",
      });
    });
  }

  const groups = groupByDay(shown);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6" data-finance-month={month}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 ref={heading} id={headingId} tabIndex={-1} className="bo-text-title outline-none">
            {monthTitle(month)}
          </h2>
          {/* F3 slot (total del mes): NumberFlow in PEN, "+ USD … sin convertir", arrows. */}
        </div>
        <Key
          ref={addKey}
          variant="signal"
          icon={Plus}
          onClick={(event) => openSheet(null, event.currentTarget)}
          aria-haspopup="dialog"
        >
          {FINANCE_COPY.addExpense}
        </Key>
      </div>

      {/* F3 slot ("Pendiente de pagar" strip, linking to Pagos; then the summary blocks). */}

      {groups.length === 0 ? (
        <div className="bo-card max-w-160" data-finance-empty="">
          <p className="bo-text-body font-semibold">{FINANCE_COPY.emptyMonthTitle}</p>
          <p className="bo-text-body-sm text-text-secondary">{FINANCE_COPY.emptyMonthText}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => {
            const dayId = `${ids}-${group.day}`;
            return (
              <div key={group.day} className="flex flex-col gap-2">
                <h3 id={dayId} className="bo-section-label">
                  <span className="bo-section-label__title">{dayTitle(group.day, today)}</span>
                </h3>
                <ul aria-labelledby={dayId} className="bo-list">
                  {group.expenses.map((expense) => (
                    <li key={expense.id}>
                      <ExpenseRow
                        expense={expense}
                        ref={(element) => {
                          if (element) rows.current.set(expense.id, element);
                          else rows.current.delete(expense.id);
                        }}
                        onOpen={(element) => openSheet(expense, element)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {sheet ? (
        <ExpenseSheet
          key={sheet.key}
          open={sheet.open}
          onOpenChange={(open) => (open ? undefined : closeSheet())}
          returnFocusRef={returnFocus}
          expense={sheet.expense}
          catalog={catalog}
          today={today}
          onSaved={(saved) => {
            // An edit shows in its row: it is said once the sheet is gone (the page is hidden
            // from screen readers until then), not a notice (a plain notice would hold back the
            // next one's "Deshacer").
            if (sheet.expense) {
              const text = expenseRowText(saved);
              afterClose.current = `${FINANCE_COPY.editedTitle}: ${FINANCE_COPY.savedText(text.amount, text.label)}.`;
            }
          }}
          onClosed={() => {
            if (afterClose.current) announce(afterClose.current);
            afterClose.current = null;
          }}
          onDelete={deleteRow}
        />
      ) : null}
    </section>
  );
}

type ExpenseRowProps = {
  expense: ExpenseItem;
  onOpen: (element: HTMLButtonElement) => void;
  ref: React.Ref<HTMLButtonElement>;
};

/** One expense: what, amount (and "≈ S/" for USD), method; the whole row opens its edit sheet. */
function ExpenseRow({ expense, onOpen, ref }: ExpenseRowProps) {
  const text = expenseRowText(expense);
  const spoken = [text.amount, text.converted, ...text.meta].filter(Boolean).join(", ");
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      aria-label={`${FINANCE_COPY.editExpense(text.label, spoken)}`}
      onClick={(event) => onOpen(event.currentTarget)}
      className="bo-row"
      data-expense-row={expense.id}
    >
      <span className="bo-row__body" aria-hidden>
        <span className="bo-row__title truncate">{text.label}</span>
        {text.meta.length > 0 ? (
          <span className="bo-row__subtitle truncate">{text.meta.join(" · ")}</span>
        ) : null}
      </span>
      <span className="bo-row__trail flex-col items-end gap-0.5" aria-hidden>
        <span className="bo-amount bo-text-body text-text">{text.amount}</span>
        {text.converted ? (
          <span className="bo-amount bo-text-body-sm">{text.converted}</span>
        ) : null}
      </span>
    </button>
  );
}
