"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { Key } from "@/design-system";
import { deleteExpense, restoreExpense } from "../actions";
import type { ExpenseItem } from "../expense-input";
import { dayTitle, FINANCE_COPY, monthTitle } from "../finance-copy";
import { expenseRowText, groupByDay } from "../month-list";
import { FIRST_MONTH, monthHref, shiftMonth } from "../routes";
import {
  expenseCategoryKey,
  groupKey,
  summarizeMonth,
  type MonthPending,
  type SummaryGroup,
} from "../summary";
import { spokenTotal, SUMMARY_COPY } from "../summary-copy";
import { ExpenseSheet } from "./expense-sheet";
import { useFinanceScreen } from "./finance-screen";
import {
  CategoryBars,
  MethodRows,
  MonthArrow,
  MonthTotal,
  PendingStrip,
  RecurringSplit,
} from "./month-summary";

type SheetState = { key: number; open: boolean; expense: ExpenseItem | null };

/** The list's filter: a category (or "none") of one month; another month shows no filter. */
type CategoryFilter = { month: string; key: string; name: string };

type MonthViewProps = {
  /** YYYY-MM (Lima). */
  month: string;
  /** The month's visible expenses, the most recent first. */
  expenses: ExpenseItem[];
  /**
   * "Pendiente de pagar" of the month (F2's recurring payments still due); null: nothing to show
   * (F2 slot: the page passes null until `getPendingForMonth` is wired).
   */
  pending?: MonthPending | null;
};

/**
 * "Mes" of /finance (SPEC-finance "Pantallas", "Resumen"): the month with its arrows and total
 * (`NumberFlow`), "Pendiente de pagar", the summary (by category, by payment method, recurring and
 * one-off) and the expenses by day (the most recent first). A category's bar filters the list. A
 * row opens "Editar gasto"; deleting is optimistic (the summary follows at once) with "Deshacer"
 * in the screen's notices.
 */
export function MonthView({ month, expenses, pending = null }: MonthViewProps) {
  const { today, catalog, enqueue, toaster, announce, openSettings } = useFinanceScreen();
  const router = useRouter();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const listHeadingId = `${ids}-list`;
  const [shown, removeShown] = useOptimistic(expenses, (list, id: string) =>
    list.filter((expense) => expense.id !== id),
  );
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [filter, setFilter] = useState<CategoryFilter | null>(null);
  const [navigating, startNavigation] = useTransition();
  const addKey = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const categoriesHeading = useRef<HTMLHeadingElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const bars = useRef(new Map<string, HTMLButtonElement>());
  // Where focus goes when the sheet closes: the row (or key) that opened it, or a neighbor.
  const returnFocus = useRef<HTMLElement | null>(null);
  // What to say, and where focus goes, once the sheet has closed after an edit.
  const afterClose = useRef<{ message: string; id: string; neighbor: string | null } | null>(null);

  const currentMonth = today.slice(0, 7);
  const summary = useMemo(() => summarizeMonth(month, shown), [month, shown]);
  // A filter belongs to the month it was set on: the arrows leave it behind.
  const active = filter?.month === month ? filter : null;
  const listed = active
    ? shown.filter((expense) => expenseCategoryKey(expense) === active.key)
    : shown;

  // Another month arrived (the arrows, or back/forward): say which and its total, once.
  const shownMonth = useRef(month);
  const monthMessage = SUMMARY_COPY.monthShown(
    monthTitle(month),
    spokenTotal(summary.total.penCents, summary.total.unconvertedUsdCents),
  );
  useEffect(() => {
    if (shownMonth.current === month) return;
    shownMonth.current = month;
    announce(monthMessage);
  }, [month, monthMessage, announce]);

  function goToMonth(target: string) {
    startNavigation(() => {
      router.push(monthHref(target, currentMonth), { scroll: false });
    });
  }

  function toggleCategory(group: SummaryGroup) {
    const key = groupKey(group);
    if (active?.key === key) {
      setFilter(null);
      announce(SUMMARY_COPY.filterOff(shown.length));
      return;
    }
    const name = group.name ?? SUMMARY_COPY.uncategorized;
    setFilter({ month, key, name });
    const count = shown.filter((expense) => expenseCategoryKey(expense) === key).length;
    announce(SUMMARY_COPY.filterOn(name, count));
  }

  function clearFilter() {
    // "Quitar filtro" goes away: focus returns to the bar that set the filter (or its heading).
    const bar = active ? bars.current.get(active.key) : undefined;
    setFilter(null);
    announce(SUMMARY_COPY.filterOff(shown.length));
    (bar ?? categoriesHeading.current)?.focus();
  }

  function openSheet(expense: ExpenseItem | null, opener: HTMLElement | null) {
    returnFocus.current = opener;
    setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true, expense }));
  }

  function closeSheet() {
    setSheet((previous) => (previous ? { ...previous, open: false } : previous));
  }

  /** The id of the listed row after `id` (or before it), if any. */
  function neighborIdOf(id: string): string | null {
    const index = listed.findIndex((expense) => expense.id === id);
    return (listed[index + 1] ?? listed[index - 1])?.id ?? null;
  }

  /** The listed row after `id` (or before it), else the add key: where focus goes when it leaves. */
  function neighborOf(id: string): HTMLElement | null {
    const neighbor = neighborIdOf(id);
    return (neighbor ? rows.current.get(neighbor) : undefined) ?? addKey.current ?? heading.current;
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
          text: FINANCE_COPY.savedText(text.spoken, text.label),
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

  const groups = groupByDay(listed);
  const previous = month > FIRST_MONTH ? shiftMonth(month, -1) : null;
  const next = month < currentMonth ? shiftMonth(month, 1) : null;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={navigating || undefined}
      className="flex flex-col gap-6"
      data-finance-month={month}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-1">
            <MonthArrow
              direction="previous"
              targetTitle={previous ? monthTitle(previous) : null}
              onGo={() => previous && goToMonth(previous)}
            />
            <h2
              ref={heading}
              id={headingId}
              tabIndex={-1}
              className="bo-text-title min-w-0 px-1 outline-none"
            >
              {monthTitle(month)}
            </h2>
            <MonthArrow
              direction="next"
              targetTitle={next ? monthTitle(next) : null}
              onGo={() => next && goToMonth(next)}
            />
          </div>
          <MonthTotal
            total={summary.total}
            rateSet={catalog.usdToPenE4 !== null}
            onSetRate={(opener) => openSettings(opener)}
          />
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

      <PendingStrip pending={pending} />

      {shown.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" data-month-summary="">
          <CategoryBars
            categories={summary.categories}
            activeKey={active?.key ?? null}
            onToggle={toggleCategory}
            registerBar={(key, element) => {
              if (element) bars.current.set(key, element);
              else bars.current.delete(key);
            }}
            headingRef={categoriesHeading}
          />
          <div className="flex flex-col gap-6">
            <MethodRows methods={summary.methods} />
            <RecurringSplit summary={summary} />
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="bo-card max-w-160" data-finance-empty="">
          <p className="bo-text-body font-semibold">{FINANCE_COPY.emptyMonthTitle}</p>
          <p className="bo-text-body-sm text-text-secondary">{FINANCE_COPY.emptyMonthText}</p>
        </div>
      ) : (
        <section aria-labelledby={listHeadingId} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h3 id={listHeadingId} className="bo-text-subheading">
              {SUMMARY_COPY.listHeading}
            </h3>
            {active ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-month-filter="">
                <p className="bo-text-body-sm text-text-secondary">
                  {`${SUMMARY_COPY.filteredBy(active.name)} · ${SUMMARY_COPY.expenses(listed.length)}`}
                </p>
                <Key variant="ghost" size="sm" icon={X} onClick={clearFilter}>
                  {SUMMARY_COPY.clearFilter}
                </Key>
              </div>
            ) : null}
          </div>
          {groups.length === 0 ? (
            <p className="bo-card bo-text-body-sm max-w-160 text-text-secondary">
              {active ? SUMMARY_COPY.emptyFiltered(active.name) : null}
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => {
                const dayId = `${ids}-${group.day}`;
                return (
                  <div key={group.day} className="flex flex-col gap-2">
                    <h4 id={dayId} className="bo-section-label">
                      <span className="bo-section-label__title">{dayTitle(group.day, today)}</span>
                    </h4>
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
        </section>
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
            if (!sheet.expense) return;
            const text = expenseRowText(saved);
            afterClose.current = {
              message: `${FINANCE_COPY.editedTitle}: ${FINANCE_COPY.savedText(text.spoken, text.label)}.`,
              id: saved.id,
              neighbor: neighborIdOf(saved.id),
            };
          }}
          onClosed={() => {
            const after = afterClose.current;
            afterClose.current = null;
            if (!after) return;
            // A new date can move the row to another day (a new element) or out of the month,
            // and a new category out of a filtered list: focus goes to the row as it is now,
            // else a neighbor, else the month's heading.
            const target =
              rows.current.get(after.id) ??
              (after.neighbor ? rows.current.get(after.neighbor) : undefined) ??
              heading.current;
            target?.focus();
            announce(after.message);
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
  const spoken = [text.spoken, ...text.meta].join(", ");
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
